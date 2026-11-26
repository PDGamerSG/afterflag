import { randomBytes } from 'node:crypto';
import { evaluatedFlag, request } from '../flagsmith.mjs';

export const FLAGSMITH_RELEASE = '2.295.2';
export const FLAGSMITH_DIGEST = 'sha256:48905c664152d8ae2c843ec9cee72ff197e7caff6e91b959bb851a235915ea35';

export async function observeHold({ baseUrl, environmentKey, holdFlag }) {
  const flag = await request(baseUrl, '/api/v1/flags/?feature=' + encodeURIComponent(holdFlag), { environmentKey });
  return evaluatedFlag(flag, holdFlag);
}

export async function bootstrapFlagsmith(baseUrl) {
  const version = await request(baseUrl, '/version/');
  if (version?.self_hosted_data?.has_users !== false) {
    throw new Error('Afterflag requires a fresh disposable Flagsmith instance.');
  }
  const password = randomBytes(24).toString('base64url');
  const account = await request(baseUrl, '/api/v1/auth/users/', {
    method: 'POST',
    body: {
      email: 'lab@afterflag.example', first_name: 'Afterflag', last_name: 'Lab',
      password, re_password: password, superuser: true
    }
  });
  const admin = (path, opts) => request(baseUrl, '/api/v1' + path, { ...opts, token: account.key });
  const create = (path, body) => admin(path, { method: 'POST', body });
  return async function provision(manifest) {
    const label = 'Afterflag ' + manifest.title + ' ' + randomBytes(3).toString('hex');
    const organisation = await create('/organisations/', { name: label });
    const project = await create('/projects/', {
      organisation: organisation.id, name: 'Afterflag release proof'
    });
    const environment = await create('/environments/', {
      name: 'Rehearsal', project: project.id, allow_client_traits: true
    });
    if (environment.use_v2_feature_versioning || environment.allow_client_traits !== true) {
      throw new Error('The disposable Flagsmith environment does not support the required local policy.');
    }

    const environmentPath = '/environments/' + encodeURIComponent(environment.api_key);
    const projectPath = '/projects/' + project.id;
    const holdFlag = manifest.flags.hold;
    const codecFlag = manifest.flags.codec;
    const workerConfig = { baseUrl, environmentKey: environment.api_key, holdFlag };
    const addFlag = (name, initial) => create(projectPath + '/features/', {
      type: 'STANDARD', name, initial_value: initial, default_enabled: false
    });
    const [codec, hold, segment, provider] = await Promise.all([
      addFlag(codecFlag, manifest.codecs.old),
      addFlag(holdFlag, null),
      create(projectPath + '/segments/', {
        name: 'Pilot', project: project.id, rules: [{
          type: 'ALL', rules: [], conditions: [{ operator: 'EQUAL', property: 'ring', value: 'pilot' }]
        }]
      }),
      create(projectPath + '/feature-health/providers/', { name: 'Webhook' })
    ]);
    const webhookPath = new URL(provider.webhook_url).pathname;
    if (!webhookPath.startsWith('/api/')) throw new Error('Flagsmith returned an invalid Feature Health route.');
    const observedHealthIds = new Set();

    async function patchDefault(feature, enabled, value) {
      const page = await admin(environmentPath + '/featurestates/?feature=' + feature.id);
      const state = page.results?.find((entry) => entry.feature_segment === null && entry.identity === null);
      if (!state) throw new Error('Flagsmith did not provide the environment default state.');
      await admin(environmentPath + '/featurestates/' + state.id + '/', {
        method: 'PATCH', body: { enabled, ...(value === undefined ? {} : { feature_state_value: value }) }
      });
    }

    return {
      workerConfig,
      provenance: {
        version: FLAGSMITH_RELEASE, imageDigest: FLAGSMITH_DIGEST,
        projectId: project.id, environmentId: environment.id, codecFeatureId: codec.id, provider: 'Flagsmith REST'
      },
      async codec(ring) {
        const evaluated = await request(baseUrl, '/api/v1/identities/', {
          method: 'POST', environmentKey: environment.api_key,
          body: { transient: true, traits: [{ trait_key: 'ring', trait_value: ring }] }
        });
        const flag = evaluated.flags?.find((entry) => entry.feature?.name === codecFlag);
        const decision = evaluatedFlag(flag, codecFlag);
        const expected = decision.enabled ? manifest.codecs.new : manifest.codecs.old;
        if (decision.value !== expected) throw new Error('The Flagsmith codec value disagrees with its state.');
        return { ...decision, ring, codec: decision.value, segmentMatched: flag.feature_segment != null };
      },
      hold: () => observeHold(workerConfig),
      setHold: (enabled) => patchDefault(hold, enabled),
      openPilot: () => create(environmentPath + '/features/' + codec.id + '/create-segment-override/', {
        enabled: true, feature_segment: { segment: segment.id, priority: 0 },
        feature_state_value: { type: 'unicode', string_value: manifest.codecs.new }
      }),
      promote: () => patchDefault(codec, true, manifest.codecs.new),
      async health(type, reason) {
        await request(baseUrl, webhookPath, {
          method: 'POST',
          body: {
            feature: codecFlag, environment: environment.name, status: type.toLowerCase(),
            reason: { text_blocks: [{ title: 'Afterflag release check', text: reason }], url_blocks: [] }
          }
        });
        const events = await admin(projectPath + '/feature-health/events/');
        const event = events.find((item) => item.type === type && item.feature === codec.id &&
          item.environment === environment.id && item.reason?.text_blocks?.[0]?.text === reason &&
          !observedHealthIds.has(item.id));
        if (!event) throw new Error('Flagsmith Feature Health event was not observed.');
        observedHealthIds.add(event.id);
        return { id: event.id, type: event.type, at: event.created_at, featureId: event.feature, environmentId: event.environment };
      }
    };
  };
}

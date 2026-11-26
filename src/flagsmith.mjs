import { createHash } from 'node:crypto';

const cleanBase = (value) => String(value).replace(/\/+$/, '');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function request(baseUrl, path, options = {}) {
  const { method = 'GET', token, environmentKey, body } = options;
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = 'Token ' + token;
  if (environmentKey) headers['x-environment-key'] = environmentKey;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(cleanBase(baseUrl) + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = { raw: text };
  }
  if (!response.ok) {
    const error = new Error('Flagsmith ' + method + ' ' + path + ' returned ' + response.status);
    error.status = response.status;
    error.details = value;
    throw error;
  }
  return value;
}

export function createFlagsmithClient({
  baseUrl = 'http://127.0.0.1:18000',
  token,
  environmentKey,
  projectId,
  codecFlag = 'afterflag_codec_v2',
  holdFlag = 'afterflag_hold'
} = {}) {
  const api = (path, options) => request(baseUrl, path, { ...options, token });

  async function findFeature(name) {
    if (!projectId) throw new Error('FLAGSMITH_PROJECT_ID is required for admin flag writes');
    const page = await api('/api/v1/projects/' + projectId + '/features/?page_size=100');
    return page.results?.find((item) => item.name === name) ?? null;
  }

  return {
    async feature(name) {
      return request(baseUrl, '/api/v1/flags/?feature=' + encodeURIComponent(name), { environmentKey });
    },
    async decision(name) {
      const flag = await this.feature(name);
      const returnedName = flag?.feature?.name ?? flag?.feature_name;
      if (!flag || flag.is_default || (returnedName && returnedName !== name)) {
        throw new Error('Flagsmith did not return an explicit decision for ' + name);
      }
      return {
        name,
        enabled: Boolean(flag.enabled),
        value: flag.feature_state_value?.string_value ?? flag.value ?? null,
        observedAt: new Date().toISOString(),
        digest: sha256(JSON.stringify(flag))
      };
    },
    async configureFeature({ projectId, name, defaultEnabled = false }) {
      return api('/api/v1/projects/' + projectId + '/features/', {
        method: 'POST',
        body: { name, type: 'STANDARD', default_enabled: defaultEnabled }
      });
    },
    async ensureFeature(name) {
      const existing = await findFeature(name);
      return existing ?? this.configureFeature({ projectId, name });
    },
    async prepare() {
      const codec = await this.ensureFeature(codecFlag);
      const hold = await this.ensureFeature(holdFlag);
      await this.setCodec(false, codec.id);
      await this.setHold(false, hold.id);
      return { codec, hold };
    },
    async featureState({ featureId, enabled, value }) {
      const feature = typeof featureId === 'number' ? { id: featureId } : await findFeature(featureId);
      if (!feature) throw new Error('Flagsmith feature not found: ' + featureId);
      const states = await api(
        '/api/v1/environments/' + environmentKey + '/featurestates/?feature=' + feature.id
      );
      const state = states.results?.[0];
      if (!state) throw new Error('No state for feature ' + featureId);
      return api('/api/v1/environments/' + environmentKey + '/featurestates/' + state.id + '/', {
        method: 'PATCH',
        body: {
          enabled,
          ...(value === undefined ? {} : { feature_state_value: value })
        }
      });
    },
    async setCodec(enabled, featureId) {
      return this.featureState({ featureId: featureId ?? codecFlag, enabled, value: enabled ? 'v2' : 'v1' });
    },
    async setHold(enabled, featureId) {
      return this.featureState({ featureId: featureId ?? holdFlag, enabled });
    },
    codecFlag,
    holdFlag
  };
}

export { request };

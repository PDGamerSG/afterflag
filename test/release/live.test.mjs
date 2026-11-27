import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootstrapFlagsmith } from '../../src/release/policy.mjs';
import { loadManifest, sha256 } from '../../src/release/manifest.mjs';
import { rehearse } from '../../src/release/rehearse.mjs';
import { createEvidence, evaluate, verifyEvidence } from '../../src/release/evidence.mjs';

const databaseUrl = process.env.AFTERFLAG_TEST_DB;
const flagsmithUrl = process.env.AFTERFLAG_TEST_FLAGSMITH;
const live = Boolean(databaseUrl && flagsmithUrl);

test('real Flagsmith and PostgreSQL prove two contracts and detect a delivery regression', { skip: !live }, async () => {
  const provision = await bootstrapFlagsmith(flagsmithUrl);
  const contracts = [
    { name: 'document-export', verdict: 'ready', output: 'release-report.json' },
    { name: 'document-export', verdict: 'blocked', output: 'blocked-report.json' },
    { name: 'webhook-delivery', verdict: 'ready', output: 'webhook-report.json' }
  ];
  for (const { name, verdict, output } of contracts) {
    const plan = await loadManifest('scenarios/' + name + '.json');
    const policy = await provision(plan.manifest);
    const report = await rehearse({
      plan, databaseUrl, policy, source: process.env.AFTERFLAG_SOURCE,
      stopBeforeDrain: verdict === 'blocked'
    });
    const path = process.env.AFTERFLAG_INTEGRATION_ARTIFACTS;
    if (path) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, output), JSON.stringify(report, null, 2) + '\n');
    }
    const computed = verifyEvidence(report, { requireLive: true, manifest: plan.digest });
    assert.equal(computed.status, verdict, JSON.stringify({
      errors: report.events.filter((event) => event.kind === 'error'),
      checks: computed.checks.filter((item) => item.status !== 'pass')
    }));
    const unsafe = report.events.find((event) => event.kind === 'blocker');
    assert.equal(unsafe.data.candidate.job.inputDigest,
      report.events.find((event) => event.kind === 'legacy-admitted').data.job.inputDigest);
    if (verdict === 'ready') {
      assert.ok(computed.checks.every((check) => check.status === 'pass'));
      const missingDigest = structuredClone(report);
      delete missingDigest.events.find((event) => event.kind === 'retired').data.replay.inputDigestObserved;
      assert.equal(evaluate(missingDigest).checks.find((check) => check.id === 'retirement').status, 'fail');
      const rebuilt = createEvidence({ id: report.id, metadata: report.metadata });
      for (const { kind, data } of report.events) {
        const changed = structuredClone(data);
        if (kind === 'candidate') changed.worker.codecs = [plan.manifest.codecs.old, plan.manifest.codecs.new];
        rebuilt.add(kind, changed);
      }
      assert.equal(verifyEvidence(rebuilt.finish()).status, 'blocked');
      report.events[2].data.job.codec = 'forged';
      assert.throws(() => verifyEvidence(report), /Evidence chain mismatch/);
    }
  }

  const regression = await loadManifest('scenarios/webhook-delivery.json');
  const original = Buffer.from(regression.artifacts.candidate.source, 'base64').toString('utf8');
  const altered = original.replace("return subscriber + ':' + event.type;", "return 'default:' + event.type;");
  assert.notEqual(altered, original);
  regression.artifacts.candidate = {
    source: Buffer.from(altered).toString('base64'),
    digest: sha256(altered)
  };
  const outcome = await rehearse({
    plan: regression, databaseUrl, policy: await provision(regression.manifest), source: process.env.AFTERFLAG_SOURCE
  });
  const verified = verifyEvidence(outcome, { requireLive: true, manifest: regression.digest });
  assert.equal(verified.status, 'blocked');
  assert.deepEqual(verified.checks.filter((item) => item.status === 'fail').map(({ id }) => id), ['candidate']);
  assert.equal(verified.checks.find((item) => item.id === 'redelivery').status, 'pass');
  const failedDelivery = outcome.events.find((event) => event.kind === 'candidate').data.worker;
  assert.equal(failedDelivery.status, 'artifact-mismatch');
  assert.equal(failedDelivery.artifactDigestObserved, sha256('default:invoice.updated'));
  assert.equal(failedDelivery.expectedArtifactDigest, outcome.metadata.specimens.replacement.artifactDigest);
  assert.ok(!outcome.events.some((event) => ['retired', 'health-ready'].includes(event.kind)));
});

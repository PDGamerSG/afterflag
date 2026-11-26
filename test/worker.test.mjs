import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openLedger } from '../src/ledger.mjs';
import { runWorker } from '../src/worker.mjs';
import { runRetirementCheck } from '../src/retirement.mjs';
import { adapter } from '../adapters/document-export.mjs';
import { runRehearsal } from '../src/rehearsal.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fixture = adapter.fixture('legacy');
const readAllow = async () => ({ enabled: false, observedAt: '2026-11-27T00:00:00Z' });

function seed(t) {
  const ledger = openLedger(':memory:');
  t.after(() => ledger.close());
  ledger.enqueue({ id: 'old-export', codec: 'v1', availableAt: 20,
    bytes: adapter.encode('v1', fixture), intentHash: hash(adapter.expectedArtifact(fixture)) });
  return ledger;
}

test('a v2-only decoder fails against ready v1 bytes without creating an effect', async (t) => {
  const ledger = seed(t);
  const result = await runWorker({ ledger, jobId: 'old-export', decoders: adapter.decoders('candidate'), readHold: readAllow, now: 25 });
  assert.equal(result.status, 'unsupported-codec');
  assert.equal(result.codec, 'v1');
  assert.equal(ledger.effectCount(), 0);
});

test('live hold and missing provider data leave the job pending', async (t) => {
  const ledger = seed(t);
  const input = { ledger, jobId: 'old-export', decoders: adapter.decoders('bridge'), now: 25 };
  const held = await runWorker({ ...input, readHold: async () => ({ enabled: true }) });
  assert.equal(held.status, 'held');
  assert.equal(held.reason, 'flag-enabled');
  const unobserved = await runWorker({ ...input, readHold: async () => { throw new Error('provider down'); } });
  assert.equal(unobserved.status, 'held');
  assert.equal(unobserved.reason, 'provider-unavailable');
  assert.equal(ledger.effectCount(), 0);
  assert.equal(ledger.inspect('v1', 25).pending, 1);
});

test('a candidate must commit the v2 probe and handle old redelivery before retirement', async (t) => {
  const ledger = seed(t);
  const now = 25;
  ledger.fence('v1');
  const useBridge = (jobId) => runWorker({ ledger, jobId, decoders: adapter.decoders('bridge'), readHold: readAllow, now });
  await useBridge('old-export');
  const replacement = adapter.fixture('replacement');
  const expectedDigest = hash(adapter.encode('v2', replacement));
  ledger.enqueue({ id: 'new-export', codec: 'v2', availableAt: 0,
    bytes: adapter.encode('v2', replacement), intentHash: expectedDigest });
  const calls = [];
  const result = await runRetirementCheck({
    ledger, oldCodec: 'v1', newCodec: 'v2', oldJobId: 'old-export',
    newJobId: 'new-export', expectedDigest, now,
    runCandidate: (jobId) => {
      calls.push(jobId);
      return runWorker({ ledger, jobId, decoders: adapter.decoders('candidate'), readHold: readAllow, now });
    },
  });
  assert.deepEqual(calls, ['new-export', 'old-export']);
  assert.equal(result.status, 'ready');
  assert.equal(result.replacement.status, 'committed');
  assert.equal(result.redelivery.status, 'duplicate');
  assert.equal(ledger.effectCount(), 2);
  assert.equal(ledger.inspect('v1', now).admission, 'retired');
});

test('a candidate that supplies no effect cannot retire a codec', async (t) => {
  const ledger = seed(t);
  ledger.fence('v1');
  ledger.commit('old-export', 'stable', 25);
  const digest = hash('replacement');
  ledger.enqueue({ id: 'new-export', codec: 'v2', availableAt: 0, bytes: Buffer.from('replacement'), intentHash: digest });
  const result = await runRetirementCheck({
    ledger, oldCodec: 'v1', newCodec: 'v2', oldJobId: 'old-export',
    newJobId: 'new-export', expectedDigest: digest, now: 25,
    runCandidate: async () => ({ status: 'held' }),
  });
  assert.equal(result.status, 'candidate-failed');
  assert.equal(ledger.inspect('v1', 25).admission, 'fenced');
});

test('retirement rejects a decoder that returns the wrong artifact', async (t) => {
  const ledger = seed(t);
  ledger.fence('v1');
  const replacement = adapter.fixture('replacement');
  const bytes = adapter.encode('v2', replacement);
  ledger.enqueue({
    id: 'new-export',
    codec: 'v2',
    availableAt: 0,
    bytes,
    intentHash: hash(adapter.expectedArtifact(replacement))
  });
  const result = await runRetirementCheck({
    ledger,
    oldCodec: 'v1',
    newCodec: 'v2',
    oldJobId: 'old-export',
    newJobId: 'new-export',
    expectedArtifact: adapter.expectedArtifact(replacement),
    now: 25,
    runCandidate: (jobId) => runWorker({
      ledger,
      jobId,
      decoders: { v1: () => 'wrong', v2: () => 'wrong' },
      readHold: async () => ({ enabled: false }),
      now: 25
    })
  });
  assert.equal(result.status, 'candidate-failed');
});

test('retirement rejects a job whose stored codec does not match the old lane', async (t) => {
  const ledger = seed(t);
  ledger.fence('v1');
  const result = await runRetirementCheck({
    ledger,
    oldCodec: 'v1',
    newCodec: 'v2',
    oldJobId: 'old-export',
    newJobId: 'old-export',
    expectedArtifact: 'unused',
    now: 25,
    runCandidate: async () => ({ status: 'duplicate' })
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'new-job-codec-mismatch');
});

test('the fixture rehearsal records a blocked hold and a ready retirement', async (t) => {
  const report = await runRehearsal({ now: 1700000025000 });
  t.after(() => {});
  assert.equal(report.status, 'passed');
  assert.equal(report.phases.find((item) => item.name === 'hold').verdict, 'held');
  assert.equal(report.phases.find((item) => item.name === 'retirement-before-fence').verdict, 'blocked');
  assert.equal(report.phases.find((item) => item.name === 'drain-and-retire').verdict, 'ready');
});

test('the file rehearsal resumes through a separate worker process', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-rehearsal-'));
  const ledgerPath = join(dir, 'queue.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = await runRehearsal({ ledgerPath, now: 1700000025000 });
  assert.equal(report.status, 'passed');
  assert.equal(report.phases.find((item) => item.name === 'worker-restart').process, 'child');
  assert.equal(report.phases.find((item) => item.name === 'worker-restart').verdict, 'committed');
});

test('a provider failure leaves an incomplete report on disk', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-failure-'));
  const reportPath = join(dir, 'report.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const flagsmith = {
    codecFlag: 'codec',
    holdFlag: 'hold',
    prepare: async () => { throw new Error('provider unavailable'); }
  };
  await assert.rejects(() => runRehearsal({ flagsmith, reportPath }), /provider unavailable/);
  const report = JSON.parse((await import('node:fs')).readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'incomplete');
  assert.equal(report.error.message, 'provider unavailable');
});

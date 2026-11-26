import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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

async function retirementFixture(t) {
  const ledger = seed(t);
  const now = 25;
  ledger.fence('v1');
  const worker = (jobId, decoders = adapter.decoders('candidate')) => runWorker({
    ledger, jobId, decoders, readHold: readAllow, now
  });
  const oldEffect = await worker('old-export', adapter.decoders('bridge'));
  const replacement = adapter.fixture('replacement');
  const expectedArtifact = adapter.expectedArtifact(replacement);
  const bytes = adapter.encode('v2', replacement);
  ledger.enqueue({ id: 'new-export', codec: 'v2', availableAt: 0,
    bytes, intentHash: hash(expectedArtifact) });
  return {
    ledger, oldCodec: 'v1', newCodec: 'v2', oldJobId: 'old-export', newJobId: 'new-export', now,
    oldEffect, expectedArtifact, bytes, worker
  };
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

test('a worker cannot commit after its lease expires during a hold check', async (t) => {
  const ledger = seed(t);
  let now = 25;
  let reads = 0;
  t.mock.method(Date, 'now', () => now);
  const result = await runWorker({
    ledger,
    jobId: 'old-export',
    decoders: adapter.decoders('bridge'),
    readHold: async () => {
      if (++reads === 2) now = 30025;
      return { enabled: false };
    }
  });
  assert.equal(result.status, 'lease-lost');
  assert.equal(ledger.effectCount(), 0);
});

test('a candidate must commit the v2 probe and handle old redelivery before retirement', async (t) => {
  const { ledger, now, oldEffect, expectedArtifact, worker, ...input } = await retirementFixture(t);
  const calls = [];
  const result = await runRetirementCheck({
    ...input, ledger, now, expectedDigest: hash(expectedArtifact),
    runCandidate: (jobId) => {
      calls.push(jobId);
      return worker(jobId);
    },
  });
  assert.deepEqual(calls, ['new-export', 'old-export']);
  assert.equal(result.status, 'ready');
  assert.equal(result.replacement.status, 'committed');
  assert.equal(result.redelivery.status, 'duplicate');
  assert.equal(result.redelivery.receipt, oldEffect.receipt);
  assert.equal(ledger.getEffect('new-export').artifact.toString(), expectedArtifact);
  assert.equal(ledger.effectCount(), 2);
  assert.equal(ledger.inspect('v1', now).admission, 'retired');
});

test('a candidate that supplies no effect cannot retire a codec', async (t) => {
  const input = await retirementFixture(t);
  const result = await runRetirementCheck({
    ...input,
    runCandidate: async (jobId) => jobId === 'new-export'
      ? { status: 'committed', receipt: 'not-stored', effect: input.expectedArtifact }
      : input.worker(jobId)
  });
  assert.equal(result.status, 'candidate-failed');
  assert.equal(input.ledger.inspect('v1', 25).admission, 'fenced');
});

test('retirement checks the stored artifact when the worker response claims success', async (t) => {
  const input = await retirementFixture(t);
  const result = await runRetirementCheck({
    ...input,
    runCandidate: async (jobId) => {
      const attempt = await input.worker(jobId, { v2: () => 'wrong' });
      return { ...attempt, effect: input.expectedArtifact };
    }
  });
  assert.equal(result.status, 'candidate-failed');
  assert.equal(input.ledger.inspect('v1', 25).admission, 'fenced');
});

test('the encoded payload digest cannot satisfy the artifact check', async (t) => {
  const { bytes, expectedArtifact, worker, ...input } = await retirementFixture(t);
  const result = await runRetirementCheck({
    ...input, expectedDigest: hash(bytes), runCandidate: worker
  });
  assert.equal(result.status, 'candidate-failed');
  assert.equal(input.ledger.inspect('v1', 25).admission, 'fenced');
});

test('old redelivery must return the original durable receipt', async (t) => {
  const input = await retirementFixture(t);
  const result = await runRetirementCheck({
    ...input,
    runCandidate: async (jobId) => {
      const attempt = await input.worker(jobId);
      return jobId === 'old-export' ? { ...attempt, receipt: 'wrong-receipt' } : attempt;
    }
  });
  assert.equal(result.status, 'candidate-failed');
  assert.equal(result.reason, 'old-redelivery-not-idempotent');
  assert.equal(input.ledger.inspect('v1', 25).admission, 'fenced');
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

test('the fixture rehearsal records a blocked hold and a ready retirement', async () => {
  const report = await runRehearsal({ now: 1700000025000 });
  assert.equal(report.status, 'passed');
  assert.equal(report.phases.find((item) => item.name === 'hold').verdict, 'held');
  assert.equal(report.phases.find((item) => item.name === 'retirement-before-fence').verdict, 'blocked');
  assert.equal(report.phases.find((item) => item.name === 'stale-admission')?.verdict, 'fenced');
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

test('the rehearsal persists the old export before changing the producer decision', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-rollout-'));
  const ledgerPath = join(dir, 'queue.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = 1700000025000;
  let codec = 'v1';
  let hold = false;
  let storedBeforeFlip;
  const flagsmith = {
    codecFlag: 'codec',
    holdFlag: 'hold',
    prepare: async () => {},
    decision: async (name) => name === 'codec' ? { value: codec } : { enabled: hold },
    setCodec: async () => {
      const ledger = openLedger(ledgerPath);
      try {
        storedBeforeFlip = ledger.getJob('old-export');
      } finally {
        ledger.close();
      }
      codec = 'v2';
    },
    setHold: async (enabled) => { hold = enabled; }
  };
  const report = await runRehearsal({ flagsmith, ledgerPath, now });
  assert.equal(report.status, 'passed');
  assert.equal(storedBeforeFlip?.codec, 'v1');
  assert.equal(storedBeforeFlip.availableAt, now + 20);
  assert.deepEqual(storedBeforeFlip.bytes, adapter.encode('v1', fixture));
});

test('the rehearsal blocks retirement when the v2-only candidate emits the wrong artifact', async (t) => {
  const original = adapter.decoders;
  t.mock.method(adapter, 'decoders', (mode) => mode === 'candidate'
    ? { v2: () => 'wrong' }
    : original(mode));
  const report = await runRehearsal({ now: 1700000025000 });
  assert.equal(report.status, 'failed');
  assert.equal(report.phases.find((item) => item.name === 'drain-and-retire').verdict, 'candidate-failed');
});

test('the rehearsal blocks retirement when the bridge emits the wrong old artifact', async (t) => {
  const original = adapter.decoders;
  t.mock.method(adapter, 'decoders', (mode) => mode === 'bridge'
    ? { ...original(mode), v1: () => 'wrong' }
    : original(mode));
  const report = await runRehearsal({ now: 1700000025000 });
  assert.equal(report.status, 'failed');
  assert.equal(report.phases.find((item) => item.name === 'drain-and-retire').ledger.admission, 'fenced');
  assert.equal(report.summary.committedEffects, 1);
});

test('the rehearsal blocks retirement when a stale submission bypasses the fence proof', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-fence-'));
  const ledgerPath = join(dir, 'queue.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  openLedger(ledgerPath).close();
  const db = new DatabaseSync(ledgerPath);
  db.exec(`
    CREATE TRIGGER admit_stale_export AFTER INSERT ON settings WHEN NEW.key = 'fence:v1'
    BEGIN
      INSERT INTO jobs (id, codec, available_at, intent_hash, bytes, status, created_at)
      VALUES ('stale-export', 'v1', 0, 'unexpected-intent', x'41', 'committed', 0);
    END;
  `);
  db.close();
  const report = await runRehearsal({ ledgerPath, now: 1700000025000 });
  assert.equal(report.status, 'failed');
  assert.equal(report.phases.find((item) => item.name === 'stale-admission').verdict, 'conflict');
  assert.equal(report.phases.find((item) => item.name === 'drain-and-retire').ledger.admission, 'fenced');
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

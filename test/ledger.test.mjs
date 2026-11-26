import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openLedger } from '../src/ledger.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const job = (id, codec = 'v1', availableAt = 0, intent = id) => ({
  id, codec, availableAt, intentHash: hash(intent), bytes: Buffer.from(`payload:${id}`),
});

function ledgerFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-test-'));
  const path = join(dir, 'queue.sqlite');
  const ledger = openLedger(path);
  t.after(() => {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ledger, path };
}

test('a delayed job blocks retirement even with an empty ready queue', (t) => {
  const { ledger } = ledgerFixture(t);
  ledger.enqueue(job('old-export', 'v1', 20));
  ledger.fence('v1');

  const snapshot = ledger.inspect('v1', 10);
  assert.equal(snapshot.pending, 1);
  assert.equal(snapshot.ready, 0);
  assert.deepEqual(snapshot.blocking, [{ id: 'old-export', availableAt: 20 }]);
  assert.equal(ledger.retire('v1', 10).status, 'blocked');
  assert.equal(ledger.inspect('v1', 30).ready, 1);
});

test('the persisted fence rejects stale producers and preserves idempotent enqueue', (t) => {
  const { ledger, path } = ledgerFixture(t);
  assert.equal(ledger.enqueue(job('old-export')).status, 'enqueued');
  ledger.fence('v1');

  const stale = openLedger(path);
  try {
    assert.equal(stale.enqueue(job('stale-export')).status, 'fenced');
    const same = stale.enqueue(job('old-export', 'v2'));
    assert.equal(same.status, 'existing');
    assert.equal(same.codec, 'v1');
    assert.equal(stale.enqueue(job('old-export', 'v2', 0, 'different')).status, 'conflict');
    assert.equal(stale.enqueue(job('old-export', 'v2', 10)).status, 'existing');
    assert.equal(stale.enqueue(job('new-export', 'v2')).status, 'enqueued');
  } finally {
    stale.close();
  }
});

test('one durable effect survives a worker restart and redelivery after retirement', (t) => {
  const { ledger, path } = ledgerFixture(t);
  ledger.enqueue(job('old-export', 'v1', 20));
  ledger.fence('v1');
  assert.equal(ledger.claim('old-export', 10).status, 'delayed');
  const claim = ledger.claim('old-export', 25);
  assert.equal(claim.status, 'claimed');
  const committed = ledger.commit('old-export', 'export', {
    token: claim.token, artifact: 'exported document', now: 25
  });
  assert.equal(committed.status, 'committed');
  assert.equal(ledger.retire('v1', 25).status, 'ready');

  const restarted = openLedger(path);
  try {
    assert.equal(restarted.receipt('old-export').digest, hash(committed.receipt));
    assert.deepEqual(restarted.commit('old-export', 'other export', { now: 40 }), {
      status: 'duplicate', receipt: committed.receipt,
    });
    assert.deepEqual(restarted.getEffect('old-export'), {
      receipt: committed.receipt,
      payloadDigest: hash('payload:old-export'),
      artifact: Buffer.from('exported document'),
      artifactDigest: hash('exported document')
    });
    assert.equal(restarted.effectCount(), 1);
    assert.equal(restarted.inspect('v1', 40).admission, 'retired');
    assert.equal(restarted.enqueue(job('stale-export')).status, 'fenced');
  } finally {
    restarted.close();
  }
});

test('a pending job cannot commit without a worker claim', (t) => {
  const { ledger } = ledgerFixture(t);
  ledger.enqueue(job('unclaimed'));
  assert.equal(ledger.commit('unclaimed', 'export', { now: 1 }).status, 'unavailable');
  assert.equal(ledger.effectCount(), 0);
});

test('an expired claim cannot change a restarted worker’s lease', (t) => {
  const { ledger, path } = ledgerFixture(t);
  ledger.enqueue(job('stale'));
  const original = ledger.claim('stale', 1, 10);
  assert.equal(original.status, 'claimed');

  const restarted = openLedger(path);
  t.after(() => restarted.close());
  assert.equal(restarted.claim('stale', 10, 1).status, 'unavailable');
  assert.equal(ledger.release('stale', original.token, 11).status, 'lease-lost');

  const successor = restarted.claim('stale', 11);
  assert.equal(successor.status, 'claimed');
  assert.notEqual(successor.token, original.token);
  assert.equal(ledger.commit('stale', 'export', {
    token: original.token, artifact: 'old output', now: 12
  }).status, 'lease-lost');
  assert.equal(ledger.release('stale', original.token, 12).status, 'lease-lost');
  assert.equal(restarted.effectCount(), 0);
  assert.equal(restarted.commit('stale', 'export', {
    token: successor.token, artifact: 'new output', now: 12
  }).status, 'committed');
  assert.equal(restarted.getEffect('stale').artifact.toString(), 'new output');
});

test('opening a pre-lease ledger preserves receipts and recovers old claims', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'afterflag-legacy-'));
  const path = join(dir, 'queue.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, codec TEXT NOT NULL, available_at INTEGER NOT NULL,
      intent_hash TEXT NOT NULL, bytes BLOB NOT NULL, status TEXT NOT NULL,
      receipt TEXT, claimed_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE effects (
      job_id TEXT NOT NULL, effect_type TEXT NOT NULL, receipt TEXT NOT NULL,
      payload_digest TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (job_id, effect_type)
    );
    INSERT INTO jobs VALUES ('done', 'v1', 0, 'intent', x'41', 'committed', 'old-receipt', NULL, 0);
    INSERT INTO jobs VALUES ('in-flight', 'v1', 0, 'intent', x'42', 'claimed', NULL, 1, 0);
    INSERT INTO effects VALUES ('done', 'export', 'old-receipt', 'old-payload-digest', 1);
  `);
  db.close();

  const ledger = openLedger(path);
  t.after(() => ledger.close());
  assert.deepEqual(ledger.claim('done', 30001), {
    status: 'duplicate', id: 'done', receipt: 'old-receipt'
  });
  assert.equal(ledger.getEffect('done').artifactDigest, null);
  assert.equal(ledger.claim('in-flight', 30000).status, 'unavailable');
  const recovered = ledger.claim('in-flight', 30001);
  assert.equal(recovered.status, 'claimed');
  assert.equal(ledger.commit('in-flight', 'export', {
    token: recovered.token, artifact: 'recovered export', now: 30001
  }).status, 'committed');
});

test('zero pending work does not let an open codec retire', (t) => {
  const { ledger } = ledgerFixture(t);
  const result = ledger.retire('v1', 20);
  assert.equal(result.status, 'blocked');
  assert.equal(result.ledger.admission, 'open');
});

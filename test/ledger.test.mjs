import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.equal(ledger.claim('old-export', 25).status, 'claimed');
  const committed = ledger.commit('old-export', 'export', 25);
  assert.equal(committed.status, 'committed');
  assert.equal(ledger.retire('v1', 25).status, 'ready');

  const restarted = openLedger(path);
  try {
    assert.equal(restarted.receipt('old-export').digest, hash(committed.receipt));
    assert.deepEqual(restarted.commit('old-export', 'other export', 40), {
      status: 'duplicate', receipt: committed.receipt,
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
  assert.equal(ledger.commit('unclaimed', 'export', 1).status, 'unavailable');
  assert.equal(ledger.effectCount(), 0);
});

test('a stale claimed lease can be recovered after a worker restart', (t) => {
  const { ledger } = ledgerFixture(t);
  ledger.enqueue(job('stale'));
  assert.equal(ledger.claim('stale', 1).status, 'claimed');
  assert.equal(ledger.claim('stale', 100, 10).status, 'claimed');
});

test('zero pending work does not let an open codec retire', (t) => {
  const { ledger } = ledgerFixture(t);
  const result = ledger.retire('v1', 20);
  assert.equal(result.status, 'blocked');
  assert.equal(result.ledger.admission, 'open');
});

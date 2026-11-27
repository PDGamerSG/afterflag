import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { openQueue, initQueue, digest } from '../../src/release/queue.mjs';

const url = process.env.AFTERFLAG_TEST_DB;
const exercise = (name, body) => test(name, { skip: !url }, async (t) => {
  const scope = randomUUID();
  const q = openQueue(url, scope);
  t.after(() => q.close());
  await initQueue(q.pool);
  await q.addCodecs(['v1', 'v2']);
  await body(q, t, scope);
});

const fixture = (id = 'legacy', codec = 'v1', availableAt = 0) => ({
  id, codec, availableAt, bytes: Buffer.from('old bytes'),
  expectedDigest: digest('document output')
});

async function databaseTime(client) {
  const { rows: [row] } = await client.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) AS now');
  return Number(row.now);
}

async function withRowContention(q, id, action, holdLock) {
  const locker = await q.pool.connect();
  let operation;
  let lockedThrough;
  try {
    await locker.query('BEGIN');
    await locker.query('SELECT 1 FROM afterflag_jobs WHERE scope = $1 AND id = $2 FOR UPDATE', [q.scope, id]);
    const { rows: [{ pid }] } = await locker.query('SELECT pg_backend_pid() AS pid');
    operation = action();
    operation.catch(() => {});
    const deadline = Date.now() + 3_000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const { rows: [row] } = await locker.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE NOT granted AND $1 = ANY(pg_blocking_pids(pid))
        ) AS waiting
      `, [pid]);
      waiting = row.waiting;
      if (!waiting) await pause(10);
    }
    assert.ok(waiting, 'PostgreSQL must observe the operation waiting for the test transaction');
    await holdLock(await databaseTime(locker));
    lockedThrough = await databaseTime(locker);
  } finally {
    await locker.query('ROLLBACK').finally(() => locker.release());
  }
  return { result: await operation, lockedThrough };
}

exercise('a fenced codec counts delayed, held, retry, claimed and dead work', async (q) => {
  await q.enqueue(fixture('delayed', 'v1', 1000));
  await q.enqueue(fixture('held'));
  await q.enqueue(fixture('retry'));
  await q.enqueue(fixture('claimed'));
  await q.enqueue(fixture('dead'));
  for (const [id, state] of [['held', 'held'], ['retry', 'retry'], ['dead', 'dead']]) {
    const { token } = await q.claim({ id, now: 10 });
    assert.equal((await q.defer(id, token, state, { now: 10, availableAt: 1000 })).status, state);
  }
  await q.claim({ id: 'claimed', now: 10 });
  const fence = await q.fence('v1');
  assert.equal(fence.generation, 1);
  const gate = await q.retire('v1', 15);
  assert.equal(gate.reason, 'pending-work');
  assert.equal(gate.snapshot.ready, 0);
  assert.equal(gate.snapshot.pending, 5);
  assert.deepEqual(gate.snapshot.counts, { pending: 1, held: 1, retry: 1, claimed: 1, dead: 1 });
  assert.equal((await q.redrive('dead', 15)).status, 'redriven');
  assert.equal((await q.enqueue(fixture('stale'))).status, 'fenced');
  assert.equal((await q.enqueue(fixture('delayed', 'v2', 1000))).job.codec, 'v1');
});

exercise('an expired claimant cannot settle a reissued lease', async (q) => {
  await q.enqueue(fixture());
  const first = await q.claim({ id: 'legacy', now: 20, leaseMs: 5 });
  assert.equal((await q.claim({ id: 'legacy', now: 24 })).status, 'unavailable');
  const second = await q.claim({ id: 'legacy', now: 25 });
  assert.notEqual(first.token, second.token);
  assert.equal((await q.defer('legacy', first.token, 'retry', { now: 25 })).status, 'lease-lost');
  assert.equal((await q.complete('legacy', first.token, 'document output', 25)).status, 'lease-lost');
  assert.equal((await q.complete('legacy', second.token, 'wrong artifact', 25)).status, 'artifact-mismatch');
  const done = await q.complete('legacy', second.token, 'document output', 25);
  assert.equal(done.status, 'committed');
  await q.fence('v1');
  assert.equal((await q.retire('v1', 25)).status, 'ready');
  const replay = await q.claim({ id: 'legacy', now: 40 });
  assert.equal(replay.status, 'duplicate');
  assert.deepEqual(replay.receipt, done.receipt);
  assert.equal(await q.effectCount(), 1);
});

for (const [name, settle] of [
  ['completion', (q, id, token) => q.complete(id, token, 'document output')],
  ['defer', (q, id, token) => q.defer(id, token, 'retry')]
]) {
  exercise(`${name} loses a lease that expires while waiting for a row lock`, async (q) => {
    const id = 'contended';
    const leaseMs = 1_500;
    await q.enqueue(fixture(id));
    const now = await databaseTime(q.pool);
    const claim = await q.claim({ id, now, leaseMs });
    const leaseUntil = now + leaseMs;
    const { result, lockedThrough } = await withRowContention(q, id, () => settle(q, id, claim.token), (waitingAt) => {
      assert.ok(waitingAt < leaseUntil, 'The operation must enter the lock wait with an active lease');
      return pause(leaseUntil - waitingAt + 20);
    });
    assert.ok(lockedThrough >= leaseUntil);
    assert.equal(result.status, 'lease-lost');
    assert.equal(await q.effectCount(), 0);
    assert.equal((await q.claim({ id })).attempt, 2);
  });
}

exercise('a named claimant gets its full lease after acquiring a contended row', async (q) => {
  const id = 'contended';
  const leaseMs = 2_000;
  await q.enqueue(fixture(id));
  const { result, lockedThrough } = await withRowContention(q, id, () => q.claim({ id, leaseMs }), () => pause(100));
  assert.equal(result.status, 'claimed');
  const { rows: [row] } = await q.pool.query('SELECT lease_until FROM afterflag_jobs WHERE scope = $1 AND id = $2', [q.scope, id]);
  assert.ok(Number(row.lease_until) >= lockedThrough + leaseMs);
});

exercise('concurrent admission and out-of-order fence leave exact backlog', async (q) => {
  const initial = await q.pool.connect();
  try {
    await initial.query('BEGIN');
    await initial.query('SELECT 1 FROM afterflag_admission WHERE scope = $1 AND codec = $2 FOR SHARE', [q.scope, 'v1']);
    const fencePromise = q.fence('v1');
    await initial.query(
      'INSERT INTO afterflag_jobs (scope, id, codec, bytes, input_digest, expected_digest, available_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [q.scope, 'in-flight-producer', 'v1', Buffer.from('old bytes'), digest('old bytes'), digest('document output'), 0]
    );
    await initial.query('COMMIT');
    assert.equal((await fencePromise).status, 'fenced');
  } finally {
    initial.release();
  }
  const outcomes = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    q.enqueue(fixture('stale-' + i))));
  assert.ok(outcomes.every((result) => result.status === 'fenced'));
  assert.equal((await q.retire('v1')).snapshot.pending, 1);
  const { token } = await q.claim({ id: 'in-flight-producer' });
  assert.equal((await q.complete('in-flight-producer', token, 'document output')).status, 'committed');
  assert.equal((await q.retire('v1')).status, 'ready');
  assert.equal((await q.enqueue(fixture('replacement', 'v2'))).status, 'enqueued');
});

exercise('concurrent consumers find different jobs and one effect each', async (q) => {
  for (let i = 0; i < 24; i++) await q.enqueue(fixture('job-' + i));
  const claims = await Promise.all(Array.from({ length: 24 }, () => q.claim({ now: 20 })));
  assert.ok(claims.every((result) => result.status === 'claimed'));
  assert.equal(new Set(claims.map((item) => item.job.id)).size, 24);
  await Promise.all(claims.map((item) => q.complete(item.job.id, item.token, 'document output', 20)));
  assert.equal(await q.effectCount(), 24);
  assert.equal((await q.inspect('v1', 20)).pending, 0);
});

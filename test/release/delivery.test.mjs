import assert from 'node:assert/strict';
import test from 'node:test';
import { deliver } from '../../src/release/delivery.mjs';
import { digest } from '../../src/release/queue.mjs';

test('a decoder can complete only after a valid explicit hold-off observation', async () => {
  let completion = 0;
  let reads = 0;
  const job = { id: 'old', codec: 'v1', bytes: Buffer.from('fixture'), inputDigest: digest('fixture') };
  const queue = {
    claim: async () => ({ status: 'claimed', token: 'owner', job }),
    complete: async () => { completion++; return { status: 'committed' }; },
    defer: async (id, token, status) => ({ id, token, status })
  };
  const args = {
    queue, decoders: { v1: () => 'artifact' }, build: 'fixture',
    id: job.id, readHold: async () => { reads++; return {}; }
  };
  const unknown = await deliver(args);
  assert.equal(unknown.status, 'held');
  assert.equal(completion, 0);
  assert.equal(reads, 1);
  const good = await deliver({ ...args, readHold: async () => ({ enabled: false }) });
  assert.equal(good.status, 'committed');
  assert.equal(completion, 1);
});

test('corrupt input is quarantined before decode and cannot replay a receipt', async () => {
  const job = { id: 'old', codec: 'v1', bytes: Buffer.from('corrupt'), inputDigest: digest('original') };
  const unexpected = () => assert.fail('Corrupt bytes must never reach decoding or effect commit.');
  const deferred = [];
  const queue = {
    claim: async () => ({ status: 'claimed', token: 'owner', job }),
    complete: unexpected,
    defer: async (id, token, status, { reason }) => {
      deferred.push({ id, token, status, reason });
      return { status };
    }
  };
  const args = { queue, decoders: { v1: unexpected }, build: 'fixture', id: job.id, readHold: unexpected };
  const result = await deliver(args);
  assert.equal(result.status, 'input-mismatch');
  assert.equal(result.inputDigestObserved, digest('corrupt'));
  assert.deepEqual(deferred, [{ id: 'old', token: 'owner', status: 'dead', reason: 'input-digest-mismatch' }]);

  const replay = await deliver({
    ...args, queue: { claim: async () => ({ status: 'duplicate', job, receipt: { id: 'committed' } }) }
  });
  assert.equal(replay.status, 'input-mismatch');
  assert.equal(replay.receipt, undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { deliver } from '../../src/release/delivery.mjs';

test('a decoder can complete only after a valid explicit hold-off observation', async () => {
  let completion = 0;
  let reads = 0;
  const job = { id: 'old', codec: 'v1', bytes: Buffer.from('fixture') };
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

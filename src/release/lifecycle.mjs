import { openQueue } from './queue.mjs';

export async function exerciseLifecycle({ databaseUrl, scope, retained, codec, now, runBridge }) {
  const queue = openQueue(databaseUrl, scope);
  const ids = ['delayed', 'held', 'retry', 'claimed', 'dead'];
  const future = now + 60;
  try {
    await queue.addCodecs([codec]);
    for (const id of ids) {
      await queue.enqueue({ ...retained, id, availableAt: id === 'delayed' ? future : now });
    }
    for (const id of ['held', 'retry', 'dead']) {
      const claim = await queue.claim({ id, now });
      await queue.defer(id, claim.token, id, { now, availableAt: future });
    }
    const staleClaim = await queue.claim({ id: 'claimed', now, leaseMs: 25 });
    await queue.fence(codec);
    const gate = await queue.retire(codec, now);
    const currentClaim = await queue.claim({ id: 'claimed', now: future });
    const rejectedCompletion = await queue.complete('claimed', staleClaim.token, '', future);
    const rejectedDefer = await queue.defer('claimed', staleClaim.token, 'retry', { now: future });
    await queue.defer('claimed', currentClaim.token, 'retry', { now: future });
    const redrive = await queue.redrive('dead', future);
    for (const id of ids) {
      await runBridge(id, future);
    }
    return {
      scope, gate, snapshot: gate.snapshot, rejectedCompletion, rejectedDefer, redrive,
      deadInputDigest: gate.snapshot.blocking.find((item) => item.id === 'dead')?.inputDigest,
      effects: await queue.effectCount(), final: await queue.inspect(codec, future)
    };
  } finally {
    await queue.close();
  }
}

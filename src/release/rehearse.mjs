import { randomUUID } from 'node:crypto';
import { openQueue, initQueue } from './queue.mjs';
import { importArtifact, sha256 } from './manifest.mjs';
import { createEvidence, evaluate } from './evidence.mjs';
import { runWorkerProcess } from './delivery.mjs';
import { exerciseLifecycle } from './lifecycle.mjs';

export function releaseMetadata(plan, source, scope = randomUUID(), provenance = null) {
  const { manifest, artifacts } = plan;
  const specimens = Object.fromEntries(Object.entries(manifest.specimens).map(([role, value]) => [
    role, { id: value.id, artifactDigest: sha256(value.expectedArtifact) }
  ]));
  return {
    scenario: manifest.id, title: manifest.title, source, scope, startedAt: new Date().toISOString(),
    manifest: plan.digest, codecs: manifest.codecs, flags: manifest.flags, specimens,
    builds: Object.fromEntries(Object.entries(artifacts).map(([role, item]) => [role, item.digest])),
    flagsmith: provenance, queue: 'postgresql', coverage: manifest.replay
  };
}

export async function rehearse({
  plan, databaseUrl, policy, source, stopBeforeDrain = false, privatePem, onStep = () => {}
}) {
  const id = randomUUID();
  const metadata = releaseMetadata(plan, source, id, policy.provenance);
  const evidence = createEvidence({ id, metadata });
  const record = (kind, data) => {
    evidence.add(kind, data);
    onStep(kind, data);
  };
  const finish = () => evidence.finish(privatePem);
  const queue = openQueue(databaseUrl, id);
  const { manifest, artifacts } = plan;
  const old = manifest.codecs.old;
  const modern = manifest.codecs.new;
  const { retained, replacement } = manifest.specimens;
  const run = (role, jobId, now, scope = queue.scope) => runWorkerProcess({
    databaseUrl, scope, jobId, now, artifact: artifacts[role], policy: policy.workerConfig
  });

  try {
    await initQueue(queue.pool);
    await queue.addCodecs([old, modern]);
    record('provider-ready', { provider: policy.provenance });
    const producer = await importArtifact(artifacts.producer);
    function makeJob(specimen, decision, availableAt) {
      return {
        id: specimen.id, codec: decision.codec, decisionDigest: decision.digest, availableAt,
        bytes: Buffer.from(producer.encode(decision.codec, specimen.payload)),
        expectedDigest: sha256(specimen.expectedArtifact)
      };
    }

    const start = Date.now();
    const baseline = {
      stable: await policy.codec('stable'), pilot: await policy.codec('pilot'), hold: await policy.hold()
    };
    record('baseline', baseline);
    const oldJob = makeJob(retained, baseline.stable, start + retained.delayMs);
    const admitted = await queue.enqueue(oldJob);
    record('legacy-admitted', { ...admitted, logicalTime: start });

    await policy.openPilot();
    record('pilot-opened', { pilot: await policy.codec('pilot'), stable: await policy.codec('stable') });
    await policy.promote();
    const promoted = { stable: await policy.codec('stable'), pilot: await policy.codec('pilot') };
    record('promoted', promoted);

    const fence = await queue.fence(old);
    const rejected = await queue.enqueue({ ...oldJob, id: retained.id + '-stale' });
    const retry = await queue.enqueue(oldJob);
    record('fenced', { fence, rejected, retry, capturedDecision: oldJob.decisionDigest });
    const gate = await queue.retire(old, start);
    const due = oldJob.availableAt + 1;
    const counterexample = await run('candidate', retained.id, due);
    record('blocker', {
      snapshot: gate.snapshot, gate, candidate: counterexample,
      snapshotAt: start, deliveryAt: due, effects: await queue.effectCount()
    });
    record('health-blocked', await policy.health('UNHEALTHY',
      'Decoder retirement blocked by ' + retained.id + ' in rehearsal ' + id));
    if (stopBeforeDrain) {
      record('halt-before-drain', { reason: 'requested-gate', jobId: retained.id });
      return finish();
    }
    if (evaluate(evidence.report).checks.some((check) => check.status === 'fail')) return finish();

    await policy.setHold(true);
    const held = await run('bridge', retained.id, due);
    record('hold', { worker: held, status: held.status, snapshot: await queue.inspect(old, due), effects: await queue.effectCount() });
    if (held.status !== 'held') return finish();

    await policy.setHold(false);
    const resumed = await run('bridge', retained.id, due + 1);
    record('drained', {
      worker: resumed, snapshot: await queue.inspect(old, due + 1),
      receipt: await queue.receipt(retained.id), effects: await queue.effectCount()
    });
    if (resumed.status !== 'committed') return finish();

    const lifecycle = await exerciseLifecycle({
      databaseUrl, scope: id + '-lifecycle', retained: oldJob, codec: old, now: due + 10,
      runBridge: (id, now) => run('bridge', id, now, queue.scope + '-lifecycle')
    });
    record('lifecycle', lifecycle);

    const newJob = makeJob(replacement, promoted.stable, due + 2);
    record('replacement-admitted', { ...await queue.enqueue(newJob), decision: promoted.stable });
    const candidate = await run('candidate', replacement.id, due + 2);
    record('candidate', { worker: candidate, receipt: await queue.receipt(replacement.id) });
    const redelivery = await run('candidate', retained.id, due + 3);
    record('redelivery', {
      worker: redelivery, receipt: await queue.receipt(retained.id), effects: await queue.effectCount()
    });
    const checks = evaluate(evidence.report).checks;
    if (checks.slice(0, -2).some((check) => check.status !== 'pass')) return finish();

    const retirement = await queue.retire(old, due + 4);
    record('retired', {
      ...retirement, rejected: await queue.enqueue({ ...oldJob, id: retained.id + '-after-retire' }),
      replay: await run('candidate', retained.id, due + 5), effects: await queue.effectCount()
    });
    if (evaluate(evidence.report).checks.at(-2).status !== 'pass') return finish();
    record('health-ready', await policy.health('HEALTHY',
      'Verified decoder retirement in rehearsal ' + id));
    return finish();
  } catch (error) {
    record('error', { message: error.message.slice(0, 240) });
    return finish();
  } finally {
    await queue.close();
  }
}

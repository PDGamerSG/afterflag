import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { openLedger } from './ledger.mjs';
import { runWorker } from './worker.mjs';
import { runRetirementCheck } from './retirement.mjs';
import { adapter } from '../adapters/document-export.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

function makeJob(id, codec, document, availableAt) {
  const bytes = adapter.encode(codec, document);
  return {
    id,
    codec,
    availableAt,
    bytes,
    intentHash: digest(adapter.expectedArtifact(document))
  };
}

export async function runRehearsal({
  flagsmith = null,
  ledgerPath = ':memory:',
  reportPath,
  now = Date.now()
} = {}) {
  let ledger = openLedger(ledgerPath);
  const saveReport = (report) => {
    if (!reportPath) return;
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  };
  const report = {
    schema: 'afterflag/v1',
    runId: randomUUID(),
    startedAt: new Date(now).toISOString(),
    product: 'Afterflag',
    infrastructure: {
      queue: 'sqlite',
      flagsmith: flagsmith ? 'self-hosted-live' : 'fixture',
      image: 'docker.flagsmith.com/flagsmith/flagsmith:2.295.2',
      digest: 'sha256:48905c664152d8ae2c843ec9cee72ff197e7caff6e91b959bb851a235915ea35'
    },
    phases: [],
    status: 'incomplete'
  };
  const flagHistory = [];
  let fixtureCodec = 'v1';
  let fixtureHold = false;
  const phase = (name, details) => report.phases.push({
    name,
    at: new Date(now).toISOString(),
    logicalTime: now,
    ...details
  });
  const readHold = async () => flagsmith
    ? flagsmith.decision(flagsmith.holdFlag)
    : { enabled: fixtureHold, observedAt: new Date(now).toISOString(), source: 'fixture' };
  const readCodec = async () => flagsmith
    ? flagsmith.decision(flagsmith.codecFlag)
    : { enabled: fixtureCodec === 'v2', value: fixtureCodec, source: 'fixture' };
  const requireDecision = (decision, name, expected) => {
    const actual = name === 'codec'
      ? decision.value ?? (decision.enabled ? 'v2' : 'v1')
      : decision.enabled;
    if (actual !== expected) {
      throw new Error('Flagsmith transition not observed for ' + name + ': expected ' + expected + ', received ' + actual);
    }
    flagHistory.push({ name, expected, observed: actual, digest: decision.digest ?? null });
    return { ...decision, observed: actual };
  };

  try {
    if (flagsmith) await flagsmith.prepare();
    const legacy = adapter.fixture('legacy');
    const replacement = adapter.fixture('replacement');
    const initialCodec = requireDecision(await readCodec(), 'codec', 'v1').observed;
    const oldJob = makeJob('old-export', initialCodec, legacy, now + 20);
    const staleJob = makeJob('stale-export', initialCodec, legacy, now);
    const oldAdmission = ledger.enqueue(oldJob);
    const rolloutQueue = ledger.inspect(initialCodec, now);
    if (flagsmith) await flagsmith.setCodec(true);
    else fixtureCodec = 'v2';
    const rolledCodec = requireDecision(await readCodec(), 'codec', 'v2').observed;
    const newJob = makeJob('new-export', rolledCodec, replacement, now);
    phase('rollout', {
      message: 'Producer switched to v2 while a v1 export waited.',
      jobId: oldJob.id,
      codec: oldJob.codec,
      verdict: oldAdmission.status,
      queue: rolloutQueue
    });

    const candidateDecoders = adapter.decoders('candidate');
    const runCandidate = (jobId) => runWorker({
      ledger,
      jobId,
      decoders: candidateDecoders,
      readHold,
      now: now + 25
    });
    const candidateAttempt = await runCandidate(oldJob.id);
    phase('candidate-before-drain', {
      message: 'The v2-only worker cannot decode the retained v1 message.',
      verdict: candidateAttempt.status,
      reason: candidateAttempt.reason ?? null,
      codec: candidateAttempt.codec ?? oldJob.codec
    });

    const beforeFence = ledger.retire(initialCodec, now + 25);
    phase('retirement-before-fence', {
      message: 'An open admission lane blocks decoder retirement.',
      verdict: beforeFence.status,
      reason: beforeFence.reason ?? null
    });
    ledger.fence(initialCodec);
    const staleAdmission = ledger.enqueue(staleJob);
    phase('stale-admission', {
      message: 'The stale producer submits an export using its pre-rollout codec decision.',
      verdict: staleAdmission.status,
      jobId: staleJob.id,
      codec: staleJob.codec
    });
    const newAdmission = ledger.enqueue(newJob);
    if (flagsmith) {
      await flagsmith.setHold(true);
    } else fixtureHold = true;
    requireDecision(await readHold(), 'hold', true);
    const held = await runWorker({
      ledger,
      jobId: oldJob.id,
      decoders: adapter.decoders('bridge'),
      readHold,
      now: now + 25
    });
    const heldQueue = ledger.inspect(initialCodec, now + 25);
    const heldEffects = ledger.effectCount();
    phase('hold', {
      message: 'A separate live hold prevents an effect while the worker restarts.',
      verdict: held.status,
      reason: held.reason,
      queue: heldQueue,
      committedEffects: heldEffects
    });

    if (flagsmith) await flagsmith.setHold(false);
    else fixtureHold = false;
    requireDecision(await readHold(), 'hold', false);
    let drained;
    if (ledgerPath !== ':memory:') {
      ledger.close();
      ledger = null;
      const child = await execFileAsync(
        process.execPath,
        ['scripts/restart-worker.mjs'],
        {
          env: {
            ...process.env,
            AFTERFLAG_LEDGER: ledgerPath,
            AFTERFLAG_WORKER_JOB_ID: oldJob.id,
            AFTERFLAG_WORKER_NOW: String(now + 25)
          }
        }
      );
      drained = JSON.parse(child.stdout.trim());
      ledger = openLedger(ledgerPath);
      phase('worker-restart', {
        message: 'A child worker reopened the same durable queue after the hold.',
        process: 'child',
        verdict: drained.status,
        queue: ledger.inspect(initialCodec, now + 25)
      });
    } else {
      drained = await runWorker({
        ledger,
        jobId: oldJob.id,
        decoders: adapter.decoders('bridge'),
        readHold,
        now: now + 25
      });
    }
    const oldEffect = ledger.getEffect(oldJob.id);
    const drainedEffects = ledger.effectCount();
    phase('drain-old', {
      message: 'The bridge decodes the retained V1 export before retirement.',
      verdict: drained.status,
      codec: drained.codec ?? oldJob.codec,
      effect: drained.effect ?? null,
      artifactDigest: oldEffect?.artifactDigest ?? null,
      receipt: oldEffect?.receipt ?? null,
      committedEffects: drainedEffects
    });
    const prerequisites = {
      rollout: oldAdmission.status === 'enqueued' && rolloutQueue.pending === 1 && rolloutQueue.ready === 0,
      'candidate-before-drain': candidateAttempt.status === 'unsupported-codec' && candidateAttempt.codec === initialCodec,
      'retirement-before-fence': beforeFence.status === 'blocked' && beforeFence.reason === 'admission-open',
      'stale-admission': staleAdmission.status === 'fenced' && ledger.getJob(staleJob.id) === null,
      'replacement-admission': newAdmission.status === 'enqueued',
      hold: held.status === 'held' && held.reason === 'flag-enabled' && heldQueue.pending === 1 && heldEffects === 0,
      'drain-old': drained.status === 'committed' && drainedEffects === 1 &&
        oldEffect?.artifactDigest === oldJob.intentHash && oldEffect.receipt === drained.receipt
    };
    const blockedBy = Object.keys(prerequisites).filter((name) => !prerequisites[name]);
    const check = blockedBy.length > 0
      ? { status: 'blocked', reason: 'failed-prerequisite' }
      : await runRetirementCheck({
        ledger,
        oldCodec: initialCodec,
        newCodec: rolledCodec,
        oldJobId: oldJob.id,
        newJobId: newJob.id,
        expectedArtifact: adapter.expectedArtifact(replacement),
        now: now + 25,
        runCandidate
      });
    phase('drain-and-retire', {
      message: 'The V2-only candidate verifies a new export and checks the old receipt on redelivery.',
      verdict: check.status,
      reason: check.reason ?? null,
      blockedBy,
      replacement: check.replacement?.status ?? null,
      replacementArtifactDigest: ledger.getEffect(newJob.id)?.artifactDigest ?? null,
      redelivery: check.redelivery?.status ?? null,
      redeliveryReceipt: check.redelivery?.receipt ?? null,
      ledger: check.ledger ?? ledger.inspect(initialCodec, now + 25)
    });

    const committedEffects = ledger.effectCount();
    const passed = check.status === 'ready' && committedEffects === 2;
    report.flagsmith = {
      mode: flagsmith ? 'live-local' : 'fixture',
      decisions: flagHistory,
      codecFlag: flagsmith?.codecFlag ?? 'afterflag_codec_v2',
      holdFlag: flagsmith?.holdFlag ?? 'afterflag_hold',
      transitions: flagHistory
    };
    report.summary = {
      candidateFailure: candidateAttempt.status,
      safeRetirement: check.status,
      committedEffects,
      scope: 'the declared SQLite ledger and document-export adapter'
    };
    report.status = passed ? 'passed' : 'failed';
    report.finishedAt = new Date(now).toISOString();
    saveReport(report);
    return report;
  } catch (error) {
    report.status = 'incomplete';
    report.finishedAt = new Date(now).toISOString();
    report.error = { name: error.name, message: error.message };
    saveReport(report);
    throw error;
  } finally {
    ledger?.close();
  }
}

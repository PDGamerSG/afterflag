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
const nowIso = () => new Date().toISOString();
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
    if (flagsmith) await flagsmith.setCodec(true);
    else fixtureCodec = 'v2';
    const rolledCodec = requireDecision(await readCodec(), 'codec', 'v2').observed;
    if (initialCodec === rolledCodec) throw new Error('Codec flag did not change');
    const oldJob = makeJob('old-export', initialCodec, legacy, now + 20);
    const newJob = makeJob('new-export', rolledCodec, replacement, now);
    ledger.enqueue(oldJob);
    phase('rollout', {
      message: 'Producer switched to v2 while a v1 export waited.',
      jobId: oldJob.id,
      codec: oldJob.codec,
      queue: ledger.inspect(initialCodec, now)
    });

    const candidateLedger = openLedger(':memory:');
    candidateLedger.enqueue(oldJob);
    const candidateAttempt = await runWorker({
      ledger: candidateLedger,
      jobId: oldJob.id,
      decoders: adapter.decoders('candidate'),
      readHold: async () => ({ enabled: false, observedAt: nowIso(), source: 'candidate' }),
      now: now + 25
    });
    candidateLedger.close();
    phase('candidate-before-drain', {
      message: 'The v2-only worker cannot decode the retained v1 message.',
      verdict: candidateAttempt.status,
      reason: candidateAttempt.reason ?? null,
      codec: candidateAttempt.codec ?? oldJob.codec
    });

    phase('retirement-before-fence', {
      message: 'An open admission lane blocks decoder retirement.',
      verdict: ledger.retire(initialCodec, now + 25).status
    });
    ledger.fence(initialCodec);
    ledger.enqueue(newJob);
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
    phase('hold', {
      message: 'A separate live hold prevents an effect while the worker restarts.',
      verdict: held.status,
      reason: held.reason,
      queue: ledger.inspect(initialCodec, now + 25)
    });

    if (flagsmith) await flagsmith.setHold(false);
    else fixtureHold = false;
    requireDecision(await readHold(), 'hold', false);
    let drained;
    if (ledgerPath !== ':memory:') {
      ledger.close();
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
    phase('drain-old', {
      message: 'The bridge decodes the retained V1 export before retirement.',
      verdict: drained.status,
      codec: drained.codec ?? oldJob.codec,
      effect: drained.effect ?? null
    });
    const check = await runRetirementCheck({
      ledger,
      oldCodec: initialCodec,
      newCodec: rolledCodec,
      oldJobId: oldJob.id,
      newJobId: newJob.id,
      expectedArtifact: adapter.expectedArtifact(replacement),
      now: now + 25,
      runCandidate: (jobId) => runWorker({
        ledger,
        jobId,
        decoders: adapter.decoders('bridge'),
        readHold,
        now: now + 25
      })
    });
    phase('drain-and-retire', {
      message: 'The bridge drains old work, proves the v2 worker, and checks redelivery.',
      verdict: check.status,
      replacement: check.replacement?.status ?? null,
      redelivery: check.redelivery?.status ?? null,
      ledger: check.ledger ?? ledger.inspect(initialCodec, now + 25)
    });

    const passed = check.status === 'ready' &&
      check.replacement?.status === 'committed' &&
      check.redelivery?.status === 'duplicate';
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
      committedEffects: ledger.effectCount(),
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
    ledger.close();
  }
}

import { openLedger } from '../src/ledger.mjs';
import { runWorker } from '../src/worker.mjs';
import { createFlagsmithClient } from '../src/flagsmith.mjs';
import { adapter } from '../adapters/document-export.mjs';

const ledgerPath = process.env.AFTERFLAG_LEDGER;
const jobId = process.env.AFTERFLAG_WORKER_JOB_ID ?? 'old-export';
const now = Number(process.env.AFTERFLAG_WORKER_NOW ?? Date.now());
const token = process.env.FLAGSMITH_ADMIN_TOKEN;
const environmentKey = process.env.FLAGSMITH_ENVIRONMENT_KEY;
const projectId = process.env.FLAGSMITH_PROJECT_ID;
const flagsmith = token && environmentKey && projectId
  ? createFlagsmithClient({
    baseUrl: process.env.FLAGSMITH_URL ?? 'http://127.0.0.1:18000',
    token,
    environmentKey,
    projectId: Number(projectId)
  })
  : null;
const ledger = openLedger(ledgerPath);
try {
  const result = await runWorker({
    ledger,
    jobId,
    decoders: adapter.decoders('bridge'),
    readHold: () => flagsmith
      ? flagsmith.decision(flagsmith.holdFlag)
      : Promise.resolve({ enabled: false, source: 'fixture-child' }),
    now
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'committed' || result.status === 'duplicate' ? 0 : 1;
} finally {
  ledger.close();
}

import { mkdirSync } from 'node:fs';
import { createFlagsmithClient } from '../src/flagsmith.mjs';
import { runRehearsal } from '../src/rehearsal.mjs';

const outputPath = process.env.AFTERFLAG_REPORT ?? 'artifacts/afterflag-report.json';
const ledgerPath = process.env.AFTERFLAG_LEDGER ?? 'artifacts/afterflag-ledger.sqlite';
const flagsmithUrl = process.env.FLAGSMITH_URL ?? 'http://127.0.0.1:18000';
const token = process.env.FLAGSMITH_ADMIN_TOKEN;
const environmentKey = process.env.FLAGSMITH_ENVIRONMENT_KEY;
const projectId = process.env.FLAGSMITH_PROJECT_ID;

mkdirSync('artifacts', { recursive: true });

function printSummary(report) {
  console.log(JSON.stringify({
    status: report.status,
    mode: report.flagsmith.mode,
    report: outputPath,
    candidateFailure: report.summary?.candidateFailure ?? null,
    safeRetirement: report.summary?.safeRetirement ?? null,
    committedEffects: report.summary?.committedEffects ?? null,
    transitions: report.flagsmith.transitions
  }, null, 2));
}

if (!token || !environmentKey || !projectId) {
  console.log('Live credentials are not configured. Running the fixture only.');
  const report = await runRehearsal({ reportPath: outputPath, ledgerPath });
  printSummary(report);
  process.exitCode = report.status === 'passed' ? 0 : 1;
} else {
  const client = createFlagsmithClient({
    baseUrl: flagsmithUrl,
    token,
    environmentKey,
    projectId: Number(projectId)
  });
  try {
    const report = await runRehearsal({ flagsmith: client, reportPath: outputPath, ledgerPath });
    printSummary(report);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    console.error('Afterflag could not produce trustworthy evidence.');
    console.error(error.message);
    if (error.details) console.error(JSON.stringify(error.details));
    process.exitCode = 2;
  }
}

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runRehearsal } from '../src/rehearsal.mjs';

const reportPath = process.env.AFTERFLAG_REPORT ?? 'artifacts/afterflag-report.json';
const directory = await mkdtemp(join(tmpdir(), 'afterflag-fixture-'));
try {
  await mkdir(dirname(reportPath), { recursive: true });
  const report = await runRehearsal({ reportPath, ledgerPath: join(directory, 'queue.sqlite') });
  console.log('SQLite fixture · ' + report.status + ' · ' + reportPath);
  process.exitCode = report.status === 'passed' ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
} finally {
  await rm(directory, { recursive: true, force: true });
}

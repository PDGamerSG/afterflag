import { spawn } from 'node:child_process';
import { startLab } from './lab.mjs';
import { gitSource } from './source.mjs';

let lab;
try {
  lab = await startLab();
  const source = gitSource();
  const child = spawn(process.execPath, ['--test'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AFTERFLAG_TEST_DB: lab.db,
      AFTERFLAG_TEST_FLAGSMITH: lab.flagsmith,
      AFTERFLAG_SOURCE: source ?? '',
      AFTERFLAG_INTEGRATION_ARTIFACTS: process.env.AFTERFLAG_INTEGRATION_ARTIFACTS ?? 'artifacts'
    }
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 2));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
} finally {
  if (lab) await lab.close();
}

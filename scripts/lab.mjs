import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const compose = fileURLToPath(new URL('../infra/release.compose.yml', import.meta.url));

export async function startLab({ databaseOnly = false } = {}) {
  const project = 'afterflag-' + randomBytes(6).toString('hex');
  const queuePassword = randomBytes(24).toString('hex');
  const env = {
    ...process.env,
    AF_QUEUE_PASSWORD: queuePassword,
    AF_LAB_PASSWORD: randomBytes(24).toString('hex'),
    AF_LAB_SERVER_SECRET: randomBytes(32).toString('hex')
  };
  const docker = async (args, timeout = 240000) => {
    try {
      const { stdout } = await exec('docker', ['compose', '-p', project, '-f', compose, ...args], {
        env, timeout, maxBuffer: 1024 * 1024
      });
      return stdout.trim();
    } catch {
      throw new Error('Docker Compose could not ' + args[0] + ' the isolated ' + project + ' lab.');
    }
  };
  const close = () => docker(['down', '--volumes', '--remove-orphans'], 45000);
  try {
    await docker(['up', '-d', '--wait', '--wait-timeout', '180', ...(databaseOnly ? ['queue-db'] : [])]);
    const port = async (service, internal) => {
      const bind = await docker(['port', service, String(internal)], 10000);
      if (!/^127\.0\.0\.1:\d+$/.test(bind)) throw new Error('Lab port was not bound to loopback.');
      return bind;
    };
    const db = await port('queue-db', 5432);
    let flagsmith;
    if (!databaseOnly) {
      flagsmith = 'http://' + await port('flagsmith', 8000);
      const deadline = Date.now() + 120000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(flagsmith + '/health/liveness/', {
            signal: AbortSignal.timeout(2000)
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!ready) throw new Error('The isolated Flagsmith API did not become healthy.');
    }
    return {
      project, close,
      db: 'postgresql://afterflag:' + queuePassword + '@' + db + '/afterflag',
      flagsmith
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { digest } from './queue.mjs';

const workerEntry = fileURLToPath(new URL('../../scripts/release-worker.mjs', import.meta.url));
const exec = promisify(execFile);

export async function deliver({ queue, decoders, build, id, now, readHold }) {
  const claim = await queue.claim({ id, now });
  const codecs = Object.keys(decoders).sort();
  const worker = { build, codecs, process: process.pid };
  if (claim.status !== 'claimed' && claim.status !== 'duplicate') return { ...worker, ...claim };

  const { bytes, ...job } = claim.job;
  const inputDigestObserved = digest(bytes);
  const matchesInput = job.inputDigest === inputDigestObserved;
  const observed = { ...worker, job, inputDigestObserved };
  if (claim.status === 'duplicate') {
    return matchesInput ? { ...observed, status: 'duplicate', receipt: claim.receipt }
      : { ...observed, status: 'input-mismatch', reason: 'input-digest-mismatch' };
  }

  const result = { ...observed, attempt: claim.attempt };
  async function defer(state, reason, status, hold = null) {
    const deferred = await queue.defer(job.id, claim.token, state, { now, reason });
    return { ...result, status: deferred.status === 'lease-lost' ? 'lease-lost' : status, reason, hold };
  }
  if (!matchesInput) return defer('dead', 'input-digest-mismatch', 'input-mismatch');
  const decode = Object.hasOwn(decoders, job.codec) ? decoders[job.codec] : undefined;
  if (typeof decode !== 'function') return defer('retry', 'missing-decoder', 'unsupported-codec');
  let artifact;
  try {
    artifact = decode(bytes);
    if (typeof artifact !== 'string' && !Buffer.isBuffer(artifact)) throw new TypeError('Invalid decoder output.');
  } catch {
    return defer('retry', 'decoder-error', 'decode-failed');
  }

  let hold;
  try {
    hold = await readHold();
  } catch {
    return defer('held', 'provider-unavailable', 'held');
  }
  if (hold?.enabled !== false) return defer('held', hold?.enabled === true ? 'hold-enabled' : 'invalid-hold', 'held', hold);

  const committed = await queue.complete(job.id, claim.token, artifact, now);
  if (committed.status === 'artifact-mismatch') return defer('retry', 'artifact-mismatch', 'artifact-mismatch', hold);
  return { ...result, ...committed, hold };
}

export async function runWorkerProcess(input) {
  const operation = exec(process.execPath, [workerEntry], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: input.benchmark ? 180000 : 30000,
    env: { PATH: process.env.PATH }
  });
  operation.child.stdin.on('error', () => {});
  operation.child.stdin.end(JSON.stringify(input));
  let output;
  try {
    output = await operation;
  } catch {
    throw new Error('The isolated worker could not complete its command.');
  }
  try {
    return JSON.parse(output.stdout);
  } catch {
    throw new Error('The isolated worker returned an invalid result.');
  }
}

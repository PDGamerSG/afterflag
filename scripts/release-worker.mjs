import { buffer } from 'node:stream/consumers';
import { performance } from 'node:perf_hooks';
import { openQueue } from '../src/release/queue.mjs';
import { importArtifact } from '../src/release/manifest.mjs';
import { observeHold } from '../src/release/policy.mjs';
import { deliver } from '../src/release/delivery.mjs';

try {
  const input = JSON.parse(await buffer(process.stdin));
  const { decoders } = await importArtifact(input.artifact);
  if (!decoders || typeof decoders !== 'object' ||
      !Object.values(decoders).every((decode) => typeof decode === 'function')) {
    throw new Error('The worker artifact must export a decoder registry.');
  }
  const queue = openQueue(input.databaseUrl, input.scope, { connections: 1 });
  try {
    if (input.benchmark) {
      const durations = [];
      let count = 0;
      for (;;) {
        const started = performance.now();
        const result = await deliver({
          queue, decoders, build: input.artifact.digest,
          readHold: async () => ({ enabled: false })
        });
        if (result.status === 'empty') break;
        if (result.status !== 'committed') throw new Error('The benchmark worker could not commit a job.');
        count++;
        durations.push(performance.now() - started);
      }
      console.log(JSON.stringify({ process: process.pid, count, durations }));
    } else {
      const result = await deliver({
        queue, decoders, build: input.artifact.digest, id: input.jobId, now: input.now,
        readHold: () => observeHold(input.policy)
      });
      console.log(JSON.stringify(result));
    }
  } finally {
    await queue.close();
  }
} catch {
  console.error('Afterflag worker failed.');
  process.exitCode = 2;
}

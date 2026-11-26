import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { startLab } from './lab.mjs';
import { gitSource } from './source.mjs';
import { openQueue, initQueue, digest } from '../src/release/queue.mjs';
import { loadManifest } from '../src/release/manifest.mjs';
import { runWorkerProcess } from '../src/release/delivery.mjs';

const queueUrl = process.env.AFTERFLAG_TEST_DB;
const lab = queueUrl ? null : await startLab({ databaseOnly: true });
const databaseUrl = queueUrl ?? lab.db;
const plan = await loadManifest('scenarios/document-export.json');
const reports = [];
const payload = Buffer.from('{"version":2,"document":{"title":"Benchmark","body":"Synthetic job."}}');
const expectedDigest = digest('Benchmark\nSynthetic job.\n');

const round = (value) => Math.round(value * 100) / 100;
async function benchmark(jobs, workerCount) {
  const scope = randomUUID();
  const queue = openQueue(databaseUrl, scope, { connections: 16 });
  try {
    await initQueue(queue.pool);
    await queue.addCodecs(['v1', 'v2']);
    for (let start = 0; start < jobs; start += 32) {
      const batch = Array.from({ length: Math.min(32, jobs - start) }, (_, i) => ({
        id: 'bench-' + (start + i), codec: 'v2', bytes: payload, expectedDigest
      }));
      await Promise.all(batch.map((job) => queue.enqueue(job)));
    }
    const started = performance.now();
    const runs = await Promise.all(Array.from({ length: workerCount }, () =>
      runWorkerProcess({ databaseUrl, scope, artifact: plan.artifacts.candidate, benchmark: true })));
    const elapsedMs = performance.now() - started;
    const count = runs.reduce((sum, run) => sum + run.count, 0);
    assert.equal(count, jobs);
    assert.equal(new Set(runs.map((run) => run.process)).size, workerCount);

    // A tenth of completed work is delivered again after the measured processing interval.
    let duplicates = 0;
    for (let i = 0; i < jobs; i += 10) {
      const replay = await queue.claim({ id: 'bench-' + i });
      assert.equal(replay.status, 'duplicate');
      assert.equal(replay.receipt.artifactDigest, expectedDigest);
      duplicates++;
    }
    const effects = await queue.effectCount();
    assert.equal(effects, jobs);
    assert.equal((await queue.inspect('v2')).pending, 0);
    const durations = runs.flatMap((run) => run.durations).sort((a, b) => a - b);
    return {
      jobs, workers: workerCount, committed: count, effects, duplicatesChecked: duplicates,
      duplicateEffects: effects - jobs, elapsedMs: round(elapsedMs), jobsPerSecond: round(jobs / (elapsedMs / 1000)),
      p95DeliveryMs: round(durations[Math.ceil(jobs * 0.95) - 1])
    };
  } finally {
    await queue.close();
  }
}

try {
  for (const jobs of [1000, 10000]) {
    for (const workers of [1, 4, 8]) {
      const result = await benchmark(jobs, workers);
      reports.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await mkdir('artifacts', { recursive: true });
  const report = {
    schema: 'afterflag/benchmark/v1', at: new Date().toISOString(), source: gitSource(),
    environment: { platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, node: process.version },
    scope: 'Single-host PostgreSQL, real worker processes, synthetic artifacts, fixed hold-off response. No Flagsmith network calls during timing.',
    results: reports
  };
  await writeFile('artifacts/benchmark-report.json', JSON.stringify(report, null, 2) + '\n');
} finally {
  if (lab) await lab.close();
}

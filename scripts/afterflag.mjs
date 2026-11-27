import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { startLab } from './lab.mjs';
import { gitSource } from './source.mjs';
import { bootstrapFlagsmith } from '../src/release/policy.mjs';
import { loadManifest } from '../src/release/manifest.mjs';
import { createEvidence, verifyEvidence } from '../src/release/evidence.mjs';
import { rehearse, releaseMetadata } from '../src/release/rehearse.mjs';

const defaultManifest = 'scenarios/document-export.json';
const defaultReport = 'artifacts/release-report.json';
const statusCode = { ready: 0, blocked: 1, incomplete: 2 };
const help = `Afterflag tests whether a queued worker can retire its old decoder.

  afterflag plan   [--manifest FILE]
  afterflag run    [--manifest FILE] [--report FILE] [--before-drain]
  afterflag verify [--report FILE] [--manifest FILE] [--source SHA] [--require-live]
                   [--public-key PEM]

Run uses Docker Compose. An optional Ed25519 private key file can be supplied as
AFTERFLAG_SIGNING_KEY. Keep its trusted public key separately for verification.
Exit codes: 0 ready, 1 blocked, 2 incomplete or malformed evidence.`;

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
  await rename(temporary, path);
}

const describe = (kind, data) => {
  const label = {
    'provider-ready': 'Self-hosted Flagsmith and PostgreSQL connected',
    baseline: 'Stable and pilot use the old codec',
    'legacy-admitted': 'Legacy job persisted under the old decision',
    'pilot-opened': 'Flagsmith moved the pilot cohort',
    promoted: 'Flagsmith promoted the new codec',
    fenced: 'Atomic fence and stale admission checked',
    blocker: 'Candidate exercised retained bytes',
    'health-blocked': 'Flagsmith recorded the blocked release',
    hold: 'Worker evaluated the live hold',
    drained: 'Relaunched bridge processed the old job',
    lifecycle: 'Delay, claims, hold, retry and redrive exercised',
    'replacement-admitted': 'Replacement job persisted under the new decision',
    candidate: 'Candidate exercised the replacement',
    redelivery: 'Candidate replayed the original receipt',
    retired: 'Atomic retirement checked',
    'health-ready': 'Flagsmith recorded the verified release',
    'halt-before-drain': 'Stopped at the demonstrated blocker',
    error: 'Rehearsal incomplete'
  }[kind];
  const status = data.worker?.status ?? data.status ?? data.type ?? data.gate?.status;
  return label + (status ? ' [' + status + ']' : '');
};

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, manifest: { type: 'string' },
      report: { type: 'string' }, source: { type: 'string' },
      'public-key': { type: 'string' }, 'require-live': { type: 'boolean' },
      'before-drain': { type: 'boolean' }
    }
  });
  if (values.help || !positionals.length || positionals[0] === 'help') {
    console.log(help);
    return;
  }
  if (positionals.length !== 1) throw new Error('Use --help for supported arguments.');
  const [command] = positionals;
  const path = resolve(values.report ?? process.env.AFTERFLAG_REPORT ?? defaultReport);
  if (command === 'verify') {
    const report = JSON.parse(await readFile(path, 'utf8'));
    const expected = values.manifest && await loadManifest(values.manifest);
    const result = verifyEvidence(report, {
      requireLive: values['require-live'],
      source: values.source,
      manifest: expected?.digest,
      expectedBuilds: expected?.artifacts,
      publicPem: values['public-key'] && await readFile(values['public-key'], 'utf8')
    });
    console.log(result.status.toUpperCase() + ' · ' +
      result.checks.filter((check) => check.status === 'pass').length + '/' + result.checks.length + ' proved');
    for (const check of result.checks.filter((item) => item.status === 'fail')) console.log('  Failed: ' + check.label);
    return statusCode[result.status];
  }

  if (command !== 'plan' && command !== 'run') throw new Error('Unknown command. Use --help.');
  const plan = await loadManifest(values.manifest ?? defaultManifest);
  const source = gitSource();
  if (command === 'plan') {
    const metadata = releaseMetadata(plan, source, 'new per run');
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }

  const privatePem = process.env.AFTERFLAG_SIGNING_KEY && await readFile(process.env.AFTERFLAG_SIGNING_KEY, 'utf8');
  console.log('Starting an isolated Flagsmith and PostgreSQL lab…');
  let lab;
  let report;
  try {
    lab = await startLab();
    const provision = await bootstrapFlagsmith(lab.flagsmith);
    const policy = await provision(plan.manifest);
    report = await rehearse({
      plan, databaseUrl: lab.db, policy, source, privatePem,
      stopBeforeDrain: values['before-drain'],
      onStep: (kind, data) => console.log('  ' + describe(kind, data))
    });
  } catch (error) {
    const id = randomUUID();
    const evidence = createEvidence({ id, metadata: releaseMetadata(plan, source, id) });
    evidence.add('error', { message: error.message.slice(0, 240) });
    report = evidence.finish(privatePem);
    console.error(error.message);
  } finally {
    if (lab) await lab.close().catch((error) => console.error(error.message));
  }
  await writeReport(path, report);
  const verdict = verifyEvidence(report, { requireLive: true });
  console.log(verdict.status.toUpperCase() + ' · ' + path);
  if (verdict.status === 'incomplete') {
    const failure = report.events.find((event) => event.kind === 'error');
    if (failure) console.error(failure.data.message);
  }
  for (const check of verdict.checks.filter((item) => item.status === 'fail')) console.log('  Failed: ' + check.label);
  return statusCode[verdict.status];
}

try {
  process.exitCode = await main() ?? 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

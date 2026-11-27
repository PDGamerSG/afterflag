import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { sha256, replayStates } from './manifest.mjs';
import { FLAGSMITH_DIGEST, FLAGSMITH_RELEASE } from './policy.mjs';

export const SCHEMA = 'afterflag/release-proof/v2';
const hex = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const hash = (value) => sha256(canonical(value));
const header = ({ schema, id, mode, metadata }) => ({ schema, id, mode, metadata });
const sameReceipt = (first, second) => hex(first?.id) && first.id === second?.id &&
  first.artifactDigest === second.artifactDigest && first.committedAt === second.committedAt;

export function evaluate(report) {
  const { metadata: m, events } = report;
  const old = m.codecs?.old;
  const modern = m.codecs?.new;
  const baseline = events.find((event) => event.kind === 'baseline')?.data;
  const legacy = events.find((event) => event.kind === 'legacy-admitted')?.data.job;
  const replacement = events.find((event) => event.kind === 'replacement-admitted')?.data.job;
  const rollout = events.find((event) => event.kind === 'promoted')?.data;
  const drained = events.find((event) => event.kind === 'drained')?.data;
  const negative = events.find((event) => event.kind === 'blocker')?.data;
  const fence = events.find((event) => event.kind === 'fenced')?.data.fence;
  const healthBlocked = events.find((event) => event.kind === 'health-blocked')?.data;
  const checks = [];

  function add(id, label, kinds, predicate) {
    const found = kinds.map((kind) => events.find((event) => event.kind === kind));
    const refs = found.filter(Boolean);
    const ordered = refs.every((event, index) => index === 0 || refs[index - 1].seq < event.seq);
    const state = refs.length !== found.length ? 'unknown'
      : ordered && predicate(...found.map((event) => event.data)) ? 'pass' : 'fail';
    checks.push({ id, label, status: state, events: refs.map((event) => event.seq) });
  }
  const providerOkay = (decision, flag, enabled) =>
    decision?.name === flag && decision?.enabled === enabled && hex(decision?.digest);
  const codecOkay = (decision, codec, ring) =>
    providerOkay(decision, m.flags?.codec, codec === modern) && decision.codec === codec && decision.ring === ring;
  const sameJob = (actual, expected) => Boolean(expected && actual?.id === expected.id &&
    actual?.codec === expected.codec && actual?.inputDigest === expected.inputDigest && hex(expected.inputDigest));
  const observedJob = (worker, expected) =>
    sameJob(worker?.job, expected) && worker.inputDigestObserved === expected.inputDigest;
  const candidateBuild = (worker) => worker?.build === m.builds?.candidate &&
    worker?.codecs?.length === 1 && worker.codecs[0] === modern &&
    Number.isSafeInteger(worker.process) && worker.process > 0;
  const health = (result, type) => result.type === type && Number.isSafeInteger(result.id) &&
    result.environmentId === m.flagsmith?.environmentId && result.featureId === m.flagsmith?.codecFeatureId;

  add('provider', 'Pinned Flagsmith and PostgreSQL', ['provider-ready'], ({ provider }) =>
    report.mode === 'live' && m.queue === 'postgresql' && hex(m.manifest) &&
    old && modern && old !== modern && hex(m.builds?.candidate) && hex(m.builds?.bridge) &&
    hex(m.builds?.producer) && m.builds.candidate !== m.builds.bridge &&
    provider?.version === FLAGSMITH_RELEASE && provider?.imageDigest === FLAGSMITH_DIGEST &&
    provider?.environmentId === m.flagsmith?.environmentId && provider?.environmentId > 0);
  add('rollout', 'The legacy job precedes the Flagsmith cutover',
    ['baseline', 'legacy-admitted', 'pilot-opened', 'promoted'],
    (before, admitted, pilot, after) =>
      codecOkay(before.stable, old, 'stable') && codecOkay(before.pilot, old, 'pilot') &&
      providerOkay(before.hold, m.flags?.hold, false) &&
      admitted.job?.id === m.specimens?.retained?.id && admitted.job?.codec === old &&
      admitted.job?.decisionDigest === before.stable.digest && hex(admitted.job?.inputDigest) &&
      codecOkay(pilot.stable, old, 'stable') && codecOkay(pilot.pilot, modern, 'pilot') &&
      pilot.pilot.segmentMatched === true &&
      codecOkay(after.stable, modern, 'stable') && codecOkay(after.pilot, modern, 'pilot'));
  add('fence', 'Stale admission is rejected and the existing job survives',
    ['promoted', 'fenced'], (_, result) =>
      result.fence?.status === 'fenced' && result.fence.codec === old && result.fence.generation > 0 &&
      result.rejected?.status === 'fenced' && result.rejected.codec === old &&
      result.rejected.generation === result.fence.generation && result.rejected.id !== legacy?.id &&
      result.capturedDecision === baseline?.stable?.digest &&
      result.retry?.status === 'existing' && sameJob(result.retry.job, legacy));
  add('counterexample', 'An empty ready queue hides bytes the candidate rejects',
    ['fenced', 'blocker'], (_, result) =>
      result.snapshot?.ready === 0 && result.snapshot?.pending === 1 &&
      result.snapshot?.blocking?.some((item) => sameJob(item, legacy)) &&
      result.gate?.status === 'blocked' && result.gate?.reason === 'pending-work' &&
      candidateBuild(result.candidate) && result.candidate.status === 'unsupported-codec' &&
      observedJob(result.candidate, legacy) && result.effects === 0);
  add('blocked-health', 'Flagsmith recorded the blocked release',
    ['blocker', 'health-blocked'], (_, result) => health(result, 'UNHEALTHY'));
  add('hold', 'A live hold preserves the job with zero effects',
    ['health-blocked', 'hold'], (_, result) =>
      result.worker?.status === 'held' && result.worker.reason === 'hold-enabled' &&
      providerOkay(result.worker.hold, m.flags?.hold, true) && observedJob(result.worker, legacy) &&
      result.effects === 0 && result.snapshot?.counts?.held === 1);
  add('bridge', 'A new bridge process commits the original artifact after resume',
    ['hold', 'drained'], (held, result) =>
      result.worker?.status === 'committed' && result.worker.build === m.builds?.bridge &&
      result.worker.process !== held.worker?.process && observedJob(result.worker, legacy) &&
      providerOkay(result.worker.hold, m.flags?.hold, false) && result.snapshot?.pending === 0 &&
      result.effects === 1 && sameReceipt(result.worker.receipt, result.receipt) &&
      result.receipt.artifactDigest === m.specimens?.retained?.artifactDigest);
  add('lifecycle', 'Delay, holds, retries, leases and dead letters all block retirement',
    ['drained', 'lifecycle'], (_, result) =>
      result.gate?.status === 'blocked' && result.gate?.reason === 'pending-work' &&
      result.snapshot?.pending === 5 && result.snapshot?.ready === 0 &&
      replayStates.every((state) => result.snapshot.counts?.[state] === 1) &&
      result.rejectedCompletion?.status === 'lease-lost' && result.rejectedDefer?.status === 'lease-lost' &&
      result.redrive?.status === 'redriven' && hex(result.deadInputDigest) &&
      result.redrive?.job?.inputDigest === result.deadInputDigest &&
      result.effects === 5 && result.final?.pending === 0);
  add('candidate', 'The same candidate commits the expected replacement artifact',
    ['drained', 'replacement-admitted', 'candidate'], (_, admitted, result) =>
      admitted.job?.id === m.specimens?.replacement?.id && admitted.job?.id !== legacy?.id &&
      admitted.job?.codec === modern && codecOkay(admitted.decision, modern, 'stable') &&
      admitted.decision.digest === rollout?.stable?.digest &&
      admitted.job?.decisionDigest === admitted.decision.digest &&
      candidateBuild(result.worker) && result.worker.build === negative?.candidate?.build &&
      observedJob(result.worker, replacement) &&
      result.worker.status === 'committed' &&
      providerOkay(result.worker.hold, m.flags?.hold, false) &&
      sameReceipt(result.worker.receipt, result.receipt) &&
      result.receipt.artifactDigest === m.specimens?.replacement?.artifactDigest);
  add('redelivery', 'The candidate returns the original receipt on old redelivery',
    ['candidate', 'redelivery'], (_, result) =>
      candidateBuild(result.worker) && result.worker.status === 'duplicate' &&
      observedJob(result.worker, legacy) &&
      sameReceipt(result.worker.receipt, drained?.receipt) &&
      sameReceipt(result.receipt, drained?.receipt) && result.effects === 2);
  add('retirement', 'The durable fence and zero outstanding old jobs authorize removal',
    ['redelivery', 'retired'], (_, result) =>
      result.status === 'ready' && result.snapshot?.codec === old && result.snapshot.admission === 'retired' &&
      result.snapshot.pending === 0 && result.snapshot.generation === fence?.generation &&
      result.rejected?.status === 'fenced' && result.rejected.generation === fence?.generation &&
      candidateBuild(result.replay) && result.replay.status === 'duplicate' &&
      observedJob(result.replay, legacy) &&
      sameReceipt(result.replay.receipt, drained?.receipt) && result.effects === 2);
  add('ready-health', 'Flagsmith recorded the verified release',
    ['retired', 'health-ready'], (_, result) => health(result, 'HEALTHY') &&
      result.id !== healthBlocked?.id && result.featureId === healthBlocked?.featureId);

  const failed = checks.some((check) => check.status === 'fail');
  const unknown = checks.some((check) => check.status === 'unknown');
  const blockedSample = events.at(-1)?.kind === 'halt-before-drain' &&
    checks.slice(0, 5).every((check) => check.status === 'pass');
  let status = 'ready';
  if (events.some((event) => event.kind === 'error')) status = 'incomplete';
  else if (failed || blockedSample) status = 'blocked';
  else if (unknown) status = 'incomplete';
  return { status, checks };
}

const reportSeal = (report) => hash({
  ...header(report), final: report.events.at(-1)?.hash ?? null, conclusion: report.conclusion
});

export function createEvidence({ id, metadata, mode = 'live' }) {
  const report = { schema: SCHEMA, id, mode, metadata: structuredClone(metadata), events: [] };
  return {
    report,
    add(kind, data) {
      const entry = {
        seq: report.events.length + 1, kind, at: new Date().toISOString(),
        data: JSON.parse(JSON.stringify(data)), previous: report.events.at(-1)?.hash ?? hash(header(report))
      };
      report.events.push({ ...entry, hash: hash(entry) });
    },
    finish(privatePem) {
      report.conclusion = evaluate(report);
      report.seal = reportSeal(report);
      if (privatePem) {
        const key = createPrivateKey(privatePem);
        if (key.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 evidence signing key.');
        report.attestation = {
          algorithm: 'Ed25519',
          fingerprint: sha256(createPublicKey(key).export({ type: 'spki', format: 'der' })),
          signature: sign(null, Buffer.from(report.seal, 'hex'), key).toString('base64')
        };
      }
      return report;
    }
  };
}

export function verifyEvidence(report, { requireLive = false, source, manifest, expectedBuilds, publicPem } = {}) {
  if (report?.schema !== SCHEMA || typeof report.id !== 'string' || !report.metadata ||
      !Array.isArray(report.events) || report.events.length > 64) {
    throw new Error('Unrecognized evidence report.');
  }
  if (requireLive && report.mode !== 'live') throw new Error('Expected a live provider report.');
  if (source && source !== report.metadata.source) throw new Error('Source fingerprint mismatch.');
  if (manifest && manifest !== report.metadata.manifest) throw new Error('Manifest fingerprint mismatch.');
  if (expectedBuilds && Object.entries(expectedBuilds).some(([role, artifact]) =>
    artifact.digest !== report.metadata.builds?.[role])) {
    throw new Error('Runtime artifact fingerprint mismatch.');
  }
  const seen = new Set();
  let previous = hash(header(report));
  for (const [index, { hash: entryHash, ...entry }] of report.events.entries()) {
    if (entry.seq !== index + 1 || entry.previous !== previous || !entry.kind ||
        !entry.data || seen.has(entry.kind) || entryHash !== hash(entry)) {
      throw new Error('Evidence chain mismatch at event ' + (index + 1) + '.');
    }
    previous = entryHash;
    seen.add(entry.kind);
  }
  const result = evaluate(report);
  if (hash(result) !== hash(report.conclusion) || reportSeal(report) !== report.seal) {
    throw new Error('Evidence verdict or seal mismatch.');
  }
  if (publicPem) {
    const key = createPublicKey(publicPem);
    const stamp = report.attestation;
    if (stamp?.algorithm !== 'Ed25519' || key.asymmetricKeyType !== 'ed25519' ||
        stamp.fingerprint !== sha256(key.export({ type: 'spki', format: 'der' })) ||
        !verify(null, Buffer.from(report.seal, 'hex'), key, Buffer.from(stamp.signature, 'base64'))) {
      throw new Error('Evidence signature mismatch.');
    }
  }
  return result;
}

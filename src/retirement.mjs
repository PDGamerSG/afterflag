import { createHash } from 'node:crypto';

export async function runRetirementCheck({
  ledger,
  oldCodec,
  newCodec,
  oldJobId,
  newJobId,
  expectedDigest,
  expectedArtifact,
  now,
  runCandidate
}) {
  const before = ledger.inspect(oldCodec, now);
  if (before.admission !== 'fenced') {
    return { status: 'blocked', reason: 'admission-not-fenced', before };
  }
  const oldJob = ledger.getJob(oldJobId);
  const newJob = ledger.getJob(newJobId);
  if (!oldJob || oldJob.codec !== oldCodec) {
    return { status: 'blocked', reason: 'old-job-codec-mismatch' };
  }
  if (!newJob || newJob.codec !== newCodec) {
    return { status: 'blocked', reason: 'new-job-codec-mismatch' };
  }
  if (before.pending > 0) {
    return { status: 'blocked', reason: 'pending-work', before, ledger: before };
  }
  const oldEffect = ledger.getEffect(oldJobId);
  if (oldJob.status !== 'committed' || !oldEffect || ledger.effectCount(oldJobId) !== 1) {
    return { status: 'blocked', reason: 'old-job-not-committed', before };
  }
  if (newJob.status === 'committed') {
    return { status: 'candidate-failed', reason: 'new-job-already-committed', before };
  }

  const expectedArtifactDigest = expectedArtifact === undefined
    ? expectedDigest
    : createHash('sha256').update(expectedArtifact).digest('hex');
  const replacement = await runCandidate(newJobId);
  const newEffect = ledger.getEffect(newJobId);
  if (replacement?.status !== 'committed' || !newEffect?.artifactDigest ||
      newEffect.receipt !== replacement.receipt || newEffect.artifactDigest !== expectedArtifactDigest ||
      ledger.effectCount(newJobId) !== 1) {
    return { status: 'candidate-failed', reason: 'new-worker-probe-failed', replacement, before };
  }
  const redelivery = await runCandidate(oldJobId);
  if (redelivery?.status !== 'duplicate' || redelivery.receipt !== oldEffect.receipt ||
      ledger.receipt(oldJobId)?.receipt !== oldEffect.receipt || ledger.effectCount(oldJobId) !== 1) {
    return {
      status: 'candidate-failed',
      reason: 'old-redelivery-not-idempotent',
      replacement,
      redelivery,
      before
    };
  }
  const result = ledger.retire(oldCodec, now);
  if (result.status !== 'ready') {
    return {
      status: 'blocked',
      reason: result.reason,
      replacement,
      redelivery,
      ledger: result.ledger
    };
  }
  return {
    status: 'ready',
    oldCodec,
    newCodec,
    replacement,
    redelivery,
    ledger: result.ledger
  };
}

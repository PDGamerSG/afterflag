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
  const replacement = await runCandidate(newJobId);
  const replacementMatches = expectedArtifact === undefined
    ? replacement.payloadDigest === expectedDigest
    : replacement.effect === expectedArtifact;
  if (replacement.status !== 'committed' || !replacementMatches) {
    return { status: 'candidate-failed', reason: 'new-worker-probe-failed', replacement, before };
  }
  const redelivery = await runCandidate(oldJobId);
  if (redelivery.status !== 'duplicate') {
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

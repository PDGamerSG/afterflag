export async function runWorker({
  ledger,
  jobId,
  decoders,
  readHold,
  now = Date.now(),
  effectType = 'export'
}) {
  const claim = ledger.claim(jobId, now);
  if (claim.status === 'delayed' || claim.status === 'missing' || claim.status === 'duplicate') {
    return claim;
  }
  if (claim.status !== 'claimed') return { status: 'unavailable', reason: claim.status };

  let decision;
  try {
    decision = await readHold();
  } catch {
    ledger.release(jobId);
    return { status: 'held', reason: 'provider-unavailable' };
  }
  if (!decision || decision.enabled !== false) {
    ledger.release(jobId);
    return {
      status: 'held',
      reason: decision?.enabled === true ? 'flag-enabled' : 'flag-unobserved'
    };
  }

  const decoder = decoders?.[claim.job.codec];
  if (!decoder) {
    ledger.release(jobId);
    return { status: 'unsupported-codec', codec: claim.job.codec };
  }
  try {
    const effect = decoder(claim.job.bytes);
    let latestDecision;
    try {
      latestDecision = await readHold();
    } catch {
      ledger.release(jobId);
      return { status: 'held', reason: 'provider-unavailable' };
    }
    if (!latestDecision || latestDecision.enabled !== false) {
      ledger.release(jobId);
      return {
        status: 'held',
        reason: latestDecision?.enabled === true ? 'flag-enabled' : 'flag-unobserved'
      };
    }
    const result = ledger.commit(jobId, effectType, now);
    return { ...result, jobId, codec: claim.job.codec, effect };
  } catch (error) {
    ledger.release(jobId);
    return { status: 'decode-failed', codec: claim.job.codec, reason: error.message };
  }
}

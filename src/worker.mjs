async function holdReason(readHold) {
  try {
    const decision = await readHold();
    if (decision?.enabled === false) return null;
    return decision?.enabled === true ? 'flag-enabled' : 'flag-unobserved';
  } catch {
    return 'provider-unavailable';
  }
}

export async function runWorker({
  ledger,
  jobId,
  decoders,
  readHold,
  now,
  effectType = 'export'
}) {
  const claim = ledger.claim(jobId, now);
  if (claim.status === 'delayed' || claim.status === 'missing' || claim.status === 'duplicate') {
    return claim;
  }
  if (claim.status !== 'claimed') return { status: 'unavailable', reason: claim.status };
  const { token, job } = claim;
  const releaseWith = (result) => {
    ledger.release(jobId, token, now);
    return result;
  };

  const held = await holdReason(readHold);
  if (held) return releaseWith({ status: 'held', reason: held });

  const decoder = decoders?.[job.codec];
  if (!decoder) return releaseWith({ status: 'unsupported-codec', codec: job.codec });
  try {
    const effect = decoder(job.bytes);
    const latestHold = await holdReason(readHold);
    if (latestHold) return releaseWith({ status: 'held', reason: latestHold });
    const result = ledger.commit(jobId, effectType, { token, artifact: effect, now });
    return result.status === 'committed' ? { ...result, jobId, codec: job.codec, effect } : result;
  } catch (error) {
    return releaseWith({ status: 'decode-failed', codec: job.codec, reason: error.message });
  }
}

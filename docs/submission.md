# Toggle Wars submission sheet

Use this after recording a public or unlisted YouTube or Loom video under three minutes. The form is the source of truth for the final submission.

## Suggested title

Afterflag: prove queued decoder retirement with Flagsmith

## Track

Track 03, Build on Open Source Flagsmith

## Problem and user

When a producer rollout changes the format of queued work, a ready-queue count can look empty while delayed, held or retryable old messages still need the previous decoder. Afterflag is for developers shipping asynchronous workers who need a release check before removing that decoder.

## What was built

Afterflag runs a reproducible CI rehearsal against a disposable self-hosted Flagsmith instance. A real Flagsmith codec flag changes new document exports from V1 to V2. The rehearsal proves that a V2-only worker cannot read the retained V1 bytes, rejects stale V1 admission, honors a separate live hold, resumes the same job in a child worker process, proves a V2 export, and returns the existing receipt on completed V1 redelivery.

## Flagsmith components

- Self-hosted Flagsmith
- Feature flags
- Flagsmith REST API
- A live codec flag and a separate live hold flag

## Reuse path

Clone the repository, run npm test, then run npm run demo. For live provider evidence, start infra/flagsmith.compose.yml, supply a disposable admin token, environment key and project ID, and run the same command. Adapt src/rehearsal.mjs and the document export adapter to a queue's payload and sink.

## Three-minute video beats

1. Show the delayed V1 job and the codec flag changing to V2.
2. Show the V2-only worker fail before drain.
3. Show open retirement blocked, then the stale admission fence.
4. Flip the live hold on, show zero effect, restart the child worker, flip the hold off and drain.
5. Show the V2 probe committed, the old redelivery returning its receipt, and the static evidence viewer.

## Required links before submission

- Public GitHub repository
- YouTube or Loom video under three minutes
- Optional live viewer URL
- README with setup, Flagsmith role and local output

Do not claim global queue emptiness, exactly-once external delivery or production-scale throughput. The report is scoped to the declared ledger, adapter and exercised paths.

# Afterflag

**Prove a queued release is safe before you retire its decoder.**

Afterflag is a small, reusable Track 03 tool for the Flagsmith Experimentation Hackathon. It runs a release rehearsal against a disposable self-hosted Flagsmith instance. The producer flag changes from document codec V1 to V2 while a V1 export waits. Afterflag proves the failure a V2-only worker would see, fences new V1 admissions, honors a separate live hold, drains the old message, verifies a V2 export, and checks that a completed V1 redelivery creates no second effect.

The verdict is scoped to the declared SQLite ledger and document-export adapter. It does not claim that a production queue is globally stopped. The live hold has a read-to-commit race that remains a deployment boundary.

## Run the proof

Node 22.13+ is required. The fixture run needs no cloud account or package install.

    npm test
    npm run demo
    npm run site
    npm run view

Open http://127.0.0.1:4173 after the viewer starts. The generated report is artifacts/afterflag-report.json.

The fixture run uses the same worker, ledger and adapter as the live integration. It is useful for a quick review, but the hackathon evidence should use the pinned self-hosted Flagsmith run.

## Live self-hosted Flagsmith

The pinned stack is Flagsmith 2.295.2 at digest sha256:48905c664152d8ae2c843ec9cee72ff197e7caff6e91b959bb851a235915ea35, with PostgreSQL and Experimentation enabled. The compose file binds the API to 127.0.0.1:18000. A disposable admin token and environment key stay in the shell environment and never enter the report.

    docker compose -p afterflag-flagsmith -f infra/flagsmith.compose.yml up -d
    export FLAGSMITH_ADMIN_TOKEN='token from the disposable local instance'
    export FLAGSMITH_ENVIRONMENT_KEY='development environment key'
    export FLAGSMITH_PROJECT_ID='numeric project id'
    npm run demo

The live run creates or reuses afterflag_codec_v2 and afterflag_hold, resets them, and proves every transition by reading the evaluated Flagsmith API response after each write. A missing flag, default fallback, malformed response, network error or provider timeout fails closed and returns exit code 2.

Create the first local admin through the dashboard or the documented bootstrap API. This project never stores that token. The official guide is linked in docs/research.md.

## Adapt it to a real queue

The reusable boundary is src/rehearsal.mjs. Keep these invariants in the adapter.

1. The producer stores the codec and payload digest in the job in the same transaction as admission.
2. A fenced codec rejects new jobs from stale producers, while same-intent retries return the original receipt.
3. The worker reads the emergency hold immediately before the effect commit. Provider failure holds work.
4. The effect intent and job completion use a unique job and effect key.
5. Retirement counts delayed, held, claimed and retryable rows in the same durable ledger.

The included SQLite ledger is a one-host proof adapter. A multi-host adapter should use PostgreSQL row locks or an equivalent lease and a sink-side idempotency key. Measure throughput and provider reads separately before making scale claims.

## Hackathon submission

Submit this public repository, an under-three-minute YouTube or Loom video, and the live demo URL if available. Track 03 asks what runs locally, what the reusable extension is, and how another developer uses it. The official deadline is November 29, 2026 at 8:00 PM IST.

- Toggle Wars overview: https://www.wemakedevs.org/hackathons/flagsmith
- Rules: https://www.wemakedevs.org/hackathons/flagsmith/rules
- Track judging: https://www.wemakedevs.org/hackathons/flagsmith#judging
- Research and pre-build review: docs/research.md and docs/review.md

## License

MIT

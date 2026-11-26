# Afterflag

**Prove that a queued worker can retire its old decoder.**

An empty ready queue can conceal delayed, held, retryable, claimed, or dead-letter work. Afterflag runs the actual candidate worker against retained bytes, verifies a version-specific producer fence and drain, and records the resulting release decision in Flagsmith.

[Document export proof](https://pdgamersg.github.io/afterflag/) · [Blocked release](https://pdgamersg.github.io/afterflag/blocked/) · [Webhook contract](https://pdgamersg.github.io/afterflag/webhook/) · [Contract guide](docs/contracts.md)

## Run it

Requires Node.js 22.13 or later, npm, and Docker with Compose. First run pulls pinned Flagsmith and PostgreSQL images and lets the Flagsmith database migrate.

~~~sh
./demo
npm run site
npm run view
~~~

The demo provisions an isolated Flagsmith and PostgreSQL lab, writes `artifacts/release-report.json`, and removes its own containers and volumes. The local evidence viewer runs at http://127.0.0.1:4173. Every run has fresh database and Flagsmith scopes.

~~~sh
# See the selected contract and fingerprints.
npm run afterflag -- plan

# Stop at the pre-drain gate to obtain a real BLOCKED report, exit 1.
npm run demo -- --before-drain --report artifacts/blocked-report.json

# Reuse the runner with a different format migration.
npm run demo -- --manifest scenarios/webhook-delivery.json --report artifacts/webhook-report.json

# Independently verify the evidence and the local contract's fingerprints.
npm run afterflag -- verify --require-live --manifest scenarios/document-export.json
~~~

The CLI returns **0 Ready**, **1 Blocked**, and **2 Incomplete or invalid evidence**.

## What the release gate observes

1. **Admit old work.** A V1 document is persisted before the rollout. Self-hosted Flagsmith switches the pilot cohort to V2 and then promotes the stable cohort.
2. **Observe the counterexample.** PostgreSQL sees zero ready jobs but one unresolved V1 job. A V2-only process cannot decode its stored bytes. The Flagsmith Feature Health webhook records the blocker, and Afterflag checks that it arrived.
3. **Fence and drain.** A durable per-codec fence rejects a producer using the captured V1 decision. The live hold flag preserves the old job with zero effects. A new bridge process commits the intended artifact after hold is released.
4. **Challenge the transition.** A replay lane exercises delayed, held, retryable, claimed, and redrivable jobs. A stale lease loses its ability to settle the job even after reassignment.
5. **Verify the candidate.** The same V2-only artifact commits the expected V2 output. It returns the original receipt on redelivery. PostgreSQL validates the fence and drains before recording retirement. Flagsmith records the healthy result.

GitHub Actions runs the same live checks and publishes only the verified run to Pages. The review scope is the declared queue and its transactional effect ledger. A fresh hold read leaves a window for work that has already passed that read.

## Reuse and verification

Copy a manifest and provide a producer, a bridge worker and a candidate worker as trusted local modules. The [contract guide](docs/contracts.md) includes the exact input/output contract, a CI integration, evidence signing, and the transport boundary.

- `npm test` runs local unit and SQLite regression tests. PostgreSQL and Flagsmith tests use the integration command.
- `npm run integration` runs ready, blocked, and alternate live proofs plus concurrent queue regressions.
- `npm run benchmark` runs six PostgreSQL workloads at 1,000 and 10,000 jobs with 1, 4, and 8 independent workers.
- `npm run demo:fixture` produces the historical SQLite demo without containers. The viewer labels it as a fixture.

## Toggle Wars

Track 03, Build on Open Source Flagsmith. [Research](docs/research-iteration.md) · [Review](docs/review.md) · [Submission sheet](docs/submission.md) · [MIT license](LICENSE)

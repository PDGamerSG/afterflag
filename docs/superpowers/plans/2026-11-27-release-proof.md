# Afterflag release proof implementation plan

**Goal**: Run a trustworthy decoder retirement decision using real Flagsmith, PostgreSQL and independently launched workers.

**Architecture**: One queue transaction is the source of admission, lease and retirement truth. A run coordinator joins that truth to remote Flagsmith decisions and worker artifact digests. A separately callable evidence gate derives a release verdict from observations.

**Tech stack**: Node 22.13+, PostgreSQL 17, Flagsmith 2.295.2, Docker Compose, GitHub Actions, HTML/CSS/JavaScript.

**Spec**: ../specs/2026-11-27-release-proof.md

- [x] Specify and exercise the PostgreSQL queue in src/release/queue.mjs and test/release/queue.test.mjs. Check admission races, all outstanding states, leases and exact effects.
- [x] Provision disposable Flagsmith and PostgreSQL from scripts/lab.mjs and infra/release.compose.yml. Validate reads, pilot and promotion, independent hold and health read-back.
- [x] Load a checked-in manifest in src/release/manifest.mjs. Execute distinct standalone runtime modules in scripts/release-worker.mjs. Run the same candidate artifact before and after the bridge drains.
- [x] Record and verify a versioned causal trace using src/release/evidence.mjs and src/release/rehearse.mjs. Cover errors, incomplete reports and early blockers.
- [x] Expose the CLI, a real CI workflow, workload benchmark and two reuse contracts. Derive the static viewer from verified reports. Capture the actual run video.
- [ ] Request a fresh Astra review of the delivered work. Revisit any failing criterion or incorrect evidence and rerun before publication.

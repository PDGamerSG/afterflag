# Afterflag implementation plan

Build a release check for retiring a decoder after a Flagsmith rollout. See docs/review.md.

1. Implement the SQLite ledger in src/ledger.mjs. Use explicit transaction boundaries to serialize admission, commit and retirement. Test delayed work, stale writes and idempotent effects in test/ledger.test.mjs.
2. Implement a local Flagsmith adapter in src/flagsmith.mjs and a real worker in src/worker.mjs. Bind disposable Flagsmith to loopback. Separate the live hold decision from the stored codec. Test missing provider results, resolved decode errors and duplicate deliveries.
3. Run the pre-rollout, blocked, fenced and ready cases in src/rehearsal.mjs. Use scripts/restart-worker.mjs against the same SQLite file for the worker restart. Save the same versioned JSON on a failed assertion or an incomplete run.
4. Provide the document export adapter in adapters/document-export.mjs, the npm run demo entry point and a GitHub Actions workflow. Run real provider verification and benchmark bounded queue workloads.
5. Build the responsive evidence viewer in scripts/site.mjs. Record an under-three-minute demo and use docs/submission.md for Track 03.

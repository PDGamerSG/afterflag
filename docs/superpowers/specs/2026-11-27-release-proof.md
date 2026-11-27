# Afterflag release proof

## Product

A release engineer needs to decide whether a candidate deployment can remove a message decoder. A versioned manifest describes a transition, two worker artifacts, and the queue paths it covers. Afterflag changes live Flagsmith policy in a disposable environment, then uses real persisted jobs and the candidate executable to challenge and verify that transition. The CLI can emit a deployment verdict, and engineers can open the exact job that explains it.

The release proof follows V1 document bytes admitted before rollout. A Flagsmith pilot recognizes V2 while the stable producer still selects V1. Promotion moves stable traffic to V2. Afterflag fences stale V1 admission and finds a delayed V1 job in a queue with zero ready jobs. The V2-only candidate reads those same bytes and rejects the codec. A bridge honors a live hold, drains V1 after relaunch, and the original candidate commits a V2 artifact and returns the already-written V1 receipt on redelivery. A V1 job that is claimed, retryable, or redrivable must block the same gate. Rehearsals use disposable control planes.

## Boundaries

- Flagsmith 2.295.2 provides remote transient cohort decisions, observed management writes, and native Feature Health events with read-back. The worker gets a restricted environment evaluator credential. Bootstrap credentials remain in the controller.
- PostgreSQL is the queue and effect ledger. A namespace scopes data to one run. An admission row serializes the per-codec fence with inserts and the final drain check. A scoped partial index finds unresolved work. Claims use an expiring UUID with guarded release and completion. A unique receipt records the persisted artifact digest and survives redelivery. Redrive resets a tracked job with its original codec and bytes.
- A checked-in JSON manifest identifies local trusted standalone producer, bridge and candidate modules and semantic artifact expectations. The controller records digests of the exact source bytes it executes. Worker processes open the same durable ledger per run. A separate companion manifest exercises another contract through the same CLI.
- Evidence records observed facts in causal order. An offline verifier checks the hash chain and computes the gate from code and queue observations, including the negative worker and the limiting scope. The canonical report carries source and manifest fingerprints. GitHub verifies the live run before deploying the read-only viewer.
- Exit codes are 0 for ready, 1 for a demonstrated blocker, and 2 for incomplete evidence. A provider error cannot enable an effect. The provider and database are separate systems, so an observed hold fences subsequent checks and has an in-flight read-to-commit window.

## Acceptance

| Criterion | Evidence |
| --- | --- |
| Provider drives the migration | Fresh seed and pilot/standard evaluations before and after actual Flagsmith writes. Show native unhealthy then healthy Feature Health read-back. |
| Candidate proof uses persisted bytes | V1 enqueue precedes cutover. An empty ready queue still blocks the gate. An independent V2-only process fails on the exact V1 byte digest. The same candidate build later succeeds on V2 and returns the matching V1 receipt. |
| Database protects the gate | Replay the captured V1 admission after fence. Exercise delay, hold, concurrent claims, lease expiry, retry, and dead-letter redrive. Check exact pending count and DB-unique committed receipts. |
| Scaling is measured | Run separate processes against one PostgreSQL queue. Report completed jobs, throughput, elapsed time and duplicate effects at bounded workloads. Identify infrastructure, policy-read mode and database scope. |
| Usable from a clean clone | A one-command Docker run, manifest plan and verification CLI, repeatable live GitHub check, a mobile-readable evidence explorer, and an under-three-minute recording. |
| Review | Astra inspects actual code, a fresh candidate proof and demo. The acceptance rating records the reviewer’s earned score on the organizer’s four criteria. |

## Design decisions

Pacing Wars covers live queue pausing, Flagpact covers flag-value compatibility across app versions, Rewind covers saved-state rollback, and pgsmith covers running Flagsmith evaluation inside SQL. Temporal and Restate supply version-aware draining, and Pact supplies contract deployment gates. The differentiating workflow here is a candidate decoder tested against live-flag-admitted, retained bytes and an exact fence over the same queue. A bounded public screen establishes separation from these projects.

The repository keeps its existing SQLite checks available. The new release command runs the exact PostgreSQL implementation. Accounts, production routing, remote plugin loading and external-effect exactly-once guarantees are outside the demonstrated scope.

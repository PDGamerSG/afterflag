# Afterflag pre-build review

**Decision: build for Track 03.** Afterflag tests whether a team can retire an old message decoder after switching producers to a new codec in Flagsmith. The green verdict is scoped to the ledger and worker exercised by the test.

No installed or publicly discoverable skill matched the name “Full Soul Review.” This review uses the product, design, developer-experience and engineering plan-review lenses in that order, with independent research and scoring. The scores below use the four organizer criteria and measure the plan before implementation.

| Organizer criterion | Reviewer 18 | Reviewer 20 | Mean | What earns the score |
| --- | ---: | ---: | ---: | --- |
| Use of Flagsmith | 9.50 | 9.75 | 9.625 | The real self-hosted provider selects the stored codec and separately holds worker effects. |
| Impact | 9.00 | 9.00 | 9.000 | The check identifies the old job that can fail when a decoder is removed. |
| Creativity | 8.25 | 8.25 | 8.250 | A bounded CI gate combines an actual flag change, durable admission fence, and candidate worker proof. |
| Demo video | 9.50 | 9.25 | 9.375 | The same live codec flag value produces blocked and ready verdicts as the queue drains. |
| **Average** | **9.0625** | **9.0625** | **9.0625** | **Clears the 9.0/10 pre-build threshold.** |

[Official scorecard](https://www.wemakedevs.org/hackathons/flagsmith#judging) · [Scoring guide](https://www.wemakedevs.org/blogs/how-to-win-toggle-wars)

## Product

The intended user is the developer changing the serialization format of asynchronous jobs. The first run takes a synthetic delayed V1 export across an actual Flagsmith rollout to V2. An empty ready queue and a V2-only consumer disagree about whether deployment is safe. The developer sees the job responsible, then verifies that a durable fence and a drain make the same V2-only consumer safe for the tested queue. Impact follows from preventing a deployment-induced failure, with adoption and production savings still unmeasured.

A basic OFF → ON → OFF rehearsal, symbolic targeting witnesses, and request-history replay all had close public implementations. The remaining differentiated behavior is a release check for queued bytes and decoder removal. See the [prior comparisons and search record](research.md).

## Design

The viewer opens on the blocked verdict and shows the late job alongside the live flag value. It puts the fence, drain and V2-only proof on a clickable ordered timeline. Every verdict pairs text with an accessible color and has browsable evidence. On narrow screens the evidence stages stack. The saved report has loading, unavailable-file and incomplete-run states. The demo shows both verdicts, the provider transition and the working CLI in under three minutes.

## Developer experience

One command starts a disposable Compose project, waits for migrations, provisions Flagsmith without a cloud account, runs the rehearsal and prints the report path. A local adapter can change the job and decoder behavior. The same runner exports versioned JSON, with exit 0 for pass, 1 for a failed release assertion and 2 when the run could not produce trustworthy evidence. Docker cold pulls and a first-time adapter path must be verified. Platform uptake and time saved in real teams remain open.

## Engineering

Producer codec selection is captured in the job. The separate hold flag is read before effect commit. Admission, pending counts and retirement share one durable ledger. The candidate decoder must process a new V2 job and return the existing receipt on completed V1 redelivery before decoding. Include delayed jobs, held jobs, and uncommitted work in the pending count. A provider error fails closed. A separate process exercises reads from the durable ledger on restart. Reports carry decision observations, job digests and run provenance. The SQLite adapter uses an indexed pending query and a single-host transactional effect. Independent CI runs can fan out. Multi-host adapters require equivalent fence and ledger semantics. A read-to-commit race exists for in-flight work even with a fresh flag read.

## Acceptance

1. Run two real Flagsmith changes against the pinned self-hosted release, with API read-back.
2. See zero ready jobs and one delayed V1 job. Attempt a newly deployed V2-only worker against a copy of that ledger and capture its reason for failing.
3. Fence new V1 admissions, reject a captured pre-rollout decision, honor live hold and drain the original message after a worker restart.
4. Exercise the actual V2-only registry, V1 redelivery and one exported receipt per job. Gate retirement on the candidate checks and an atomic ledger check.
5. Reproduce the run from a clean checkout in GitHub Actions and publish its report in a static viewer. Keep credentials in the disposable lab.

## Second discovery and architecture pass

On November 27, Astra reviewed the published v0.1 commit `c487bc8` and independently rated its working walkthrough **8.70/10**. The demo score covered the walkthrough. The required submission video was still unavailable. The old demo queued its V1 witness after promotion, used the bridge for its terminal check, failed on a repeated default run, and displayed fixture results as live on the public viewer. These findings supersede the original completion assessment.

| Criterion | Astra’s v0.1 review | Astra’s v0.2 design projection |
| --- | ---: | ---: |
| Flagsmith | 9.30 | 9.60 |
| Impact | 8.60 | 9.30 |
| Creativity | 8.40 | 9.20 |
| Demo | 8.50 | 9.40 |
| **Mean** | **8.70** | **9.375** |

The revised architecture uses a real PostgreSQL queue and separate worker processes, manifests and semantic output checks, an offline evidence verifier, and native Feature Health read-back. The projected rating qualified this architecture for implementation. A fresh earned rating must use the working build and recorded demonstration. [Second-round research](research-iteration.md) · [Architecture](superpowers/specs/2026-11-27-release-proof.md)

## First v0.2 implementation review

Astra scored the implementation at commit `4444ba9` **6.90/10**. It gave 9.6 for Flagsmith, 8.8 for impact, 9.2 for creativity and 0 for the missing recording. Its independent PostgreSQL test showed that a worker could still complete or defer a job after its lease expired while waiting for a row lock. [Reviewed code](https://github.com/PDGamerSG/afterflag/tree/4444ba9) · [CI evidence](https://github.com/PDGamerSG/afterflag/actions/runs/45913784071)

The follow-up samples the database clock after acquiring the row lock and checks the worker’s observed payload digest before decoding or replaying a receipt. Three contention regressions fail on the original queue and pass with the fix. The live suite passes 38 tests and the reusable action passes against a separate consumer checkout. The recorded demonstration follows the actual CLI output and evidence viewer for 1 minute 54 seconds. [Queue fix](https://github.com/PDGamerSG/afterflag/commit/35395eebee0a99f188e886f1513667dde1ffcc5e)

## First recorded cut

Astra scored commit `30c89d9` and the first recording **8.875/10**. It gave 9.5 for Flagsmith, 8.5 for impact, 9.0 for creativity and 8.5 for the video. It independently verified the four report verdicts and observed the PostgreSQL lock-wait tests pass. The requested improvements were a larger opening counterexample and a direct view of the matching Feature Health event in Flagsmith. The practice run uses synthetic workloads and the record contains no downstream production adoption. [Reviewed code](https://github.com/PDGamerSG/afterflag/tree/30c89d9)

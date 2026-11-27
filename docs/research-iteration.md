# Second-round research

**Decision.** Build a release gate for candidate decoders on a durable queue. Afterflag keeps the actual candidate code constant while the workload moves from a retained-message failure to a verified migration. The gate records its result in Flagsmith Feature Health.

## Scope and method

On November 27, 2026 we launched three read-only research tracks for concept and competitor analysis, architecture feasibility, and independent Astra review. The second pass searched beyond the 54 repositories in the [first screen](research.md). It opened the closest READMEs and vendor sources and compared where each product obtains its verdict. Code search throttling and unpublished submissions limit coverage.

| GitHub repository query | Returned by the second research track |
| --- | ---: |
| `"toggle wars" flagsmith in:readme` | 170 |
| `flagsmith "queue" in:readme created:>=2026-11-24` | 41 |
| `flagsmith "replay" in:readme created:>=2026-11-24` | 53 |
| `flagsmith "schema" in:readme created:>=2026-11-24` | 53 |
| `flagsmith "decoder" in:readme created:>=2026-11-24` | 7 |
| `flagsmith "drain" in:readme created:>=2026-11-24` | 7 |

Queries provide overlapping candidate sets. The counts are index snapshots. [Event search](https://github.com/search?q=%22toggle+wars%22+flagsmith+in%3Areadme&type=repositories) · [Queue search](https://github.com/search?q=flagsmith+%22queue%22+in%3Areadme+created%3A%3E%3D2026-11-24&type=repositories) · [Replay search](https://github.com/search?q=flagsmith+%22replay%22+in%3Areadme+created%3A%3E%3D2026-11-24&type=repositories)

## Closest evidence

| Project or method | Observed capabilities | Where Afterflag focuses |
| --- | --- | --- |
| Flagpact | Runs version tests on pending Flagsmith configuration, rehearses in clones, stages rollout and gates CI. | Candidate code runs the actual past payloads and receipt replays against a live PostgreSQL queue. [Flagpact](https://github.com/Nithinaug/flagpact) |
| Rewind | Rehearses flag rollback on saved client state using separate files and trusted journey commands. | One durable queue owns concurrent admission, leases, effects and redrive. [Rewind](https://github.com/kittu181707/rewind) |
| pgsmith | Compiles Flagsmith evaluation into SQL with immutable campaign snapshots and operational tooling. | PostgreSQL enforces queue invariants while Flagsmith remotely evaluates both the rollout and hold. [pgsmith](https://github.com/SriPrarabdha/pgsmith) |
| Pacing Wars | A live Flagsmith kill switch pauses BullMQ processing and retries, with stable strategies and deduplicated outcomes. | The same reduced codec registry has to reject retained bytes, then commit new output and acknowledge an old completed message. [Pacing Wars](https://github.com/Krrishkumar125/pacing-wars) |
| Flag Flight Recorder and Flag Rehearsal | Records failed requests for offline replay and rehearses browser journeys over different flag configurations. | Keep live admitted bytes and a version-specific fence in the queue that produces the verdict. [Flight Recorder](https://github.com/raj9073/flag-flight-recorder) · [Flag Rehearsal](https://github.com/krishh0310/flagsmith-) |
| NServiceBus serializer migration | Prescribes expand, switch writers, then remove the old serializer. Warns that old bytes can reappear in the error queue. | Exercise that failure with the actual candidate and verify the gate accounts for dead-letter redrive. [Migration sample](https://docs.particular.net/samples/serializers/transitioning-formats/) |
| Temporal, Restate and Trigger.dev | Version pinning, drainage and replay or deployment skew management for workflows. | A release test for application-owned message codecs and a PostgreSQL queue. [Temporal](https://docs.temporal.io/worker-versioning) · [Restate](https://docs.restate.dev/services/versioning) · [Trigger.dev](https://trigger.dev/docs/versioning) |
| Pact and Confluent | Compatibility gates and schema evolution policies. | Verify old work that was actually admitted before the flag changed, alongside the contract artifacts. [Pact](https://docs.pact.io/pact_broker/can_i_deploy) · [Confluent](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html) |
| LaunchDarkly and Flagsmith | Staged migrations and native release planning. | Feed observed queued-work evidence into the pinned open-source Feature Health webhook. [Migration flags](https://launchdarkly.com/docs/guides/flags/migrations) · [Feature Health](https://docs.flagsmith.com/managing-flags/feature-health-metrics) · [Release Pipelines](https://docs.flagsmith.com/managing-flags/release-pipeline) |

No exact public match for the scoped release check appeared in these sources. Serializer expansion, fencing, work drainage and replay have established precedents.

## What past judging rewarded

The closest verified Flagsmith award went to Insidious for running real feature changes during a self-hosted operational drill. Roloe and CapyKube reported sponsor-linked performance improvements and DebugProof tested the same failure on two releases. Public award records show that both solo developers and teams win. The detailed audit covers 30 project records from seven events, with team credits, observed mechanisms, and retrieval gaps. [Award-by-award audit](winners.md) · [Festive Hacks second place](https://x.com/WeMakeDevs/status/2126001571184116029) · [Cloud Native winners](https://www.wemakedevs.org/hackathons/cnh/projects) · [Agents of SigNoz winners](https://archive.wemakedevs.org/hackathons/signoz/projects)

## Directions scored by the research track

These are design estimates on the organizer’s four criteria, each with equal weight. [Scorecard](https://www.wemakedevs.org/hackathons/flagsmith#judging) · [Judging guide](https://www.wemakedevs.org/blogs/how-to-win-toggle-wars)

| Direction | Flagsmith | Impact | Creativity | Demo | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fenced decoder retirement and candidate evidence | 9.5 | 9.4 | 8.8 | 9.4 | 9.275 |
| Shadow replay and effect comparison | 9.0 | 9.1 | 8.2 | 8.7 | 8.75 |
| General migration control plane | 9.3 | 8.2 | 7.5 | 7.6 | 8.15 |

See the [design specification](superpowers/specs/2026-11-27-release-proof.md) for the selected architecture and [review](review.md) for Astra’s separate scores.

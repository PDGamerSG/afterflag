# Research record

Research date: November 27, 2026. This is a bounded public-source screen, not an exhaustive novelty or patent search.

## Event facts

- Overview: https://www.wemakedevs.org/hackathons/flagsmith gives four tracks and the scorecard. Track 03 requires self-hosted Flagsmith and reusable integrations or developer tools.
- Rules: https://www.wemakedevs.org/hackathons/flagsmith/rules require one public GitHub repository, setup README and short demo video. Teams have one to four registered human members. AI assistance is allowed if the entrant understands the code.
- Schedule: https://www.wemakedevs.org/hackathons/flagsmith/schedule closes submissions November 29, 2026 at 8 PM IST.
- Submission schema: https://wemakedevs-server.onrender.com/hackathons/flagsmith requires a public repo, README, video under three minutes on YouTube or Loom, project/problem/user description, Flagsmith components, feedback and selected track.

## Winner patterns

The public Cloud Native results, First Commit results, Cognee results, Graph Hacks results, and Agent Harness results repeatedly reward one clear user pain, a working sponsor-dependent mechanism, and a measurable before/after. They do not establish that a particular participant background or team size wins.

- Cloud Native: https://www.wemakedevs.org/hackathons/cnh/projects
- First Commit: https://www.wemakedevs.org/aws/first-commit/projects
- Cognee: https://archive.wemakedevs.org/hackathons/cognee/projects
- Graph Hacks: https://www.wemakedevs.org/hackathons/falkordb/projects
- Agent Harness: https://www.wemakedevs.org/hackathons/trueforge/projects

The closest Flagsmith co-sponsored result is Insidious, announced as Best Use of Flagsmith at Festive Hacks. It used real Flagsmith writes during a self-hosted store traffic rehearsal. RaktSetu was announced third for an approval-gated blood-finder workflow.

- Insidious: https://github.com/AloysJehwin/insidious
- RaktSetu: https://github.com/mavihsrr/raktsetu
- Festive Hacks projects: https://www.wemakedevs.org/hackathons/festivehacks/projects

## Public overlap screen

The query gh api search/repositories -f q='"toggle wars" flagsmith' returned 54 repositories on November 27.

| Existing project | Overlap rejected |
| --- | --- |
| Flag Rehearsal | Current/proposed browser journeys and CI against self-hosted Flagsmith |
| FlagProof | Real flag combinations, browser evidence and restored state |
| FlagLens | Static targeting proofs and smallest test plans |
| FlagRadius | Versioned policy snapshots and chronological replay |
| Flag Flight Recorder | Offline reproduction of flag-dependent failures |
| Branchpoint | Simulated rollback counterexamples and a schema failure |
| Pacing Wars | Live Flagsmith queue pause, retry/resume, dedupe and job timeline |
| SchemaSentinel | Sandboxed DDL compatibility and rollback |

Links:

- Flag Rehearsal: https://github.com/krishh0310/flagsmith-
- FlagProof: https://github.com/Aviral02git/FlagProof
- FlagLens: https://github.com/Pranav-Singh-Devloper/flaglens
- FlagRadius: https://github.com/GGGODLIN/flagradius
- Flag Flight Recorder: https://github.com/raj9073/flag-flight-recorder
- Branchpoint: https://github.com/mohitkushwaha0601/branchpoint
- Pacing Wars: https://github.com/Krrishkumar125/pacing-wars
- SchemaSentinel: https://github.com/mohitpargaie002-a11y/SchemaSentinel

The remaining wedge is deliberately narrow. Afterflag tests a real codec rollout against the same durable queued bytes, fences stale admission, and proves decoder retirement only after a candidate worker processes a new message and a completed old message redelivers without a second effect.

## Technical sources

- Pinned Flagsmith release: https://github.com/Flagsmith/flagsmith/releases/tag/v2.295.2
- Pinned compose: https://github.com/Flagsmith/flagsmith/blob/v2.295.2/docker-compose.yml
- Local bootstrap: https://docs.flagsmith.com/getting-started/run-locally-with-a-coding-agent
- AWS rollback safety: https://aws.amazon.com/builders-library/ensuring-rollback-safety-during-deployments/
- AWS queue drain: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/confirm-queue-is-empty.html
- Temporal Worker Versioning: https://docs.temporal.io/worker-versioning
- Confluent schema evolution: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html

The product claim is a scoped workflow integration, not a claim that versioned messages, queue drains, idempotency or rollback safety were invented here.

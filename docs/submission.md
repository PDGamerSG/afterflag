# Toggle Wars submission

**Title**

Afterflag — prove queued decoder retirement with Flagsmith

**Track**

Track 03, Build on Open Source Flagsmith

**Problem and users**

When a feature flag changes a producer’s codec, the ready queue can show zero while delayed, held, retryable, in-flight, or dead-letter jobs still depend on the previous decoder. Afterflag gives release engineers a reproducible check before deploying a worker that removes it.

**What we built**

A manifest records two codec versions, worker artifacts, expected outputs, and replay coverage. The same V2-only candidate fails against a V1 document admitted before the flag flip, then succeeds after a PostgreSQL fence and controlled drain. Stale producers are refused, expired claims cannot commit, and an old redelivery returns its original receipt. An offline verifier recomputes the decision. The same runner checks a second format migration for webhook delivery intents.

**How Flagsmith is used**

Afterflag runs self-hosted Flagsmith 2.295.2. The Flags API evaluates the initial, pilot, and promoted codec policy. The separate hold flag controls effect commits. A Feature Health webhook records unhealthy and healthy results, which the runner reads back through Flagsmith’s management API. The artifact records observed values and digests.

**Reuse**

Clone the public repository and run `./demo`. The Docker lab self-provisions and produces a browseable JSON proof. To test another release, replace the local manifest and its producer, bridge and candidate modules. The CI action returns ready, blocked, or incomplete.

**Flagsmith feedback**

Transient identity evaluations made the pilot easy to test without storing customer profiles. The Feature Health webhook made it possible to post an evidence-backed release result. Onboarding would benefit from a single documented, versioned API recipe covering segment overrides, audit read-back, and Feature Health for headless self-hosted CI.

## Links and cutoff

- [Public repository](https://github.com/PDGamerSG/afterflag)
- [Evidence viewer](https://pdgamersg.github.io/afterflag/)
- [Organizer submission form](https://www.wemakedevs.org/hackathons/flagsmith/submit)

The form requires a public or unlisted **YouTube or Loom link under three minutes** and a public repository with setup details. Submit by **November 29, 2026 at 8:00 p.m. IST**. [Submission schema](https://wemakedevs-server.onrender.com/hackathons/flagsmith) · [Rules](https://www.wemakedevs.org/hackathons/flagsmith/rules)

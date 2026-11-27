# Reuse the release check

The [document](../scenarios/document-export.json) and [webhook intent](../scenarios/webhook-delivery.json) contracts exercise the same runner and distinct payload formats.

## Manifest version 1

Copy one manifest and keep its worker modules inside the same directory tree. Use distinct IDs for the two codecs, Flagsmith flags, and specimen jobs.

| Field | Purpose |
| --- | --- |
| `id` and `title` | Stable contract ID and a human-readable title. |
| `flags.codec` and `flags.hold` | Boolean rollout and live hold flags in the disposable Flagsmith project. The codec flag also carries the selected codec as a string value. |
| `codecs.old` and `codecs.new` | Versions active before and after promotion. |
| `artifacts.producer` | Standalone ESM module exporting `encode(codec, payload)`. Return a string or buffer containing the real envelope. |
| `artifacts.bridge` and `artifacts.candidate` | Standalone ESM modules exporting `decoders` keyed by codec ID. Each decoder receives a buffer and returns deterministic string or byte content. The bridge supports both codecs. The candidate declares the new codec. |
| `specimens` | Retained and replacement job payloads, their distinct IDs, and the expected semantic artifact as an exact UTF-8 string. The retained job also declares `delayMs`. The rehearsal advances a logical clock to deliver it without a wall-clock wait. |
| `replay` | Declare `pending`, `held`, `retry`, `claimed` and `dead`. All source paths represented by these states must share the ledger. |

Keep worker functions pure. Side-effect bytes are committed transactionally to the PostgreSQL effect table, which owns one receipt per job. The controller and worker use the exact loaded module bytes. Bundle relative imports before supplying an artifact. Supply only code from the checkout you intend to run. The lab does not offer a sandbox for untrusted plugins.

## CI action

Use a Node 22 runner with Docker Compose and a checked-out trusted consumer repository. Pin the action reference to a release commit in your CI policy.

~~~yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- uses: PDGamerSG/afterflag/.github/actions/release-proof@30c89d963059de6af13e5dbe2d5e3bfc4155933c
  with:
    manifest: release/document-export.json
    report: artifacts/release-report.json
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: decoder-retirement-proof
    path: artifacts/release-report.json
~~~

The action preserves the verifier exit code. It needs no production Flagsmith, database, or AWS credentials.

## Evidence and trust

`afterflag verify` recomputes predicates and sequence, verifies the hash chain, and can bind an expected source SHA and local manifest. When given `--manifest`, it compares the three actual module fingerprints as well as the manifest. Reports include only relevant digests and job IDs. The hash chain catches corruption. Signing binds the sealed report to a key that you trust out of band.

~~~sh
openssl genpkey -algorithm Ed25519 -out /path/to/private.pem
openssl pkey -in /path/to/private.pem -pubout -out /path/to/public.pem
AFTERFLAG_SIGNING_KEY=/path/to/private.pem ./demo
npm run afterflag -- verify --require-live --public-key /path/to/public.pem
~~~

## Queue and deployment contract

Afterflag’s PostgreSQL queue replaces the broker for the supplied integration. Use a scope per contract and rehearsal. The admission fence and final backlog read share the same transactional boundary. `SKIP LOCKED` distributes ready jobs to workers. The retirement query counts all unresolved old rows, including dead jobs, without skipping locks. Workers check lease ownership after acquiring the row lock. Each delivery hashes the stored payload bytes before deciding whether to decode or replay a receipt. A digest mismatch on an uncommitted job moves it to the dead-letter state.

External producers, brokers, replay archives, or a separate effect sink need their own authoritative adapter with equivalent fencing and idempotency. An approximate broker count cannot establish the same proof. Compatibility between app versions and formats depends on the specimens and artifacts you supply. Use the archived JSON and pinned CI source to inspect the exact evidence behind a decision.

# Task 1 Report: Exact Identity Crosswalk

## Result

- Status: DONE_WITH_CONCERNS
- Commit: `bea4f4d` (`feat: add matrix identity crosswalk`)

## RED

Command:

```text
node scripts/test-matrix-identity.js
```

Observed result: exit 1. Node raised `MODULE_NOT_FOUND` for `../src/services/matrixIdentity`, which was the expected missing-module failure before production implementation.

## GREEN

Commands:

```text
node scripts/test-matrix-identity.js
node --check src/services/matrixIdentity.js
node --check scripts/test-matrix-identity.js
git diff --check -- src/db.js src/services/matrixIdentity.js scripts/test-matrix-identity.js scripts/fixtures/matrix-core/entity-crosswalk.json
```

Observed result: exit 0. The focused test printed `PASS matrix identity exact crosswalk`; both syntax checks and the scoped whitespace check completed without errors.

## Coverage

- All five allowlisted exact methods link automatically.
- Caller-defined methods, approximate name/address candidates, and unverified email-domain evidence create one injected review task and do not create links.
- External identity keys are normalized and stored only as SHA-256 hashes.
- Identical idempotent replay is stable; a changed request using the same key fails.
- Link/evidence rows reject update and delete operations.
- Fixture resolves Atlas candidate, CRM record, public email and WhatsApp identities, inquiry, and order through one confirmed organization link, making the complete resolved set available to suppression/revocation consumers.

## Modified Files in Commit

- `src/services/matrixIdentity.js`
- `src/db.js`
- `scripts/test-matrix-identity.js`
- `scripts/fixtures/matrix-core/entity-crosswalk.json`

## Self-review

- Checked the table constraint against the exact five-method allowlist.
- Checked that no raw external-key column or value is persisted.
- Checked that review behavior uses only the injected `taskSupervisor.createReviewTask` stub contract and imports no later-task implementation.
- Checked the commit file list; the pre-existing modified plan file was neither edited for this task nor staged.

## Concerns

- The injected task supervisor owns durable idempotency for ambiguous review tasks; Task 1 supplies the idempotency key but intentionally does not implement the later supervisor persistence layer.
- The worktree already contained an unrelated modification to `docs/superpowers/plans/2026-07-18-matrix-supervisor-atlas-draft.md`; it remains uncommitted and untouched by this task.

## Independent Review Fix

### RED

The focused test was extended before production changes. The observed failures were:

- ambiguous candidate payloads exposed a raw external key through an untyped nested object;
- identical ambiguous replay returned a second injected task result instead of the original result;
- with logical-link alias reservation removed, reusing the fresh alias key for a different payload did not raise the expected idempotency conflict.

### GREEN

- Evidence redaction now covers recursive object keys as well as values, and ambiguous candidates are projected into a bounded typed schema before fingerprinting or forwarding.
- `matrix_identity_commands` owns fingerprints and results for Task 1 commands. Review commands reserve their key, call the injected stub, and persist its result in one transaction; identical replay reads the stored result and changed payload reuse conflicts.
- Exact-link commands reserve both original keys and fresh keys accepted for an existing logical link in the same transaction as link lookup/creation.
- Existing link command keys are backfilled from immutable link rows when the database initializes.

Verification commands:

```text
node scripts/test-matrix-identity.js
node --check src/services/matrixIdentity.js
node --check scripts/test-matrix-identity.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-api.js
git diff --check
```

Observed result: all commands completed with exit 0. The API baseline initially encountered sandbox `EPERM` while binding its local test port; the approved out-of-sandbox rerun completed successfully.

## Independent Review R2 Fix

### RED

The R2 regression cases were added before each production change. The focused test produced these expected failures:

- an ambiguous candidate carrying `externalKey` and `metadata` did not raise the required unknown-field error;
- a case-expanding Unicode domain key remained verbatim in persisted evidence;
- with collision detection removed, two evidence property names that redacted to one name were silently accepted instead of raising an evidence-key collision.

### GREEN

- Domain namespaces now canonicalize external keys through Unicode NFC and ASCII/Punycode domain conversion with label validation. Other namespaces canonicalize with NFKC and lowercase, then require visible ASCII.
- Evidence sanitization covers the raw key, canonical key, case variants, and NFC/NFD/NFKC/NFKD variants in both property names and values.
- Ambiguous candidates enforce an exact typed-field allowlist. Any unknown string or symbol field is rejected before fingerprinting, command reservation, or stub invocation.
- Evidence objects are rebuilt with null prototypes, and duplicate property names created by redaction abort the command before link creation.
- Tests cover case expansion, composed/decomposed normalization resolving to one domain key, non-domain non-ASCII rejection, unknown candidate fields, and post-redaction key collision.

R2 verification commands:

```text
node scripts/test-matrix-identity.js
node --check src/services/matrixIdentity.js
node --check scripts/test-matrix-identity.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-api.js
git diff --check
```

Observed result: all focused, syntax, shared database, API, and whitespace checks completed with exit 0.

## Independent Review R4 Fix

The final review probe showed that scanning serialized JSON confused primitive text
such as `true`, `null`, and `1` with leaked string evidence. The boundary check now
walks only evidence property names and string values; booleans, numbers, and null
are ignored because they cannot contain an external-key string. Regression cases
cover domain keys `true`, `false`, and `null`, plus legal ID `1`, while retaining
the Unicode, marker-overlap, collision, replay, and immutable-evidence coverage.

Verification:

```text
node scripts/test-matrix-identity.js
node --check src/services/matrixIdentity.js
node --check scripts/test-matrix-identity.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
git diff --check
```

All commands completed with exit 0.

## Independent Review R3 Fix

### RED

The R3 tests were added before production changes and produced both expected failures:

- an accepted legal-ID key matching text in the visible replacement marker remained in serialized evidence;
- a confirmed Unicode multi-word alias failed under the suffix-inferred non-domain ASCII rule.

### GREEN

- Redacted substrings now use one private-use sentinel containing no visible text or digest. Every canonical evidence serialization is scanned for all raw, canonical, case, and normalization forms before review forwarding, fingerprinting, or persistence.
- Marker-overlap tests cover accepted keys matching the prior marker wording, digest wording, and a full digest-shaped key in both property names and nested values.
- Namespace policy is an explicit fixed mapping: `organization_domain` uses IDNA domain canonicalization; `legal_id` uses a bounded ASCII identifier policy; `lei` uses a 20-character ASCII policy; `organization_alias` uses normalized Unicode text with collapsed whitespace.
- Exact methods are validated against the declared namespace policy. Unknown namespaces, suffix-only domain names, and method-policy mismatches are rejected without inferring behavior from namespace spelling.
- Existing public method signatures remain unchanged, and link/resolve use the same explicit policy mapping.

R3 verification commands:

```text
node scripts/test-matrix-identity.js
node --check src/services/matrixIdentity.js
node --check scripts/test-matrix-identity.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-api.js
git diff --check
```

Observed result: all focused, syntax, shared database, API, and whitespace checks completed with exit 0.

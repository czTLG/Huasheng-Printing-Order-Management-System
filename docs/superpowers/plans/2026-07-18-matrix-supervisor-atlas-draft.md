# Matrix Supervisor Atlas and Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete compliant 100/20/5 public discovery and produce evidence-bound 90–130 word English drafts, complete Chinese translations, and separate review-only WhatsApp copy.

**Architecture:** Continue the reviewed protected Atlas SQLite store and source registry. Only the scanner fetches; adapters parse supplied content; resolver reads CRM query-only; reader/scorer create evidence-linked facts; reviewed packets materialize into the existing candidate compatibility tables; Matrix Stream remains the only delivery boundary.

**Tech Stack:** Node.js 22, CommonJS, `better-sqlite3`, injected native `fetch`, exact-pinned `cheerio@1.0.0` after dependency review, systemd timer, Node `assert`.

## Global Constraints

- Reuse completed Atlas store/source-policy commits `f3e7963..27c3f05`; do not rewrite them.
- Public organizational information only with exact URL, source class, observed time, fingerprint, parser version, and locator.
- Daily maximums: 100 light discoveries, 20 deep reads, five recommendations, zero Atlas outbound attempts.
- Start production at 10/3/1 and reduce discovery when backlog grows.
- No login/CAPTCHA/paywall bypass, private profiles, guessed contacts, contact-form submission, stealth behavior, or automatic outreach.
- China-fit is `confirmed | public_lead | unknown | conflicting`; missing evidence stays unknown.
- English body is 90–130 words excluding signature; Chinese is fully paired; WhatsApp is separate 45–80 words and manual/review-only.
- Person/role requires exact public evidence; otherwise use `Dear <Company> team`.
- One official same-domain website link maximum, normally in signature.
- Registered real sources remain paused until separate current policy approval.

---

## Canonical Cross-Task Contracts

```sql
-- Immutable history. This is the source of truth; UPDATE and DELETE are denied
-- by triggers. A transaction inserts one event and then refreshes the projection.
CREATE TABLE atlas_identity_link_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  link_version INTEGER NOT NULL CHECK(link_version > 0),
  organization_id INTEGER NOT NULL REFERENCES atlas_organizations(id),
  endpoint_type TEXT NOT NULL CHECK(endpoint_type IN ('crm_customer','public_email','public_whatsapp','email_thread','inquiry','order','confirmed_alias')),
  endpoint_id_hash TEXT NOT NULL CHECK(length(endpoint_id_hash) = 64 AND endpoint_id_hash NOT GLOB '*[^0-9a-f]*'),
  endpoint_hash_version TEXT NOT NULL CHECK(endpoint_hash_version = 'sha256-normalized-v1'),
  direction TEXT NOT NULL CHECK(direction IN ('organization_to_endpoint','endpoint_to_organization','bidirectional')),
  cardinality TEXT NOT NULL CHECK(cardinality IN ('one','many')),
  state TEXT NOT NULL CHECK(state IN ('confirmed','review_required','blocked','revoked')),
  suppression_state TEXT NOT NULL CHECK(suppression_state IN ('clear','opt_out','bounced','do_not_contact','suppressed')),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  actor_user_id INTEGER NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN ('created','confirmed','review_required','blocked','revoked','opt_out','bounce','do_not_contact','suppressed','cleared_after_review')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(link_id, link_version)
);

-- Rebuildable current projection. Only appendIdentityLinkEvent may update it.
CREATE TABLE atlas_identity_links (
  link_id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES atlas_organizations(id),
  endpoint_type TEXT NOT NULL CHECK(endpoint_type IN ('crm_customer','public_email','public_whatsapp','email_thread','inquiry','order','confirmed_alias')),
  endpoint_id_hash TEXT NOT NULL CHECK(length(endpoint_id_hash) = 64 AND endpoint_id_hash NOT GLOB '*[^0-9a-f]*'),
  endpoint_hash_version TEXT NOT NULL CHECK(endpoint_hash_version = 'sha256-normalized-v1'),
  direction TEXT NOT NULL CHECK(direction IN ('organization_to_endpoint','endpoint_to_organization','bidirectional')),
  cardinality TEXT NOT NULL CHECK(cardinality IN ('one','many')),
  state TEXT NOT NULL CHECK(state IN ('confirmed','review_required','blocked','revoked')),
  suppression_state TEXT NOT NULL CHECK(suppression_state IN ('clear','opt_out','bounced','do_not_contact','suppressed')),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
  version INTEGER NOT NULL CHECK(version > 0),
  last_event_id INTEGER NOT NULL UNIQUE REFERENCES atlas_identity_link_events(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ambiguous/shared endpoints may have multiple review_required rows. Only one
-- organization may own a confirmed endpoint.
CREATE UNIQUE INDEX atlas_identity_confirmed_endpoint_uq
  ON atlas_identity_links(endpoint_type, endpoint_id_hash)
  WHERE state = 'confirmed';
```

`appendIdentityLinkEvent(db, { linkId, expectedVersion, organizationId, endpointType, normalizedEndpoint, direction, cardinality, state, suppressionState, evidenceIds, actorUserId, reasonCode, idempotencyKey, now })` normalizes, hashes, inserts `link_version=expectedVersion+1`, and updates the projection in one `IMMEDIATE` transaction. Version `0` means create; any mismatch is `IDENTITY_VERSION_CONFLICT`. Projection rows are never changed without a matching event, and rebuilding the projection from events must produce byte-identical rows.

Endpoint normalization is exact: organizational email is trimmed NFC lowercase; WhatsApp is validated E.164; CRM/thread/inquiry/order IDs are trimmed ASCII prefixed with their authoritative system namespace; confirmed aliases use `alias_type + ':' + normalized_value`. The hash is lowercase hex SHA-256 of `endpoint_type + '\0' + normalized_endpoint`. Raw endpoint values never enter events, logs, errors, or hashes returned to callers. Multiple `review_required` rows represent ambiguity; confirmation is transactional and the partial unique index prevents two confirmed owners.

```js
// Content hash: sha256:<64 lowercase hex> over UTF-8 RFC-8785 canonical JSON of
// {facts,site_resource,source_evidence_ids}. Facts sort by fact_key; every
// evidence-id array is numeric ascending. Lifecycle fields are excluded.
SenderFactVersion = {
  version_id: String, version_no: Integer, content_hash: 'sha256:<hex>',
  facts: [{ fact_key: String, value: String, evidence_ids: [Integer], source_url: 'https://...', observed_at: ISO8601 }],
  site_resource: { canonical_url: 'https://...', canonical_host: String, resource_version: String, evidence_ids: [Integer] },
  source_evidence_ids: [Integer],
  status: 'draft'|'approved'|'revoked'|'superseded',
  created_by: Integer, created_at: ISO8601,
  approved_by: Integer|null, approved_at: ISO8601|null,
  revoked_by: Integer|null, revoked_at: ISO8601|null, revocation_reason: String|null,
  supersedes_id: String|null, superseded_by_id: String|null
}

SenderFactProvider = {
  generate({
    channel: 'email'|'whatsapp',
    requested_fields: ['subject','body_en','body_cn','strategy_cn']|['whatsapp_en','whatsapp_cn'],
    candidate_fact_block: CandidateFactBlock,
    sender_fact_version: SenderFactVersion,
    recipient_evidence_id: Integer,
    policy_version: String
  })
  // -> an object containing exactly requested_fields; no extra/null fields
}

AtlasDraft = {
  subject: String|null, body_en: String|null, body_cn: String|null,
  strategy_cn: String|null, whatsapp_en: String|null, whatsapp_cn: String|null,
  channel_generation: {
    email: 'generated'|'unavailable'|'provider_failed',
    whatsapp: 'generated'|'unavailable'|'provider_failed'
  },
  claim_bindings: [ClaimBinding]
}

ChannelAvailability = {
  email: { available: Boolean, reason_code: ChannelReason, recipient_evidence_id: Integer|null, policy_version: String },
  whatsapp: { available: Boolean, reason_code: ChannelReason, recipient_evidence_id: Integer|null, policy_version: String }
}
ChannelReason = 'eligible'|'missing_recipient'|'stale_evidence'|'not_organization_owned'|'policy_denied'|'suppressed'|'channel_not_requested'

ClaimBinding = {
  output_field: 'subject'|'body_en'|'body_cn'|'whatsapp_en'|'whatsapp_cn',
  sentence_index: Integer, claim_type: String,
  evidence_ids: [Integer], sender_fact_version_id: String|null, status: 'supported'|'blocked'
}

AtlasReviewedPacket = {
  packet_id: Integer, packet_version_id: String, organization_id: Integer,
  content_hash: 'sha256:<hex>', review_state: 'reviewed',
  candidate_fact_version: String, sender_fact_version_id: String,
  channel_availability: ChannelAvailability,
  subject: String|null, body_en: String|null, body_cn: String|null,
  strategy_cn: String|null, whatsapp_en: String|null, whatsapp_cn: String|null,
  claim_bindings: [ClaimBinding], score_version: String, evidence_ids: [Integer]
}

PrivateCopySource = {
  source_type: 'atlas_reviewed_packet', source_version_id: String,
  allowed_formats: Array<'email_en'|'strategy_cn'|'whatsapp_en'>,
  content_hash: 'sha256:<hex>'
}

PrivateCopyRenderBundle = {
  source: PrivateCopySource,
  sections: Array<{
    format: 'email_en'|'strategy_cn'|'whatsapp_en',
    heading: 'EMAIL EN'|'中文说明'|'WHATSAPP EN',
    plain_text: String
  }>,
  group_receipt: { source_version_id: String, delivered_formats: [String], record_path: String }
}

AtlasRunSummary = {
  run_id: String, run_date: 'YYYY-MM-DD', policy_version: String,
  lease_owner: String, lease_expires_at: ISO8601,
  discovered: Integer, deep_read: Integer, recommended: Integer,
  backlog_before: Integer, backlog_after: Integer,
  packet_ids: [Integer], feedback_event_ids: [Integer], outbound_attempts: 0
}
```

```sql
-- Immutable approved-sender content in the management database.
CREATE TABLE matrix_sender_fact_versions (
  version_id TEXT PRIMARY KEY,
  version_no INTEGER NOT NULL UNIQUE CHECK(version_no > 0),
  content_hash TEXT NOT NULL UNIQUE CHECK(
    length(content_hash) = 71 AND
    substr(content_hash, 1, 7) = 'sha256:' AND
    substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  facts_json TEXT NOT NULL CHECK(json_valid(facts_json) AND json_type(facts_json) = 'array'),
  site_resource_json TEXT NOT NULL CHECK(json_valid(site_resource_json) AND json_type(site_resource_json) = 'object'),
  source_evidence_ids_json TEXT NOT NULL CHECK(json_valid(source_evidence_ids_json) AND json_type(source_evidence_ids_json) = 'array'),
  created_by INTEGER NOT NULL,
  supersedes_id TEXT REFERENCES matrix_sender_fact_versions(version_id),
  created_at TEXT NOT NULL
);

-- One durable idempotency record per external lifecycle command. command_id is
-- an injected opaque ULID. payload_hash is SHA-256 over RFC-8785 canonical
-- command input excluding idempotency_key, command_id, and now.
CREATE TABLE matrix_sender_fact_commands (
  command_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL CHECK(command_type IN ('create','approve','revoke','approve_and_supersede')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 71 AND substr(payload_hash, 1, 7) = 'sha256:' AND substr(payload_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json) = 'object'),
  created_at TEXT NOT NULL
);

-- Lifecycle source of truth. UPDATE/DELETE are denied by triggers.
CREATE TABLE matrix_sender_fact_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL REFERENCES matrix_sender_fact_commands(command_id),
  command_event_index INTEGER NOT NULL CHECK(command_event_index BETWEEN 1 AND 2),
  version_id TEXT NOT NULL REFERENCES matrix_sender_fact_versions(version_id),
  event_version INTEGER NOT NULL CHECK(event_version > 0),
  event_type TEXT NOT NULL CHECK(event_type IN ('created','approved','revoked','superseded')),
  expected_content_hash TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL,
  related_version_id TEXT REFERENCES matrix_sender_fact_versions(version_id),
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(version_id, event_version),
  UNIQUE(command_id, command_event_index)
);
```

`SenderFactVersion.status` is derived from append-only events `created → approved → revoked|superseded`; only an approved version whose latest event is `approved` is accepted by draft creation. `draft` has all approval/revocation/superseded fields null. `approved` has `approved_by/approved_at` and null revocation/superseded fields. `revoked` preserves approval, requires `revoked_by/revoked_at/revocation_reason`, and has null `superseded_by_id`. `superseded` preserves approval, requires `superseded_by_id`, and has null revocation fields. Creating a successor and superseding its approved predecessor is one command transaction.

The only lifecycle commands are `createSenderFactVersion(input) -> SenderFactVersion`, `approveSenderFactVersion({ versionId, expectedContentHash, actorUserId, idempotencyKey, now }) -> SenderFactVersion`, `revokeSenderFactVersion({ versionId, expectedContentHash, reason, actorUserId, idempotencyKey, now }) -> SenderFactVersion`, and `approveAndSupersedeSenderFactVersion({ successorVersionId, expectedSuccessorHash, predecessorVersionId, expectedPredecessorHash, actorUserId, idempotencyKey, now }) -> { successor, predecessor }`. Create inserts immutable content plus event version 1 `created`. Approve requires latest `created`; revoke requires latest `approved`; approve-and-supersede requires a draft successor whose `supersedes_id` is the approved predecessor.

Every command computes `payload_hash`, looks up `matrix_sender_fact_commands.idempotency_key`, and runs one `IMMEDIATE` transaction. A new command inserts its `command_id`, all content/events, and final `result_json` before commit. Event keys are derived, never caller-supplied: `event_key = command_id + ':' + command_event_index`. Create/approve/revoke produce index `1`; approve-and-supersede produces exactly index `1` successor `approved` and index `2` predecessor `superseded`, both carrying the same `command_id`, with reciprocal `related_version_id`. Reusing the same idempotency key and identical payload hash returns the stored result without new rows; for approve-and-supersede this returns the same stored `{ successor, predecessor }`. The same key with a different payload hash or command type is `SENDER_FACT_IDEMPOTENCY_CONFLICT`. Any validation, event insert, result serialization, or second-event failure rolls back the command row and both events, leaving both versions unchanged. Terminal versions cannot transition. Event `reason` is null except revoke, where it is non-empty; `related_version_id` is null except both sides of supersession. Direct UPDATE/DELETE of content, commands, or events fails.

Unavailable channel output is `null`, never fabricated or requested from the provider. `available=true` requires `reason_code='eligible'` and a current evidence ID; every unavailable reason requires `available=false`, with evidence nullable only for `missing_recipient|channel_not_requested`. Email-only, WhatsApp-only, and neither-available states are valid independently. The draft service makes one provider call per available channel with the exact field tuple above; failure/null/extra/missing fields mark only that channel `provider_failed` and null only its outputs. Unavailable channels make zero provider calls. If neither channel is generated the packet stays `text_pending`; one generated channel may proceed independently. `allowed_formats` is derived, never caller-supplied: generated email adds `email_en` and `strategy_cn`; generated WhatsApp adds `whatsapp_en`; output order is always email, Chinese explanation, WhatsApp.

Server rendering is exact: `email_en` is `EMAIL EN\nSubject: <subject>\n\n<body_en>`; `strategy_cn` is `中文说明\n策略：<strategy_cn>\n\n中文译文：\n<body_cn>`; `whatsapp_en` is `WHATSAPP EN\n<whatsapp_en>`. `strategy_cn` is internal analysis, is not a customer-facing claim, and therefore has no `ClaimBinding`; a separate deterministic validator rejects any unsupported customer claim before packet review. The group receipt contains identifiers/formats/record path only and never customer text.

`AtlasReviewedPacket.content_hash` is `sha256:<hex>` over UTF-8 RFC-8785 canonical JSON containing exactly `organization_id`, `candidate_fact_version`, `sender_fact_version_id`, `channel_availability`, `subject`, `body_en`, `body_cn`, `strategy_cn`, `whatsapp_en`, `whatsapp_cn`, `claim_bindings`, `score_version`, and numeric-ascending `evidence_ids`. It excludes packet IDs, the hash itself, review timestamps/actors, and materialization state. `packet_version_id` is an opaque ULID created once by injected `idFactory` at successful review; the reviewed packet and private-copy-source row are inserted atomically and never updated.

```sql
CREATE TABLE atlas_private_copy_sources (
  source_version_id TEXT PRIMARY KEY,
  packet_id INTEGER NOT NULL UNIQUE REFERENCES atlas_packets(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  allowed_formats_json TEXT NOT NULL CHECK(json_valid(allowed_formats_json) AND json_type(allowed_formats_json) = 'array'),
  review_event_id INTEGER NOT NULL UNIQUE REFERENCES atlas_events(id),
  created_at TEXT NOT NULL
);
```

`atlas_private_copy_sources` is append-only with UPDATE/DELETE denial triggers. `createAtlasPrivateCopyRepository({ readonlyAtlasDb })` first sets `foreign_keys=ON` and `query_only=ON`, then exposes only `load({ sourceType, sourceVersionId })`. It accepts `atlas_reviewed_packet` only, joins the reviewed `atlas_packets` row, parses `AtlasReviewedPacket`, recomputes its canonical content hash, re-derives allowed formats from stored channel availability plus `channel_generation`, renders the exact sections, and returns `PrivateCopyRenderBundle`. Missing row, hash/format/review mismatch, malformed JSON, unavailable format, and non-readonly DB fail closed. Card, callback, and outbox callers may provide only source type/version; text, hash, formats, packet JSON, recipient, and target are rejected.

---

### Task 1: Schema V2 Identity Graph and Run Capacity

**Files:** modify `src/lib/matrixAtlasDb.js`, `scripts/test-matrix-atlas-db.js`.

- [ ] Write RED migration tests for the exact `atlas_identity_link_events` source-of-truth, `atlas_identity_links` projection, and `atlas_runs`: v1 preservation, event UPDATE/DELETE denial, projection rebuild byte equality, expected-version conflict, duplicate idempotency behavior, foreign keys, JSON-array validation, and dangling-alias rejection.
- [ ] Add RED normalization/hash vectors for Unicode email, E.164 WhatsApp, namespaced external IDs, and confirmed aliases. Prove raw endpoints never appear in rows/logs/errors, two `review_required` organizations may share an endpoint, and the partial index refuses two confirmed owners.
- [ ] Add RED cross-channel suppression cases proving a confirmed organization re-imported through a new alias/email/WhatsApp/thread remains blocked after opt-out, bounce, or do-not-contact; clearing requires a reviewed `cleared_after_review` event and cannot erase history.
- [ ] Run `node scripts/test-matrix-atlas-db.js`; expect schema-v1 failure.
- [ ] Add the exact v1→v2 DDL above, denial triggers, `appendIdentityLinkEvent`, deterministic projection rebuild, indexes, protected mode, and an idempotent migration.
- [ ] Run the DB tests twice; expect PASS and idempotent migration.
- [ ] Commit `feat: extend matrix atlas protected store`.

### Task 2: Robots-Aware Bounded Scanner

**Files:** create `src/services/matrixAtlasScanner.js`, `scripts/test-matrix-atlas-scanner.js`.

```js
createMatrixAtlasScanner({ db, registry, fetchImpl, resolveHost, safeDispatcher, clock, sleep, maxBytes: 5_242_880 })
  .scan({ sourceCode, url, countryCode })
// -> { fetchId, status, canonicalUrl, contentType, fingerprint, body, observedAt }
```

- [ ] Write RED tests for registry authorization-before-fetch, paused source, robots deny, 5 MB cap, type allowlist, ETag/304 cache, bounded 429/503 backoff, per-source concurrency, daily budget, and circuit breaker.
- [ ] Add RED DNS/IP tests for IPv4/IPv6 private, loopback, link-local, multicast, carrier-grade NAT, cloud metadata, mixed public/private answers, redirect re-resolution, and rebinding; block before body retrieval with a stable classification.
- [ ] Run scanner tests; expect module missing.
- [ ] Implement streamed bounded retrieval, cache/fingerprint, descriptive user agent, safe redirects, leases, and redacted errors.
- [ ] Run focused tests and capability scan; expect PASS and zero credential/session/browser primitives.
- [ ] Commit `feat: add matrix atlas scanner`.

### Task 3: Exact Resolver and Cross-Entity Graph

**Files:** create `src/services/matrixAtlasResolver.js`, `scripts/test-matrix-atlas-resolver.js`.

```js
resolveOrganization(db, input)
confirmAlias(db, input)
crmRoute(readonlyCrmDb, { companyName, domain, publicCompanyEmail, publicWhatsapp, emailThreadId, aliases })
persistCrmLink(atlasDb, { organizationId, crmRouteResult, evidenceIds, actorUserId, idempotencyKey })
```

- [ ] Write RED tests for exact IDNA domain/legal ID/LEI, same-name/different-domain review, conflicting IDs, customer/email/WhatsApp/thread/inquiry/order links, suppression/bounce/opt-out propagation, one review task per ambiguity, and query-only CRM.
- [ ] Run resolver tests; expect module missing.
- [ ] Implement exact linking and explicit possible-duplicate tasks without copying message bodies or delivery side effects.
- [ ] Run focused tests; expect PASS.
- [ ] Commit `feat: resolve matrix atlas identities`.

### Task 4: Market Radar and Parse-Only Adapters

**Files:** create `src/services/matrixAtlasRadar.js`, `src/services/matrixAtlasAdapterDispatch.js`, `src/services/matrixAtlasAdapters/source-mt.js`, `source-tx.js`, `official-site.js`, `public-pdf.js`, `retailer-distributor.js`, `public-trade.js`, `scripts/test-matrix-atlas-adapters.js`, `tests/fixtures/matrix-atlas/source-rx.html`, `source-px.json`, `official.pdf.bin`, `pdf-encrypted.bin`, `pdf-malformed.bin`; modify `src/services/matrixAtlasRegistry.js`, `scripts/test-matrix-atlas-registry.js`, `config/matrix-atlas-sources.json`, and dependency lock only after license review.

```js
const ADAPTERS = {
  'mt-v1': require('./matrixAtlasAdapters/source-mt'),
  'tx-v1': require('./matrixAtlasAdapters/source-tx'),
  'official-html-v1': require('./matrixAtlasAdapters/official-site'),
  'official-pdf-v1': require('./matrixAtlasAdapters/public-pdf'),
  'rx-v1': require('./matrixAtlasAdapters/retailer-distributor'),
  'px-v1': require('./matrixAtlasAdapters/public-trade')
};

selectAtlasAdapter({ sourceDefinition, contentType })
// PDF is allowed only when sourceDefinition.adapter_code === 'official-html-v1';
// it dispatches to official-pdf-v1. All other pairs require an exact adapter_code.

parsePublicPdf(buffer, {
  parser, maxBytes: 5_242_880, maxPages: 80,
  maxTextBytes: 1_048_576, timeoutMs: 5_000
})
// parser.parse(buffer,{maxPages,maxTextBytes,timeoutMs}) ->
// { pages: Integer, text: String, metadata: Object }
```

Add these exact paused definitions to the config; `.example` is fixture-only and activation is forbidden. A real replacement requires a separate current robots/terms review and a new checksum:

```json
[
  {
    "code": "source-rx", "publisher": "Fixture RX public organizational source", "landing_url": "https://source-rx.example/", "source_class": "P2",
    "countries": ["MY", "TH"], "allowed_origins": ["https://source-rx.example"], "allowed_paths": ["/public/catalog/"], "disallowed_paths": ["/login", "/account", "/profile"],
    "auth_mode": "none", "min_interval_ms": 5000, "concurrency": 1, "daily_budget": 20, "cache_ttl_seconds": 86400,
    "robots_reviewed_at": "2026-07-18T00:00:00Z", "policy_expires_at": "2026-07-18T00:00:00Z", "parser_version": "rx-v1", "adapter_code": "rx-v1",
    "coverage_note": "Fixture-only partial catalog coverage; presence corroborates a public organizational listing and never proves supply relationship or scale.", "license_note": "Reserved .example fixture; no production fetch", "status": "paused"
  },
  {
    "code": "source-px", "publisher": "Fixture PX public organizational record source", "landing_url": "https://source-px.example/", "source_class": "P2",
    "countries": ["MY", "TH", "ID"], "allowed_origins": ["https://source-px.example"], "allowed_paths": ["/public/records/"], "disallowed_paths": ["/login", "/account", "/person"],
    "auth_mode": "none", "min_interval_ms": 10000, "concurrency": 1, "daily_budget": 10, "cache_ttl_seconds": 86400,
    "robots_reviewed_at": "2026-07-18T00:00:00Z", "policy_expires_at": "2026-07-18T00:00:00Z", "parser_version": "px-v1", "adapter_code": "px-v1",
    "coverage_note": "Fixture-only partial record coverage; direction and caveat are mandatory and absence is never negative evidence.", "license_note": "Reserved .example fixture; no production fetch", "status": "paused"
  }
]
```

Registry time semantics are exact: `validateSourceDefinition` may register an expired definition only when `status='paused'`; it returns `policy_current:false`. `authorizeFetch` checks status and policy on every call and returns `SOURCE_PAUSED` for paused definitions and `SOURCE_POLICY_EXPIRED` for an expired active definition, before DNS/network work. A `.example` origin can never transition to active. Changing status, origin, paths, review/expiry, adapter, or coverage note requires a new reviewed definition and checksum; activation requires `robots_reviewed_at <= now < policy_expires_at`, a non-`.example` HTTPS origin, and the separately recorded reviewer.

- [ ] Write RED fixtures proving market data creates tasks only; government/exhibition rows retain locators; official HTML/PDF, RX, and PX facts retain coverage caveats, relationship direction, and source locators; personal/private fields never appear. Assert the exact registry definition → adapter mapping and refuse an unknown/mismatched adapter code or content type.
- [ ] Add static RED assertions that adapters import no fetch, DNS, browser, credentials, child process, or transport.
- [ ] Extend strict registry validation with the exact paused-expired rule, `adapter_code` enum, and required `coverage_note`. Registration stores `policy_checksum='sha256:'+sha256(RFC-8785 canonical definition excluding the checksum)` and the append-only before/after event; tests recompute it and prove any field change changes the checksum. RED must prove both fixture definitions register as paused/policy-current-false, authorize zero fetches, reject active `.example`, and require a future reviewed expiry plus new checksum for a real activation.
- [ ] Write RED PDF cases for `PDF_ENCRYPTED`, `PDF_MALFORMED`, `PDF_OVERSIZE`, `PDF_PAGE_LIMIT`, `PDF_TEXT_LIMIT`, and `PDF_TIMEOUT`; the injected parser receives only the bounded buffer/options and has no network/process capability. Any selected package must be exact-pinned with version, license, integrity checksum, and lockfile review while preserving this interface.
- [ ] Run `node scripts/test-matrix-atlas-adapters.js`; expect missing modules.
- [ ] Implement `selectAtlasAdapter`, bounded `parsePublicPdf`, deterministic parse-only adapters, and exact fact/discovery schemas. Paused fixture sources authorize zero scanner fetches.
- [ ] Run focused tests and package-license/checksum audit; expect PASS.
- [ ] Commit `feat: add matrix atlas source adapters`.

### Task 5: Two-Pass Reader, Company Fact Block, and China-Fit

**Files:** create `src/services/matrixAtlasReader.js`, `src/services/matrixAtlasFacts.js`, `scripts/test-matrix-atlas-reader.js`, `scripts/test-matrix-atlas-facts.js`.

```js
lightRead(db, input)
deepRead(db, input)
buildCandidateFactBlock(db, organizationId, { asOf })
```

Rename this target-company contract `CandidateFactBlock`. It contains exactly `identity`, `products`, `formats`, `specifications`, `scale`, `markets`, `china_fit`, `contacts`, `contact_salutation`, `official_url`, `observations`, `missing`, `risks`, and `evidence_ids`. Every nested fact is `{ value, status, evidence_ids, observed_at, source_type, coverage_caveat }`; relationships additionally contain `direction`. Contacts contain `channel`, `value_ref`, `organization_owned`, `source_url`, `observed_at`, and optional evidenced `person_name/role`.

- [ ] Write RED lane tests: corroborated first-party/authoritative evidence → confirmed; one limited public record → public_lead; absence → unknown; unresolved alias → conflicting; product breadth alone proves nothing.
- [ ] Write RED contact tests: evidenced person/department allowed, email-local-part inference rejected, otherwise company-team salutation.
- [ ] Run reader/fact tests; expect missing modules.
- [ ] Implement light/deep extraction and evidence-bound facts for supplier, multi-category sourcing, warehouse consolidation, inspection/pickup, and trade terms.
- [ ] Run focused tests; expect PASS.
- [ ] Commit `feat: build matrix atlas company facts`.

### Task 6: Lane and Dual Scorer

**Files:** create `src/services/matrixAtlasScore.js`, `scripts/test-matrix-atlas-score.js`.

```js
scoreOrganization(db, organizationId, { scoreVersion, asOf })
// -> { lane, opportunity, confidence, components, eligible, exclusions, evidenceIds }

rankRecommendations(rows) {
  // 1. Remove ineligible/conflicting/hard-failure rows.
  // 2. Process complete lane partitions in order confirmed, public_lead, unknown.
  // 3. Base-sort each lane by opportunity DESC, confidence DESC,
  //    freshness_epoch DESC, organization_id ASC; retain zero-based baseRank.
  // 4. Repeatedly select the remaining row with the lexicographically smallest
  //    [countryCount, categoryCount, parentCount, baseRank]. Counts include only
  //    rows already selected in this lane. parentKey is confirmed parent ID;
  //    without confirmed parent evidence it is `org:<organization_id>`.
  // 5. Concatenate complete lanes. A lower lane can never pass a higher lane.
}
```

- [ ] Write RED tests for the exact total-order algorithm above. One canonical fixture has confirmed base order `c-a(MY,coffee,p1)`, `c-b(MY,coffee,p1)`, `c-c(TH,pet,p2)`, `c-d(TH,coffee,p3)` and must emit `c-a,c-c,c-d,c-b`; all confirmed rows precede higher-scoring `p-a`, and all public-lead rows precede `u-a`. Add deterministic ties, exhausted buckets, unknown-parent isolation, country/category/parent conflicts, ineligible/conflicting exclusions, and numeric-specification-optional cases.
- [ ] Run score tests; expect missing module.
- [ ] Implement the already approved opportunity weights product30/scale25/China-delivery15/certification-market10/contact10/market-priority10 and confidence 25/25/20/15/15; require ≥75/≥80, current review, no exclusion. `conflicting` is excluded. Lane is a strict ordered partition for otherwise eligible rows—not an eligibility condition and not a score tiebreaker; score establishes `baseRank` within a lane, then the exact greedy diversity tuple applies.
- [ ] Run focused tests; expect PASS.
- [ ] Commit `feat: score matrix atlas evidence`.

### Task 7: Bilingual First Contact and WhatsApp Copy

**Files:** create `src/services/matrixSenderFacts.js`, `src/services/matrixAtlasDraft.js`, `src/services/matrixAtlasDraftGate.js`, `scripts/test-matrix-sender-facts.js`, `scripts/test-matrix-atlas-draft.js`, `scripts/test-matrix-atlas-draft-gate.js`; modify `src/db.js` for immutable sender facts.

```js
createSenderFactVersion({ facts, siteResource, sourceEvidenceIds, supersedesId, actorUserId, idempotencyKey, now })
approveSenderFactVersion({ versionId, expectedContentHash, actorUserId, idempotencyKey, now })
revokeSenderFactVersion({ versionId, expectedContentHash, reason, actorUserId, idempotencyKey, now })
approveAndSupersedeSenderFactVersion({ successorVersionId, expectedSuccessorHash, predecessorVersionId, expectedPredecessorHash, actorUserId, idempotencyKey, now })
createAtlasDraft({ candidateFactBlock, senderFactVersion, channelAvailability, textProvider })
// -> AtlasDraft
scoreAtlasDraft({ draft, candidateFactBlock, senderFactVersion, recipientEvidence, now })
// -> { score, passed, channelResults: { email, whatsapp }, components, hardFailures, revisionSuggestions }
```

- [ ] Write RED schema/hash vectors for RFC-8785 canonical input, sorted fact/evidence arrays, all status/null combinations, immutable content/command/event denial triggers, exact event versions, injected `command_id`, derived `command_id:index` event keys, one-event command rows, same-input command replay, changed-payload/command-type conflict, stale hash, invalid transition, exact sender `Gavin`, and authoritative approved site evidence.
- [ ] Write RED lifecycle tests for create→approve, create→approve→revoke, and atomic draft-successor approval + approved-predecessor supersession. For approve-and-supersede assert one shared command row, exactly two events with the same `command_id` and indexes `1/2`, reciprocal related IDs, and one stored two-result JSON. Replay the same key/hash and require the identical `{ successor, predecessor }` with unchanged row counts; reuse the key with either payload changed and require `SENDER_FACT_IDEMPOTENCY_CONFLICT`. Inject failure before the second event and before result serialization; require rollback of command/both events and unchanged versions. Also prove direct supersession, terminal transition, wrong predecessor, and unapproved/superseded/revoked draft use fail.
- [ ] Write RED word-boundary tests using the exact `--SIGNATURE--` delimiter and Unicode whitespace word counter: English 89/131 fail and 90/130 pass; WhatsApp 44/81 fails and 45/80 passes; CRLF/bullets/URLs are deterministic; Chinese must be a complete semantic pair.
- [ ] Write RED hard failures for unsupported price, certification, performance, delivery, volume, supplier/China claim, person/role, recipient, or website. Email requires current public organizational-email provenance; WhatsApp copy requires current public organizational-number provenance and allowed channel policy; a contact page is neither.
- [ ] Write the exact independent-channel RED matrix: email-only makes one four-field email call and nulls WhatsApp; WhatsApp-only makes one two-field WhatsApp call and nulls email/Chinese fields; neither makes zero calls and stays `text_pending`; stale/policy-denied/suppressed channels make zero calls; one channel provider failure does not erase the other; missing/null/extra provider fields fail only that channel. Assert derived `allowed_formats` for every row.
- [ ] Write RED quality tests for sourced customer observation, one approved concise Huasheng fact, relevant hypothesis, one/two questions, low-friction CTA, truthful signature, and same-domain link.
- [ ] Prove missing numeric size does not fail when a strong evidenced product-family observation exists.
- [ ] Implement the exact immutable content/command/event tables and four lifecycle commands. Centralize command handling as `runSenderFactCommand({ commandType, idempotencyKey, payload, now, execute })`: compute payload hash, replay stored `result_json` only on exact key/type/hash match, otherwise run command row + one/two derived events + result serialization in one `IMMEDIATE` transaction. Hydrate `SenderFactVersion` from immutable content plus latest events and enforce the canonical hash/null/state rules.
- [ ] Implement per-channel `SenderFactProvider.generate` calls with exact requested/returned fields; deterministic code creates `ClaimBinding` rows. `strategy_cn` is internal only and cannot add customer-facing claims. Score/gate channels independently, keep unavailable/failed output null, derive formats from successfully generated channels, and add safe component-specific revision suggestions; a channel passes at ≥80 with zero channel hard failure.
- [ ] Run all three focused tests: `node scripts/test-matrix-sender-facts.js`, `node scripts/test-matrix-atlas-draft.js`, and `node scripts/test-matrix-atlas-draft-gate.js`; expect PASS.
- [ ] Commit `feat: generate evidence-bound atlas drafts`.

### Task 8: Packet Guard and Compatibility Handoff

**Files:** create `src/services/matrixAtlasPlan.js`, `src/services/matrixAtlasPrivateCopyRepository.js`, `scripts/test-matrix-atlas-plan.js`, `scripts/test-matrix-atlas-private-copy-repository.js`; modify `src/lib/matrixAtlasDb.js`, `src/lib/cacheIndexView.js`.

```js
buildPacket(db, organizationId, { draftService, asOf })
reviewPacket(db, { packetId, actorUserId, decision, idempotencyKey })
materializePacket(atlasDb, cacheDb, packetId)
createAtlasPrivateCopyRepository({ readonlyAtlasDb }).load({ sourceType, sourceVersionId })
// -> PrivateCopyRenderBundle
```

- [ ] Write RED tests for unsupported claim, text pending, low score, conflicting lane, unreviewed packet, replay, normalized-domain update, and no CRM/delivery write. Assert the exact packet hash vector, injected ULID stability, atomic reviewed-packet/private-source insert, append-only denial triggers, and derived successful-channel formats.
- [ ] Write RED repository tests for query-only enforcement, exact source type/version, server-side packet load, hash recomputation, format re-derivation, exact three renderers/group receipt, email-only/WhatsApp-only output, malformed JSON, missing/unreviewed packet, hash/format mismatch, and rejection of caller text/hash/formats/recipient/target.
- [ ] Run plan/cache tests; expect missing service/fields.
- [ ] Implement evidence/fact/score/draft packet, exact canonical hash, reviewed-only materialization, `atlas_private_copy_sources` migration/triggers, and the narrow read-only repository. WhatsApp remains manual copy with no send action.
- [ ] Materialize the canonical `AtlasReviewedPacket` and `PrivateCopySource` atomically. Operations Task 4 consumes `createAtlasPrivateCopyRepository` through a management-only `MATRIX_ATLAS_DB_PATH` opened mode-`0600`, read-only/query-only; bot runtime receives neither the path nor DB. It accepts only `source_type='atlas_reviewed_packet'`, reloads server-side, omits unavailable/failed formats, and rejects callback content.
- [ ] Run packet and strict recommendation tests; expect ≤5 and full provenance.
- [ ] Run `node scripts/test-matrix-atlas-private-copy-repository.js`; expect PASS.
- [ ] Commit `feat: hand off matrix atlas packets`.

### Task 9: Human Gold Standard and Adoption Gate

**Files:** create `scripts/matrix-atlas-gold-review.js`, `scripts/test-matrix-atlas-gold-review.js`, protected schema `/home/admin/work/packaging-system/runtime-data-matrix-signal-private/atlas-gold-schema.json` (mode `0600`), and redacted aggregate report output.

- [ ] Write RED tests for a 20–30 candidate sample, two independent labels for China-fit/contact/claims, disagreement resolution, and decisions `adopt | minor_edit | rewrite | reject` with reason codes.
- [ ] Require 100% evidence-link completeness, zero guessed contacts, zero unsupported claims, zero exact-domain duplicates, lane agreement ≥0.85, and adopt+minor-edit ≥0.70 before raising above 10/3/1.
- [ ] Prove raw contacts, drafts, and business records never enter the aggregate report.
- [ ] Implement review import/validation and cohort adoption metrics; no score weight changes occur automatically.
- [ ] Run focused tests and commit `test: add matrix atlas adoption gate`.

### Task 10: Runner, Backpressure, Feedback, and CLI

**Files:** create `src/services/matrixAtlasRunner.js`, `scripts/matrix-atlas-run.js`, `scripts/test-matrix-atlas-runner.js`.

```js
runAtlasDay({ atlasDb, crmDbReadonly, date, scanner, adapters, budgets })
effectiveBudgets({ requested, backlog, oldestPendingDays, policyVersion })
```

- [ ] Write RED tests for 100/20/5 caps, same-day replay, crash/resume, lease expiry, refresh-not-duplicate, and `outbound_attempts: 0`.
- [ ] Assert audited configuration backlog >100 or oldest >7 days limits discovery to 25; backlog >200 stops discovery; store policy version/reasons in the run event; feedback never changes weights automatically.
- [ ] Assert CLI accepts only `due|status|verify` and rejects `send`.
- [ ] Implement resumable stages, run counters, backpressure, query-only feedback, and safe CLI.
- [ ] Run runner tests twice; expect stable packet IDs.
- [ ] Commit `feat: run matrix atlas daily loop`.

### Task 11: Timer, Runtime Manifest, and Pilot Gate

**Files:** create `deploy/systemd/matrix-atlas.service`, `deploy/systemd/matrix-atlas.timer`; modify `.env.example`, `scripts/verify-matrix-readonly-selection.js`, `scripts/test-verify-matrix-readonly-selection.js`, `docs/matrix-stream-catalog-2026-07-16.md`.

- [ ] Write RED verifier mutations for unauthorized network outside scanner, mail/transport, browser/process/eval, proxy/session/login/CAPTCHA, missing runtime file, and altered digest.
- [ ] Add safe empty/default env names and exact unit contract: `OnCalendar=*-*-* 07:30:00 Asia/Shanghai`, `Persistent=true`, dedicated unprivileged user/group, protected mode-0600 environment file, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, exact `ReadWritePaths`, bounded timeout/restart policy, and no SMTP/IMAP/WhatsApp variables.
- [ ] Before any real source activation, fetch/review current robots/terms through an approved read-only process, store reviewer/time/checksum, and prove the deployed registry activation checksum matches; otherwise source stays paused.
- [ ] Update manifest only after capability review; prove paused sources and disabled Atlas perform zero fetch/work.
- [ ] Run every Atlas test, cache/Matrix verifier, syntax, and diff checks.
- [ ] Commit `test: gate matrix atlas rollout`.

## Execution Wave and Acceptance Order

1. Implement Atlas Tasks 1–11 and run the Atlas-local verification below. Operations code is not required for this local gate.
2. After Task 8's reviewed packet/repository commit exists, implement Operations Task 4. Its management application opens `MATRIX_ATLAS_DB_PATH` read-only/mode-`0600`, injects `createAtlasPrivateCopyRepository({readonlyAtlasDb})` into the outbox source resolver, and never exposes that DB/path to the bot or caller.
3. Run the combined Atlas→Operations verification. Program acceptance is blocked until private delivery reaches the server-derived clicking operator, the group receives only the compact receipt, unavailable/failed formats are omitted, replay is idempotent, and sent-state mutation remains zero.

## Atlas-Local Verification

```bash
node scripts/test-matrix-atlas-db.js
node scripts/test-matrix-atlas-registry.js
node scripts/test-matrix-atlas-scanner.js
node scripts/test-matrix-atlas-resolver.js
node scripts/test-matrix-atlas-adapters.js
node scripts/test-matrix-atlas-reader.js
node scripts/test-matrix-atlas-facts.js
node scripts/test-matrix-atlas-score.js
node scripts/test-matrix-atlas-draft.js
node scripts/test-matrix-atlas-draft-gate.js
node scripts/test-matrix-sender-facts.js
node scripts/test-matrix-atlas-plan.js
node scripts/test-matrix-atlas-private-copy-repository.js
node scripts/test-matrix-atlas-gold-review.js
node scripts/test-matrix-atlas-runner.js
node scripts/test-cache-index-view.js
node scripts/test-matrix-api.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node scripts/test-bridge-artifact-0.6.9.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
npm --prefix frontend-next run lint
npm --prefix frontend-next run build
node scripts/run-ui-e2e.js
git diff --check
```

## Combined Atlas→Operations Verification

Run only after Operations Task 4 is implemented:

```bash
node scripts/test-matrix-sender-facts.js
node scripts/test-matrix-atlas-draft.js
node scripts/test-matrix-atlas-draft-gate.js
node scripts/test-matrix-atlas-plan.js
node scripts/test-matrix-atlas-private-copy-repository.js
node scripts/test-matrix-copy-outbox.js
node scripts/test-matrix-api.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
git diff --check
```

## 蒸馏进度

- 已确认模块：protected store/source policy基线、scanner、resolver、adapters、facts、China-fit、双评分、双语文案、WhatsApp副本、packet、runner、timer。
- 未解决模块：Task 1–11 尚未实施；真实来源保持暂停；上线前需要人工金标准和政策复核。
- 下一优先知识缺口：由官网权威资源形成并确认 `SenderFactVersion` 中华胜可公开事实。

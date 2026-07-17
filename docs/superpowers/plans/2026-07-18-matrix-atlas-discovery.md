# Matrix Atlas Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compliant, provenance-first system that discovers up to 100 public organizations daily, deep-reads up to 20, and hands at most five reviewed recommendations to Matrix Stream without any outbound messaging capability.

**Architecture:** Extend the existing protected candidate database with an append-oriented Atlas evidence graph. Independent source registry, retrieval, identity, reading, scoring, packet, and runner services communicate through persisted identifiers and strict schemas. Only reviewed packets are materialized into the existing `cache_*` compatibility tables used by Matrix recommendations.

**Tech Stack:** Node.js 22, better-sqlite3, native `fetch`, `cheerio@1.0.0` (MIT, exact-pinned), systemd timer, Node `assert` integration tests.

## Global Constraints

- Public organizational information only; every material fact retains source URL, type, observed time, content fingerprint, and extraction method.
- Respect robots.txt, publisher terms, per-host rate limits, cache validators, and access controls.
- No login reuse, CAPTCHA/paywall bypass, private-profile collection, guessed personal contact, automatic contact-form submission, or stealth identity.
- India is excluded and European targets remain paused; approved nearby-country policy remains authoritative.
- Atlas sends zero email, WhatsApp, or website submissions and receives no SMTP credentials.
- Daily default maximums are 100 new discoveries, 20 deep reads, and five recommendations.
- Opportunity score must be at least 75 and evidence confidence at least 80 for recommendation eligibility.
- AI may summarize evidence but cannot create evidence points, silently overwrite reviewed facts, or change thresholds.
- Internal components, workers, folders, and UI feature names use neutral codenames; real upstream publisher, license, URL, version, checksum, and network behavior remain in audit records.
- Every task follows RED-GREEN-REFACTOR and ends with a focused commit.

---

## File Map

- `src/lib/matrixAtlasDb.js`: schema initialization, protected database opening, row hydration.
- `src/services/matrixAtlasRegistry.js`: source policies, adapter budgets, country/category approval.
- `src/services/matrixAtlasScanner.js`: robots-aware cached retrieval and durable fetch ledger.
- `src/services/matrixAtlasResolver.js`: exact identity links and review-only possible duplicates.
- `src/services/matrixAtlasRadar.js`: country/category tasks from approved policy and aggregate signals.
- `src/services/matrixAtlasReader.js`: light/deep extraction into evidence graph.
- `src/services/matrixAtlasScore.js`: explainable opportunity and confidence scores.
- `src/services/matrixAtlasPlan.js`: evidence-linked recommendation packets and claim guard.
- `src/services/matrixAtlasRunner.js`: idempotent daily budgets and resumable queues.
- `src/services/matrixAtlasAdapters/source-mt.js`: reviewed MATRADE public-directory adapter.
- `src/services/matrixAtlasAdapters/source-tx.js`: reviewed THAIFEX public-directory adapter.
- `src/services/matrixAtlasAdapters/official-site.js`: allowlisted first-party website reader.
- `scripts/matrix-atlas-run.js`: neutral operator CLI and timer entrypoint.
- `deploy/systemd/matrix-atlas.service`, `deploy/systemd/matrix-atlas.timer`: isolated daily runner.
- `scripts/test-matrix-atlas-*.js`: focused fixture tests.
- `package.json`, `package-lock.json`: exact-pinned HTML parser dependency and reproducible install record.

---

### Task 1: Evidence Graph Schema and Protected Store

**Files:**
- Create: `src/lib/matrixAtlasDb.js`
- Create: `scripts/test-matrix-atlas-db.js`
- Modify: `.env.example`

**Interfaces:**
- Produces `openMatrixAtlas({ dbPath, readonly = false }): { db, close, init }`.
- Produces tables `atlas_sources`, `atlas_fetches`, `atlas_organizations`, `atlas_aliases`, `atlas_evidence`, `atlas_products`, `atlas_relationships`, `atlas_tasks`, `atlas_scores`, `atlas_packets`, and `atlas_events`.

- [ ] **Step 1: Write the failing store test**

Create `scripts/test-matrix-atlas-db.js`:

```js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-atlas-db-'));
const dbPath = path.join(root, 'atlas.db');
const { openMatrixAtlas } = require('../src/lib/matrixAtlasDb');
const store = openMatrixAtlas({ dbPath });
store.init();
for (const name of ['atlas_sources','atlas_fetches','atlas_organizations','atlas_aliases','atlas_evidence','atlas_products','atlas_relationships','atlas_tasks','atlas_scores','atlas_packets','atlas_events']) {
  assert(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name), `${name} missing`);
}
assert.strictEqual(fs.statSync(dbPath).mode & 0o777, 0o600);
store.close();
fs.rmSync(root, { recursive: true, force: true });
```

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/test-matrix-atlas-db.js`  
Expected: FAIL with module-not-found for `matrixAtlasDb`.

- [ ] **Step 3: Implement the minimal schema**

Use these key constraints:

```sql
CREATE TABLE atlas_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  publisher TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  source_class TEXT NOT NULL CHECK(source_class IN ('P0','P1','P2','P3')),
  countries_json TEXT NOT NULL,
  allowed_origins_json TEXT NOT NULL,
  allowed_paths_json TEXT NOT NULL,
  disallowed_paths_json TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('none','public_api_key')),
  min_interval_ms INTEGER NOT NULL CHECK(min_interval_ms >= 1000),
  concurrency INTEGER NOT NULL CHECK(concurrency BETWEEN 1 AND 2),
  daily_budget INTEGER NOT NULL CHECK(daily_budget BETWEEN 1 AND 1000),
  cache_ttl_seconds INTEGER NOT NULL CHECK(cache_ttl_seconds >= 3600),
  robots_reviewed_at TEXT NOT NULL,
  policy_expires_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  license_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused','blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE atlas_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  normalized_domain TEXT,
  legal_identifier TEXT,
  lei TEXT,
  organization_type TEXT NOT NULL DEFAULT 'unknown',
  review_state TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_atlas_org_domain ON atlas_organizations(lower(normalized_domain)) WHERE normalized_domain IS NOT NULL AND normalized_domain != '';
CREATE TABLE atlas_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER,
  source_id INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  page_title TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_json TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('confirmed','public_lead','conflicting','unknown')),
  UNIQUE(source_id, canonical_url, content_fingerprint, fact_type, source_locator),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id)
);
CREATE TABLE atlas_fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  requested_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('fetched','cached','not_modified','blocked','retryable_error','terminal_error')),
  http_status INTEGER,
  content_type TEXT NOT NULL DEFAULT '',
  content_length INTEGER NOT NULL DEFAULT 0,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT '',
  cache_expires_at TEXT,
  robots_allowed INTEGER NOT NULL,
  error_class TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  UNIQUE(source_id, canonical_url, observed_at),
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id)
);
CREATE TABLE atlas_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  alias_type TEXT NOT NULL CHECK(alias_type IN ('name','domain','legal_identifier','lei')),
  normalized_value TEXT NOT NULL,
  original_value TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('confirmed','possible_duplicate_review','conflicting')),
  evidence_id INTEGER NOT NULL,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  UNIQUE(alias_type, normalized_value, organization_id),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(evidence_id) REFERENCES atlas_evidence(id)
);
CREATE TABLE atlas_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT NOT NULL,
  UNIQUE(organization_id, product_name, format, specification, observed_at),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE atlas_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  counterpart_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('confirmed','public_lead','unknown','conflicting')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE atlas_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL CHECK(task_type IN ('discover','light_read','deep_read','score','packet','materialize')),
  task_key TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  organization_id INTEGER,
  input_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed_retryable','failed_terminal')),
  priority INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT NOT NULL DEFAULT '',
  run_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES atlas_sources(id),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE atlas_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  opportunity_score INTEGER NOT NULL CHECK(opportunity_score BETWEEN 0 AND 100),
  confidence_score INTEGER NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  opportunity_components_json TEXT NOT NULL,
  confidence_components_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  eligible INTEGER NOT NULL,
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  score_version TEXT NOT NULL,
  scored_at TEXT NOT NULL,
  UNIQUE(organization_id, score_version, scored_at),
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id)
);
CREATE TABLE atlas_packets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  score_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('text_pending','review_pending','reviewed','materialized','rejected')),
  packet_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL UNIQUE,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  materialized_cache_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES atlas_organizations(id),
  FOREIGN KEY(score_id) REFERENCES atlas_scores(id)
);
CREATE TABLE atlas_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
```

Enable foreign keys; add indexes on fetch source/time, evidence organization/type/time, task state/run-date/priority, score organization/time, and packet state/time. Validate every JSON text field during writes and hydration, add append-only update/delete triggers for `atlas_events`, and set file mode `0600` after creation. Default to the protected `MATRIX_STREAM_DB_PATH`; reject an absent path, a world/group-readable file, and any path equal to the main application `DB_PATH`.

- [ ] **Step 4: Add integrity and readonly tests**

Assert event update/delete fails, duplicate domains fail, readonly open cannot initialize or mutate, invalid JSON hydration fails closed, and `PRAGMA integrity_check` returns `ok`.

Add these disabled-by-default settings to `.env.example`:

```dotenv
MATRIX_ATLAS_ENABLED=0
MATRIX_ATLAS_DAILY_DISCOVER=100
MATRIX_ATLAS_DAILY_DEEP=20
MATRIX_ATLAS_DAILY_RECOMMEND=5
```

- [ ] **Step 5: Run and commit**

Run: `node scripts/test-matrix-atlas-db.js`  
Expected: PASS.  
Commit: `feat: add matrix atlas evidence store`

---

### Task 2: Source Registry and Policy Gate

**Files:**
- Create: `src/services/matrixAtlasRegistry.js`
- Create: `scripts/test-matrix-atlas-registry.js`
- Create: `config/matrix-atlas-sources.json`

**Interfaces:**
- Produces `validateSourceDefinition(value, now)`, `registerSources(db, definitions, actor)`, `authorizeFetch(db, { sourceCode, url, countryCode, now })`.

- [ ] **Step 1: Write RED policy tests**

```js
const { validateSourceDefinition, authorizeFetch } = require('../src/services/matrixAtlasRegistry');
const source = {
  code: 'source-tx', publisher: 'Department of International Trade Promotion', landing_url: 'https://www.thaitradefair.com/', source_class: 'P0',
  countries: ['TH'], allowed_origins: ['https://www.thaitradefair.com'], allowed_paths: ['/fair-content/'], disallowed_paths: ['/login','/account'],
  auth_mode: 'none', min_interval_ms: 5000, concurrency: 1, daily_budget: 150, cache_ttl_seconds: 86400,
  robots_reviewed_at: '2026-07-18T00:00:00Z', policy_expires_at: '2026-10-18T00:00:00Z', parser_version: '1', license_note: 'public official directory', status: 'active'
};
assert.strictEqual(validateSourceDefinition(source, '2026-07-18T01:00:00Z').code, 'source-tx');
assert.throws(() => validateSourceDefinition({ ...source, min_interval_ms: 0 }, '2026-07-18T01:00:00Z'), /interval/);
assert.throws(() => authorizeFetch(db, { sourceCode: 'source-tx', url: 'https://www.thaitradefair.com/login', countryCode: 'TH', now: '2026-07-18T01:00:00Z' }), /disallowed/);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-registry.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement exact policy validation**

Reject unknown fields, non-HTTPS origins, wildcard origins, missing license/publisher, expired reviews, unapproved countries, `CN`, `IN`, European paused countries, user-login auth, concurrency above two, and intervals below one second. `authorizeFetch` canonicalizes URLs and requires exact origin plus allowed-path prefix and no disallowed prefix.

- [ ] **Step 4: Seed reviewed source definitions**

`config/matrix-atlas-sources.json` contains `source-mt`, `source-tx`, and their real publisher/landing URLs. It contains no credentials. Registration records a checksum and append-only before/after event.

- [ ] **Step 5: Run and commit**

Run: `node scripts/test-matrix-atlas-registry.js`  
Expected: PASS.  
Commit: `feat: add matrix atlas source policy`

---

### Task 3: Robots-Aware Cached Scanner

**Files:**
- Create: `src/services/matrixAtlasScanner.js`
- Create: `scripts/test-matrix-atlas-scanner.js`

**Interfaces:**
- Produces `createMatrixAtlasScanner({ db, fetchImpl, clock, sleep }).scan(input)`.
- Consumes `authorizeFetch`; produces durable `atlas_fetches` rows and immutable evidence-ready response metadata.

- [ ] **Step 1: Write the RED scanner test**

Inject a fake fetch sequence for `/robots.txt` and one allowed page:

```js
const scanner = createMatrixAtlasScanner({ db, clock: () => new Date('2026-07-18T00:00:00Z'), sleep: async ms => waits.push(ms), fetchImpl: fakeFetch });
const first = await scanner.scan({ sourceCode: 'source-tx', url: 'https://www.thaitradefair.com/fair-content/example', countryCode: 'TH' });
assert.strictEqual(first.status, 'fetched');
assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
const second = await scanner.scan({ sourceCode: 'source-tx', url: first.canonicalUrl, countryCode: 'TH' });
assert.strictEqual(second.status, 'cached');
assert.strictEqual(pageFetchCount, 1);
```

Assert disallowed robots path, cross-origin redirect, content above 5 MB, non-HTML/JSON/PDF type, 429 retry, repeated 5xx circuit breaker, and daily budget exhaustion.

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-scanner.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement bounded retrieval**

Use fixed headers:

```js
const headers = {
  'user-agent': 'MatrixAtlas/1.0 (+https://gdhspack.com/contact)',
  accept: 'text/html,application/xhtml+xml,application/json,application/pdf;q=0.8',
  ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
  ...(cached?.last_modified ? { 'if-modified-since': cached.last_modified } : {})
};
```

Fetch robots before a host's first page, cache its decision for no more than 24 hours, enforce source interval and concurrency, refuse cross-origin redirects unless the redirected origin is separately allowlisted, stream with a 5 MB cap, hash content, and persist status/error classification. Back off on 429/503 within the daily budget; never use proxies or identity rotation.

- [ ] **Step 4: Run and commit**

Run: `node scripts/test-matrix-atlas-scanner.js`  
Expected: PASS.  
Commit: `feat: add matrix atlas scanner`

---

### Task 4: Identity Resolver and CRM Duplicate Boundary

**Files:**
- Create: `src/services/matrixAtlasResolver.js`
- Create: `scripts/test-matrix-atlas-resolver.js`

**Interfaces:**
- Produces `resolveOrganization(db, input)`, `confirmAlias(db, input)`, `crmRoute(readonlyCrmDb, input)`.

- [ ] **Step 1: Write RED identity tests**

```js
const first = resolveOrganization(db, { name: 'Alpha Foods Co., Ltd.', countryCode: 'VN', domain: 'alpha.vn', legalIdentifier: '', lei: '', evidenceId: 1, idempotencyKey: 'resolve-1' });
const same = resolveOrganization(db, { name: 'ALPHA FOODS', countryCode: 'VN', domain: 'www.alpha.vn', legalIdentifier: '', lei: '', evidenceId: 2, idempotencyKey: 'resolve-2' });
assert.strictEqual(same.organizationId, first.organizationId);
const possible = resolveOrganization(db, { name: 'Alpha Food Company', countryCode: 'VN', domain: 'alpha-food.example', legalIdentifier: '', lei: '', evidenceId: 3, idempotencyKey: 'resolve-3' });
assert.strictEqual(possible.status, 'possible_duplicate_review');
assert.notStrictEqual(possible.organizationId, first.organizationId);
```

Assert exact legal id/LEI links, conflicting legal ids block, and alias confirmation preserves both original rows/evidence.

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-resolver.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement exact and review-only resolution**

Normalize IDNA domains, remove only legal-form punctuation from names, and keep original names. Automatic identity uses exact domain, legal id, LEI, or confirmed alias only. Name/address similarity creates a possible-duplicate edge with component reasons and never transfers contacts, suppression, history, scores, or relationships.

- [ ] **Step 4: Add readonly CRM routing**

`crmRoute` reads the application DB in readonly mode. Exact email/domain with an inquiry, order, valid reply, refusal, bounce, or suppression returns `existing_relationship` or `blocked`; it never writes CRM and never copies message bodies into Atlas.

- [ ] **Step 5: Run and commit**

Run: `node scripts/test-matrix-atlas-resolver.js`  
Expected: PASS.  
Commit: `feat: resolve matrix atlas identities`

---

### Task 5: Market Radar and Initial Public Adapters

**Files:**
- Create: `src/services/matrixAtlasRadar.js`
- Create: `src/services/matrixAtlasAdapters/source-mt.js`
- Create: `src/services/matrixAtlasAdapters/source-tx.js`
- Create: `src/services/matrixAtlasAdapters/official-site.js`
- Create: `scripts/test-matrix-atlas-adapters.js`
- Create: `tests/fixtures/matrix-atlas/source-mt.html`
- Create: `tests/fixtures/matrix-atlas/source-tx.html`
- Create: `tests/fixtures/matrix-atlas/official-site.html`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Adapter method `discover({ body, canonicalUrl, observedAt }): Array<DiscoveryRecord>`.
- `DiscoveryRecord` exact keys: `source_code`, `company_name`, `country_code`, `official_url`, `product_categories`, `source_url`, `source_title`, `observed_at`, `source_locator`.
- Radar produces persisted tasks `{ country_code, category, vocabulary, source_codes, priority, evidence_expectations }`.

- [ ] **Step 1: Write RED fixture adapter tests**

```js
const rows = sourceTx.discover({ body: fs.readFileSync(txFixture, 'utf8'), canonicalUrl: 'https://www.thaitradefair.com/fair-content/example', observedAt: '2026-07-18T00:00:00Z' });
assert.deepStrictEqual(rows[0], {
  source_code: 'source-tx', company_name: 'Alpha Beverage Company Limited', country_code: 'TH', official_url: 'https://alpha.example/',
  product_categories: ['beverage'], source_url: 'https://www.thaitradefair.com/fair-content/example', source_title: 'Official exhibitor list', observed_at: '2026-07-18T00:00:00Z', source_locator: 'company[1]'
});
assert(!JSON.stringify(rows).includes('personal_mobile'));
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-adapters.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Install the reviewed parser and implement strict parsers and radar tasks**

Run `npm install cheerio@1.0.0 --save-exact`, retain its MIT license/provenance in the lockfile and dependency inventory, and use it only on scanner-supplied bounded bodies. Adapters have no `fetch`, DNS, browser, or credential imports.

Parse only publisher-defined public fields. Reject rows without organization name, approved country, authoritative source URL, or category evidence. Official-site adapter accepts only the resolved organization's allowlisted domain and extracts title, canonical URL, JSON-LD organization/product fields, visible product headings, public company email, and contact page URL; it does not crawl team/private-profile pages.

Radar combines approved country/category policy and aggregate trade signals. Store UN Comtrade values as `market_signal` tied to country/category, never organization id.

- [ ] **Step 4: Run and commit**

Run: `node scripts/test-matrix-atlas-adapters.js`  
Expected: PASS.  
Commit: `feat: add matrix atlas source adapters`

---

### Task 6: Two-Pass Reader and Explainable Dual Scores

**Files:**
- Create: `src/services/matrixAtlasReader.js`
- Create: `src/services/matrixAtlasScore.js`
- Create: `scripts/test-matrix-atlas-reader.js`
- Create: `scripts/test-matrix-atlas-score.js`

**Interfaces:**
- Produces `lightRead(db, input): LightResult`, `deepRead(db, input): DeepResult`.
- Produces `scoreOrganization(db, organizationId): { opportunity, confidence, components, eligible }`.

- [ ] **Step 1: Write RED light/deep tests**

Assert light read stores identity/category/official evidence only and excludes `CN`, `IN`, paused Europe, test/noise, domestic-old-customer, and contact-form-only records. Deep read stores product families, brands, SKU breadth, formats, sizes, manufacturer/type, factories, export markets, retailer/distributor/exhibition signals, public company contact provenance, and relationship state.

```js
const deep = deepRead(db, { organizationId, evidenceIds: [1,2,3], idempotencyKey: 'deep-1' });
assert.deepStrictEqual(deep.formats, ['stand-up pouch', 'roll film']);
assert.deepStrictEqual(deep.sizes, ['250g', '500g']);
assert.strictEqual(deep.missing.supplier, 'unknown');
```

- [ ] **Step 2: Run reader RED**

Run: `node scripts/test-matrix-atlas-reader.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement evidence-only extraction**

Every stored fact must reference evidence ids. Absence writes `unknown`, never `false`. Public trade records store dataset coverage and relationship confidence. Website appearance, social follower count, a single listing, or unverified employee estimate cannot independently create a scale fact.

- [ ] **Step 4: Write and implement dual-score RED/GREEN**

```js
const score = scoreOrganization(db, organizationId);
assert.deepStrictEqual(Object.keys(score.components.opportunity).sort(), ['certification_market_fit','china_delivery_fit','contactability','market_priority','product_fit','scale_volume']);
assert.strictEqual(score.opportunity, 82);
assert.strictEqual(score.confidence, 86);
assert.strictEqual(score.eligible, true);
```

Opportunity maxima are 30/25/15/10/10/10. Confidence maxima are identity 25, product 25, corroboration 20, contact 15, scale/relationship 15. Eligibility is opportunity `>=75`, confidence `>=80`, current review, and no exclusion. Persist component reasons and evidence ids.

- [ ] **Step 5: Run and commit**

Run:

```bash
node scripts/test-matrix-atlas-reader.js
node scripts/test-matrix-atlas-score.js
```

Expected: PASS.  
Commit: `feat: score matrix atlas evidence`

---

### Task 7: Recommendation Packet, Claim Guard, and Stream Handoff

**Files:**
- Create: `src/services/matrixAtlasPlan.js`
- Create: `scripts/test-matrix-atlas-plan.js`
- Modify: `src/lib/cacheIndexView.js`

**Interfaces:**
- Produces `buildPacket(db, organizationId, options): Packet` and `materializePacket(atlasDb, packetId): { cacheRecordId }`.
- Packet exact keys include identity, products, formats, specifications, scale, fit, supplier state, entry product, differentiation, questions, risks, contacts, evidence ids, English draft, and Chinese translation.

- [ ] **Step 1: Write RED packet and guard tests**

```js
const packet = buildPacket(db, organizationId, { textService: deterministicText });
assert.strictEqual(packet.supplier.state, 'unknown');
assert(packet.claims.every(claim => claim.evidence_ids.length > 0));
assert.throws(() => buildPacket(db, organizationId, { textService: async () => ({ body_en: 'FDA approved, guaranteed delivery, USD 0.05', body_cn: '保证交期' }) }), /unsupported claim/i);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-plan.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement packet and claim guard**

Supplier state is `confirmed`, `public_lead`, or `unknown`. Questions number one to three. Claims about certification, price, performance, delivery, scale, volume, or supplier require matching evidence ids and compatible fact types. Text-provider failure stores a packet as `text_pending`; it cannot materialize.

- [ ] **Step 4: Implement compatibility handoff**

In one transaction, materialize only reviewed eligible packets into existing `cache_records`, `cache_evidence`, `cache_discovery`, `cache_relationships`, and `cache_strategy_signals`. Preserve packet id/fingerprint in audit note, update an existing normalized domain instead of inserting a duplicate, and never write CRM or delivery tables.

- [ ] **Step 5: Run and commit**

Run:

```bash
node scripts/test-matrix-atlas-plan.js
node scripts/test-cache-index-view.js
```

Expected: PASS.  
Commit: `feat: hand off matrix atlas packets`

---

### Task 8: Daily Runner, Feedback, Verification, and Rollout

**Files:**
- Create: `src/services/matrixAtlasRunner.js`
- Create: `scripts/matrix-atlas-run.js`
- Create: `scripts/test-matrix-atlas-runner.js`
- Create: `deploy/systemd/matrix-atlas.service`
- Create: `deploy/systemd/matrix-atlas.timer`
- Modify: `scripts/verify-matrix-readonly-selection.js`
- Modify: `docs/matrix-stream-catalog-2026-07-16.md`

**Interfaces:**
- Produces `runAtlasDay({ atlasDb, crmDbReadonly, date, scanner, adapters, budgets }): RunSummary`.
- CLI supports only `due`, `status`, and `verify`; no send command exists.

- [ ] **Step 1: Write RED budget and resume tests**

```js
const summary = await runAtlasDay({ atlasDb, crmDbReadonly, date: '2026-07-18', scanner, adapters, budgets: { discover: 100, deep: 20, recommend: 5 } });
assert(summary.discovered <= 100);
assert(summary.deep_read <= 20);
assert(summary.recommended <= 5);
assert.strictEqual(summary.outbound_attempts, 0);
const replay = await runAtlasDay({ atlasDb, crmDbReadonly, date: '2026-07-18', scanner, adapters, budgets: { discover: 100, deep: 20, recommend: 5 } });
assert.deepStrictEqual(replay.packet_ids, summary.packet_ids);
```

Simulate a crash after discovery and assert resume continues pending tasks without duplicate organization/evidence/event rows.

- [ ] **Step 2: Run RED**

Run: `node scripts/test-matrix-atlas-runner.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement deterministic queue orchestration**

Persist task states `pending`, `running`, `completed`, `failed_retryable`, `failed_terminal`, and leases with expiry. Order by market priority, evidence gap, and source budget. Refreshing an existing domain creates new evidence when the fingerprint changes and no new organization when it does not.

- [ ] **Step 4: Add feedback imports and audited weight reports**

Read Matrix Stream outcome events through a readonly query and store aggregate Atlas feedback events: selected, deferred, rejected reason, sent, bounced, replied, qualified inquiry, order, suppressed. Produce cohort statistics by country/category/source/type/strategy. Do not change score weights automatically; emit a proposed before/after report requiring human approval.

- [ ] **Step 5: Add isolated timer**

`matrix-atlas.timer` uses `OnCalendar=*-*-* 07:30:00 Asia/Shanghai` and `Persistent=true`. The service uses a dedicated unprivileged account, read-only project code, writable protected database/cache directories only, `NoNewPrivileges=true`, private temporary directory, and environment file mode `0600`. It receives `MATRIX_STREAM_DB_PATH` and the main `DB_PATH` only for SQLite readonly CRM queries; it has no SMTP variables.

- [ ] **Step 6: Extend verification boundary**

Add Atlas files to a digest manifest and reject `nodemailer`, `sendMail`, SMTP/IMAP variables, WhatsApp delivery, arbitrary child processes, dynamic import/eval, wildcard origins, proxy rotation, browser automation, login/session credential inputs, CAPTCHA-solving calls, and unbounded fetch. Policy text may name prohibited behaviors; the verifier checks executable imports, inputs, and call sites rather than merely matching those words. The only network-capable source must be the reviewed scanner digest; adapters parse supplied bodies and cannot fetch.

- [ ] **Step 7: Run complete verification**

Run:

```bash
node scripts/test-matrix-atlas-db.js
node scripts/test-matrix-atlas-registry.js
node scripts/test-matrix-atlas-scanner.js
node scripts/test-matrix-atlas-resolver.js
node scripts/test-matrix-atlas-adapters.js
node scripts/test-matrix-atlas-reader.js
node scripts/test-matrix-atlas-score.js
node scripts/test-matrix-atlas-plan.js
node scripts/test-matrix-atlas-runner.js
node scripts/test-cache-index-view.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
npm run lint
npm run build
```

Expected: all PASS; summary reports no excluded country, no recommendation provenance gap, no duplicate domain, recommendation count at most five, and Atlas outbound capability false.

- [ ] **Step 8: Controlled rollout**

Back up both databases with mode `0600` and integrity `ok`. Deploy source registry and scanner with one-request smoke budgets first, then identity, reader, scores, and handoff. Run one day with `discover=10`, `deep=3`, `recommend=1`; manually inspect every evidence link. Increase to 100/20/5 only after review. Keep the timer disabled until all stages pass.

- [ ] **Step 9: Commit rollout record**

Record adapter policy checksums, release hash, budgets, fetch counts, robots refusals, duplicate ratio, evidence gaps, and rollback units without contact bodies or credentials.  
Commit: `docs: record matrix atlas rollout`

# Matrix Stream Phase 1 Final Fixes Report

Date: 2026-07-16
Source review: `.superpowers/sdd/final-review.md`

## Outcome

All eight Important findings and all three Minor findings were addressed. The phase-one path remains read-only with respect to formal CRM data and contains no email, WhatsApp, or form-delivery path.

## RED → GREEN evidence

1. **Identity/business/evidence contract (I1)**
   - RED: `test-schema-rank.js` reproduced a contact-page-only record returning `valid`; assertion failed with actual `valid`, expected `needs_review`.
   - GREEN: `valid` now requires approved country, usable same-domain email or confirmed international WhatsApp, business evidence, and parseable evidence references. Recent activity alone stays B; A additionally requires inquiry/quote, clear product evidence, substantive interaction, and recency. Every non-valid class has `priority: null`.

2. **CRM classification completeness (I6)**
   - RED: the +86-agent/explicit-Vietnam fixture increased excluded domestic count from expected 4 to actual 5. Additional canaries covered WhatsApp-only, internal-only, unsubscribe, refusal, invalid address, and mixed fixture text.
   - GREEN: positive overseas facts take precedence over domestic contact hints; WhatsApp is an identity alternative; deterministic noise flags are explicit; fixture matching is bound to fixed customer/source identities rather than arbitrary grouped body text.

3. **Campaign, persistence, and exact evidence IDs (I2/I3/I4, M1/M2)**
   - RED: `test-signal-cache.js` failed because incomplete and India/Canada campaigns were accepted. Further assertions required finite fact fields, numeric confidence, ISO retrieval time, sensitive-query rejection, exact evidence ownership, snapshots, effective override, and complete run deletion.
   - GREEN: `createRun` requires the approved campaign contract and a non-empty subset of the six exact countries. Evidence is run-owned and field-enumerated; classification stores an immutable run snapshot and many-to-many exact evidence IDs. Classification/priority/reason/confidence are validated in application code and fresh-schema CHECK constraints. Human override class/priority/actor/note/time determines the effective query result. `deleteRun` removes run classifications, evidence, snapshots, and orphan identities transactionally.

4. **Guarded import controls (I2/I3/I7)**
   - RED: after the storage contract tightened, the old importer persisted zero valid records because it supplied neither run-owned evidence IDs nor field snapshots. The final-review Canada/run-mismatch reproduction was added with explicit zero-network/zero-write assertions.
   - GREEN: importer atomically claims a run for one import only, so country/probe/deadline budgets cannot reset across calls; existing domains and same-batch duplicates are suppressed before network access. Canada, India, blanks, aliases, and run-country mismatches are excluded before DNS/HTTP/DB. Official hosts and terms-reviewed third-party host/source-type pairs are allowlisted at entry and before every redirect hop. Phase 1 rejects cross-host official redirects, preserving exact official-domain evidence without inventing an alias contract. Every persisted fact has matching evidence with an allowed `source_type`. Unique pages, total probes, redirects, per-probe and run wall-clock deadlines are bounded. Sensitive query keys and non-global special-purpose addresses are rejected. IPv6 uses a positive `2000::/3` global-unicast gate plus special-purpose exclusions; DNS results remain pinned and peer-verified.

5. **Candidate API semantics and SQL bounds (I5)**
   - RED basis: final review reproduced default visibility of test/noise/India/Canada and entity-wide evidence leakage. New black-box fixtures preserve those counterexamples.
   - GREEN: default candidate queries enforce approved countries plus `valid|needs_review` at SQL level, use the globally latest effective classification unless a run is requested, and execute SQL COUNT/LIMIT/OFFSET. List rows expose `run_id`; detail accepts the same run selector and reads that immutable classification/snapshot. Evidence comes only through `matrix_classification_evidence`. India is not an accepted candidate filter. Test/noise remain outside this candidate route.

6. **Controlled runner and unified verification (I8/M3)**
   - RED: integration failed with `Cannot find module '../src/lib/matrixRunner'` after the runner acceptance probe was added.
   - GREEN: `matrix:run` requires an authenticated local administrator, derives actor from the database user, creates a run, executes only guarded import, records started/discovery/evidence/classification/completed or failed audit events, persists counters/status/completion/resume cursor, and prints the same run ID/summary. Test database initialization suppresses generated bootstrap secrets. `verify:matrix-phase1` now runs all five focused suites, integration, smoke, and `git diff --check`.

## Finding closure map

- I1: deterministic identity + business evidence + evidence references; strict mutually exclusive priority contract.
- I2: exact six-country campaign and run membership enforced before network/storage.
- I3: finite fact fields, matching values, official/approved-third-party sources, canonical safe URLs, exact classification evidence IDs.
- I4: global identity plus immutable run snapshots, run evidence ownership, reproducible historical run queries, transactional deletion that restores canonical global facts from the latest remaining snapshot.
- I5: safe default candidates, India rejected, exact evidence join, SQL pagination/count/detail.
- I6: overseas-positive eligibility, email-or-WhatsApp identity, complete deterministic noise flags, and per-source fixture/system isolation before customer grouping.
- I7: single-use run budget, existing-domain suppression, host/source-type allowlists, pages/probes/deadlines, peer pinning, positive IPv6 global-unicast policy.
- I8: controlled authenticated runner, counters/status/audit/resume, complete unified command.
- M1: shared enums, reason whitelist, `[0,1]` confidence, classification/priority application and DB constraints.
- M2: effective human override class/priority with actor/note/time contract.
- M3: test-only bootstrap-secret logging suppression.

## Verification

Fresh full command:

```text
npm run verify:matrix-phase1
  test:matrix-rank       PASS
  test:signal-cache      PASS
  test:matrix-stream     PASS
  test:matrix-crm        PASS
  test:matrix-api        PASS
  integration            PASS
  verify:smoke           SMOKE PASS
  git diff --check       PASS
```

Additional syntax checks passed for all modified/new production JavaScript modules and runner scripts. Static scan found no delivery adapter call and no formal CRM write in the phase-one modules/runner.

## Remaining attention

- Legacy pre-v1.1 Matrix rows remain intentionally read-only and are not synthesized into unverifiable snapshots/evidence links. New runs use the strict v1.1 contract.
- A real public-evidence run still requires an explicitly approved campaign input, authenticated local actor, and terms-reviewed third-party sources. No real data run was performed during these fixes.

## Final re-review fixes (`428065d..working tree`)

### RED → GREEN

- **Campaign low-water budgets (R2-I1)**
  - RED: a campaign with `max_companies_per_country: 1` accepted two records; a one-page campaign requested official plus evidence pages; a two-probe campaign completed four redirect requests while persisting two probes.
  - GREEN: the configured company limit is enforced beneath the global ceiling; page count includes the official page; a shared run budget is consumed before every DNS/HTTP hop; redirect count is a required campaign field; actual consumed hops are persisted. A run-level `AbortController` is propagated into redirect processing and the pinned transport, preventing new hops after deadline.
- **Existing CRM scope (R2-I2)**
  - RED: `direction=internal` email classified `needs_review`; United States and India existing customers inherited public-discovery country exclusions.
  - GREEN: classifier context explicitly separates `existing_crm` from `public_discovery`. Existing overseas CRM identity is not limited to the discovery six-country campaign, while public import remains strict. Internal-only email and CRM groups deterministically return `noise/internal_only`.
- **Exact contact/evidence contract (R2-I3)**
  - RED: `not-a-reference` satisfied classifier references; conflicting business/public emails could classify with one value and persist evidence for another; LinkedIn could persist without a representable fact.
  - GREEN: references require positive numeric IDs with scope-specific prefixes; discovery uses one canonical email and rejects conflicts before network; unsupported social contact is removed from Phase 1. Every retained contact/product/company field is checked against a same-field/same-value evidence row, and classification links the exact run-owned evidence IDs.
- **Authenticated full rollback (R2-I4)**
  - RED: the repository had no rollback module/CLI and the runbook published incomplete DELETE SQL.
  - GREEN: `matrix:rollback -- --run-id <id>` authenticates an active authorized database user, calls the sole `deleteRun()` semantics, restores historical canonical entity facts, removes orphan identities, and writes `matrix_run_rolled_back` with actor and affected counts. Integration verifies denied unauthenticated access, restoration/deletion, audit, and unchanged formal CRM tables. The runbook no longer publishes manual DELETE steps.

## 蒸馏进度

- 已确认模块：分类身份/业务证据合同、六国活动边界、字段级证据、精确 evidence IDs、run snapshot/回滚、候选安全 SQL、CRM 完整分类、受控 runner、统一验证、无外发/无正式 CRM 写。
- 未解决模块：真实第三方目录逐域 terms 审批与首批真实样本人工抽检尚未执行；它们是运行输入/审批，不是代码默认值。
- 下一最高优先知识缺口：为首个获批第三方来源记录 host、source type、terms URL、审批时间，然后只在隔离临时数据库执行六国极小样本演练并人工核对全部 valid/A（若有）。
### Internal re-review counterexamples

- RED: a DNS lookup completing after the run deadline could still consume a probe and start transport. GREEN: the cancellation signal is passed to DNS and rechecked immediately after resolution, before budget consumption or HTTP.
- RED: existing records without a positive overseas fact could bypass discovery-country rules, and inbound/outbound email rows with only configured internal participants were not noise. GREEN: existing-scope classification requires explicit overseas eligibility, while normalized email participants are checked against configured internal mailboxes/domains independently of the direction label.
- RED: one valid evidence reference could mask additional bogus references. GREEN: the nonempty reference array now requires every entry to match the scope-specific positive-ID format.

Final Critical/Important re-review: clean / GO for the R2 scope.

## R3 final-review fixes

- RED: production IMAP comma-separated recipients disappeared from participant checks, so outbound internal-to-external mail was classified as internal noise; production CSV also tripped JSON-malformation handling. GREEN: recipient fields accept both JSON arrays and comma-separated/RFC address syntax, normalize every from/to/cc/bcc address, preserve external participants, and mark malformed lists for safe review instead of internal-noise suppression.
- RED: an official URL redirect to a child subdomain contacted that child before final exact-domain rejection. GREEN: non-wildcard host authorization is exact at entry and before every redirect/evidence hop; only an explicit `*.` campaign pattern retains subdomain matching. The regression asserts the child host never reaches transport.
- During repeated deadline regression runs, the outer deadline race exposed a detached DNS continuation when its rejection timer won just before the abort timer. The deadline rejection now aborts the shared controller synchronously before rejecting, and repeated focused runs remained green.

Final Critical/Important re-review: clean / GO for the R3 scope.

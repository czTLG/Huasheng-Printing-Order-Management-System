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

## 蒸馏进度

- 已确认模块：分类身份/业务证据合同、六国活动边界、字段级证据、精确 evidence IDs、run snapshot/回滚、候选安全 SQL、CRM 完整分类、受控 runner、统一验证、无外发/无正式 CRM 写。
- 未解决模块：真实第三方目录逐域 terms 审批与首批真实样本人工抽检尚未执行；它们是运行输入/审批，不是代码默认值。
- 下一最高优先知识缺口：为首个获批第三方来源记录 host、source type、terms URL、审批时间，然后只在隔离临时数据库执行六国极小样本演练并人工核对全部 valid/A（若有）。

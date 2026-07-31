# Task 6 Final Independent Re-review

## Verdicts

- **Specification compliance: PASS / READY.** The unified command now runs the complete guarded-import and read-only API contracts before its temporary-database integration verification. All Task 6 topics and safety boundaries are covered.
- **Implementation quality: PASS / READY (Critical 0, Important 0).** All three Important findings from the first independent review are resolved. No new Critical, Important, or Minor issue was found in the round-two package.

## Previous Important Findings

### 1. Complete Phase 1 API contract — RESOLVED

`verify:matrix-phase1` now runs `test:matrix-api` before the integration verifier (`package.json:14-17`). Because the commands are joined with `&&`, any API contract failure produces a nonzero unified result and prevents the remaining stages from masking it.

The included API contract covers:

- unauthenticated 401 and non-CRM-role 403 responses (`scripts/test-matrix-api.js:165-169`);
- authorized, filtered, paginated candidate summaries, public reason codes, evidence URLs, masked email/phone values, and private/internal sentinel suppression (`scripts/test-matrix-api.js:171-186`);
- page-size cap, invalid classifications/priorities/countries/pages, and second-page behavior (`scripts/test-matrix-api.js:188-199`);
- `GET /api/matrix/runs` and campaign-private-field suppression (`scripts/test-matrix-api.js:201-204`);
- `GET /api/matrix/candidates/:id`, limited evidence fields, redaction, 404 behavior, unchanged entity/classification rows, and the single expected detail-read audit event (`scripts/test-matrix-api.js:206-227`);
- runtime 404 rejection for POST, PATCH, and DELETE candidate routes (`scripts/test-matrix-api.js:229-231`).

This supplies the full three-GET API safety contract missing from round one. The integration verifier still independently starts the application against its own temporary database and confirms the populated candidate list does not change the four formal CRM tables (`scripts/verify-matrix-phase1.js:254-305`).

### 2. Complete Task 3 guarded-import contract — RESOLVED

The unified command now runs `test:matrix-stream` first (`package.json:14-17`). The focused contract covers every Task 3 negative boundary and the later transport-hardening cases:

- loopback, link-local, private IPv4, carrier-grade NAT, IPv6 loopback, IPv6 unique-local, IPv4-mapped private addresses, credentials, non-HTTP schemes, and disallowed ports (`scripts/test-matrix-stream.js:101-117`);
- mixed public/private DNS answers (`scripts/test-matrix-stream.js:126-136`);
- missing evidence source URL, missing official URL, empty evidence, unsafe stored evidence, India exclusion before persistence, and redirect-to-private rejection before transport (`scripts/test-matrix-stream.js:186-250`);
- multi-hop revalidation for official and evidence URLs (`scripts/test-matrix-stream.js:251-260`);
- DNS-rebinding resistance through a single validated lookup and pinned connection address (`scripts/test-matrix-stream.js:262-300`);
- rejection of the ordinary `fetch` option and of transport responses without connected-peer proof (`scripts/test-matrix-stream.js:302-321`);
- direct pinned-request behavior, default production adapter pinning, TLS host/SNI preservation, and peer-address mismatch rejection without persistence (`scripts/test-matrix-stream.js:343-412`);
- the 21st same-country record error and whole-batch rejection of 121 inputs before persistence (`scripts/test-matrix-stream.js:414-442`).

The accepted public-address path and normalized record behavior are also exercised (`scripts/test-matrix-stream.js:119-155`), while the Task 6 integration verifier independently confirms the exact six-country × 20 distribution, India exclusion, formal-table isolation, and expected summary (`scripts/verify-matrix-phase1.js:98-168`, `296-305`).

### 3. Runbook output path and counter source — RESOLVED

The dry-run output example now targets `./matrix-current-summary.json` in the workspace root and explicitly states that nested paths such as `./tmp/...` are unsupported (`docs/operations/matrix-phase1-runbook.md:32-40`). This matches the CLI's immediate-parent check in `workspaceOutputPath` (`scripts/matrix-classify-current.js:44-52`).

The counter section now accurately identifies the in-memory summary returned by `importDiscoveryBatch(...)` as the source, requires the controlled runner to print the run ID and complete summary for the audit record, and explicitly warns that `matrix_runs.counters_json` is not updated and must not be treated as the import count source (`docs/operations/matrix-phase1-runbook.md:81-95`). The review SQL no longer selects `counters_json` (`docs/operations/matrix-phase1-runbook.md:99-119`). These statements match `createRun`, which only initializes the column from campaign input, and `importDiscoveryBatch`, which returns but does not persist its summary (`src/lib/signalCache.js:101-118`; `src/lib/matrixStream.js:358-426`).

The integration verifier now guards these documentation contracts and the exact unified package command against regression (`scripts/verify-matrix-phase1.js:214-229`, `308-313`).

## Shared entity/evidence rollback boundary

The rollback remains accurate and appropriately conservative. Direct run ownership exists only on `matrix_classifications.run_id`; neither `matrix_entities` nor `matrix_evidence` records a run ID (`src/db.js:815-856`). Entities are domain-upserted and evidence is independently deduplicated, so those rows may be shared across runs (`src/lib/signalCache.js:121-155`, `165-214`).

The runbook therefore deletes only classifications for the selected run and its `matrix_runs` row in one transaction, and explicitly prohibits heuristic/cascading deletion of shared entity/evidence rows (`docs/operations/matrix-phase1-runbook.md:121-143`). This satisfies the brief's “delete only the run-owned `matrix_*` rows” boundary. It is correctly disclosed as conservative rather than presented as full restoration of shared import state; complete reversibility would require separate provenance design and is outside Task 6.

## Other confirmed requirements

- The verifier creates, initializes, uses, closes, and removes a temporary SQLite database, with a nonzero exit code on assertion failures (`scripts/verify-matrix-phase1.js:10-15`, `296-324`).
- Deterministic classification, current-CRM adapter invocation, signal storage, exact six-country/20/120 limits, and India exclusion are directly exercised in the integration stage.
- Full-row snapshots prove no changes to `customers`, `crm_messages`, `email_messages`, or `communication_logs` across guarded import, current-CRM classification, and the integration API request (`scripts/verify-matrix-phase1.js:27-32`, `71-76`, `171-176`, `261-305`).
- Delivery remains unavailable through zero phase-module delivery exports/imports, no Matrix write route declarations, and no Matrix delivery package commands (`scripts/verify-matrix-phase1.js:179-211`).
- The runbook accurately covers dry run, evidence JSON schema, output counters, review sampling, run-owned rollback, secret isolation, and explicit delivery unavailability (`docs/operations/matrix-phase1-runbook.md:22-149`).

The updated report and all 524 lines of `review-task-6-r2.diff` were read completely. The implementation-reported fresh passes for `npm run verify:matrix-phase1`, `npm run verify:smoke`, `git diff --check`, and `node --check scripts/verify-matrix-phase1.js` were accepted as supplied and were not repeated, per re-review instructions.

## 蒸馏进度

- 已确认模块：临时库统一集成验证、Task 3 全部负向守卫、三个只读 API 安全契约、六国 20/120/India 限制、正式表零写、CRM 适配、干跑输出路径、summary 计数来源、共享 entity/evidence 保守回滚、secret 隔离与 delivery 不可用。
- 未解决模块：无 Task 6 审查阻断项；持久库中共享 entity/evidence 的完整可逆性仍需后续 provenance 设计。
- 下一最高优先知识缺口：在后续允许持久导入前，明确 run-to-entity/evidence 关联或变更日志的归属与完整回滚语义。

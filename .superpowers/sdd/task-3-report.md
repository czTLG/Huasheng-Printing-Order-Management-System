# Task 3 Report — Narrow Matrix Review APIs

## Status

DONE_WITH_CONCERNS

## Scope

- Added the bound-operator Matrix review endpoints for immutable version creation/revision, approval, and persisted final preview.
- Version and approval inputs accept identifiers, expected version/hash values, revision instruction, and idempotency keys only. Unknown client fields are rejected.
- Initial recipient, source, evidence snapshot, and deterministic bilingual content are derived only from the server-loaded candidate detail and same-organization official evidence.
- Recipient evidence insertion and initial version creation share one immediate transaction. Any stale, authorization, evidence, or quality failure rolls back evidence/version/event/work-item changes.
- Preview reads persisted version/quality state only and creates no job or delivery state.
- No delivery implementation, mail transport, SMTP handling, credential handling, attachment handling, or external communication was added.
- No quotation workflow was modified.

## RED / GREEN Evidence

1. Missing routes
   - RED: the first create probe failed with `404 !== 201` after traversing the existing JWT fallback layer.
   - GREEN: create/revise/approve/preview routes were added under the existing Matrix router.
2. Fail-closed API matrix
   - Tests cover inactive/no binding, worker role, missing explicit `matrixSend`, another owner, unknown fields, unpaired base/instruction, stale work version/hash, missing public email, contact-form-only input, missing official evidence, and foreign-domain official evidence.
   - Every negative case compares recipient-evidence/version/event/job counts and work-item review state before/after and requires zero change.
3. Deterministic quality
   - Initial GREEN attempt was blocked by the existing quality gate at 55 because the Chinese specification conjunction was malformed and an English company token in Chinese text produced an ontology conflict.
   - The deterministic template was corrected without changing the gate. The persisted draft now scores 100, has no hard failures, and records `passed=true`.
4. Official evidence domain
   - RED: an `official_website` row on `outside.test` produced a 201 draft for `alpha.test`.
   - GREEN: official evidence must now use HTTPS and the candidate organization hostname or a subdomain; the foreign-domain case returns 400 with zero review write.
5. Idempotent replay
   - RED: exact create replay was rejected as `409 stale work version` by an API preflight check.
   - GREEN: create and approval initially delegated replay fingerprint/scope handling to the reviewed Task 2 service. Exact replays returned 200 and created no additional state, while a new stale request still returned 409.

## Independent Review Repair

1. Authoritative API request ledger
   - RED: after a successful create, removing the candidate email and official evidence made the exact API replay return 400 instead of the recorded result.
   - GREEN: added immutable `matrix_stream_api_requests` records keyed by a globally unique idempotency key and bound to actor, work item, action, canonical client-request fingerprint, version, and original response snapshot.
   - The ledger row is inserted in the same outer immediate transaction as the evidence/version/event/work-item transition. Update and delete triggers reject direct mutation.
   - Exact create/approve/revise replay is resolved before candidate loading, stale preflight, or provider invocation. It returns the original response fields plus explicit `current_status` and `current_work_item_version`. A mismatched expected version, target, hash, base, or instruction returns stable 409 without a write.
   - Candidate email/evidence/specification drift no longer affects exact replay. A new key evaluates current candidate state and still fails closed.
2. Successful revision replay
   - RED: the original route had no injectable successful provider path; the first injected revision test received `503 text_provider_unavailable`.
   - GREEN: the router accepts a bounded text-service dependency. A successful revision writes one ledger row atomically; exact replay returns the persisted snapshot without another provider call. Changed instruction/base and a new stale key all fail before provider invocation.
3. Commit-time authorization
   - A fresh authorization read now runs inside the same immediate transaction as create, revise, and approve writes. It binds the current Feishu open ID and binding ID to the actor, then rechecks actor/binding active state, current role, freshly parsed persisted permissions with explicit `matrixSend`, owner, suppression, and expected work version.
   - Blocking-provider tests revoke the binding and capability during the wait. Both requests return 403 after provider completion and leave recipient evidence, API requests, versions, events, jobs, and work-item review state unchanged.
4. Stable public errors
   - RED: a provider exception containing a token, internal path, SQL, and SQLite diagnostic was returned verbatim as HTTP 400.
   - GREEN: review endpoints return fixed `{ error: { code, message } }` objects. Provider unavailable/failure use stable 503 codes, unexpected storage/service failures use a generic 500, and known validation/authorization/stale/not-found/idempotency classes have stable 4xx codes.
   - Server diagnostics log only the redacted error class. API tests prove provider text, credentials, filesystem paths, SQL, and SQLite diagnostics do not enter responses.
5. Durable concurrent replay claim
   - RED: two overlapping identical revisions both invoked the provider; the results were `[201,409]` with two provider calls and only the first transition committed.
   - GREEN: added `matrix_stream_api_claims`, a durable globally keyed claim containing the canonical actor/work/action/fingerprint scope, an opaque owner token, and a bounded lease. Claim identity fields are immutable; only owner/lease timestamps can change for compare-and-swap takeover.
   - Every create, revise, and approve request now acquires the same claim protocol before work. Exact contenders poll the committed immutable request ledger and return its authoritative response; mismatched contenders fail immediately with stable 409 and never invoke the provider.
   - The committing immediate transaction rechecks either an already-recorded result or the exact unexpired owner token, then performs fresh authorization, the review transition, ledger insertion, and conditional owner cleanup atomically.
   - A crashed owner leaves a recoverable lease. Active claims produce a bounded stable 503 after the configured wait, while an expired claim can be taken over only through owner/expiry compare-and-swap. A request that loses ownership during provider work receives a stable 409 and cannot commit or delete the replacement owner's claim.
   - Blocking tests now prove concurrent exact statuses `[200,201]`, one provider invocation, the same version result, and one ledger/event transition, plus active mismatch isolation, wait timeout, immutable claim scope, expired-owner recovery, and final-transaction lease-loss rejection.

## Verification

- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/test-admin-access-regression.js` — PASS.
- `node scripts/smoke-test.js` — PASS on the approved localhost-capable path.
- `node --check src/db.js src/routes/matrix.js src/server.js scripts/test-matrix-api.js` — PASS.
- Added-line static scan for mail transport, SMTP, credential, and attachment primitives — no matches.
- `git diff --check` — PASS.

## Concerns

- The deterministic initial template intentionally supports only a small reviewed category map and requires official weight specifications. Unsupported or evidence-poor candidates fail closed instead of receiving a low-quality draft.
- Free-form revision is exposed and has a successful injected-provider API acceptance path. Production still returns `503 text_provider_unavailable` with zero writes when the bounded provider is intentionally unavailable; no fallback revision is fabricated.
- The official contact page is accepted as recipient provenance only when the reviewed recipient service can bind it to the same registrable organization domain; at least one same-organization official evidence row is also required.
- This task does not add final confirmation or delivery. Approval remains a persisted review transition only.

## 蒸馏进度

- 已确认模块：窄化版本创建/修改/批准/预览 API、服务端 recipient/evidence 推导、不可变 API request ledger、持久化 claim/lease/CAS 并发 replay、崩溃接管与 lease-loss 隔离、原子 transition/replay、提交事务内 fresh 授权、稳定脱敏错误、stale/hash 与零写回归、确定性质量门禁。
- 未解决模块：生产 provider 的真实自由修改验收、更多可审计品类/规格模板、最终确认与交付；均不在 Task 3 范围内。
- 下一优先知识缺口：为更多候选品类建立有官方证据支撑的双语确定性模板与规格映射，未确认前继续 fail closed。

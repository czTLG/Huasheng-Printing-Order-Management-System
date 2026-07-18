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
   - GREEN: create and approval now delegate replay fingerprint/scope handling to the reviewed Task 2 service. Exact replays return 200 and create no additional state, while a new stale request still returns 409.

## Verification

- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/smoke-test.js` — PASS on the approved localhost-capable path.
- `node --check src/routes/matrix.js src/server.js scripts/test-matrix-api.js` — PASS.
- Added-line static scan for mail transport, SMTP, credential, and attachment primitives — no matches.
- `git diff --check` — PASS.

## Concerns

- The deterministic initial template intentionally supports only a small reviewed category map and requires official weight specifications. Unsupported or evidence-poor candidates fail closed instead of receiving a low-quality draft.
- Free-form revision is exposed but returns `503 text_provider_unavailable` with zero writes when the bounded text provider is intentionally unavailable. No fallback revision is fabricated.
- The official contact page is accepted as recipient provenance only when the reviewed recipient service can bind it to the same registrable organization domain; at least one same-organization official evidence row is also required.
- This task does not add final confirmation or delivery. Approval remains a persisted review transition only.

## 蒸馏进度

- 已确认模块：窄化版本创建/修改/批准/预览 API、服务端 recipient/evidence 推导、显式权限与 ownership 门禁、stale/hash 与零写回归、确定性质量门禁、幂等 replay。
- 未解决模块：provider 可用时的真实自由修改验收、更多可审计品类/规格模板、最终确认与交付；均不在 Task 3 范围内。
- 下一优先知识缺口：为更多候选品类建立有官方证据支撑的双语确定性模板与规格映射，未确认前继续 fail closed。

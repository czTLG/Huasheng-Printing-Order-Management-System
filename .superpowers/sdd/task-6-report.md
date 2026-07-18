# Task 6 Report — Two-Confirmation Cards and Revision Context

## Status

DONE

## Scope implemented

- Added fixed-origin client methods `createVersion`, `reviseVersion`, `approveVersion`, `versionPreview`, and `confirmSend` with exact request-body fields and positive identifier validation.
- Replaced the local selection draft with the persisted immutable version returned by the review API.
- Added neutral card actions `mx.review`, `mx.revise`, `mx.approve`, `mx.preview`, and `mx.confirm`.
- Kept selection and first approval strictly no-send. The only extension call to `confirmSend` is inside `mx.confirm` after a separately loaded final preview.
- Added a ten-minute edit context bound to chat, operator open ID, and thread. Only `修改：...` from that exact context is consumed. Success, expiry, cancel, and defer clear the context.
- Added final preview rendering for quality score/component reasons, duplicate, cooling, quota, sender readiness, and country/channel policy results. Blocked previews expose no confirmation action.
- Added distinct accepted, definite-failure, and ambiguous result cards. Definite failure returns to a fresh preview; ambiguous delivery has no retry action.
- Derived stable approval and confirmation idempotency keys from the reviewed identifiers and content hash. Repeated confirmation of the same final card uses the same idempotency key.
- Kept review/final cards within 1,500 Unicode code points and excluded raw server diagnostics and Message-ID display.
- Added no production transport, SMTP configuration, or real delivery wiring. Runtime delivery remains disabled.

## TDD evidence

1. Full card-flow RED: selection still rendered only `返回列表` / `查看进行中`; expected the three review actions.
2. Client API RED: the five exact methods were absent from the exported client.
3. Result-card RED: definite failure used the old retry label rather than the explicit `重新预览` action.
4. Positive-body validation RED: `expected_work_version=0` was not rejected locally.
5. Each RED was followed by the minimal implementation and a focused GREEN run of `test-stream-card-extension.js`.

## Verification

- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js` — PASS.
- `node scripts/test-bridge-artifact-0.6.9.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path; the initial sandboxed run failed only with `listen EPERM 0.0.0.0:21002`.
- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/smoke-test.js` — `SMOKE PASS`.
- `node --check` on the changed client, extension, and card test — PASS.
- Task 6 static no-transport/no-send boundary checks — PASS.
- `git diff --check` — PASS.

## Deferred boundary

- Copyable direct-message content, price presentation, FOB presentation, and knowledge archival remain unimplemented pending user design confirmation.
- Task 7 still owns the complete runtime capability audit and manifest rebuild/re-signing.

## Independent review repair

- I1 repaired with a shared fail-closed gate projection: only strict `ok === true` with no blocking reasons is displayed as passed; any present reason fields must be valid arrays.
- Missing, non-object, empty, unknown, non-boolean `ok`, or malformed reason projections are displayed as `提交时复核` and suppress final confirmation.
- Explicit `ok === false` or any blocking reason is displayed as blocked. A contradictory `allowed: true` response with any blocked gate exposes no `mx.confirm` action.
- RED fixtures cover `{}`, `{ ok: null }`, unknown status, string `ok`, missing gates, and `allowed: true` plus an explicitly blocked readiness gate; the normal five-gate passing path remains covered.
- R2 adds a shared strict reason projection for gate and top-level metadata. Present reason fields must be arrays containing only trimmed, non-empty, bounded strings without control newlines; malformed containers or null/boolean/number/object/empty elements fail closed before display filtering.
- R2 RED fixtures cover `reasons: [null]`, `hardFailures: [false, '', '   ']`, `hard_failures: [0]`, mixed valid/object arrays, and malformed top-level string/object/array payloads. All suppress `mx.confirm`; the strict five-gate pass remains covered.

## 蒸馏进度

- 已确认模块：固定源 exact client、不可变版本审阅卡、两次确认、三元组十分钟修改上下文、门禁阻断卡、三类提交结果、稳定幂等键、no-send/no-transport 边界。
- 未解决模块：可复制私聊、价格、FOB、知识归档设计；Task 7 runtime manifest 总审计与重签。
- 下一优先知识缺口：Task 7 capability inventory 与 manifest 一致性验证。

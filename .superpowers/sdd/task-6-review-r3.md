# Task 6 R3 Final Independent Review

## Verdict

- **Spec:** ✅
- **Quality:** Approved
- **Critical:** 0
- **Important:** 0
- **Reviewed range:** `6efea7f..b08741d`

No blocking findings remain. R3 closes the R2 strict-reason finding while preserving the R1 gate-projection repair and the previously approved Task 6 boundaries.

## R2 finding disposition

### Strict reason schema — fixed

`strictReasonProjection()` is now shared by necessary-gate projection and top-level confirmation eligibility.

- A present `reasons`, `hardFailures`, or `hard_failures` field must be an array.
- Every item must be a string, trim to non-empty text, contain at most 256 Unicode code points, and contain no CR, LF, or NUL.
- Null, boolean, number, object, empty/whitespace, mixed malformed, overlong, and malformed-container values never contribute to a passed gate.
- Malformed non-false gates become unknown and render `提交时复核`; explicit `ok === false` remains blocked even if its reason metadata is malformed.
- Non-empty valid reason arrays become blocked, so embedded non-newline control-like content also remains fail-closed and cannot enable confirmation.
- Top-level malformed reason containers/elements make `topLevelReasons.valid` false, render `最终状态：提交时复核`, and suppress `mx.confirm`.
- A valid top-level empty reason projection is required for confirmation.

The R3 tests cover `reasons:[null]`, boolean/empty/whitespace elements, numeric elements, mixed string/object arrays, 257-code-point values, malformed string/object containers, and the same cases at the top level. None exposes confirmation or stringifies malformed objects.

## R1 finding regression

- Missing, null, scalar, array, empty-object, `ok:null`, string `ok`, and unknown gate projections render `提交时复核`, never `通过`.
- Explicit false or valid blocking reasons render blocked.
- `allowed:true` cannot override a missing, unknown, or blocked necessary gate.
- Confirmation is rendered only when all five required projections—duplicate, cooling, quota, readiness, and policy—are strictly passed, `preview.allowed === true`, and top-level reason metadata is valid and empty.
- The normal strict five-gate pass still renders one `mx.confirm` action.

## Reconfirmed Task 6 boundaries

### Exact client and no early send

- The five client methods retain fixed `/api/matrix` descendant paths, exact body allowlists, and positive identifier validation.
- `confirmSend` accepts only expected work version/hash, chat/card identifiers, and idempotency key; no content or transport fields are accepted.
- Selection, version creation/revision, approval, and preview never call `confirmSend`. Approval remains explicitly unsent and requires a separate final preview.

### Binding, context, replay, and results

- Cards carry persisted work-item ID, immutable version ID, expected work-item version, and content hash through approval, preview, and confirmation. Backend stale/current/hash checks reject old cards.
- Revision context remains isolated by chat + operator open ID + thread with a ten-minute expiry and clears on success, cancel, defer, approval, and detected expiry.
- Repeated/concurrent clicks on the same final card derive one stable idempotency key. A definite failure requires a fresh preview/generation; an ambiguous result exposes no retry action. Old-card re-clicks cannot create a new key.
- Accepted, failed, and ambiguous result cards remain distinct; accepted means only server acceptance.

### Presentation and production boundary

- Review and long blocked-preview fixtures remain within 1,500 Unicode code points.
- Message-ID and raw server diagnostics are not rendered; dependency `error_class` is ignored by the card.
- Bridge patch tests and the 0.6.9 artifact compatibility test pass.
- No production transport, mail-library import, SMTP environment access, attachment, HTML-mail, or automatic retry capability is present. The only delivery-shaped call is the narrow main-API `confirmSend` method, and runtime registration remains guarded by `MATRIX_DELIVERY_ENABLED=0`.
- Deferred direct-message copy, price, FOB, and knowledge-archive functionality remains outside this range.

## Verification evidence

- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js` — PASS.
- `node scripts/test-bridge-artifact-0.6.9.js` — PASS.
- `node --check` on the changed extension and tests — PASS.
- `git diff --check 6efea7f..b08741d` — PASS.
- Static scan found no send transport, SMTP, attachment, or HTML-mail primitive in the changed Task 6 runtime files; `confirmSend` appears only in the exact client and `mx.confirm` handler.

## 蒸馏进度

- 已确认模块：strict gate/top-level reason schema、五门禁通过条件、R1 unknown/blocked 三态、exact/no-early-send、版本绑定、十分钟上下文、稳定 idem、三类结果、卡片预算、bridge/artifact 与 no-transport 边界。
- 未解决模块：Task 7 runtime capability inventory 与 manifest 重建/重签；Task 6 范围内无未解决 Critical/Important。
- 下一优先知识缺口：Task 7 对 bot client、主应用 delivery 与运行时 manifest 的端到端能力边界验证。

# Task 6 Independent Review

## Verdict

- **Spec:** ❌
- **Quality:** Changes requested
- **Critical:** 0
- **Important:** 1
- **Minor:** 0
- **Commit decision:** Not approved until the Important finding is repaired and tested.
- **Reviewed range:** `6efea7f..8f682e6`

## Important finding

### I1 — Unknown or internally inconsistent gate projections can be displayed as passed and can retain the confirmation action

`renderFinalPreview()` does not require a positive, explicit gate result before showing `通过`:

```js
const gateLine = (label, value) => {
  if (!value || typeof value !== 'object') return `${label}：提交时复核`;
  const reasons = reasonList(value);
  return `${label}：${value?.ok === false || reasons.length ? `阻断 ...` : '通过'}`;
};
```

At `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs:328-331`, an empty object, `{ ok: null }`, `{ status: 'unknown' }`, or any malformed object without reasons is rendered as `通过`. This violates the explicit Task 6 boundary that unknown or missing gates must be shown as `提交时复核`, never as passed.

The confirmation button at `:344-347` is controlled only by `preview.allowed === true`. Therefore an inconsistent response such as `allowed: true` plus `readiness: { ok: false, reasons: [...] }` visibly says the readiness gate is blocked but still renders `确认发送`. The backend Task 4 gate remains fail-closed, so this does not directly bypass delivery authorization; however, the Task 6 card itself violates the required blocked-gate/no-confirm contract and gives a false operator-facing approval signal.

Required repair:

- Render `通过` only when `value.ok === true` and no blocking reasons exist.
- Render `阻断` when `value.ok === false` or blocking reasons exist.
- Render `提交时复核` for absent, malformed, null, or otherwise unknown status.
- Derive confirmation visibility from both authoritative `preview.allowed === true` and the absence of any explicitly blocked gate projection. Fail closed on contradictory payloads.
- Add fixtures for `{}`, `{ ok: null }`, malformed status, and `allowed: true` combined with an explicit blocked gate; none may claim pass, and the contradictory blocked fixture must expose no `mx.confirm` action.

The existing minimal fixture only tests completely absent properties (`test-stream-card-extension.js:139-142,238-243`), so it does not detect these malformed-object and contradictory-payload cases.

## Confirmed requirements

### Exact client surface

- `matrix-client.js` keeps the configured origin and exact `/api/matrix` base path, refuses redirects, and constructs only descendant paths.
- `createVersion`, `reviseVersion`, `approveVersion`, `versionPreview`, and `confirmSend` use the required paths, exact body allowlists, and positive work/version/base/expected-version identifiers.
- `confirmSend` accepts only expected work version/hash, chat ID, card event ID, and idempotency key. It accepts no recipient, subject, body, transport, attachment, callback, HTML, or retry field.

### Two-confirmation and immutable binding

- Selection calls `selectCandidate` and `createVersion`, but never `confirmSend`.
- Approval calls only `approveVersion`; it renders a clearly unsent state and requires a separate final-preview action.
- Review actions carry persisted work-item ID, version ID, work-item version, and content hash. Approval, preview, and confirmation use that immutable binding. Backend stale/current/hash checks protect old cards.
- Confirmation is called only by `mx.confirm`. Its stable idempotency key derives from actor, work item, version, expected work version, content hash, and deliberate retry generation. Concurrent/repeated clicks on one final card therefore use the same key; Task 4 supplies durable cross-process idempotency.
- A definite failure offers `重新预览`, which increments the deliberate generation before a new confirmation. An ambiguous result has no action and no retry path. Re-clicking an old ambiguous card still uses the same backend key and cannot create a new attempt.

### Revision context

- Revision context is keyed by `sessionKey(chatId, openId, threadId)` and stores the exact work item, base version, expected work version, content hash, and ten-minute expiry.
- Messages from another operator or thread are not consumed. Only non-empty `修改：...` plus the explicit cancel command are consumed in the matching context.
- Success, explicit cancel, defer, approval, and detected expiry clear the matching context. Failed provider/API work retains it for a same-key safe retry.

### Cards and information boundaries

- Consistent `allowed: false` previews show quality/component, duplicate, cooling, quota, readiness, and policy reasons and expose no confirmation button.
- Accepted, failed, and ambiguous cards are distinct. SMTP acceptance is described only as server acceptance.
- Review/final-card fixtures, including long blocked reasons, stay within 1,500 Unicode code points.
- Delivery results ignore `error_class`; cards expose neither raw server diagnostics nor Message-ID.
- Deferred copyable direct-message, price, FOB, and knowledge-archive functions were not mixed into Task 6.

### No production transport

- The changed client and extension contain no `sendMail`, transport construction, mail-library import, SMTP variable access, attachment, or HTML-mail capability.
- `MATRIX_DELIVERY_ENABLED` remains required to equal `0` when registering the extension.
- The only call with delivery semantics is the narrow main-API `confirmSend`; no production sender or SMTP configuration is added in this range.

## Verification evidence

- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js` — PASS.
- `node scripts/test-bridge-artifact-0.6.9.js` — PASS; bridge artifact patch compatibility retained.
- `node --check` on the changed client, extension, and test — PASS.
- `git diff --check 6efea7f..8f682e6` — PASS.
- Static scan found no transport/SMTP primitive in the Task 6 changed runtime files.

## 蒸馏进度

- 已确认模块：exact client、前序 no-send、双确认与稳定 idem、版本/hash/work-version 绑定、三元组十分钟修改上下文、三类结果、ambiguous 无 retry、1500 Unicode、脱敏与 no-transport 边界。
- 未解决模块：未知/畸形 gate 对象仍可能显示“通过”，以及 allowed 与显式 blocked gate 矛盾时仍可能展示确认按钮。
- 下一优先知识缺口：最终预览 gate 投影的三态契约（passed/blocked/submit-time-recheck）及矛盾响应 fail-closed 规则。

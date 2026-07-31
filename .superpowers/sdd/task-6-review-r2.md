# Task 6 R2 Independent Review

## Verdict

- **Spec:** ❌
- **Quality:** Changes requested
- **Critical:** 0
- **Important:** 1
- **Minor:** 0
- **Reviewed range:** `6efea7f..14dfc6b`

R2 closes the original empty/missing/non-boolean gate-status defect and the `allowed=true` plus explicit blocked-gate contradiction. One strict malformed-reason path remains, so Task 6 is not yet approved.

## Important finding

### I1-R2 — Malformed reason-array elements and malformed top-level reason containers can still be treated as a clean pass

`gateProjection()` validates that an explicitly present `reasons`, `hardFailures`, or `hard_failures` property is an array, but it does not validate the array elements. It then delegates to `reasonList()`, which silently drops null, empty, false, and zero-like elements:

```js
const reasons = reasonList(value);
if (reasons.length) return { state: 'blocked', reasons };
if (value.ok === true) return { state: 'passed', reasons: [] };
```

As a result, these malformed necessary-gate projections are currently classified as strict `passed` and can contribute to rendering `mx.confirm`:

```js
{ ok: true, reasons: [null] }
{ ok: true, hardFailures: [false, ''] }
{ ok: true, hard_failures: [0] }
```

This violates the R2 requirement that malformed reasons must be `unknown` or `blocked`, never passed.

The same issue exists at the top level. `confirmAllowed` uses `reasonList(preview).length === 0` but does not validate top-level reason-container types. Therefore a response with all five gates strictly passed can still render confirmation despite malformed top-level reasons:

```js
{
  allowed: true,
  reasons: 'malformed',
  duplicate: { ok: true, reasons: [] },
  cooling: { ok: true, reasons: [] },
  quota: { ok: true, reasons: [] },
  readiness: { ok: true, hardFailures: [] },
  policy: { ok: true, hardFailures: [] }
}
```

Because a string is not consumed by `reasonList()`, it appears to have no top-level reasons and satisfies `confirmAllowed`. The explicit R2 boundary is that confirmation appears only when all five necessary gates are strictly passed **and the top level has no reasons**; malformed reason metadata must fail closed.

The main delivery endpoint still rechecks every durable gate, so this is an operator-card correctness/fail-closed defect rather than a direct delivery authorization bypass. It is Important, not Critical.

Required repair:

- Add a reusable strict reason projection that distinguishes: property absent, valid array of non-empty strings, and malformed container/elements.
- For a gate, `ok === true` is passed only when every present reason container is a valid array and every element is a valid non-empty bounded string; empty arrays are valid. Malformed containers or elements must produce `unknown` or `blocked`.
- For the top-level preview, allow confirmation only when every present reason container is structurally valid and contains zero reasons. Any malformed top-level container or element must suppress `mx.confirm`.
- Add tests for `reasons:[null]`, `hardFailures:[false,'']`, `hard_failures:[0]`, a mixed valid/malformed array, and top-level string/object/malformed-element containers.

## Original I1 disposition

The original R1 Important finding is otherwise closed:

- Missing, null, scalar, array, empty-object, `ok:null`, `ok:'true'`, and unknown-status gate projections resolve to `提交时复核` rather than `通过`.
- Explicit `ok:false` remains blocked even when its reason container is malformed.
- A present non-array reason container with non-false `ok` resolves to unknown.
- Any necessary gate that is missing, unknown, or blocked suppresses `mx.confirm`.
- `allowed:true` plus an explicit blocked necessary gate suppresses confirmation.
- Confirmation now requires `preview.allowed === true`, all five necessary gates projected as passed, and no recognized top-level reasons.

## Reconfirmed Task 6 boundaries

- Client paths and request bodies retain their exact allowlists and positive identifiers.
- Selection, version creation, approval, revision, and preview do not call `confirmSend`; only `mx.confirm` reaches the narrow send API.
- Approval renders an unsent card and requires a separate preview action.
- Work item, immutable version, expected work version, and content hash remain carried through approval/preview/confirmation. Backend stale/current/hash checks reject old cards.
- Repeated/concurrent clicks on one final card derive the same idempotency key. Definite failure requires a fresh preview/generation; ambiguous delivery has no retry action.
- Revision context remains isolated by chat + operator open ID + thread, expires after ten minutes, and clears on success, cancellation, defer, approval, and detected expiry.
- Accepted, failed, and ambiguous cards remain distinct; raw diagnostics and Message-ID are not rendered.
- Long review/blocked cards remain covered by the 1,500-Unicode-code-point tests.
- Bridge patch and 0.6.9 artifact compatibility remain intact.
- No production transport, mail library, SMTP environment access, attachment, HTML-mail, or automatic retry capability was added.

## Verification evidence

- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js` — PASS.
- `node scripts/test-bridge-artifact-0.6.9.js` — PASS.
- `node --check` on the changed extension and tests — PASS.
- `git diff --check 6efea7f..14dfc6b` — PASS.
- Static no-transport scan returned no matches; its `rg` exit status was `1` because the prohibited patterns were absent.

## 蒸馏进度

- 已确认模块：缺失/空/非布尔 gate 三态、allowed/blocked 矛盾 fail-closed、五门禁确认条件、原 Task6 exact/no-send/context/idem/result/card/compatibility/no-transport 边界。
- 未解决模块：reason 数组元素未严格校验；顶层畸形 reason 容器可能被当作“无 reasons”并展示确认。
- 下一优先知识缺口：统一 gate 与顶层 reason payload 的严格 schema 和 malformed-element 测试矩阵。

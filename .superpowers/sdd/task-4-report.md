# Task 4 Report — Restricted Single-Message Delivery

## Status

DONE_WITH_CONCERNS

## Scope

- Added `createMatrixStreamDelivery({ db, transport, clock, fromAddress, messageIdDomain })` with an injected transport only. The implementation does not construct a transport, load SMTP environment variables, import a mail library, or call any existing production sender.
- Bound the first confirmation to the immutable persisted approved version and its append-only approval event. The separate send confirmation records actor, binding, chat, card event, expected work-item version, expected content hash, and idempotency key before invoking the injected transport.
- Reloaded active actor/binding, explicit `matrixSend`, owner, suppression, current version, canonical content hash, recipient evidence/snapshot/domain/freshness, recomputed quality, identity/cooling/quota, persisted sender readiness, and current country/channel policy inside the immediate pre-transport transaction.
- Persisted `pending` with a stable job-derived Message-ID, transitioned to `sending`, and invoked the injected transport with only `from`, persisted `to`, persisted `subject`, persisted English plain text, stable `messageId`, and the single reviewed version header. No HTML, attachment, reply override, callback, client recipient/body, or retry option is accepted.
- Classified recipient acceptance as `accepted`, explicit 5xx/550 rejection as `failed`, and timeout/disconnect/unknown post-invocation outcomes as `ambiguous`. There is no internal retry. A definite failure permits a new deliberate key; accepted/ambiguous/sending state blocks a new attempt for the same approved content.
- Scheduled the reply check only inside the accepted durable result transaction. Failed and ambiguous results create no reply check.
- Added the narrow send API with an exact five-field allowlist. Its response is fixed to `state`, `error_class`, and `work_item_version`; Message-ID is persisted only in the delivery job and is absent from public API results and stream event diagnostics.
- Added `country_code` to the server-derived immutable source snapshot so delivery can reload the exact reviewed country policy without accepting a client country field.
- No costing, price, FOB, freight, quotation, order, or unrelated workflow was changed.

## RED / GREEN Evidence

1. Accepted delivery and replay
   - RED: `node scripts/test-matrix-stream-delivery.js` failed with `MODULE_NOT_FOUND` for `matrixStreamDelivery`.
   - GREEN: the fake transport received exactly six top-level fields, exact persisted recipient/subject/plain-text body, a stable job-derived Message-ID, and one reviewed header. Exact replay returned the same public result and kept transport count at one.
   - Repair RED: authoritative replay was initially blocked by the accepted job's own 90-day cooling record.
   - GREEN: replay now performs fresh authorization and exact request-scope verification while returning the already durable historical result without re-running one-time pre-send gates.
2. Result classification and duplicate prevention
   - RED: a fake `responseCode=550` exception escaped with raw server text.
   - GREEN: 550 persists only `failed/recipient_rejected`; a new deliberate key may make one new attempt. `ETIMEDOUT` persists only `ambiguous/transport_outcome_unknown`, exposes no raw diagnostic, and blocks every new key.
   - Two overlapping exact confirmations share the in-process durable job result and invoke transport exactly once. A restarted-process replay of a leftover `sending` job becomes `ambiguous` instead of retrying.
3. Fresh fail-closed gates
   - Mutation tests revoke or alter binding, owner, current version, expected hash, recipient evidence, quality, suppression, sender readiness, country policy, 90-day cooling, and daily quota.
   - Every mutation rejects before transport and leaves the fake transport count at zero.
4. Send API
   - RED: the route returned 404.
   - GREEN: the exact five identifier fields reach the injected service; recipient, subject, body, SMTP host, callback URL, attachment, and retry fields each return 400 before the service call.
   - RED: the Task 3 source snapshot lacked `country_code`, preventing server-side policy reload.
   - GREEN: the server-derived snapshot now persists the reviewed candidate country.
   - RED: an injected service result containing `message_id` was passed through by the route.
   - GREEN: the public response is an explicit three-field projection and cannot expose Message-ID or other dependency fields.

## Verification

- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/test-admin-access-regression.js` — PASS.
- `node scripts/smoke-test.js` — PASS.
- `node --check` on the delivery service, Matrix route, delivery tests, and API tests — PASS.
- Static production-source boundary assertions — PASS: one injected `transport.sendMail` call site; no transport construction, SMTP environment access, mail-library import, attachment, HTML, reply override, callback, or automatic retry capability.
- `git diff --check` — PASS.

## Concerns

- Production transport construction and rollout remain intentionally absent. Without an injected reviewed delivery service the endpoint fails closed with `delivery_unavailable`; Task 7/8 controlled rollout must separately retain the disabled flag and explicit operator grant.
- Sender readiness is consumed from the persisted, unexpired Task 2A result. Delivery does not perform DNS, TLS, or SMTP verification itself and never calls a verification transport.
- `accepted` means only that the injected receiving transport accepted the recipient for queueing. It does not mean inbox delivery, reply, editorial acceptance, publication, or a live external result.
- A post-invocation timeout or disconnect is deliberately ambiguous and cannot be resent automatically. Manual reconciliation remains required.
- The existing reply-check calendar excludes weekends but does not infer public holidays.
- Automated fake-transport tests and local API calls are not approval for any real external message. Every real message still requires the user's explicit final approval for that exact recipient, subject, and plain-text body.

## 蒸馏进度

- 已确认模块：不可变 approved version 与双确认审计链、exact persisted body/recipient、fresh 权限与全部安全门禁、stable job/Message-ID、accepted/failed/ambiguous 分类、无内部重试、并发单次 transport、accepted-only follow-up、窄化 API 与 Message-ID 边界。
- 未解决模块：生产 transport 受控接线、真实逐封验收、ambiguous 人工对账、法定节假日日历；均不在 Task 4 本地 fake-transport 范围内。
- 下一优先知识缺口：Task 7/8 受控 rollout 中的生产 sender readiness 复核、逐封最终批准证据和 ambiguous 人工 reconciliation 操作规程。

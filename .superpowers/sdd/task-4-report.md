# Task 4 Report — Restricted Single-Message Delivery

## Status

DONE_WITH_CONCERNS

## Scope

- Added `createMatrixStreamDelivery({ db, transport, clock, fromAddress, messageIdDomain })` with an injected transport only. The implementation does not construct a transport, load SMTP environment variables, import a mail library, or call any existing production sender.
- Bound the first confirmation to the immutable persisted approved version and its append-only approval event. The separate send confirmation records actor, binding, chat, card event, expected work-item version, expected content hash, and idempotency key before invoking the injected transport.
- Reloaded active actor/binding, explicit `matrixSend`, owner, suppression, current version, canonical content hash, recipient evidence/snapshot/domain/freshness, recomputed quality, identity/cooling/quota, persisted sender readiness, and current country/channel policy inside the immediate pre-transport transaction.
- Persisted `pending` with a stable job-derived Message-ID, transitioned to `sending`, and invoked the injected transport with only `from`, persisted `to`, persisted `subject`, persisted English plain text, stable `messageId`, and the single reviewed version header. No HTML, attachment, reply override, callback, client recipient/body, or retry option is accepted.
- Classified recipient acceptance as `accepted`, explicit 5xx/550 rejection as `failed`, and timeout/disconnect/unknown post-invocation outcomes as `ambiguous`. There is no internal retry. A definite failure permits a new deliberate key; accepted/ambiguous/sending state blocks a new attempt for the same approved content.
- Replaced process-local ownership with a durable owner token and bounded lease. A second process polls only the durable job, never invokes transport, and either observes a terminal result or returns a fixed in-progress timeout. Expired ownership is compare-and-set to `ambiguous`; a late or replaced owner cannot overwrite durable state.
- Reserved daily/domain capacity in the same immediate transaction that creates the job. `pending`, `sending`, `accepted`, and `ambiguous` consume the daily limit; `failed` releases it. Active and ambiguous jobs block the recipient domain, while accepted jobs enforce the 90-day domain window.
- Reserved both internal start/result event keys before transport in a dedicated immutable table. The user idempotency key is not reused as a global stream-event key, and a trigger prevents unrelated events from taking a reserved delivery key.
- Bound readiness to the configured sender domain, freshness window, and exact configured selector parsed from the canonical readiness detail JSON.
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
   - Repair RED: resolved `undefined`, empty, unrelated, or contradictory accepted/rejected responses were treated as definite failure.
   - GREEN: only an exact accepted recipient without an exact rejection is `accepted`; only an exact rejected recipient without acceptance is `failed`; every other resolved outcome is durable `ambiguous` and blocks resend.
   - Repair RED: two service instances could treat the same durable `sending` row as locally owned, and a late owner could overwrite a recovered result.
   - GREEN: active-lease replays poll without transport or mutation, stale leases are CAS-recovered to `ambiguous`, owner replacement rejects the old finalizer, and late results cannot overwrite the durable terminal state.
3. Fresh fail-closed gates
   - Mutation tests revoke or alter binding, owner, current version, expected hash, recipient evidence, quality, suppression, sender readiness, country policy, 90-day cooling, and daily quota.
   - Every mutation rejects before transport and leaves the fake transport count at zero.
   - Repair RED: readiness accepted a fresh row without proving the configured selector, and quota/cooling checks had no in-flight reservation.
   - GREEN: missing/wrong/malformed selector detail fails closed; two database connections racing the same domain or the fifth/sixth daily slots allow only the single transaction that owns available capacity to reach transport.
4. Send API
   - RED: the route returned 404.
   - GREEN: the exact five identifier fields reach the injected service; recipient, subject, body, SMTP host, callback URL, attachment, and retry fields each return 400 before the service call.
   - RED: the Task 3 source snapshot lacked `country_code`, preventing server-side policy reload.
   - GREEN: the server-derived snapshot now persists the reviewed candidate country.
   - RED: an injected service result containing `message_id` was passed through by the route.
   - GREEN: the public response is an explicit three-field projection and cannot expose Message-ID or other dependency fields.
   - Repair RED: the bounded cross-process waiter surfaced as a generic 500.
   - GREEN: the API returns the fixed `503 delivery_in_progress` response without exposing internal state or diagnostics.
5. Event-key isolation
   - Repair RED: a client key colliding with an unrelated stream event failed before delivery, and predictable result keys could collide after transport.
   - GREEN: random job-bound internal start/result keys are collision-checked and atomically pre-reserved before transport; raw client keys and legacy predictable collisions do not affect delivery persistence.

## Verification

- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/test-admin-access-regression.js` — PASS.
- `node scripts/smoke-test.js` — PASS.
- `node --check` on the database schema, delivery service, Matrix route, delivery tests, and API tests — PASS.
- Static production-source boundary assertions — PASS: one injected `transport.sendMail` call site; no transport construction, SMTP environment access, mail-library import, attachment, HTML, reply override, callback, or automatic retry capability.
- `git diff --check` — PASS.

## Concerns

- Production transport construction and rollout remain intentionally absent. Without an injected reviewed delivery service the endpoint fails closed with `delivery_unavailable`; Task 7/8 controlled rollout must separately retain the disabled flag and explicit operator grant.
- Sender readiness is consumed from the persisted, unexpired Task 2A result. Delivery does not perform DNS, TLS, or SMTP verification itself and never calls a verification transport.
- `accepted` means only that the injected receiving transport accepted the recipient for queueing. It does not mean inbox delivery, reply, editorial acceptance, publication, or a live external result.
- A post-invocation timeout or disconnect is deliberately ambiguous and cannot be resent automatically. Manual reconciliation remains required.
- Lease renewal/heartbeat is intentionally absent. If an injected transport takes beyond the bounded lease, finalization is conservatively `ambiguous`; this favors duplicate prevention over claiming a late definite result.
- `ambiguous` reservations consume their Shanghai-day quota and retain the domain reservation until manual reconciliation. There is no automatic expiry or automatic retry path.
- The existing reply-check calendar excludes weekends but does not infer public holidays.
- Automated fake-transport tests and local API calls are not approval for any real external message. Every real message still requires the user's explicit final approval for that exact recipient, subject, and plain-text body.

## 蒸馏进度

- 已确认模块：不可变 approved version 与双确认审计链、exact persisted body/recipient、selector-bound readiness、durable owner/lease CAS、跨进程单次 transport、原子 daily/domain reservation、预留内部事件键、严格 accepted/failed/ambiguous 分类、accepted-only follow-up、窄化 API 与固定超时边界。
- 未解决模块：生产 transport 受控接线、lease heartbeat 取舍、ambiguous 人工对账与容量释放、法定节假日日历；均未被本地 fake-transport 测试宣称为完成。
- 下一优先知识缺口：Task 7/8 受控 rollout 中 ambiguous reconciliation 的授权操作、容量释放审计和逐封最终批准证据。

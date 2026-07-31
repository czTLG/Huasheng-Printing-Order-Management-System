# Task 4 R2 Independent Review

## Verdict

- **Spec compliance: ✅ PASS**
- **Implementation quality: Approved**
- **Critical: 0**
- **Important: 0**
- **Minor: 0**

Reviewed fixed range `142dda2..711fde0`, with focused regression against all two Critical and three Important findings from the first review. The R2 implementation resolves each blocker without wiring a production transport.

## Prior findings — resolution

### C1 — Cross-process `sending` ownership: resolved

- Each new job receives a durable random `owner_token` and bounded `lease_expires_at` in the same immediate transaction that moves it to `sending` (`src/services/matrixStreamDelivery.js:326-388`).
- A second service instance with the same exact request waits on durable state while the lease is active and never invokes transport or mutates the job (`:341-345,481-505`). Bounded wait failure maps to fixed API `503 delivery_in_progress` (`src/routes/matrix.js:168-176`).
- Expired or malformed leases are recovered conservatively to `ambiguous`; no retry occurs (`matrixStreamDelivery.js:487-490,505`).
- Finalization validates the durable owner token and exact lease. An old owner cannot overwrite a replacement with an active lease, and terminal state cannot be overwritten by a late result (`:391-446`).
- Two-connection tests cover active-owner wait, stale recovery, late-owner result, and replacement-owner CAS (`scripts/test-matrix-stream-delivery.js:377-443,524-557`).

### C2 — Atomic daily/domain reservations: resolved

- Capacity is checked inside the same SQLite immediate transaction that inserts the job (`matrixStreamDelivery.js:283-307,326-388`).
- `pending`, `sending`, `accepted`, and `ambiguous` consume the recorded Shanghai-day reservation; only `failed` releases daily capacity by leaving the counted state set.
- Active/ambiguous rows retain the normalized registrable-domain reservation. Accepted rows retain the 90-day cooling block based on their durable result time. A partial unique index additionally enforces one active domain reservation (`src/db.js`, `idx_matrix_stream_jobs_active_domain_reservation`).
- Two database connections prove that simultaneous same-domain requests and the fifth/sixth daily-slot race allow only the capacity owner to reach transport (`test-matrix-stream-delivery.js:447-517`).
- Result and follow-up persistence are atomic. `accepted` schedules exactly one reply check in the result transaction; `failed` and `ambiguous` do not schedule one.

### I1 — Strict transport-result classification: resolved

- Only exact target acceptance without target rejection is `accepted`.
- Only exact target rejection without target acceptance is definite `failed`.
- Undefined, empty, unrelated, malformed, or contradictory resolved responses are `ambiguous` and block resend (`matrixStreamDelivery.js:455-479`; tests around `test-matrix-stream-delivery.js:340-369`).
- Thrown 5xx/550 remains definite rejection; timeout/disconnect/unknown exceptions remain ambiguous. Raw transport strings are neither persisted nor returned.

### I2 — Internal event-key collision: resolved

- Start/result keys are job-bound SHA-256 identifiers incorporating the request fingerprint and cryptographically random owner token (`matrixStreamDelivery.js:117-120,309-324`). They are unpredictable to clients yet auditable through immutable `job_id`, `event_kind`, `request_hash`, and `created_at` records.
- Both keys are collision-checked and reserved before transport in the same transaction as job creation. The client idempotency key is retained on the job but is no longer reused as a globally unique stream-event key.
- The reservation table is immutable, uniquely binds one start/result pair per job, and its trigger prevents unrelated events from consuming reserved keys (`src/db.js`, `matrix_stream_delivery_event_keys` and reservation triggers).
- Tests cover collision with a raw client key and the former predictable `delivery-result-${jobId}` pattern (`test-matrix-stream-delivery.js:299-334`).

### I3 — Exact readiness selector: resolved

- Factory construction requires a validated `dkimSelector`.
- The pre-send gate selects only an unexpired passing row for the configured sender domain whose parsed readiness detail has the exact normalized selector (`matrixStreamDelivery.js:236-245,261-280`). Missing, wrong, or malformed selector details fail closed before transport.
- Tests cover missing configured selector, wrong selector, and malformed readiness JSON (`test-matrix-stream-delivery.js:264-291`).

## Reconfirmed boundaries

- First approval and second confirmation remain bound to the current immutable approved version, approval evidence, expected work version, canonical content hash, actor/binding, card/chat identifiers, and request fingerprint.
- Active actor/binding, explicit permission, owner/current/suppression state, provenance/freshness/domain, recomputed quality, identity, cooling/quota, selector-bound readiness, and current country/channel policy are reloaded before transport.
- Transport receives exactly six fields: configured `from`, persisted `to`, persisted `subject`, persisted English plain text, stable Message-ID, and the reviewed version header. No HTML, attachment, retry, callback, or client content is accepted.
- Public send results remain a fixed `state`, `error_class`, and `work_item_version` projection. Message-ID, owner token, event keys, transport diagnostics, and raw errors are not exposed.
- There is still no production sender construction or SMTP-environment access. No server path instantiates `createMatrixStreamDelivery`; without an injected service the endpoint fails closed.

## Verification

- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path, including fixed `503 delivery_in_progress`.
- `node --check src/services/matrixStreamDelivery.js` — PASS.
- `node --check src/routes/matrix.js` — PASS.
- `node --check src/db.js` — PASS.
- `git diff --check 142dda2..711fde0` — PASS.
- Static source scan confirms one injected `transport.sendMail` call and no Task 4 production transport construction or SMTP environment access.

## Non-blocking operational notes

- The intentionally heartbeat-free lease can conservatively produce `ambiguous` when a transport exceeds the configured lease. It does not permit duplicate delivery or a late owner overwrite.
- Ambiguous rows deliberately retain their domain reservation and their original Shanghai-day quota record until a separately authorized reconciliation workflow exists.
- These are documented fail-closed operating choices, not Task 4 Critical/Important defects.

## 蒸馏进度

- 已确认模块：durable sending lease/wait/CAS、跨进程 daily/domain 原子预留、strict transport 分类、内部事件键预留与审计、selector 精确绑定、API 503、accepted-only follow-up、fake-only 边界。
- 未解决模块：生产 transport 受控接线、ambiguous 人工对账与容量释放、lease heartbeat 取舍；均明确留待后续受控阶段。
- 下一优先知识缺口：ambiguous reconciliation 的授权动作、审计字段和容量释放状态机。

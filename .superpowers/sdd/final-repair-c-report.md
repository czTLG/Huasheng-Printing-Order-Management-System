# Final Repair C Report

Base: `64b74dc` (Repair C phase checkpoint: `ae7bb8a`)

## Outcome

- Application sessions persist only a SHA-256 `snapshot_key`, an ordered JSON array of at most five unique positive candidate IDs, approved filters, page/version/context, and timestamps. Existing rows migrate to an empty legacy mapping; no candidate facts or contacts are copied into the application database.
- Authorized current/by-ID session reads enforce active actor binding, owner, expiry, chat, and thread before dynamically rehydrating the ordered summaries from the read-only candidate database. Expired, revoked, cross-owner, cross-context, legacy-empty, and mapping-external requests fail closed.
- Bridge detail and selection are authorized against the persisted candidate mapping. A–E and card callbacks recover after a bridge process restart while the server session remains valid.
- List-dependent filter/page actions read first and patch the mapping/version only after success. Detail, facet, back, and work-item reads no longer consume a session version. Injected timeout and HTTP 500 failures leave the prior button/version usable; retrying that same button succeeds. Selection remains an idempotent write and consumes its authoritative server response.
- SQLite foreign keys are enabled on the application connection and covered by an enforcement test. Binding replacement audit detail records old/new user IDs and statuses; CLI output remains generic and does not expose those identifiers.

## TDD Evidence

- Schema/gate RED initially failed with `no such column: snapshot_key`; migration, strict mapping validation, authorized reads, mapping-bound selection, and FK enforcement then passed.
- Restart recovery RED lacked a client/session hydration path. The extension tests now clear the process-local state implicitly through a fresh registration and prove both letter A/current-session and callback/by-ID recovery return the same candidate.
- Failure-order RED showed filter/page PATCH occurred before candidate reads. The tests inject HTTP 500 and timeout failures, assert no PATCH occurred, and reuse the unchanged callback successfully.
- The integrated fixture initially failed with `candidate not in session mapping`; its idempotency session now supplies a minimized persisted mapping and passes.

## Verification

- Packet gate, protected API, bridge seam, card extension, supervisor, exact artifact, verifier unit, syntax, and diff checks: passed.
- Explicit fixture integrated gate: 2 eligible records, integrity `ok`, mode `600`, all strict gaps zero, one idempotent event, delivery disabled.
- Existing database read-only/query-only gate: 97 eligible records, five recommendations, integrity `ok`, mode `600`, all strict recommendation gaps zero. The 110 ordinary-pool evidence gaps remain aggregate statistics only.
- `npm run verify:smoke`: `SMOKE PASS`.
- No deployment, restart, real credential use, real actor binding, external request, or outbound communication occurred.

## Review Repair — Mapping, Concurrency, and Offset Expiry

- Rehydration no longer compacts missing rows. Every persisted ID must resolve in the same position and return the same numeric ID; a missing, excluded, or suppressed row fails the complete session with HTTP 409. Letter and callback paths convert that conflict into the restart card.
- Every callback freezes its displayed version before the first await. Filter/page PATCH receives that immutable version rather than reading shared mutable session state. A Promise-barrier regression releases two v1 reads independently and observes PATCH versions `[1, 1]`; one commit advances the server to v2 and the other receives the stale conflict and renders restart state.
- Current-session expiry now uses `julianday` with an explicit non-null check. Tests prove an offset timestamp already expired in UTC is rejected, an offset timestamp still in the future is accepted, and an invalid stored timestamp fails closed.
- By-ID, update, selection, and detail authorization now share a strict `activeUntil` rule: both parsed timestamps must be finite and expiry must be later than the current instant. Invalid/NaN expiry therefore fails closed exactly like current-session lookup; API tests cover both session rehydration and candidate-detail authorization against an invalid stored timestamp.
- Current-session lookup also uses that exact JavaScript `activeUntil` predicate rather than SQLite's narrower date parser. It scans the context index newest-first with 100-row keyset pages until it finds an active row or exhausts the context, so any number of newer invalid/expired rows cannot hide an older active session. A regression places 101 such rows ahead of the active session. Legacy RFC2822 future expiry is accepted consistently by by-ID/current/update/selection; invalid, expired, ISO-Z, and ISO-offset cases retain identical semantics.
- The hydration API covers both a missing ID and an existing but excluded ID. It never shifts B into A or returns a partial candidate array.

### 蒸馏进度

- 已确认模块：最小化会话映射、重启恢复、映射授权、read-before-patch、超时/5xx重试、外键约束、绑定替换审计。
- 未解决模块：生产环境真实桌面端/移动端卡片恢复视觉验收（本任务禁止部署与外发）。
- 下一优先知识缺口：取得部署授权后验证真实群聊中重启前后的 A–E 与按钮视觉和候选一致性。

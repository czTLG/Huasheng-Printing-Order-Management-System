# Final Repair D Report

Base: `e0029a4`

## Outcome

- `recommendPage` provides strict audited/current/evidence/discovery/contact pagination with stable page, page size, total, total pages, and snapshot semantics. Initial, filter, and next-page cards all call the same `/recommendations/today` operation; ordinary candidate listing cannot feed A–E cards.
- Zero qualified results normalize the session to an empty snapshot and empty ID mapping, then render a compact no-result card without buttons or weaker fallback rows.
- Authenticated `/api/matrix/ready` requires the service token and active owner binding. It verifies the configured database is query-only, required tables/columns exist, and a strict recommendation query executes, returning no candidate content. Missing/malformed data, generic health responses, inactive binding, or an unusable lazy router fail closed.
- Stale selection callbacks reach persisted server idempotency after process restart. A previously successful event returns its authoritative result with one work item/event; an unseen stale event receives conflict and renders restart state.
- Rehydration constructs summaries from an explicit field allowlist. Contacts, discovery, evidence collections, and excerpts are excluded.

## TDD Evidence

- Strict pagination tests cover two pages, filters, totals, snapshots, empty pages, and a weak ordinary row that never appears as a recommendation.
- Extension mocks make ordinary listing throw if called. Initial/filter/page flows pass using only the strict recommendation client.
- Interactive zero-result coverage begins with a non-empty server hash and proves the extension writes the valid empty mapping and displays the no-result card.
- Restart replay coverage performs success, fresh extension registration, same old callback replay, and unseen stale callback; the work-item count remains one.
- Readiness tests cover authenticated success, missing binding, JWT-only refusal, generic false-green response, malformed schema, and missing candidate database/router 503.

## Verification

- Adapter, packet gate, protected API, bridge patch, extension, runtime supervisor, exact artifact, verifier, syntax, and diff checks passed.
- Explicit fixture integrated gate passed with 2 eligible records, integrity `ok`, mode `600`, all strict gaps zero, one idempotent event, and delivery disabled.
- Existing database query-only gate passed with 97 eligible records, five recommendations, integrity `ok`, mode `600`, and all strict recommendation gaps zero. The 110 ordinary-pool evidence gaps remain aggregate statistics only.
- `npm run verify:smoke` passed.
- No deployment, service restart, real credential use, real binding, candidate-content output, or outbound action occurred.

## Review Repair — Durable Replay and Complete Schema

- Selection replay now occurs through an actor/binding-authorized gate lookup before any mutable candidate lookup. If candidate lookup reports missing, the route checks persisted replay once more to cover the lookup/event race; after a successful lookup, the transactional selector still checks the event first.
- The API regression selects once, changes the candidate to both excluded and suppressed, then proves the same key returns HTTP 200 with the same authoritative work/event while a new key receives 404. Work-item and event counts remain one.
- Readiness declares complete explicit column contracts: 26 `cache_records`, 7 `cache_evidence`, and 7 `cache_discovery` columns used by strict predicates, ranking, summaries, details, hydration, evidence, and discovery.
- A table-driven suite creates 40 empty malformed databases, omitting exactly one required column each time. Every case fails readiness before data-dependent mapping can hide the missing column.

### 蒸馏进度

- 已确认模块：严格推荐分页、空结果、Matrix 就绪门、重启幂等回放、水合字段白名单。
- 未解决模块：生产环境真实桌面端/移动端最终视觉验收（本任务禁止部署与外发）。
- 下一优先知识缺口：取得部署授权后验证真实群聊的分页、空状态和重启回放表现。

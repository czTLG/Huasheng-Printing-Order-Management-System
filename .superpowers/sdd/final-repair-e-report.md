# Final Repair E Report

Base: `4083b5a`

## Outcome

- Strict recommendation eligibility now requires exactly `status = valid` and a positive stage allowlist of `observed` or `recommendation_ready`. Review-needed, unknown, pending, terminal, suppressed, bounced, opted-out, delivered, and every other stage are excluded. Ordinary listing remains broader.
- Paginated recommendations hash the complete ordered strict membership as `[id, updated_at]` plus normalized filters. Page number and page size are excluded, so every page of the same live membership shares one snapshot key.
- Next-page card actions compare the returned key with the persisted session key before PATCH. Membership/order/version drift renders restart state and leaves the version unchanged. Filter changes intentionally accept and persist a new snapshot.

## TDD Evidence

- Adapter fixtures include valid/needs-review statuses, both allowed stages, and representative disallowed workflow/terminal/contact stages.
- Page 1, page 2, and different page sizes share one key. Updating an eligible record version changes the key.
- Extension tests prove stable page transition persists non-overlapping IDs, drift performs zero PATCH calls and renders restart state, and an intentional filter change persists its new key.

## Verification

- Adapter, packet gate, protected API, bridge/extension, runtime supervisor, verifier, exact artifact, syntax, and diff checks passed.
- Explicit fixture integrated gate passed with 1 valid eligible record, one recommendation, integrity `ok`, mode `600`, all strict gaps zero, one idempotent event, and delivery disabled.
- Existing database query-only gate passed with 56 valid/stage-allowed eligible records, five recommendations, integrity `ok`, mode `600`, and all strict recommendation gaps zero. The 110 ordinary-pool evidence gaps remain aggregate statistics only.
- `npm run verify:smoke` passed.
- No deployment, service restart, real credential use, real binding, candidate-content output, or outbound action occurred.

## Review Repair — Atomic Read Snapshot

- Complete membership and paged rows now execute inside one better-sqlite3 deferred read transaction, preserving one SQLite snapshot while remaining compatible with query-only connections.
- A WAL regression commits a new top-ranked valid record from a second connection exactly after membership is read. The in-flight call returns the old membership and old rows consistently; the next independent call sees the new member and a new key.
- An injected failure between the two reads proves the transaction rolls back and the view closes cleanly.

## Signing Review Repair — Selection-Time Strictness

- The cache view exposes a synchronous strict summary/eligibility lookup by ID that directly reuses `RECOMMENDATION_WHERE`.
- Packet-gate construction requires a candidate validator. After persisted replay and before any work/event/session write, unseen selections must pass it; failure leaves all three application states unchanged.
- API regressions mutate a previously displayed candidate through review-needed status, bounced/opted-out/delivered/unknown stages, stale audit, missing official evidence, missing discovery, and missing public contact. Every new key is rejected with unchanged version and one work/event, while the original successful key remains an authoritative replay for every drift.
- Interactive and scheduled cards render `recommendation_ready` as `推荐就绪`.

### 蒸馏进度

- 已确认模块：valid-only推荐、正向阶段白名单、全成员跨页快照、漂移关闭与筛选新快照。
- 未解决模块：生产环境真实桌面端/移动端最终验收（本任务禁止部署）。
- 下一优先知识缺口：部署后确认真实数据变更时旧分页卡的重启提示与操作一致性。

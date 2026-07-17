# Matrix Stream Read-Only Selection Catalog

This catalog records only the code contract and acceptance gate. It contains no copied candidate records, contact values, bridge tokens, application IDs, or chat IDs.

## Runtime contract

- Read-only candidate API: `/api/matrix` exposes facets, candidate summaries/details, daily recommendations, sessions, selections, and owned work items. Candidate reads use `MATRIX_STREAM_DB_PATH` in read-only/query-only mode.
- Actor binding: `node scripts/matrix-bind-actor.js --open-id <id> --username <user> --bound-by <admin>` binds an authorized account; replacement requires the explicit `--replace` flag.
- Feishu entry: exact trimmed `开发客户` returns at most five stable overseas choices labelled A–E without asking a geographic question. `A`–`E`, lowercase letters, and `开发客户 A` open the corresponding detail. If no state exists, the runtime obtains the current strict snapshot and creates a fresh actor+chat+thread session. The scheduled card uses stateless `mx.quick` buttons; the server creates the authoritative A–E mapping before opening detail.
- Durable card state: the application session stores only a SHA-256 snapshot key and at most five ordered candidate IDs. Candidate facts and contacts remain in the read-only source database. After a bridge restart, current-session or by-ID rehydration restores A–E only for the same active actor, chat, thread, unexpired session, and persisted mapping. Every persisted ID must still resolve in the same position; a missing or suppressed row invalidates the whole card with no letter compaction.
- Recoverable actions: candidate/facet/work/list reads complete before any session-version update. A timeout or 5xx therefore leaves the prior card and server version usable for a retry; selection remains an idempotent write and its authoritative response advances the local version.
- Database integrity: the application connection enables SQLite foreign-key enforcement. Binding replacement audit details retain old/new user IDs and statuses, while the command-line result does not print those identifiers.
- Mobile constraint: the full recommendation card is limited to 1,500 Unicode code points, uses no Markdown table, and retains name, reason, category, data status, supplier state, approach angle, verification gap, and next action. Desktop and mobile use wrapping CardKit button rows rather than horizontal tables.
- 来源分离: discovery channel/URL identifies how the company was found; official evidence URLs support product/category claims. Detail views label unconfirmed information as `待核实`.
- Nearby recommendation scope: active A–E recommendations are limited to `JP,KR,VN,TH,MY,ID,PH,MN,RU,KZ,UZ,KG,PK,BD,NP,LK`. Broader non-CN/non-IN records remain visible to administrators for history and audit, but do not enter the daily card.
- Public relationship signals: named supplier relationships are shown only when stored as `confirmed` or `public_lead` with HTTPS source URL, source type, observation time, and excerpt. Missing evidence renders `未知`; it never creates a guessed supplier. Strategy signals retain entry product, differentiation angle, first-contact goal, questions, risks, source URL, and observation time.
- Recommendation truth: ordinary candidate lists remain broad, but daily recommendations require `status=valid`, stage `observed` or `recommendation_ready`, an allowed country, `audit_state=audited`, a current review, at least one non-empty official-website evidence URL, one discovery row, and one public organizational contact route. All unknown, pending, terminal, suppressed, bounced, opted-out, delivered, and review-needed states are excluded. “Current” means both `audited_at` and `updated_at` are parseable and `audited_at >= updated_at`; missing timestamps never imply freshness.
- Recommendation flow: initial choices, advanced-filter results, and every `换一批` page use the same strict paginated recommendation query. Ordinary `/candidates` rows never feed A–E cards. Zero qualified rows create an empty minimized session and a compact no-result card without substituting weaker records.
- Snapshot consistency: every page shares a hash of the complete ordered eligible membership, update versions, and filters. A plain next-page action refuses membership/order/version drift before changing the session version; an intentional filter change starts a new snapshot.
- Presentation truth: API summaries and details expose the real `stage_code`, while cards render its Chinese workflow label. Observed signals with explicit units/dimensions are shown as confirmed specifications; other non-empty observed values are shown as confirmed public signals, not mislabeled as specifications. Only an empty specification set is marked for verification.
- Delivery boundary: `MATRIX_DELIVERY_ENABLED=0` is mandatory. This slice only selects and records candidates; 不存在外发适配器, and it does not send email, WhatsApp, or website requests.
- Reminder safety: local delivery prioritizes at-most-once behavior. A pending reminder is claimed as inflight before the single managed-card attempt; an inflight record without a matching receipt is always treated as ambiguous and requires manual reconciliation. It is never retried automatically, even after the platform idempotency window, so a crash can cause a missed reminder rather than a duplicate.
- Readiness: the runtime probes authenticated `/api/matrix/ready` with the configured service identity. The endpoint verifies active binding, read-only/query-only candidate access, required schema, and execution of the strict recommendation query without returning candidate content. Generic application health cannot satisfy this gate.
- Selection replay: a repeated selection callback reaches persisted server idempotency even after bridge restart; the same event returns its authoritative prior result, while an unseen stale event fails closed.
- Selection-time truth: every unseen selection reuses the exact strict recommendation predicate synchronously before any work item, event, or session-version write. A candidate that became review-needed, disallowed-stage, stale-audit, evidence/discovery-less, or unreachable cannot be newly selected; an already persisted event still replays authoritatively.
- Stage presentation: `recommendation_ready` is rendered as `推荐就绪` in both interactive and scheduled cards.

## Automated acceptance

Run `npm run verify:matrix-readonly-selection`. This deployment gate uses `MATRIX_STREAM_DB_PATH` or the safe default `./data/matrix-stream.db` and will **fail closed** when that file is missing, corrupt, incorrectly permissioned, or incomplete.

Disposable fixture verification is separate and explicit: `MATRIX_VERIFY_FIXTURE=1 npm run verify:matrix-readonly-selection`. Fixture mode cannot be combined with `MATRIX_STREAM_DB_PATH` and is never enabled by the package script itself. It checks:

- SQLite integrity and mode `0600`;
- no duplicate normalized domains or excluded CN/IN rows; ordinary-pool evidence/discovery gaps are reported as statistics, while recommendation-eligible rows must have current audit, official evidence, discovery, and a public organizational contact route;
- the adapter's real oversized `recommend` request still returns no more than five recommendations;
- delivery disabled and no outbound adapter capability in the Matrix slice;
- one event after the same idempotent selection is submitted twice; A–E only opens detail, while `确认选择` performs the idempotent write;
- recommendation geography contains only the 16 approved nearby country codes, and every named supplier row has complete public provenance;
- focused tests for the adapter, packet gate, API, bridge seam, and card extension.

## Controlled deployment gate

The candidate database must have SQLite integrity `ok`, filesystem mode `0600`, the optional signal tables, zero provenance gaps, and `MATRIX_DELIVERY_ENABLED=0`. Build an immutable release directory and image, preserve hostname `vm-debug-ci`, and keep the stopped prior container as `vm_debug_ci_pre_<commit>` until acceptance completes. A failed health, authenticated readiness, bridge credential, or WebSocket check must restore the preserved container.

Real Feishu acceptance uses the authorized bound account and must cover:

- 桌面端: `开发客户`, `A`, `a`, `开发客户 A`, `mx.quick` button/detail parity, advanced overseas filters, distinct discovery/evidence links, idempotent confirmation, and current work items;
- 移动端: the same choices/actions without horizontal scrolling, including two-row A–E buttons and detail sections;
- confirmation that no email, WhatsApp, or website request was generated.

The automated verifier performs no real actor binding, real message, production-database selection, or external delivery. Its duplicate-selection check exists only in a disposable temporary application database. Deployment and real Feishu actions remain separately auditable operational steps.

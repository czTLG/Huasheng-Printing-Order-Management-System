# Matrix Stream Read-Only Selection Catalog

This catalog records only the code contract and acceptance gate. It contains no copied candidate records, contact values, bridge tokens, application IDs, or chat IDs.

## Runtime contract

- Read-only candidate API: `/api/matrix` exposes facets, candidate summaries/details, daily recommendations, sessions, selections, and owned work items. Candidate reads use `MATRIX_STREAM_DB_PATH` in read-only/query-only mode.
- Actor binding: `node scripts/matrix-bind-actor.js --open-id <id> --username <user> --bound-by <admin>` binds an authorized account; replacement requires the explicit `--replace` flag.
- Feishu entry: exact trimmed `开发客户` returns at most five stable overseas choices labelled A–E without asking a geographic question. A–E replies and card buttons are session/version bound.
- Mobile constraint: the full recommendation card is limited to 1,500 Unicode code points, uses no Markdown table, and retains name, reason, category, data status, verification gap, and next action.
- 来源分离: discovery channel/URL identifies how the company was found; official evidence URLs support product/category claims. Detail views label unconfirmed information as `待核实`.
- Delivery boundary: `MATRIX_DELIVERY_ENABLED=0` is mandatory. This slice only selects and records candidates; 不存在外发适配器, and it does not send email, WhatsApp, or website requests.

## Automated acceptance

Run `npm run verify:matrix-readonly-selection`. The verifier uses a repeatable temporary fixture unless `MATRIX_STREAM_DB_PATH` explicitly points to a read-only candidate database. It checks:

- SQLite integrity and mode `0600`;
- no duplicate normalized domains, excluded CN/IN rows, or eligible records missing evidence/discovery;
- no more than five recommendations;
- delivery disabled and no outbound adapter capability in the Matrix slice;
- one event after the same idempotent selection is submitted twice;
- focused tests for the adapter, packet gate, API, bridge seam, and card extension.

## Deployment gate

Deployment/restart is not authorized by this task. Step 5 remains **等待明确部署授权**. Only after separate authorization may an operator build/up the Compose service, inspect its status, and confirm exactly one bridge consumer with delivery disabled.

Real Feishu acceptance is also deferred. Step 6 remains **等待明确部署授权** and an authorized bound test account. The checklist must cover:

- 桌面端: `开发客户`, A–E reply/detail parity, advanced overseas filters, distinct discovery/evidence links, idempotent selection, and current work items;
- 移动端: the same choices/actions without horizontal scrolling;
- confirmation that no email, WhatsApp, or website request was generated.

No deployment, restart, real actor binding, real message, production-database selection, or external delivery is performed by the automated verifier. Its duplicate-selection check exists only in a disposable temporary application database.

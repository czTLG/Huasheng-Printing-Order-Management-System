# Task 7 Independent Review — Production-Surface Gate and Full Regression

## Review scope

- Fixed range: `b08741d..378be63`
- Inputs reviewed: Task 7 plan, `.superpowers/sdd/task-7-report.md`, `.superpowers/sdd/review-task-7.diff`, all changed source/tests, and the production files named by the runtime manifest.
- Review was read-only apart from this report. No implementation, deployment, restart, enablement, or external delivery was performed.

## Verdict

**APPROVED**

Task 7 conforms to the plan. I found no Critical or Important defect in the fixed range.

## Spec compliance

- The runtime roots enumerate the pre-existing bot/application gate plus all seven required services exactly once: review, text, gate, readiness, follow-up, delivery, and correlation. Recursive directory enumeration and exact set comparison reject both missing and unexpected files; the manifest contains 20 unique entries and matches the 20 files currently enumerated.
- `validateRuntimeManifest()` recalculates SHA-256 from each actual file. The current manifest set and every recorded digest validate successfully, including the delivery digest `dc27f55dcc73093c50d7f6fbf28a5a1b17f20378d9e24065aa706b71d15653ea`.
- The only transport-capable exception is the exact digest-bound `src/services/matrixStreamDelivery.js`. It requires explicit `matrixSend`, a current approved persisted version, exact expected/stored/canonical content-hash equality, active HTTPS recipient provenance (`recipient_source_url` and matching snapshot/domain), one injected `transport.sendMail()` call, persisted recipient/subject/body, no attachments, and fail-closed `ambiguous` handling for unknown/expired outcomes.
- Runtime input uses an exact allowlist. Caller transport/content fields are rejected before delivery: `to`/recipient, subject, body, `smtpHost`, callback URL, attachment, retry, and any other unknown key. Static mutation tests additionally reject `input.to`, `input.subject`, `input.smtpHost`, callback, and automatic retry source changes. The exact source digest means alternate notation or a capability-pattern spelling bypass cannot approve a modified delivery source.
- Bot client, card extension, and watcher remain outbound-free. Synthetic `sendMail()` additions to each are rejected. The approved client/supervisor exceptions are also digest-bound; arbitrary network, process, unsafe-evaluation, and external-URL mutations are rejected.
- `.env.example` contains all required safe names and defaults, with `MATRIX_STREAM_SEND_ENABLED=0` and empty SMTP credentials. `src/server.js` does not construct/inject `createMatrixStreamDelivery`; therefore the Task 7 production route refuses send confirmation regardless of injected-test behavior. Conditional production wiring remains correctly deferred to Task 8.
- The catalog accurately distinguishes the outbound-free bot surface from the digest-bound, dependency-injected management source, records the disabled rollout boundary, and describes verifier output as `delivery_enabled: false`.
- The verifier reports the literal boolean `delivery_enabled: false` after asserting the legacy bot-delivery gate is `0`, validating the server remains unwired, validating the signed runtime surface, and finding no unreviewed outbound adapter.

## Code quality and gate assessment

- The capability rules are intentionally conservative and can produce false positives for unapproved source text, but that fails closed. Approved capability sources additionally require exact SHA-256 equality, so the string rules do not create a practical bypass in this revision.
- Manifest membership is maintained explicitly, but recursive enumeration of the declared directories and exact set equality prevents hidden additions within those roots. Tests cover missing, unexpected, and digest-changed manifest cases.
- The Task 7 delivery edits strengthen the pre-send hash gate and correct expired-lease persistence so the database explicitly writes `ambiguous`; the delivery concurrency/regression suite passes.

## Findings

### Critical

None.

### Important

None.

### Verification gaps / operational notes

- `npm run lint` and `npm run build` cannot be executed because `package.json` defines neither script; the repository also has no declared lint/build dev dependency or matching ESLint/TypeScript/Vite/Webpack/Rollup/esbuild configuration. This is an existing repository tooling gap, not a Task 7 regression.
- Actual available substitutes passed: `node --check` on all three changed JavaScript files, `git diff --check b08741d..378be63`, the planned focused suites, and the configured-database end-to-end verifier.
- The first sandbox run of `scripts/test-matrix-api.js` could not bind `0.0.0.0` (`EPERM`); the same test passed on the approved localhost-capable path. One bridge-artifact run passed its assertions but encountered a transient `/tmp` cleanup `ENOTEMPTY`; an immediate isolated rerun passed cleanly.

## Independent verification evidence

- `node scripts/test-verify-matrix-readonly-selection.js` — PASS.
- Review, gates, policy, delivery, correlation, admin-access, card-extension, bridge-patch, and bridge-artifact suites — PASS.
- `node scripts/test-matrix-api.js` on the approved localhost-capable path — PASS.
- `MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection` — PASS: 26 eligible records, 5 recommendations, manifest/capability and all embedded focused suites passed, one idempotent selection event, and `delivery_enabled: false`.
- `node --check` for `scripts/verify-matrix-readonly-selection.js`, `scripts/test-verify-matrix-readonly-selection.js`, and `src/services/matrixStreamDelivery.js` — PASS.
- `git diff --check b08741d..378be63` — PASS.

## 蒸馏进度

- 已确认模块：Task 7 完整 runtime 集合/摘要绑定、delivery 能力边界、bot outbound-free、恶意输入拒绝、safe env/catalog、configured read-only verifier。
- 未解决模块：仓库级 lint/build 工具链缺失；Task 8 受控 wiring、显式启用、真实单次验收与回滚证据。
- 下一优先知识缺口：Task 8 如何在不扩大 transport 权限面的前提下，把精确 `MATRIX_STREAM_SEND_ENABLED=1` 门禁与可回滚的生产 wiring 一起留证。

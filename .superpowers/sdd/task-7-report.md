# Task 7 Report — Production-Surface Gate and Full Regression

## Status

IMPLEMENTED; repository lint/build commands unavailable

## Scope implemented

- Expanded the single reviewed runtime manifest to include the complete review, text, gate, readiness, follow-up, delivery, and correlation service surface.
- Re-signed the changed runtime inventory together and bound the sole reviewed main-application delivery capability to its exact source digest.
- Kept the bot client, card extension, and watcher outbound-free. Synthetic transport additions to each surface are rejected by the verifier.
- Restricted delivery approval to the persisted recipient, subject, body, source URL, exact content hash, explicit `matrixSend` capability, one injected `sendMail` call, and fail-closed ambiguous state. Caller recipient, subject, SMTP host, callback URL, retry, attachments, direct SMTP construction, and other network/process capabilities are rejected.
- Documented only safe environment names/defaults. `MATRIX_STREAM_SEND_ENABLED=0` remains the default, SMTP values are empty, and production does not construct or inject a delivery service in this gate.
- Updated the runtime catalog to distinguish the outbound-free bot surface from the digest-bound, dependency-injected management service.

## TDD evidence

1. RED: `node scripts/test-verify-matrix-readonly-selection.js` failed because `approvedCapabilitySource('delivery', source)` returned false.
2. GREEN: the digest-bound delivery capability branch and unified runtime manifest made the reviewed source pass.
3. Mutation coverage rejects caller-controlled `input.to`, `input.subject`, `input.smtpHost`, callback URL, automatic retry, and unreviewed `nodemailer` construction.
4. Bot-surface mutation coverage rejects a `sendMail` addition to the client, extension, or watcher.
5. Safe environment/catalog assertions failed before the documented defaults were added and pass afterward.

## Final verification

- `node scripts/test-verify-matrix-readonly-selection.js` — PASS.
- Review, gate, policy, delivery, correlation, admin-access, card-extension, bridge-patch, and bridge-artifact focused suites — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path; the initial sandbox-only run was blocked from binding `0.0.0.0:21002` with `EPERM`.
- Configured read-only database verifier — PASS with 26 eligible rows, five recommendations, one idempotent selection event, and `delivery_enabled: false`.
- Runtime verifier focused suites — all PASS, including manifest/capability, API, bridge, card, and supervisor checks.
- `node --check` for the changed verifier files and `git diff --check` — PASS.
- `npm run lint` — unavailable: `package.json` defines no `lint` script.
- `npm run build` — unavailable: `package.json` defines no `build` script.

## Boundaries

- No deployment, restart, external send, real transport construction, or enable-flag change was performed.
- Tests use injected fakes and do not require or read SMTP credentials.
- Production remains fail-closed because `src/server.js` does not inject the delivery service while the safe flag is disabled.
- Task 8 retains responsibility for controlled production wiring, explicit enablement, real acceptance, rollback evidence, and any reply-window observation.

## 蒸馏进度

- 已确认模块：统一 runtime manifest、digest-bound delivery capability、bot outbound-free 审计、五类 caller-controlled mutation 拒绝、safe env catalog、configured read-only acceptance。
- 未解决模块：仓库缺少 lint/build npm scripts；Task 8 controlled wiring、显式启用、真实单次验收与回滚记录尚未执行。
- 下一优先知识缺口：Task 8 在不扩大 transport 权限面的前提下，如何完成受控 wiring、单次验收和可核验回滚。

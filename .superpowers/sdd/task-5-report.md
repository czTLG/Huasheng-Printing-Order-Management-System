# Task 5 Report — Inbound Correlation and Notification Queue

## Status

DONE

## Commit

- `45b80cb` (`feat: correlate matrix stream replies`)
- `189d195` (`fix: harden matrix stream reply delivery`)
- `b724076` (`fix: make matrix relay crash safe`)
- `6efea7f` (`fix: preserve matrix notification generations`)

## Scope implemented

- Added deterministic inbound correlation with unique `In-Reply-To` precedence over `References`, then a 120-day unique normalized sender-recipient-subject fallback.
- Persisted sender address on new delivery jobs so fallback correlation is an exact contact-pair match.
- Added durable inbound dedupe links and a narrow notification spool containing identifiers, bounded centrally redacted previews, translation state, and review-draft fields only. Full inbound text remains linked to its authoritative email row.
- Added monotonic terminal transitions for reply, bounce, refusal, unsubscribe, and manual stop. Later lower-priority events append evidence without rolling state back; the originating reply check closes exactly once.
- Added provider-unavailable `pending` behavior with no guessed translation and an actor-bound manual retry endpoint.
- Added durable `draft_pending` creation. Pending translation cannot create a draft; ready notifications create one idempotent CRM reply draft and never create or invoke a delivery job.
- Hooked correlation after durable IMAP upsert. Correlation errors return a fixed diagnostic, increment sync diagnostics, and do not roll back the imported email.
- Added a durable `pending -> inflight -> delivered/manual_review` notification delivery state machine with owner token, lease, attempt count, receipt, explicit-failure retry, and ambiguous/crash fail-closed handling.
- Wired the watcher and card extension to claim, queue, deliver, acknowledge, and negatively acknowledge reply cards using a stable persisted notification key.
- Serialized the single-slot watcher with a private O_EXCL lock before API claim and hard-link no-replace publication. Live locks cannot be scavenged; stale/dead locks and private temporary files are cleaned.
- Made status/ack/nack replay-safe with persisted finalization tokens, lease-aware transactional CAS, startup reconciliation, and pre-send current-state validation. Unknown DB outcomes retain the recovery file.
- Successful pending-translation retry atomically requeues exactly one ready-card revision. Higher-priority terminal transitions atomically retire pending/inflight reply cards.
- Notification retries now append immutable generations: the pending-card row retains its delivery identity and finalization history, while one idempotent ready generation references it through `supersedes_notification_id`.
- Stale lock ownership binds boot ID, PID, and `/proc/<pid>/stat` start time; PID reuse and reboot mismatches are recoverable without stealing a live lock.
- Added ready/pending reply cards, `View reply draft`, and `Retry translation` callbacks. Only genuine authored replies enter translation/draft/notification paths.

## TDD evidence

1. Correlation RED: `MODULE_NOT_FOUND` for `matrixStreamCorrelation`; GREEN after schema/service implementation.
2. IMAP durability RED: missing `importAndCorrelateEmailMessage`; GREEN with committed-row observation and safe non-rollback diagnostics.
3. Card RED: missing `replyNotificationCard`; GREEN with ready/pending fields and draft-only action.
4. Draft persistence RED: missing `startReplyDraft`; GREEN with idempotent `draft_pending` persistence and zero delivery-job mutation.
5. API RED: `404 Cannot POST /api/matrix/notifications/41/reply-draft`; GREEN with empty-body, actor-bound fixed projection.
6. Retry RED: missing `retryInboundTranslation` / client method; GREEN with pending-preserving failure and validated ready update.
7. Pending-draft RED: pending translation incorrectly allowed an empty draft; GREEN after fail-closed service guard and retry-only pending card.
8. Durable delivery RED: claim/ack/nack functions and watcher delivery were absent; GREEN with exclusive claims, token/lease checks, receipts, bounded explicit retries, and ambiguous/manual-review recovery.
9. Header precedence RED: a unique direct reply was polluted by unrelated `References`; GREEN after strict direct-header precedence.
10. Terminal monotonicity RED: unsubscribe after reply conflicted with the already-closed check and late replies could enqueue cards; GREEN after state priority and exactly-once closure.
11. Authored-text classification RED: quoted unsubscribe history was classified as unsubscribe; GREEN after quoted-history/signature/footer stripping.
12. Retry authority RED: retry translated the bounded preview; GREEN after durable email-row linkage, full-text retrieval, and post-provider actor/binding reauthorization.
13. Event-key collision RED: predictable keys collided with external events; GREEN after reserved UUID-backed internal keys.
14. Redaction RED: multi-word secrets, auth headers, URL credentials, token queries, and PEM keys leaked; GREEN with the centralized sanitizer.
15. Relay race RED: two overlapping watchers both claimed and one overwrote the relay slot; GREEN with lock-before-claim and no-replace publication.
16. Recovery RED: an acked inflight file replay attempted nack and wedged; GREEN with status reconciliation and replay-stable finalize results.
17. Lease RED: expired tokens could still finalize delivered; GREEN with same-transaction expiry-to-manual-review and cross-connection scavenger replay.
18. Retry-ready RED: a delivered pending card became ready but stayed delivered; GREEN with idempotent ready revision requeue.
19. Terminal-card RED: unsubscribe left an old pending reply card claimable; GREEN with transactional retirement and pre-send validation.
20. Private-text RED: inline credentials and private formula/cost lines persisted; GREEN with whole-line centralized redaction and direct spool assertions.
21. Retry/finalize race RED: retry reset the old inflight token and made its recovery file unreconcilable; GREEN with a separate immutable ready generation.
22. Retry interleavings: ack-before-retry, retry-before-ack, response-loss replay, and two-connection concurrent retry all produce exactly one ready generation while preserving old-token ack/status behavior.
23. PID reuse RED: an old lock with a reused live PID remained busy forever; GREEN with boot ID plus process-start identity matching and malformed-lock recovery.

## Final verification

- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the approved localhost-capable path.
- `node scripts/test-matrix-record-import.js` and `node scripts/test-matrix-signal-import.js` — PASS.
- `node scripts/smoke-test.js` — `SMOKE PASS`.
- `node --check` on all changed JavaScript production/test files — PASS.
- IMAP verifier with all mailbox variables explicitly unset — expected configuration-incomplete exit; test database SHA-256 remained unchanged before/after.
- Task5 scoped static scans — PASS: no correlation send/network capability, no correlation env/credential access, no real IMAP client use in tests, empty-body reply actions, and no excluded copy fields.
- `git diff --check` — PASS.

## Deferred boundary

- `test-verify-matrix-readonly-selection.js` correctly reports the newly reviewed client capability as absent from the old signed selection. Task5 does not re-sign the manifest; Task7 must audit the complete runtime set and rebuild the manifest/capability hashes together.
- Existing accepted jobs created before `sender_email` was introduced have an empty sender address and therefore cannot use the fallback contact-pair path. Exact Message-ID correlation remains available for them.

## Boundaries

- No real IMAP connection, credential read, provider network call, or message delivery occurred in tests.
- Ambiguous correlation writes one review event/link only and performs zero work-item mutation.
- Spool data excludes source snapshots, credentials, internal formulas, and raw provider/server errors.
- Translation retry and reply-draft endpoints accept no caller-provided text, recipient, transport field, callback, attachment, or send flag.

## 蒸馏进度

- 已确认模块：header precedence/fallback correlation、message-id dedupe、单调 terminal state、reply-check exactly-once closure、lock-before-claim/no-replace relay、boot+pid+starttime lock identity、lease-aware replay-safe claim/status/ack/nack、crash reconcile、immutable notification generation、四类 retry/finalize 时序、terminal card retirement、集中整行脱敏、authoritative-text retry、actor/binding 二次授权、IMAP post-commit hook、draft_pending/API no-send 边界。
- 未解决模块：Task7 完整 runtime manifest 审计与重签；历史 accepted job 的空 sender address 仅能走 exact correlation。
- 下一优先知识缺口：Task7 runtime capability 总审计与 selection manifest 重签。

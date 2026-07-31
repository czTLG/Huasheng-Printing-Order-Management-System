# Task 5 Independent Review — Inbound Correlation and Notification Queue

## Verdict

- **Spec: FAIL / changes required**
- **Quality: FAIL / changes required**
- **Critical:** 0
- **Important:** 5 Spec, 3 Quality
- Reviewed range: `711fde0..45b80cb`
- Known baseline excluded as instructed: the stale global runtime manifest was not treated as a Task 5 finding and was not re-signed.

The focused tests are green, but the end-to-end Task 5 outcome is not implemented: durable notification rows have no discoverable, claimable path to the watcher. Several correlation and terminal-state edge cases can also produce the wrong durable result.

## Findings

### Spec — Important

#### S1. Durable notification rows are never discoverable or delivered by the watcher

`matrix_stream_notification_spool` is written with `delivery_state='pending'` (`src/services/matrixStreamCorrelation.js:212-230`), but there is no API to list/claim/ack those rows and no service method that transitions `pending -> claimed -> delivered`. The only notification routes are actor actions on a notification ID (`src/routes/matrix.js:633-672`). The watcher merely exports `replyNotificationCard`; its main loop only calls `today()` and queues the pre-existing daily reminder file (`.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js:227-265`). The extension likewise polls only `/workspace/store/matrix-reminder-pending.json`, not the database notification spool (`.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs:298-319`).

Consequences:

- A real matched reply remains permanently `pending` and no reply card is emitted.
- `claimed` and `delivered` are dead schema states.
- There is no owner/lease/claim token, delivery event key, receipt binding, crash recovery, or repeated-notification protection for reply notifications.
- The card test calls `replyNotificationCard()` directly, so it cannot detect the missing production connection.

This fails Task 5 Step 5 and the durable notification-queue interface.

#### S2. `In-Reply-To` does not take precedence over `References`

`exactCandidates()` flattens every ID from both headers into one SQL `IN` set (`src/services/matrixStreamCorrelation.js:93-106`). A normal threaded reply can have one direct parent in `In-Reply-To` and older messages in `References`. If two of those IDs belong to accepted jobs, the direct parent is discarded as an exact answer and the result becomes `needs_review` (`:167-181`).

Required behavior is ordered matching: resolve a unique valid `In-Reply-To` first; only when it has no match should parsed `References` be considered according to an explicit deterministic order. Add coverage where `In-Reply-To` matches one accepted job while `References` contains that job plus another accepted job.

#### S3. A later terminal event can be rejected after an earlier terminal reason closed the reply check

Every matched inbound event calls `closeReplyCheck()` before updating the work item (`src/services/matrixStreamCorrelation.js:190-198`). `closeReplyCheck()` throws when the task is already closed with a different reason (`src/services/matrixStreamFollowup.js:88-92`). Thus a reply followed by an unsubscribe/manual stop, or another valid terminal transition with a different reason, rolls back correlation and never applies the more protective state. The IMAP row remains durable, but the work item is left in the old state and each replay repeats the error.

Closing the active check must be idempotent without preventing accurate later terminal state handling. In particular, unsubscribe/manual stop must still suppress an item after a prior reply/refusal.

#### S4. Refusal is incorrectly placed on the reply-draft path

The implementation translates and spools both `reply` and `refusal` (`src/services/matrixStreamCorrelation.js:186-188,212-230`). `startReplyDraft()` does not require `n.kind='reply'` or a reply-compatible work state (`:249-286`), so a refusal notification can create a suggested reply draft and change the work-item stage to `draft_pending`. The test explicitly cements this behavior by expecting one spool row for refusal.

The plan assigns spool/draft handling to a unique reply and defines refusal as an exact terminal condition. Refusal may warrant a terminal notification, but it must not expose `View reply draft` or reopen the item into the reply drafting flow without a separately specified, explicitly authorized action.

#### S5. Automatic terminal classification is not bounded against quoted history/footer text

`classifyKind()` searches the whole cleaned body for unsubscribe/refusal phrases (`src/services/matrixStreamCorrelation.js:65-73`). `cleanMessageText()` removes `>` lines and a narrow `On ... wrote:` line only (`src/lib/imapSync.js:116-122`); common Outlook-style `From:/Sent:/Subject:` history and unquoted prior-message footers remain. A positive reply that quotes an earlier opt-out footer can therefore be classified as `unsubscribe` and durably suppressed.

Terminal classification needs structured DSN/list headers where available and bounded current-message extraction. At minimum add fixtures for Outlook-style quoted history and an outbound opt-out footer to prove a positive reply is not suppressed.

### Quality — Important

#### Q1. `safePreview()` does not provide the claimed sensitive-data boundary

The redactor handles only a single non-whitespace token after a small key list and uses `$1` despite having no capture group (`src/services/matrixStreamCorrelation.js:76-82`). Fresh reproduction against this commit produced:

```text
password = very secret       -> $1=[redacted] secret
Authorization: Bearer token  -> Authorization: Bearer token
smtp://user:pass@host        -> smtp://user:pass@host
```

This can persist credentials in the notification spool. The test only checks that the serialized row does not contain the literal words `password` or `source_snapshot`, which misses retained secret values. Use a reviewed structured redaction policy, retain the field label correctly, cover multi-word values/Bearer/basic auth/credential URLs, and test that the secret value itself is absent.

#### Q2. Manual translation retry uses the truncated preview, not the durable inbound message

Initial translation consumes the full cleaned inbound text, but failure stores only an 800-code-point preview. Retry then calls the provider with `row.original_preview` (`src/services/matrixStreamCorrelation.js:319`). A long inbound message can therefore retry successfully against incomplete content, yielding incomplete translation, requirements, and suggested reply while being marked `ready`.

The durable `email_messages` row already exists before correlation. Retry should reload the actor-authorized message text through an immutable link to that row (or another bounded durable source), re-run the exact Task 2 validation, and fail pending if the authoritative source is unavailable. Active actor authorization should also be rechecked in the commit transaction after the provider await; the current commit rechecks ownership but not active user status (`:323-350`).

#### Q3. Predictable notification event keys can collide with global client-controlled idempotency keys

`matrix_stream_events.idempotency_key` is globally unique. Draft and retry use predictable values `reply-draft-notification-${id}` and `inbound-translation-ready-${id}` (`src/services/matrixStreamCorrelation.js:287-296,343-350`). Earlier review/version operations write caller-supplied idempotency keys into the same table. A pre-existing equal key causes the entire draft or translation-ready transaction to roll back, even though it is unrelated.

Task 4 already introduced reserved internal delivery event keys to avoid this class of collision. Task 5 needs an equivalent namespace/reservation boundary or a scoped uniqueness model, plus collision regression tests.

## Confirmed behavior

- Same inbound Message-ID is mutation-idempotent because the inbound-link primary key is rechecked inside the immediate transaction. Concurrent callers can still duplicate the provider call, but only one link/event/spool mutation commits.
- Fallback requires one parsed sender, the persisted original sender among To/CC, normalized subject equality, accepted job state, and a 120-day timestamp window. Legacy accepted jobs with empty `sender_email` correctly fail closed on fallback and retain exact-header matching only.
- Ambiguous fallback changes no `matrix_work_items` row and creates no notification spool row; it writes only the review event and inbound link.
- Translation output is checked for the exact five keys and non-empty fields. Provider/validation failure remains `pending` with empty translated/suggested fields; no raw provider error is persisted.
- Actor/owner binding and empty-body API projections prevent caller-supplied recipient/body/send fields. Ready draft creation is transactional, idempotent by `reply_draft_id`, creates no delivery job, and the card action contains no send call.
- IMAP upsert completes before the correlation hook is awaited. Correlation failure returns a fixed diagnostic, increments sync errors, and does not remove the imported message.
- The additive `sender_email` migration is compatible with old jobs by using a non-null empty default. New Task 5 tables are created during normal initialization.

## Verification evidence

- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS when rerun with localhost binding permission; the sandboxed attempt failed only with `listen EPERM`.
- IMAP verifier with mailbox variables unset — expected configuration-incomplete exit and no live connection.
- Static route/watcher scan — no notification list/claim/ack route or reply-spool polling call exists.
- Direct `safePreview()` probes reproduced the credential leaks shown above.

## Required repair order

1. Implement and test the durable notification claim/delivery/receipt state machine and wire it to the watcher.
2. Correct exact-header precedence and terminal-transition behavior, including later unsubscribe/manual stop.
3. Separate refusal terminal notification from reply drafting.
4. Replace preview redaction and make manual retry use authoritative durable inbound content.
5. Isolate internal event keys and add concurrency/collision regressions.

## 蒸馏进度

- 已确认模块：Message-ID mutation dedupe、唯一 fallback 基本约束、ambiguous 零 work-item mutation、exact-shape translation pending、IMAP post-upsert failure isolation、actor-bound draft/no-send、旧 job additive migration。
- 未解决模块：notification spool 真实领取/送达/回执、header precedence、跨 terminal reason 状态演进、refusal 与 draft 边界、完整脱敏、authoritative retry source、内部 event-key 隔离。
- 下一优先知识缺口：reply notification 的 lease/receipt/幂等事件模型以及 watcher 端崩溃恢复语义。

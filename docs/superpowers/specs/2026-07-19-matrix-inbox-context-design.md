# Matrix Inbox and Context Router Design

**Date:** 2026-07-19  
**Status:** Pending written-spec review  
**Scope:** Reliable inbound mailbox observation, protected attachment handling, internal Feishu notification, and deterministic short-choice routing.

## 1. Goals

The system must continuously observe the existing `sales@gdhspack.com` mailbox, including weekends, and must not depend on a person opening the CRM page. A newly received reply must be durably imported before analysis, associated with the best available existing record, and announced in the `build` Feishu project. Image attachments must be visible in Feishu rather than represented only by filenames.

The bot must also stop treating every standalone `A` through `E` as a candidate shortcut. Quoted-message context and explicit command scope must determine which option set receives a short answer. Ambiguous input must not execute a business action.

Outbound messages remain separately reviewed. Inbox synchronization and notification do not authorize an external reply.

## 2. Confirmed Production Findings

- The production application has protected SMTP variables but no active `ALIYUN_MAIL_*` IMAP variables.
- The database's latest mailbox synchronization completed on 2026-06-25; there is no recurring inbox synchronization job.
- `src/lib/imapSync.js` records attachment filename, MIME type, and size, but discards attachment bytes.
- Reply correlation, translation, suggested-reply notification, and notification spooling exist in prior design material but not in the production service implementation.
- The bridge already supplies `msg.replyToMessageId` and `msg.threadId`.
- The candidate extension currently intercepts every standalone `A` through `E` before the normal conversation handler and restores the latest candidate session by chat, thread, and sender. It does not inspect `replyToMessageId`.
- The observed `build` incident contained a standalone `A` after a non-candidate option card; the message had no parent/root binding and was incorrectly consumed by the candidate extension.

## 3. Architecture

The feature is split into four bounded components:

1. **Inbox observer** in the main application: connects to IMAP, imports messages and attachments, correlates replies, and creates durable notification jobs.
2. **Protected attachment store** outside Git: stores bounded, non-executable attachment bytes with hashes and restrictive permissions.
3. **Notification relay** in the existing bot container: reads pending jobs and attachment files through read-only mounts, sends cards/images/files to the exact `build` project, and records idempotent receipts in its writable private store.
4. **Context router** in the existing card extension: handles candidate shortcuts only when an exact candidate context is proven; all other short answers continue to the normal conversation handler.

The main application never receives the Feishu application secret. The bot container never receives SMTP or IMAP credentials. The database remains the durable handoff boundary.

## 4. Inbox Configuration and Schedule

The inbox observer reuses the protected credentials already loaded into `packaging-system.service`. It does not copy or print the password.

Configuration precedence is:

1. Explicit `ALIYUN_MAIL_USER` and `ALIYUN_MAIL_PASSWORD`, when already supplied by protected configuration.
2. Otherwise, the existing in-process `SMTP_USER` and `SMTP_PASS`, only after the configured IMAP endpoint is verified to belong to the same mailbox provider.

The IMAP host, port, and TLS mode are non-secret deployment settings. No Outlook or Gmail setup is introduced. Logs and health responses expose only configuration booleans, a masked mailbox, run identifiers, counts, and classified errors.

The application schedules an incremental inbox poll every five minutes in `Asia/Shanghai`, seven days a week. A guarded startup catch-up runs after the database is initialized. A database lease prevents overlapping runs across restarts or duplicate application processes.

Before recurring polling is enabled, production verification must prove TLS connection, authentication, `INBOX` access, and a zero-write configuration check. If verification fails, the scheduler stays disabled and an internal operational error is raised without exposing credentials.

## 5. Durable Import and Backfill

Mailbox import remains idempotent using provider Message-ID first and mailbox/folder/UID second. An inbound message is committed before correlation or translation begins.

Initial rollout performs a 90-day `INBOX` backfill with bounded pages. Existing messages are updated but are not re-announced unless they have never received a notification receipt. Historical outbound/sent synchronization is used for correlation but does not create inbound alerts.

Each synchronization run records whether it was `startup`, `scheduled`, `manual`, or `backfill`, together with scanned, inserted, updated, skipped, and failed counts. A single malformed message cannot abort the rest of the mailbox run.

## 6. Attachment Handling

Attachment bytes are stored under a neutral private runtime directory, outside Git, with directory mode `0700` and file mode `0600`. Database records contain a generated storage key, sanitized original filename, detected MIME type, byte size, SHA-256 digest, and availability state. Paths are canonicalized and must stay below the configured attachment root.

Limits are enforced before writing:

- maximum 20 attachments per message;
- maximum 20 MiB per individual attachment;
- maximum 60 MiB total per message;
- no archive extraction, macro execution, HTML execution, or server-side rendering of untrusted files;
- MIME detection is checked against the declared type;
- unsupported or oversized files are recorded as quarantined metadata and still produce an alert.

Images supported by Feishu are uploaded with the official image API and sent in the same message thread as the notification card. Other allowed files are uploaded with the official file API. Upload receipts, not temporary access tokens, are persisted. The private source file is mounted read-only into the bot container.

## 7. Reply Correlation and Internal Analysis

Correlation order is deterministic:

1. Exact `In-Reply-To` or `References` match to a recorded outbound Message-ID.
2. Exact conversation key plus contact address.
3. Unique normalized subject/contact match within 120 days.
4. Otherwise mark `needs_review`; never guess between multiple records.

The durable notification job contains record identifiers, the original safe text preview, attachment metadata, and correlation outcome. Internal analysis may add:

- Chinese translation or summary;
- newly stated product/specification requirements;
- differences from the prior conversation;
- suggested next action;
- a proposed Chinese reply and English reply.

Analysis failure must not delay the initial alert. The first card is sent with `分析处理中` or `分析暂不可用`, and analysis can be retried. Uncertain extracted values are labeled `待核实` and are not written as confirmed facts.

## 8. Feishu Notification Workflow

All inbound customer replies, attachment alerts, and reply-review tasks route to the exact `build` project resolved from the bot registry. They must never fall back to `vm_debug_ci` or a shared chat variable.

The initial card includes:

- company/customer display name and country when known;
- sender, subject, and received time;
- original preview and Chinese summary/translation status;
- matched record and current stage;
- attachment count and attachment warnings;
- extracted changes and next-action recommendation;
- buttons for `查看完整内容`, `生成建议回复`, and `标记已处理`.

Images follow the card in its thread. A bounded retry queue handles Feishu rate limits and transient failures. A notification key derived from the inbound Message-ID makes delivery idempotent. Ambiguous delivery is stopped for reconciliation rather than retried blindly.

Generating a suggested reply does not send it. Any external reply must pass the existing exact-recipient, exact-subject, exact-body, duplicate, approval, and sender-identity gates. Attachments require separate approval.

## 9. Deterministic Choice Routing

Candidate handling follows this priority:

1. A candidate card button carries its own signed session/candidate identifiers and is handled directly.
2. A standalone `A` through `E` is handled by the candidate extension only when `replyToMessageId` exactly matches a registered candidate card for the same chat and operator.
3. Explicit `候选A` or `开发客户 A` may use the operator's unexpired candidate session without a quote.
4. Every other standalone `A` through `E` returns `false` from the candidate extension and continues to the normal conversational handler.
5. If the normal handler cannot prove which visible option set applies, it asks which option set the user means and performs no state change.

Candidate-card message IDs are registered when daily recommendations or interactive candidate lists are delivered. Registrations contain only message ID, session ID, chat binding, operator binding where available, creation time, and expiration. Daily cards instruct users to click a button, quote the card and reply `A–E`, or type `候选A`; they no longer claim that every bare letter is a candidate shortcut.

A quote pointing at a non-candidate message is authoritative negative evidence: the candidate extension must not consume it. Thread membership alone is insufficient because one thread may contain several independent option sets.

## 10. Data and State

The implementation adds or extends neutral runtime records for:

- mailbox synchronization leases and run type;
- attachment storage key, digest, state, and detected MIME type;
- inbound correlation outcome and matched work item;
- notification job state, attempts, receipt, and analysis state;
- candidate card context binding and expiration.

Actual message bodies, contact data, attachments, and business records stay in the protected application database/private runtime. They are not copied into documentation, the user-level runtime catalog, Git, or test fixtures.

## 11. Failure Handling and Observability

Operational health exposes these redacted facts:

- IMAP configured/verified;
- last successful poll and its age;
- consecutive failures;
- pending notification count and oldest age;
- pending analysis count;
- quarantined attachment count;
- context-router version.

After two failed polls, the bot creates one deduplicated internal operational warning in `build`. Recovery produces one recovery notice. Authentication failures do not retry rapidly; network and rate-limit failures use bounded exponential backoff.

## 12. Testing

Test-first implementation must cover:

- missing inbox configuration fails closed without printing secrets;
- protected SMTP credential fallback is used only with an explicitly verified IMAP endpoint;
- scheduler runs every day, prevents overlap, and catches up after restart;
- 90-day backfill and incremental polling deduplicate Message-ID and UID;
- attachment bytes survive import with correct hash and restrictive permissions;
- traversal filenames, unsupported MIME, oversized files, and duplicate attachments are contained;
- an inbound reply commits even when correlation, analysis, or Feishu delivery fails;
- exact header correlation wins and ambiguous fallback changes no customer state;
- notification retry is idempotent and routes only to `build`;
- image/file messages remain attached to the notification thread;
- quoted candidate `A` resolves the quoted candidate;
- quoted non-candidate `A` is not consumed;
- unquoted bare `A` is not consumed by candidate handling;
- explicit `候选A` resolves an unexpired session;
- expired, cross-chat, cross-operator, or unknown contexts execute nothing;
- existing candidate buttons and existing outbound approval gates still work.

Production smoke verification uses one controlled inbound test reply with an approved harmless image. It verifies mailbox import, attachment digest, `build` card delivery, image visibility, deduplication on a second poll, and no outbound email.

## 13. Rollout and Recovery

Rollout order is:

1. Add schema and tests while inbox polling remains disabled.
2. Verify protected configuration and IMAP connectivity without logging values.
3. Deploy context routing and prove non-candidate `A` is no longer intercepted.
4. Deploy attachment storage and notification relay with a synthetic local fixture.
5. Enable a bounded 90-day backfill and inspect counts.
6. Enable five-minute recurring polling.
7. Run the controlled inbound production smoke.
8. Review previously missed replies and create current internal follow-up tasks.

Disabling the scheduler stops new network polling but preserves imported messages, attachments, notification receipts, and audit records. The outbound sender remains independently gated throughout rollout and rollback.

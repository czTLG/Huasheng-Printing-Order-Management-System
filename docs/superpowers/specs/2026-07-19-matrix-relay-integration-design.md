# Matrix Relay Integration Design

**Date:** 2026-07-19
**Status:** Interaction approved; written specification pending final review

## Goal

Connect the current 智能桓 production runtime to the existing protected local sender for `sales@gdhspack.com`. The bot can prepare, preview, and request delivery of an exact reviewed email without holding SMTP credentials. The management system owns authorization, duplicate prevention, transport, receipts, and progress updates.

## Existing Authority

- Canonical sender instructions: `runtime-data-matrix-signal-private/SENDER_HANDOFF.md`.
- Protected configuration: `/etc/packaging-system/smtp.env`, readable only by the privileged management service.
- Sender and Reply-To must both resolve to `sales@gdhspack.com`.
- The bot container must not mount, read, log, or receive SMTP passwords.
- Legacy credentials in the systemd drop-in are outside this change and must not be read, copied, cleaned, or rotated without separate approval.

## Interaction and Confirmation

The bot first shows one final preview containing:

- customer/company and contact identity;
- exact recipient;
- exact subject;
- complete English body;
- Chinese translation for internal review;
- sender identity;
- attachment list, normally empty;
- current version and duplicate-check status.

The preview provides a `确认发送` action. A reply such as `确认发送` or `你直接发送给他` is final confirmation only when it is scoped to the current operator, chat, customer, and exact final-preview version. A quoted preview or an unexpired server-side preview binding may establish that scope.

If no valid final-preview binding exists, those phrases open or regenerate the final preview and do not send. Editing the recipient, subject, body, translation-bound English content, or attachments invalidates approval and requires a new preview and confirmation.

## Architecture

The integration has four isolated parts:

1. **Bot adapter** — sends only record/version identifiers, expected version/hash, chat binding, and idempotency key to fixed management-system endpoints. It contains no SMTP settings and no caller-supplied transport fields.
2. **Management gate** — reloads the authoritative recipient and exact immutable draft, verifies the approving actor and current binding, checks version/hash freshness, duplicate/cooling state, daily quota, suppression, sender readiness, and the single-use confirmation.
3. **Protected transport factory** — runs only in the management service, loads protected environment variables, asserts the approved sender identity, and invokes the local sender with the gated recipient, subject, and plain-text English body.
4. **Receipt and progress writer** — records accepted, failed, or ambiguous outcomes, prevents reuse of the idempotency key, updates the related customer/inquiry task, schedules reply checking when accepted, and returns a redacted result to Feishu.

The previously implemented and tested relay branch is a reference implementation, not a branch to merge wholesale. Required delivery/review components must be ported onto the current `main` so later inbox, context, attachment, and short-command work is preserved.

## Required Gates

Every delivery attempt must fail closed unless all conditions are true:

1. The operator has an active Matrix binding and explicit send capability.
2. The final-preview version is current, approved, unexpired, and owned by that operator.
3. Recipient, subject, English body, attachment hashes, and content hash exactly match the approved version.
4. The recipient is authoritative for the linked customer or explicitly verified through an approved protected control.
5. Sender and Reply-To are `sales@gdhspack.com`.
6. No accepted, sending, ambiguous, suppressed, bounced, opted-out, cooling-window, or same-content duplicate blocks delivery.
7. The successful daily first-contact limit remains at most five. Reply emails for existing inquiries are classified separately but still require exact approval and duplicate checks.
8. Sender readiness is current and the transport configuration is available to the management service.
9. The confirmation idempotency key has not been consumed with different inputs.
10. Attachments are omitted unless each exact attachment has separate approval.

## Outcome Semantics

- `accepted`: SMTP accepted the message for queueing. It does not prove delivery or a customer reply.
- `failed`: transport produced a definite failure; the approval is not silently retried.
- `ambiguous`: the process cannot prove whether SMTP accepted the message; automatic retry is prohibited until reconciled.
- Repeated confirmation with the same key returns the recorded outcome and never creates a second send.

The Feishu response shows only the recipient, subject/version, outcome, timestamp, and safe next step. SMTP password, transport debug data, full Message-ID, and protected configuration values remain outside cards and tracked files. A restricted local ledger may retain the full provider receipt.

## Acepac Current Case

The current Acepac message has not been sent by this change. After rollout, 智能桓 must rebuild the final preview from the authoritative customer, inquiry, email thread, and current approved draft. The operator must perform the final confirmation in Feishu. No existing conversational statement is retroactively treated as a consumed send authorization.

## Failure Handling

- Missing sender service: show `发送服务暂不可用` and retain the draft and task.
- Missing/stale preview: regenerate the preview; do not send.
- Duplicate or ambiguous prior attempt: show the existing outcome and require reconciliation; do not resend.
- Permission failure: show that the current operator lacks send authorization; do not suggest Outlook or Gmail.
- Transport failure: record a safe error class, keep customer progress unchanged except for the failed attempt, and provide an internal retry/review action only when the outcome is definite.

## Testing

Automated coverage must prove:

- the bot has no SMTP variables or generic outbound request primitive;
- preview and approval alone never send;
- `确认发送` and `你直接发送给他` send only with a valid scoped final preview;
- a missing, expired, cross-chat, cross-operator, stale, edited, or duplicate preview sends nothing;
- route input rejects caller-supplied recipient, subject, body, sender, Reply-To, attachment paths, or SMTP settings;
- the management service reloads exact authoritative content and uses an injected fake transport in tests;
- accepted, failed, ambiguous, concurrent, replay, and crash-recovery behavior is idempotent;
- permissions, sender identity, readiness, recipient provenance, suppression, cooling, and daily-limit gates fail closed;
- accepted delivery creates a reply-check task and updates the correct customer/inquiry without mixing contacts;
- production no-send preflight validates wiring and sender readiness without invoking `sendMail`;
- Feishu production container loads the updated adapter after restart.

## Rollout

1. Port the narrow relay/review services and schema additions onto current `main` with tests first.
2. Add a protected transport factory to the management service; keep delivery disabled.
3. Run migrations, complete no-send sender readiness, permission, API, duplicate, and crash-recovery tests.
4. Enable delivery only for the exact approved operator and protected management service.
5. Sync and restart the 智能桓 production container.
6. Verify preview generation and a fake/no-send confirmation path.
7. The first real Acepac send occurs only after a fresh final preview and explicit Feishu confirmation.

## Out of Scope

- Direct SMTP access from the bot container.
- Outlook or Gmail configuration.
- Automatic WhatsApp sending.
- Automatic attachment sending without separate approval.
- Retroactive approval of an earlier conversation.
- Credential cleanup or rotation.

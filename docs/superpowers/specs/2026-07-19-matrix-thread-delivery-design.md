# Matrix Thread Delivery Design

**Date:** 2026-07-19  
**Status:** Approved in conversation, pending written-spec review  
**Codename:** `matrix-thread-route`

## Problem

The Feishu command `发送邮件` is not handled by the reviewed interaction extension. It falls through to the general AI conversation, which can incorrectly claim that only inbox access exists. The existing delivery service also permits only `initial_contact`; a reply to an existing inquiry is deliberately blocked as `existing_relationship_requires_reply_route`.

The system needs a separate route for replying to an existing, synchronized inquiry. It must reuse the protected `sales@gdhspack.com` sender without exposing SMTP configuration to the Feishu container and without weakening immutable-draft approval or duplicate prevention.

## Scope

This change covers an outbound reply when all of the following are authoritative records:

- an existing CRM message thread;
- an exact recipient address already bound to that thread;
- an approved bilingual draft version bound to the same work item and thread;
- the Feishu operator, chat, quoted message or current approved-card context;
- the final content hash, attachments and thread headers shown in the preview.

It does not add arbitrary recipient entry, infer a recipient from free text, send a cold-development message, or grant the Feishu container access to SMTP credentials.

## Architecture

### 1. Route classification

The preview and delivery services classify the approved version as one of:

- `initial_contact`: existing cold-development route;
- `existing_relationship`: new `matrix-thread-route`;
- `blocked`: no send action.

The thread route is allowed only when the work item resolves to one synchronized inbound thread and its stored sender address exactly matches the approved version recipient. A company name, recent chat text or model memory is not sufficient evidence.

### 2. Thread evidence

The approved version stores or references an immutable thread-evidence record containing:

- CRM thread identifier and latest inbound message identifier;
- normalized recipient address;
- authoritative source type and source record identifier;
- observed message timestamp;
- optional reply headers (`In-Reply-To` and `References`) derived from protected source metadata;
- attachment manifest with content hashes, filenames and approval state.

The final preview projects these fields without exposing protected transport identifiers. A changed thread, recipient, draft, attachment or content hash invalidates the preview and requires approval again.

### 3. Feishu command and context

The interaction extension recognizes `发送邮件` as a scoped command only when the same operator/chat/thread has a live approved-version context or the message explicitly quotes the corresponding approved card. It must never select the globally latest draft.

The first command opens the immutable final preview. The second command must be `确认发送` and must use the exact previewed digest. Context expires after ten minutes and is consumed after submission. Another operator, another chat, another thread, an expired context or an unbound command receives a clear Chinese no-send response.

### 4. Gates

The thread route keeps:

- active operator binding, approved role and explicit send capability;
- persisted approval evidence and exact content hash;
- exact recipient/thread/attachment binding;
- SMTP/TLS and sender-domain readiness;
- one reservation per approved version and idempotency key;
- accepted/failed/ambiguous terminal states;
- immutable audit events and reply-follow-up scheduling.

The thread route does not apply cold-development domain cooling, first-contact duplicate classification, daily cold-contact quota, or marketing opt-out/country-policy requirements. It remains subject to operational rate limiting and explicit suppression or unsubscribe records.

### 5. Delivery

The management service, not the Feishu container, constructs the outbound message. It pins `from` and `replyTo` to `sales@gdhspack.com`, includes only approved attachments, and applies protected reply headers when verified thread metadata exists. The transport result is recorded as:

- `accepted`: transport accepted the exact recipient; schedule the next reply check and update the thread state;
- `failed`: deterministic recipient rejection; do not retry automatically;
- `ambiguous`: outcome unknown; block retry until manual reconciliation.

No automatic resend is allowed.

## User flow

1. Operator reviews and approves the Acepac-bound reply draft.
2. Operator replies `发送邮件` to that card or within its live scoped context.
3. The robot shows recipient, thread, subject, English body, Chinese translation, approved attachments and all applicable gates.
4. Operator replies `确认发送` or presses the bound confirmation button.
5. The management service performs one idempotent send attempt and returns a Chinese result card.
6. On acceptance, CRM records the outbound reply and schedules a follow-up check. On failure or ambiguity, the work item remains visible with a specific next action.

## Error handling

- No scoped approved context: `当前没有绑定到本会话的已批准邮件，尚未发送。`
- Thread or recipient mismatch: block and require re-association; never guess.
- Preview changed or expired: require a new preview and confirmation.
- Sender readiness blocked: show the normalized gate reason; do not claim that no sender exists.
- Transport ambiguity: show manual-reconciliation status and prevent a second send.
- General AI fallback must not answer send-capability questions when the command matches a protected action.

## Tests

Automated regression must prove:

- `发送邮件` is intercepted and never reaches the general agent;
- first command previews and second command sends;
- no context, wrong operator/chat/thread, expiry and changed digest all fail closed;
- existing-thread evidence permits the reply route but cannot be used for initial contact;
- cold-development cooling, quota and marketing policy do not block a verified reply;
- suppression, sender readiness, missing approval, recipient mismatch and attachment mismatch do block;
- one immutable version produces at most one transport attempt;
- accepted, failed and ambiguous outcomes update state correctly;
- SMTP values and protected message identifiers never appear in API responses, cards, logs or the user catalog.

## Deployment and rollback

Deploy the management service and Feishu extension from one committed revision. Build a commit-addressed immutable robot image, preserve the previous container, verify authenticated API readiness, runtime health, extension hash and Feishu WebSocket readiness, and send no real message during smoke testing. Roll back both routing surfaces if either side fails compatibility checks.

## Acceptance criteria

- A scoped Acepac approved reply responds to `发送邮件` with the real final preview instead of generic setup guidance.
- A second explicit confirmation invokes the protected management sender exactly once when all gates pass.
- An unscoped `发送邮件` cannot send or select any recipient.
- The Feishu container contains no SMTP credential and no arbitrary-send API.
- Existing initial-contact behavior and approval thresholds remain unchanged.

# Matrix Stream Review Loop Design

**Date:** 2026-07-17  
**Status:** Approved for implementation planning  
**Scope:** A human-reviewed, single-recipient email loop connecting Matrix candidate work items, CRM drafts, the Feishu bot, the main application, and inbound email synchronization.

## 1. Outcome

After an operator selects a candidate, the system produces a bilingual draft instead of stopping at a text-only next-step suggestion. The operator may revise it, approve the exact version, review a final send preview, and separately confirm a single email send. Replies update the same CRM and work-item history and trigger a Feishu notification with translation and a suggested response.

The system must never send because a candidate was merely selected or a draft was merely approved.

## 2. Fixed Boundaries

- Only a verified public company email may be used as a recipient.
- The recipient record must retain its public source URL and verification time.
- Website contact forms are not submitted automatically.
- Personal addresses are not guessed, inferred, or constructed.
- Each external message requires two human actions: approve the exact draft version, then confirm its final send preview.
- A received reply may generate a new bilingual response draft, but it uses the same two-confirmation process and is never sent automatically.
- The Feishu runtime does not receive or store SMTP credentials. Sending is performed by a restricted service in the main application.
- The current `MATRIX_DELIVERY_ENABLED=0` boundary remains in force for the Feishu runtime.
- Public sources, upstream project provenance, audit records, and dependency inventory remain accurately recorded even when internal capabilities use neutral codenames.

## 3. Chosen Architecture

Reuse the existing `crm_reply_drafts`, CRM message, email synchronization, audit, and Matrix work-item facilities. Add immutable draft versions and delivery records rather than creating a second CRM or placing an outbound adapter inside the bot container.

The Feishu card extension calls only narrow Matrix API methods on the configured main-application origin. The Matrix router authorizes the bound operator and delegates draft versioning and delivery to focused services. The delivery service accepts a persisted approved version identifier, not caller-supplied SMTP settings or arbitrary message content.

## 4. State Model

### 4.1 Draft version

Each modification creates an immutable version containing:

- work-item and CRM draft identifiers;
- version number;
- recipient email, recipient source URL, and recipient verification time;
- subject, English body, and Chinese translation;
- strategy summary and public-source snapshot;
- canonical content hash;
- creator and creation time;
- approval status, approver, and approval time.

Approving a version changes only its approval state. Editing recipient, subject, either body, or the public-source binding creates a new version and supersedes the old approval.

### 4.2 Work item

Work-item stages are:

- `draft_pending`: draft exists and needs review;
- `review_pending`: the current version needs approval;
- `approved`: the exact version is locked and ready for final preview;
- `send_pending`: final preview is awaiting the separate send confirmation;
- `sending`: one delivery attempt owns the idempotency key;
- `sent`: SMTP returned a definite accepted result;
- `replied`: an inbound reply was uniquely correlated;
- `delivery_ambiguous`: the connection ended without a trustworthy accepted or rejected result;
- `bounced`: a delivery-status message identified the sent message or recipient;
- `suppressed`: the recipient opted out, refused contact, or was manually stopped.

Selection creates or updates the work item and then creates its first draft version. Selection alone never advances beyond draft review and never sends.

### 4.3 Delivery event

Delivery events are append-only. Each event stores:

- delivery job and approved version identifiers;
- operator, Matrix binding, chat, and card event identifiers;
- idempotency key and content hash;
- transition and timestamp;
- SMTP envelope recipient and returned `Message-ID` when available;
- classified result: accepted, definite failure, ambiguous, bounce, reply, or suppression;
- a redacted diagnostic safe for audit display.

An accepted idempotency key cannot create a second delivery. An ambiguous attempt is not automatically retried.

## 5. Feishu Interaction

### 5.1 After selection

The card shows:

- confirmation that the candidate was added to the work list;
- English draft and Chinese translation;
- product entry point, differentiation basis, supplier evidence state, and questions;
- explicit text that email, WhatsApp, and website contact have not been executed;
- `Confirm draft`, `Revise draft`, and `Defer` actions in localized UI copy.

### 5.2 Revision

`Revise draft` binds a short-lived edit context to operator, chat, thread, work item, and current version. The next message beginning with `修改：` supplies requested changes. The system creates a new version, regenerates both language views, and returns the review card. It never mutates an approved snapshot.

An expired or mismatched edit context produces a restart instruction and makes no change.

### 5.3 First confirmation

`Confirm draft` approves only the version and content hash carried by the card. The final preview then displays:

- full verified recipient address;
- recipient source URL and verification time;
- subject and full English body;
- Chinese translation;
- version, content hash abbreviation, and approving operator;
- `Confirm send`, `Return to revise`, and `Cancel` actions.

No network delivery occurs during this action.

### 5.4 Second confirmation

`Confirm send` submits only the approved version identifier, expected work-item version, and card event idempotency key. The server reloads all content from its database, rechecks recipient provenance, permissions, suppression, approval, version, and content hash, and then attempts one delivery.

The result card distinguishes accepted, definite failure, and ambiguous status. Definite failures can expose a manually initiated retry action that creates a new attempt key. Ambiguous status requires reconciliation and never offers immediate resend.

## 6. Recipient and Permission Rules

The recipient is eligible only when all of these are true:

- it is syntactically valid and normalized;
- it is recorded as a public company contact rather than a guessed personal address;
- it has an HTTPS public source URL from an allowed evidence record;
- it has a verification timestamp within the configured freshness window;
- the candidate and recipient are not bounced, opted out, refused, or suppressed;
- no unresolved delivery attempt exists for the same approved version.

Viewing and revising drafts uses existing CRM access. Approval and send confirmation require an active Matrix binding and the appropriate CRM role. Sending additionally requires an explicit outbound-send permission; role membership alone is insufficient. The approving and sending operators are recorded separately even when they are the same person.

The delivery endpoint accepts no host, port, credentials, arbitrary callback URL, file path, attachment, or unpersisted recipient/body field.

## 7. Main-Application Services

The implementation is divided into focused units:

- a draft-version service creates, reads, approves, and supersedes immutable versions;
- a recipient-provenance validator determines eligibility without network access;
- a delivery service owns the SMTP transport, idempotency transaction, message headers, and result classification;
- a correlation service links inbound messages, bounces, and suppression signals;
- the Matrix router exposes narrow bound-operator endpoints;
- the Feishu extension renders cards and forwards action identifiers without possessing delivery credentials.

Outbound messages set a stable `Message-ID` and preserve it in the delivery record before reply synchronization relies on it.

## 8. Reply, Bounce, and Suppression Correlation

Inbound mail synchronization continues writing to `email_messages` and CRM messages. Correlation order is:

1. exact `In-Reply-To` or `References` match to the stored outbound `Message-ID`;
2. exact normalized sender/recipient pair plus normalized subject within the configured time window;
3. otherwise no automatic association.

Multiple possible matches produce a `needs_review` correlation record and do not change a candidate or customer automatically.

A uniquely matched reply advances the work item to `replied`, stores the relationship, and queues one Feishu notification containing the original text, Chinese translation, extracted requirements, current progress, and a suggested bilingual response. The response begins again at `draft_pending`.

A uniquely matched delivery-status notification advances to `bounced`. A clear unsubscribe, refusal, or manual stop advances to `suppressed`. Both states block future sends before SMTP is called.

## 9. Error and Concurrency Behavior

- Concurrent approval uses expected versions; one succeeds and stale actions fail closed.
- Concurrent send confirmation uses a unique approved-version/idempotency constraint; at most one job owns delivery.
- A definite SMTP rejection records failure and permits a deliberate retry after correction.
- A timeout or disconnect after the SMTP transaction begins records `delivery_ambiguous`; no automatic retry occurs.
- A process crash before SMTP begins leaves a safely retryable pending job.
- A crash after a definite accepted result can be reconciled using the stable `Message-ID` and event record; it must not cause automatic resend.
- User-facing errors reveal no SMTP credentials, internal paths, or stack traces.

## 10. Automated Acceptance

### 10.1 Unit and database tests

- immutable version creation and supersession;
- approval bound to exact content hash;
- editing invalidates earlier approval;
- recipient provenance, freshness, suppression, and public-company validation;
- append-only delivery events and valid state transitions.

### 10.2 API and concurrency tests

- bound actor and outbound permission checks;
- unknown-field rejection on all mutation endpoints;
- stale card and stale work-item rejection;
- repeated and concurrent send clicks produce at most one delivery job;
- caller cannot supply SMTP configuration or substitute recipient/body content.

### 10.3 Delivery tests

A local fake SMTP server verifies accepted, definite failure, disconnect-before-send, and ambiguous-after-transaction paths. Automated tests never send to a real external address.

### 10.4 Correlation tests

- exact `Message-ID` reply matching;
- normalized subject/contact fallback;
- ambiguous fallback isolation;
- bounce and suppression blocking;
- one Feishu notification per correlated reply.

### 10.5 Feishu and production tests

- browserless card regression covers select, revise, approve, preview, send confirmation, and status rendering;
- mobile card text remains within the established code-point budget;
- production smoke verifies database migration, access controls, bot-to-main-app API, SMTP connection capability, health, and `MATRIX_DELIVERY_ENABLED=0` without sending a test email;
- final acceptance uses one user-selected real candidate and both explicit confirmations.

## 11. Rollout and Rollback

Deploy database migrations and the main-application read paths first, then delivery endpoints disabled by configuration, then the Feishu cards. Enable the restricted send endpoint only after automated verification and production smoke pass. Keep the prior application service and bot container releases available for rollback.

Rollback disables new send confirmation immediately while preserving immutable draft and delivery history. It must not delete, rewrite, or reclassify past delivery events.

## 12. Explicitly Out of Scope

- bulk or scheduled automatic sending;
- automatic website-form submission;
- guessed, scraped-private, or login-only personal contact data;
- automatic attachment sending;
- WhatsApp outbound delivery;
- automatic follow-up messages without a new two-confirmation cycle;
- automatic resend after ambiguous delivery;
- bypassing unsubscribe, bounce, refusal, permission, or provenance checks.

# Matrix Runtime Unified Ledger Design

**Date:** 2026-07-23  
**Status:** Approved design  
**Scope:** Unify the current Codex session, the management application, and the Feishu assistant around one authoritative lifecycle ledger.

## Objective

Replace the current split state across the management database, tracked CSV files, private delivery evidence, chat context, and assistant-local context with one authoritative management-system ledger.

The design must:

- preserve an explicit approval gate before every external message;
- prevent duplicate delivery across every interface;
- make the current Codex session and the Feishu assistant display the same customer state and next action;
- correlate sent messages, bounces, automatic replies, real replies, attachments, and follow-up tasks;
- migrate every historical record that can be linked reliably;
- place ambiguous history in a review queue instead of guessing;
- disable every legacy delivery path immediately after cutover.

## Authority and Boundaries

The management-system database is the sole authority for operational state.

The current Codex session and the Feishu assistant are clients of the same controlled API. They may:

- discover and select an existing customer;
- read research evidence and route readiness;
- create a versioned draft;
- display the complete final preview;
- submit the user's explicit approval for that exact version;
- read delivery, reply, and follow-up state.

They may not:

- call SMTP directly;
- create a delivery without a persisted approved version;
- maintain a separate customer stage or follow-up date;
- fall back to a legacy sender when the management service is unavailable;
- infer that an ambiguous historical record belongs to a customer.

SMTP credentials remain available only to the protected management service. Credentials and secret values are never copied into the database, catalog, logs, prompts, or migration artifacts.

## Canonical Lifecycle

The single lifecycle is:

```text
candidate
→ verified public research
→ verified website route
→ authoritative customer/contact
→ versioned draft
→ complete final preview
→ explicit final approval
→ unique delivery job
→ SMTP result and Sent correlation
→ bounce, automatic reply, or customer reply
→ translated summary and next action
→ follow-up task
```

Every state transition is persisted with actor, timestamp, source version, content hash, and idempotency key where applicable.

## Core Records

### Customer

Stores the canonical organization identity, country, domain, lifecycle stage, owner, current summary, and next action.

One organization has one canonical customer ID. Aliases and historical candidate IDs map to that ID and never create parallel customer records.

### Contact

Stores a contact channel, role, public source, verification time, and active/revoked status.

A contact address must be tied to an official source or an explicitly approved protected source. A permanent bounce revokes the address without deleting its history.

### Research dossier

Stores source URLs, checked dates, confirmed facts, inferences, unknowns, and blockers. Confirmed facts and inferences remain distinct.

### Route assessment

Stores route-set ID, localized public URLs, deployment version, desktop and mobile checks, verification time, status, and blocking reason.

Only a current `ready` assessment may support a new initial-contact draft.

### Draft version

Stores recipient contact ID, recipient evidence snapshot, subject, English body, translated review body, attachment manifest, source snapshot, quality result, content hash, revision, and status.

Editing creates a new immutable version. Approval applies to one exact content hash.

### Approval event

Stores approver, approved draft version, content hash, timestamp, interface, and explicit approval phrase.

Candidate selection, draft adoption, or opening a preview is not delivery approval.

### Delivery job

Stores the approved version ID, idempotency key, recipient domain, sender identity, attempt count, result state, redacted diagnostic class, and timestamps.

The database enforces that the same approved content cannot have two active or accepted jobs.

### Message thread

Stores inbound and outbound messages, Message-ID, In-Reply-To, References, normalized subject, participants, attachments, customer/contact association, and classification.

### Follow-up task

Stores task type, customer, source delivery or message, due time, state, priority, recommended next action, and cancellation reason.

## Approval Experience

Both the current Codex session and the Feishu assistant use the same interaction:

1. Display the complete recipient, subject, body, and attachment list.
2. Display the customer identity and current draft version.
3. The user replies `确认发送 <客户名>` or performs an equivalent explicitly labelled action.
4. The server compares the submitted version ID and content hash with the current preview.
5. The server creates one idempotent delivery job and returns its persisted state.

Only this final explicit confirmation authorizes delivery. A second repeated confirmation is unnecessary because the version hash, approval event, and unique delivery job provide independent technical safeguards.

## Delivery States

Allowed delivery states are:

- `pending`
- `sending`
- `accepted`
- `failed`
- `ambiguous`
- `bounced`

`accepted` means only that the configured SMTP transport accepted the recipient for queueing. It does not claim inbox placement or reading.

An ambiguous transport result blocks automatic retry. An operator must reconcile Sent-folder evidence and inbound delivery-status messages before approving a new attempt.

## Inbox Classification and Correlation

The existing five-minute inbox and Sent-folder synchronization remains the ingestion mechanism.

Correlation order:

1. Message-ID, In-Reply-To, and References;
2. exact recipient or sender contact;
3. normalized organization domain;
4. normalized thread subject;
5. explicit historical customer/candidate mapping.

Product similarity, telephone suffix similarity, or AI semantic similarity alone never establishes customer identity.

Inbound classifications:

- real customer reply;
- permanent bounce;
- temporary delivery delay;
- automatic reply;
- advertisement/noise;
- unrelated operational message;
- unresolved.

Actions:

- a real reply cancels the outstanding no-reply follow-up and creates translation and response-review work;
- a permanent bounce revokes the address, cancels follow-up, and creates a replacement-contact task;
- a temporary delay creates a timed delivery review and never resends automatically;
- an automatic reply adjusts the follow-up date when a reliable return date exists;
- noise is archived without entering the customer work queue;
- unresolved messages enter a review queue without modifying a customer's stage.

## Translation and Reply Assistance

Every real customer reply receives:

- the preserved original text;
- paragraph-by-paragraph Chinese translation;
- extracted product, specification, quantity, commercial-term, attachment, and deadline signals;
- missing-information list;
- recommended next action;
- a draft reply in the customer-facing language and Chinese review translation.

The draft reply remains approval-gated. The system never sends a customer reply merely because it generated a recommendation.

## Follow-up Automation

An accepted initial delivery creates a no-reply check task due three calendar days later.

There is no weekday/weekend distinction.

Before a task becomes actionable, the server rechecks:

- customer reply state;
- bounce state;
- automatic-reply return date;
- active contact status;
- existing follow-up deliveries;
- customer suppression state.

If no blocker exists, the system creates a reviewable follow-up draft. Sending that draft requires the same complete final preview and explicit confirmation.

## Reliable Historical Migration

The migration includes every historical customer, candidate, research record, route record, draft, approval, delivery result, Sent message, inbound message, bounce, attachment index, and follow-up date that can be linked reliably.

Automatic linkage is allowed when supported by one or more authoritative identifiers:

- existing customer or candidate ID mapping;
- exact official email address;
- verified organization domain plus verified company identity;
- exact approved subject and body hash;
- Message-ID, In-Reply-To, or References;
- an explicit protected historical mapping.

Records enter the unresolved queue when they contain only:

- a company abbreviation without corroboration;
- a public-mail address without organization evidence;
- conflicting company, country, or contact identities;
- product specifications without customer identity;
- a telephone suffix without the full verified identity;
- semantic similarity without a deterministic identifier.

Migration requirements:

- append provenance for every imported record;
- preserve original timestamps;
- never invent approval evidence;
- never convert SMTP acceptance into inbox delivery;
- support safe repeated execution;
- produce zero new records on an unchanged second run;
- generate a reconciliation report with imported, matched, unresolved, skipped, and conflicting counts.

## Legacy Cutover

After migration verification:

- tracked CSV registries become read-only audit references;
- private delivery evidence remains permission-restricted and read-only;
- temporary sender scripts are removed;
- legacy delivery endpoints are disabled;
- the Feishu assistant loses direct or indirect access to any separate sender;
- the current Codex workflow uses only the management API;
- failure of the management API fails closed.

No rollback may re-enable a legacy delivery route. Operational rollback restores the previous management release while preserving the authoritative database and the external-communication gate.

## API Responsibilities

The controlled API provides:

- customer search and canonical identity retrieval;
- research and route-readiness retrieval;
- draft creation and immutable revision;
- final preview retrieval;
- approval submission;
- delivery confirmation;
- delivery status retrieval;
- thread and attachment retrieval;
- inbox classification review;
- translation and reply-draft retrieval;
- follow-up task retrieval and action.

Mutating endpoints require authenticated actor identity, explicit capability, customer ownership or administrator authority, exact expected version, and idempotency key.

## Error Handling

- stale preview or hash mismatch: reject with no delivery job;
- duplicate idempotency key with different input: conflict;
- accepted or ambiguous existing job: block resend;
- inactive/revoked contact: block;
- stale route or research blocker: block initial-contact draft;
- missing sender readiness: block;
- management database unavailable: fail closed;
- correlation ambiguity: create unresolved item only;
- translation failure: preserve original and queue retry without blocking message ingestion;
- attachment quarantine: show metadata only and prevent unreviewed external reuse.

## Security and Privacy

- credentials remain only in protected configuration;
- message bodies and customer records remain in authoritative protected storage;
- operational logs contain redacted error classes, not credentials or unnecessary message content;
- private delivery identifiers remain outside tracked public files;
- migration never copies live business records into the user-level capability catalog;
- external communication always retains the explicit final approval gate.

## Verification and Acceptance

### Migration

- representative records from every legacy source migrate correctly;
- an unchanged second migration adds zero records;
- ambiguous fixtures enter the unresolved queue;
- conflicting identities do not merge;
- original timestamps and provenance remain intact.

### Delivery

- current session and Feishu display the same final preview and customer state;
- exact approval creates one delivery job;
- repeated approval replays the existing result without sending again;
- stale version, altered body, recipient change, or attachment change is rejected;
- UTF-8 English, Thai, Vietnamese, Malay, and Russian bodies survive MIME generation and Sent synchronization.

### Inbox

- real reply, permanent bounce, temporary delay, automatic reply, noise, and unresolved fixtures classify correctly;
- Message-ID and References correlation wins over weaker signals;
- customer reply cancels the outstanding no-reply task;
- permanent bounce revokes the address and prevents follow-up;
- attachments bind to the correct thread and customer.

### Follow-up

- accepted initial delivery creates one task due in three calendar days;
- duplicate scheduler runs do not create duplicate tasks;
- replies, bounces, and suppression cancel or block the task;
- a follow-up draft cannot send without a new final confirmation.

### Cutover

- legacy scripts and endpoints cannot send;
- CSV and private ledgers are read-only;
- management-service failure does not activate a fallback sender;
- production services remain healthy;
- browser and API regression tests cover both the current-session workflow and Feishu-card workflow.

## Rollout

1. Add the canonical schema and controlled APIs.
2. Implement the idempotent historical migrator and dry-run report.
3. Review unresolved and conflict samples.
4. Run migration and repeat-run idempotency verification.
5. Switch the current session and Feishu assistant to the canonical APIs.
6. Disable and verify legacy paths.
7. Run end-to-end delivery, Sent correlation, bounce, reply, translation, and follow-up tests.
8. Deploy with production approval and monitor the first live cycle.

## Success Criteria

The design is successful when:

- every customer and external message has one authoritative lifecycle;
- both user interfaces show identical state and next action;
- duplicate delivery is prevented at the database boundary;
- every accepted delivery creates a follow-up task;
- every bounce or reply changes the correct customer state within one inbox polling cycle;
- historical ambiguity remains visible and reviewable instead of being guessed;
- no operational path can send outside the canonical approval and delivery flow.

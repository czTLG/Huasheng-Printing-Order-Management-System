# Matrix Candidate Classification Design

Date: 2026-07-16

## Goal

Classify the existing overseas CRM records into `test`, `noise`, `needs_review`, and `valid` without deleting source data, then produce a first human-reviewable candidate list. Domestic legacy customers remain in CRM but are excluded from this classification run.

## Scope

Included sources:

- All WhatsApp messages already stored in `crm_messages`.
- All email messages currently stored in `email_messages`.
- Overseas customer records linked to those messages.

Excluded from this phase:

- Domestic legacy customers.
- Sending email or WhatsApp messages.
- Automatically modifying formal customer, inquiry, specification, costing, freight, order, or production records.
- Deleting test, noise, duplicate, or incomplete data.
- Full historical mailbox synchronization; that is a later phase after classification is proven on current data.

## Overseas Eligibility

A record enters the classification input only when at least one of these facts is present:

- A non-domestic email contact.
- A confirmed international WhatsApp or phone number.
- An explicit overseas country or destination.
- An existing foreign-source CRM message linked to the record.

Domestic customer records with none of these facts are excluded, not reclassified.

## Classification Order

Rules run in strict precedence order so that a lower-confidence rule cannot override a safety exclusion:

1. `test`
2. `noise`
3. `needs_review`
4. `valid`

Each result stores rule identifiers and supporting record IDs. Free-form AI output cannot change the class without deterministic evidence.

### Test

Classify as `test` when deterministic evidence matches a known fixture or verification artifact:

- Fixed names, addresses, domains, message identifiers, or payload markers used by repository tests.
- Explicit token/sync verification messages.
- Fixture mailboxes or sample payload markers.

Test records never enter the candidate list. They remain stored and can only be restored by an administrator.

### Noise

Classify as `noise` when evidence identifies a non-customer communication:

- Account verification, security alerts, automated reports, delivery failures, or machine notifications.
- Unsolicited advertising unrelated to the supported product domain.
- A message involving only internal addresses with no external conversation party.
- Confirmed unsubscribe, refusal of further contact, or invalid address.

Noise remains visible in an audit view and is never used to generate a draft.

### Needs Review

Classify as `needs_review` when an overseas identity exists but the customer or intent cannot be established safely:

- Contact method exists but company or product evidence is missing.
- Content is only greeting, acknowledgement, or other short context-free text.
- Multiple contacts may represent the same company but identity resolution is ambiguous.
- WhatsApp sender is unknown, direction is uncertain, or extraction duplicated substantial portions of the message.
- Email/phone identity conflicts with the linked customer.

These records appear in a verification queue and do not generate send-ready content.

### Valid

Classify as `valid` only when all safety exclusions are false and the record has:

- A usable overseas email or confirmed international WhatsApp identity.
- At least one business evidence item: company identity, relevant product, specification, application, inquiry, historical quote, or substantive prior conversation.
- Evidence sufficient to associate the conversation with one customer.

Valid means eligible for human selection. It does not authorize sending.

## Priority

Only `valid` records receive a candidate priority:

- `A`: explicit historical inquiry or quote, clear product need, and meaningful recent interaction.
- `B`: reliable identity and product evidence, but older interaction or incomplete requirements.
- `C`: plausible opportunity with weaker recency or incomplete business evidence; requires human judgment before analysis.

Priority is accompanied by reason codes. It is not derived from contact frequency alone.

## Evidence and Product Analysis

The classifier stores normalized evidence references, not copied private conversations in list views. A detail view may retrieve authorized source records.

Product-structure analysis follows private rule provenance:

- Extract confirmed product, use, format, dimensions, process, and material statements from prior conversations.
- Distinguish confirmed facts from inferred possibilities and missing questions.
- Never invent layer thickness, material grade, price, processing fee, loss, margin, freight, or MOQ.
- Never expose internal price, cost, loss, margin, formula, or private rule text in customer-facing output.
- An unresolved process or material rule leaves analysis in `blocked` or `needs_review`; it cannot become send-ready.

## Candidate List

The neutral UI label is `矩阵候选`. Each card shows only:

- Internal customer identifier and company/contact display name.
- Country or international calling region.
- Available source channels.
- Most recent interaction date.
- Identified product summary.
- Classification, priority, and reason summary.
- Missing information.
- Actions: `暂不处理`, `待核实`, `进入分析`.

Raw contact information and message bodies remain in permission-controlled detail views.

## Persistence and Audit

Classification output is append-only and versioned by rule-set version and run ID. It stores:

- Source customer/message/email identifiers.
- Class, priority, reason codes, confidence, and evidence references.
- Run timestamp and rule-set version.
- Human override, actor, timestamp, and note.

Re-running classification creates or updates the latest result without mutating source records. Human overrides take precedence until explicitly cleared.

## Failure Handling

- A malformed date, missing contact, invalid JSON payload, or parser failure produces `needs_review`, not a dropped record.
- One failed record does not abort the batch.
- The run summary reports input, excluded domestic, test, noise, needs-review, valid, and error counts.
- If classification evidence is incomplete, the system chooses the safer class.

## First Candidate Run

The first run is a dry run against current stored data:

1. Read and normalize eligible overseas records.
2. Produce classes, priorities, reasons, and evidence references without database writes.
3. Manually inspect all `test` results, all `valid/A` results, and a sample of other classes.
4. Correct deterministic rules when evidence shows a systematic error.
5. Run again and save only after human approval.

Known baseline expectations before the run:

- One known token verification customer and its WhatsApp message must classify as `test`.
- Existing IMAP messages contain real mailbox records but include non-customer system messages that must classify as `noise`.
- Unknown WhatsApp contacts and malformed imported timestamps must not automatically classify as `valid`.

## Acceptance Criteria

- Domestic legacy customers are excluded from candidate results.
- Known test records never appear as valid candidates.
- System notifications and internal-only messages never appear as valid candidates.
- Every valid candidate has a usable overseas identity, business evidence, reason codes, and source references.
- Missing or ambiguous identity produces `needs_review`.
- No source CRM record is deleted or overwritten.
- No outbound communication is sent.
- The dry-run report can be reproduced from the same database and rule-set version.
- Sensitive source content is absent from the candidate list response for unauthorized roles.

## Later Phases

After this classification design is implemented and accepted:

1. Add resumable, deduplicated full-mailbox synchronization.
2. Add structured product analysis and review drafts.
3. Add `矩阵候选` cards to the existing Feishu bridge.
4. Add explicit final approval and email delivery with an audit trail.
5. Add inbound-reply matching and Feishu notification.

Each later phase requires separate tests and must preserve the explicit human-send gate.

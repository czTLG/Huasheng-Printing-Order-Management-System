# Matrix Intake Bridge Design

**Date:** 2026-07-28  
**Status:** Approved design, pending implementation plan  
**Scope:** Safely admit one reviewed public organization and one exact human-approved message into the canonical management workflow without bypassing the existing delivery gates.

## Problem

The discovery workflow can produce a well-researched organization, verified public organizational email, localized website journey, and a human-approved message before that organization exists in the canonical candidate and customer records. The current delivery runtime correctly refuses a temporary SMTP send, but there is no narrow supported path that converts this reviewed package into the existing immutable-version workflow.

The missing path must not become a generic database writer or an SMTP shortcut. It must preserve domain and contact provenance, deduplication, customer ownership, immutable content, route readiness, two-stage approval, duplicate protection, cooling, quota, sender readiness, and follow-up creation.

## Chosen Architecture

Add a protected two-part intake path:

1. A bounded candidate-store importer validates and records the reviewed public organization in the existing candidate database.
2. A management-service intake endpoint resolves that candidate into canonical customer state and stores the exact reviewed message as an immutable draft version through existing ledger services.

The management service continues to open the candidate database as read-only. Candidate-store writes remain outside the service and use the reviewed importer. The management endpoint never accepts arbitrary customer identities that are absent from the reviewed candidate store.

No component sends mail directly. After intake, approval, final preview, and confirmation continue through the existing canonical delivery API.

## Input Contract

The intake package contains only:

- deterministic candidate ID;
- official organization name and country;
- normalized official domain and official URL;
- public organizational recipient email;
- official contact-source URL and verification timestamp;
- bounded product, format, scale, and strategy signals;
- at least three official evidence URLs with source roles;
- route-readiness ID, localized public URLs, verified commit, and production verification timestamp;
- exact subject;
- exact English body;
- exact Chinese translation;
- attachment manifest, empty unless separately approved;
- actor ID, binding ID, idempotency key, and approval provenance.

The package may not contain credentials, cookies, private profiles, guessed personal addresses, SMTP identifiers, quotations, orders, formulas, or raw message histories.

## Candidate Admission

The candidate importer:

- validates a public HTTPS official domain and source URLs;
- accepts only public organizational addresses whose registrable domain matches the organization domain;
- requires country, company positioning, product evidence, service or process evidence, contact evidence, and route readiness;
- records discovery and evidence provenance;
- verifies exact domain and email duplicates before mutation;
- creates or reuses one candidate deterministically;
- marks the candidate `valid`, `audited`, and current only when every required evidence role passes;
- remains idempotent for identical input;
- blocks conflicting input without overwriting the existing record.

The candidate database remains independent from the operational database. A successful candidate admission does not authorize delivery.

## Canonical Management Intake

The management endpoint receives a candidate ID and exact reviewed message package. Inside one operational-database transaction it:

1. Reloads the candidate from the read-only candidate view.
2. Revalidates status, audit freshness, official domain, public recipient, contact source, and strategy-match requirements.
3. Revalidates the production route-readiness evidence.
4. Resolves one canonical customer by candidate link, exact official email, or verified domain and company name.
5. Blocks ambiguous or conflicting identities.
6. Creates or reuses the canonical customer, candidate link, and active email contact.
7. Creates or reuses one owned work item.
8. Stores recipient evidence bound to the work item.
9. Creates an immutable draft version using the exact supplied subject and bodies.
10. Runs the existing deterministic quality gate.
11. Returns customer ID, work-item ID/version, draft-version ID, content hash, and status without approving or sending.

The endpoint uses an idempotency key and request fingerprint. Repeating identical input returns the original result. Reusing the key with changed content fails.

## Exact-Content Rule

The approved message is not sent through the generative revision service during intake. Line breaks, links, local-language courtesy text, signature, and punctuation are normalized only according to the existing immutable-version rules.

The content hash binds:

- recipient;
- recipient source URL;
- subject;
- English body;
- Chinese body;
- attachment manifest.

Any later edit creates a new version and requires new approval. The prior approval cannot authorize changed content.

## Approval and Delivery

Intake ends in `draft` status. It does not count as either delivery confirmation.

The existing sequence remains:

1. Human reviews and approves the exact immutable version.
2. System generates a fresh final preview and projects duplicate, cooling, quota, suppression, country, sender-readiness, and attachment gates.
3. Human confirms the exact final preview.
4. The management relay submits the message as `sales@gdhspack.com`.

Only SMTP acceptance may produce `accepted`. Failed or ambiguous results never auto-resend.

## Follow-Up

After an accepted initial delivery, the existing follow-up service creates one pending reply-check task due three calendar days later. A repeated accepted result or replay must not create a duplicate task.

## Failure and Recovery

- Candidate admission succeeds but management intake fails: retain the reviewed candidate; retry the idempotent management intake.
- Management transaction fails: roll back customer, link, contact, work item, recipient evidence, and version together.
- Duplicate domain or email maps to one customer: reuse it.
- Duplicate domain or email maps to multiple customers: block for identity review.
- Candidate evidence becomes stale or route readiness is not `ready`: block without creating a draft.
- Content quality fails: roll back the management transaction.
- Delivery is ambiguous: preserve the delivery-review state and require operator resolution.

## Security and Audit

- The management endpoint requires the existing authenticated operator binding and an administrative intake permission.
- It accepts exact allow-listed fields and rejects unknown fields.
- Candidate and operational writes are separately logged with idempotency fingerprints.
- No credential value or SMTP identifier is returned.
- The candidate database retains public discovery provenance; the operational database retains canonical customer, version, delivery, and task history.
- External delivery continues to require the existing exact final confirmation.

## Testing

Automated coverage must prove:

- reviewed candidate insertion and identical replay;
- domain duplicate reuse;
- conflicting domain or email rejection;
- stale evidence rejection;
- incomplete official-source roles rejection;
- unverified production route rejection;
- exact line-break and bilingual-content preservation;
- content-hash change when any approved field changes;
- atomic rollback on quality or identity failure;
- one canonical customer, link, contact, work item, recipient evidence row, and immutable version;
- no approval or delivery job created by intake;
- duplicate, cooling, quota, sender-readiness, and suppression gates remain active;
- accepted delivery creates exactly one reply-check task;
- repeated confirmation does not resend or duplicate the task;
- Nutty Nuts fixture completes intake through final preview without invoking delivery in tests.

## Rollout

1. Implement and verify locally using isolated databases and a fake transport.
2. Run the complete Matrix API, review, delivery, follow-up, database-integrity, and character-integrity suites.
3. Commit and push the reviewed change.
4. Obtain explicit approval before restarting the production management service or assistant container.
5. Deploy, verify authenticated readiness, and perform a production no-send intake preview.
6. Reconfirm the exact production preview before the first real delivery.


# Matrix Signature Design

**Date:** 2026-07-28  
**Status:** Approved in conversation  
**Scope:** Canonical outbound email signature and revision of unsent drafts

## Goal

Use one concise, text-first sender signature across newly generated outbound
email drafts and refresh every eligible unsent draft as a new immutable version.
The change must make the official website, sender mailbox, and verified WhatsApp
entry easy to use without weakening exact-content approval or duplicate-send
protection.

## Canonical Signature

The authoritative English signature is:

```text
Best regards,

Gavin
Huasheng Printing Co., Ltd.
Website: https://gdhspack.com
Email: sales@gdhspack.com
WhatsApp: https://wa.me/8615850502651
```

This release is text-first and does not add a logo. The complete identity and
contact information therefore remains visible when an email client blocks
images. The WhatsApp URL contains the verified E.164 number without spaces,
punctuation, query parameters, or prefilled message text.

## Generation Rules

One focused helper owns signature normalization. Draft generators pass their
English body through the helper before persistence.

The helper:

- preserves the customer-specific body above the signature;
- recognizes existing `Best regards` signature blocks;
- removes duplicate sender, company, website, email, and WhatsApp lines from the
  replaced signature block;
- appends exactly one canonical signature with the exact blank-line layout;
- normalizes CRLF input to deterministic LF output;
- is idempotent: applying it twice produces the same body;
- does not add a logo, attachment, tracking parameter, QR code, or social icon;
- does not alter Chinese strategy/translation content.

## Existing Draft Migration

Only unsent, non-suppressed drafts that are still eligible for review are
refreshed. An existing immutable version is never edited in place.

For each eligible draft:

1. read the current exact body and current version;
2. normalize the English signature;
3. do nothing if the normalized body is byte-for-byte unchanged;
4. otherwise create exactly one successor version using the existing canonical
   revision path;
5. recompute the content hash and invalidate approval tied to the older body;
6. retain the same customer, recipient, subject, localization, evidence, and
   provenance;
7. create no delivery job and invoke no sender.

Sent, sending, bounced, suppressed, opted-out, cancelled, or otherwise terminal
records are not changed. A repeated migration is idempotent and creates no
additional version.

## Preview and Approval

Final preview displays the complete signature without truncation. The new
WhatsApp URL is part of the immutable body and therefore part of the exact
content hash and two-step approval boundary.

Any approval for an older body does not authorize the refreshed version. The
operator must review and approve the new exact version before it can be sent.
This design does not authorize any external email or WhatsApp action.

## Failure Handling

- An unrecognized or ambiguous signature boundary fails closed for migration;
  the record is reported for review rather than partially rewritten.
- A database error rolls back the current draft revision transaction.
- Invalid canonical configuration fails tests and startup validation.
- Migration reports counts only: scanned, revised, unchanged, skipped, and
  review-required. It does not print recipients or message bodies.

## Verification

Automated tests must prove:

- exact canonical layout and clickable HTTPS WhatsApp URL;
- CRLF normalization and idempotence;
- replacement of legacy signatures without duplicate fields;
- preservation of customer-specific body text;
- new drafts use the canonical signature;
- eligible unsent drafts receive one successor version and a new content hash;
- prior approval is not carried to the successor;
- sent and suppressed records remain unchanged;
- a second migration creates no extra versions;
- no delivery job is created and the relay is not invoked;
- final preview shows all signature lines without ellipsis.

The final operational check queries the authoritative database for aggregate
version/job counts before and after the no-send migration. It must not disclose
business records or protected provider identifiers.

## Out of Scope

- adding a logo or HTML signature;
- changing the sender or Reply-To identity;
- sending or approving any email;
- sending WhatsApp messages;
- changing website WhatsApp buttons;
- modifying previously sent message history.

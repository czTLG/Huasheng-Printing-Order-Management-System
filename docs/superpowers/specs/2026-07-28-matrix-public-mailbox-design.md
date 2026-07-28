# Matrix Public Mailbox Evidence Design

**Date:** 2026-07-28
**Status:** Approved

## Goal

Allow a public mailbox hosted by a consumer provider only when the address is explicitly published by the organization and independently corroborated by an authoritative public source, while preserving every existing approval, duplicate, cooling, suppression, quota, and delivery gate.

## Evidence modes

- `company_domain`: the recipient registrable domain equals the organization registrable domain and the source page is on the organization domain.
- `official_public_mailbox`: the source page is on the organization domain, the mailbox provider is allow-listed, and a recent authoritative corroboration repeats the exact mailbox and organization identity.

The public-mailbox provider allow-list is limited to `gmail.com`, `outlook.com`, `hotmail.com`, `live.com`, and `yahoo.com`. It does not authorize guessed addresses or addresses found only in directories.

## Input and storage

The reviewed candidate recipient gains:

- `evidence_mode`;
- `corroboration`, required only for `official_public_mailbox`;
- corroboration source URL, source class, observed timestamp, exact public mailbox, organization name, official domain, and identity-match fields.

Allowed corroboration source classes are `government`, `industry_association`, and `official_exhibition`. The evidence snapshot stores normalized provenance and hashes; it does not store credentials, private profiles, raw messages, quotations, or orders.

## Validation

A shared validator returns normalized recipient provenance. For a public mailbox it requires:

1. the exact address on a current HTTPS page under the organization domain;
2. an allow-listed provider;
3. a current HTTPS corroboration source distinct from the organization domain;
4. an allowed source class;
5. exact mailbox, organization name, and official-domain agreement;
6. at least two matching identity fields from address and phone.

Company-domain behavior remains unchanged.

## Downstream behavior

Candidate admission, immutable-version review, quality scoring, final preview, and delivery use the shared provenance result. Organization identity, duplicate checks, suppression, and the 90-day cooling window remain keyed to the official organization domain, never to `gmail.com` or another provider domain.

The final preview exposes the evidence mode and corroboration class without copying sensitive transport identifiers. A preview still does not authorize delivery.

## Tests

Regression coverage must prove:

- same-domain mailboxes remain accepted;
- an official public mailbox with complete corroboration is accepted end to end;
- missing, stale, mismatched, directory-only, or insufficient identity corroboration is rejected;
- unrelated organizations using the same provider do not share cooling state;
- the organization domain still enforces duplicate and cooling protection;
- Hock Xeng can reach draft and preview state without creating a delivery job.


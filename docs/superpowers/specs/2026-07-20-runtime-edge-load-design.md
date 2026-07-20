# Runtime Edge Load Design

## Goal

Reduce the perceptible post-login load time of `cahs.top` on desktop and mobile without changing business data, authorization, navigation, or form behavior.

## Confirmed Evidence

- The public HTML endpoint is healthy and the local application responds in about 2 ms.
- Authenticated production reads complete in about 14 ms for the order dashboard, 5 ms for the work-order list, and 10 ms for work-order metadata.
- The production TLS endpoint does not negotiate HTTP/2.
- The new UI loads one main bundle plus many lazy module and shared icon chunks after login.
- The work-order list fetches approximately 272 KB of create-form metadata before the user opens the create view.

## Selected Design

### Edge transport

Enable HTTP/2 on the existing TLS listeners for `cahs.top` while preserving the certificate, reverse proxy, HTTP redirect, request-size limit, and upstream address. Validate the candidate Nginx configuration before reload. A failed validation must leave the current configuration and process untouched.

### UI data loading

Do not fetch work-order create-form metadata when the list view first mounts. Load it only when the user enters the create view. Cache the successful result in component state so returning between list and create in one session does not repeat the request. List rows and preview drafts continue to load immediately.

### Failure behavior

If metadata loading fails after the create action, keep the create screen available and preserve the existing error notification. Prevent concurrent duplicate metadata requests. No write API is called during preloading.

## Verification

- A source-level regression test must fail before the UI change and pass after it, proving the metadata request is absent from initial list mount and is triggered by create intent.
- Frontend type-check and production build must pass.
- `nginx -t` must pass before reload.
- Public TLS must negotiate `h2` after reload.
- Production desktop and mobile smoke tests must load the new UI.
- Authenticated read-only timing checks must confirm the order and work-order endpoints remain consistent and responsive.

## Deployment and Rollback

- Back up the active Nginx site file before changing it.
- Build the existing frontend output and restart the existing management service using the normal service path.
- Preserve the previous frontend output and Nginx file as one rollback version until production verification passes.
- If HTTP/2 negotiation, service health, or browser smoke verification fails, restore both previous artifacts and reload the prior configuration.

## Out of Scope

- No database migration or business-record mutation.
- No API response-shape or permission change.
- No redesign, dependency upgrade, bundle-vendor refactor, CDN, or DNS change.

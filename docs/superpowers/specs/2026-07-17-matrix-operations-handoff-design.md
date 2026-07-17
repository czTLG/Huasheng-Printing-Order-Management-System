# Matrix Operations Handoff Design

**Date:** 2026-07-17  
**Status:** Design confirmed; pending document review  
**Target branch:** `feature/matrix-operations-handoff`

## Purpose

Create one durable, auditable branch that lets a new Codex session resume the existing external-placement work and the `stream-publisher` draft workflow without reconstructing state from several worktrees or committing credentials.

The handoff is operational documentation and tested tooling. It does not authorize new outreach, publication, account creation, DNS changes, or promotion of a draft to a live post.

## Scope

The consolidation will start from the latest `feature/foreign-trade-crm` state and bring in only the relevant artifacts from the existing worktrees:

- current `matrix-signal` approved-message, send-state, evidence, and follow-up records;
- the four tested `stream-publisher` command and policy scripts;
- sanitized self-hosting configuration and operator notes;
- a single session entry point that explains status, next actions, approval boundaries, and verification commands.

Unrelated branch history and unrelated dirty changes will not be merged into this branch.

## Proposed Repository Layout

### Unified session entry point

`docs/matrix-signal/SESSION_HANDOFF.md` will be the first file a new session reads. It will contain:

- the sole target domain: `https://gdhspack.com`;
- current external-placement status and the meaning of each status;
- follow-up dates and the next safe action;
- current `stream-publisher` deployment state and deferred channels;
- the required approval boundary before any external send or publication;
- links to all canonical records and operator commands;
- a short new-session checklist.

### External-placement records

The existing neutral-codename files under `docs/matrix-signal/` remain canonical:

- `messages.md`: approved message bodies and editorial targets;
- `packet.md`: operational batch summary and send results;
- `registry.csv`: per-target status, evidence, and follow-up date;
- existing identity, evidence, and asset files needed to interpret those records.

The records must distinguish these states precisely:

1. prepared;
2. approved for sending;
3. SMTP accepted;
4. editorial reply received;
5. accepted for publication;
6. published;
7. live link independently verified.

`SMTP accepted` must never be described as editorial acceptance, publication, or a backlink.

### Stream-publisher tooling and deployment notes

The handoff branch will include:

- `scripts/stream-publisher-cli.mjs`;
- `scripts/stream-publisher-cli.test.mjs`;
- `scripts/stream-publisher-policy.mjs`;
- `scripts/stream-publisher-policy.test.mjs`;
- `deploy/stream-publisher/README.md`;
- `deploy/stream-publisher/APPROVAL.md`;
- `deploy/stream-publisher/CHANNELS.md`;
- `deploy/stream-publisher/SOURCE.md`;
- `deploy/stream-publisher/compose.local.yaml`;
- `deploy/stream-publisher/runtime.env.example`.

The tracked configuration will preserve loopback-only defaults and draft-first behavior. It will document that LinkedIn Page and Medium remain deferred until their platform prerequisites are supplied.

## Data Flow and Approval Boundary

The intended flow is:

`content idea -> local draft -> human review -> explicit approval -> platform action -> result recorded`

The policy wrapper must continue to force draft mode and reject schedule, immediate-publication, or status-promotion attempts. A future session may prepare drafts and update local records, but it must obtain fresh explicit approval before sending an external message or publishing content.

## Security and Privacy

Before any push, the implementation must determine the GitHub repository visibility using the authenticated GitHub client or the authoritative repository page.

- Credentials, OAuth tokens, API keys, SMTP passwords, cookies, and the live `runtime.env` are never committed.
- Docker volumes and generated runtime state are never committed.
- Only a placeholder-based `runtime.env.example` may be tracked.
- If the remote is public, SMTP message IDs and other unnecessary operational identifiers will be removed from the tracked copy. A local private ledger may retain them outside the pushed record.
- If the remote is private, credentials are still excluded; operational identifiers are kept only when they materially support auditability.
- Public editorial addresses may be documented where operationally necessary, but private or guessed personal contact data will not be added.
- Upstream project name, source URL, version, license, dependency behavior, and audit trail remain explicit even though the local capability uses a neutral codename.

## Runtime State to Document

The handoff will record verified facts without embedding secrets:

- the service currently uses loopback port `4407`;
- the supporting workflow service uses loopback port `7723`;
- the local workflow UI uses loopback port `8808`;
- `stream.gdhspack.com` DNS and HTTPS are not yet configured;
- account bootstrap, registration closure, DNS, TLS, and platform OAuth remain operator actions;
- LinkedIn Page and Medium are deferred.

Commands that expose secret values will not be placed in the handoff.

## Verification

Before commit and push, the implementation will run:

1. both Node test suites for the policy and command wrappers;
2. syntax checks for all tracked JavaScript entry points;
3. a compose configuration validation using placeholder or temporary values;
4. file-link and required-section checks for the handoff documents;
5. a repository scan for common secret patterns and live runtime files;
6. `git diff --check` and a scoped review of every changed file;
7. a remote visibility check;
8. a final branch status and commit inspection.

The project-wide baseline check is also attempted. If it cannot run because the required private `GOLDEN_BASELINE_PATH` is unavailable, that operational limitation will be recorded rather than bypassed.

## Commit and Push Strategy

Implementation will use small, reviewable commits on `feature/matrix-operations-handoff`:

1. this design document;
2. external-placement records and unified handoff;
3. stream-publisher scripts and sanitized deployment packet;
4. verification or documentation corrections, if needed.

After verification, the branch will be pushed to `origin/feature/matrix-operations-handoff`. The push will not alter or overwrite the existing source branches.

## Acceptance Criteria

The work is complete when:

- a new session can identify the current state and next safe action from one document;
- external-placement statuses and follow-up dates are preserved accurately;
- draft-only safeguards remain tested and passing;
- the self-hosting notes are reproducible without containing secrets;
- repository visibility has been checked and tracked data is appropriate for it;
- the branch is committed and available on the remote;
- no outbound message or social post is sent as part of consolidation.

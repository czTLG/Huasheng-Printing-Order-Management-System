# Matrix Runtime User Catalog Design

**Date:** 2026-07-18  
**Status:** Design confirmed; pending document review  
**User scope:** Linux user `admin` on this host

## Purpose

Make verified reusable capabilities and authoritative business resources discoverable to every new Codex session owned by the same Linux user. Email, future messaging APIs, social publishing, website operations, management-system resources, and private knowledge must not depend on one conversation or one project-local handoff file.

The catalog shares authoritative entry points. It does not copy live order, customer, quotation, credential, or token data into global instructions or preload that data into every session.

## Chosen Architecture

Use a hybrid of a user-level rule, a neutral user-level catalog, existing user-level skills and commands, and pointers to canonical projects.

### User-level rule

`/home/admin/.codex/AGENTS.md` will gain a `User-Level Shared Runtime` section requiring sessions to:

- discover reusable capabilities through the user catalog;
- register every newly verified cross-project capability after installation;
- keep shared skills and commands in user-visible locations rather than session or worktree-only paths;
- preserve project-owned source and data in their authoritative projects;
- read actual business data only when the current task requires it;
- preserve approval gates for external messages, publication, deployment, and other consequential actions;
- never copy credentials or sensitive records into the catalog.

### Neutral user catalog

Create:

```text
/home/admin/.codex/matrix-runtime/
├── INDEX.md
├── capabilities/
│   ├── message-relay.md
│   └── stream-publisher.md
└── resources/
    ├── site-runtime.md
    ├── matrix-console.md
    └── matrix-build-cache.md
```

The neutral codenames comply with the user's private naming rule. Each entry may state its real purpose inside the document so natural-language tasks remain discoverable.

### Existing user-level execution locations

- Cross-project skills: `/home/admin/.codex/skills/`
- Cross-project commands: `/home/admin/.local/bin/`
- User catalog and handoff metadata: `/home/admin/.codex/matrix-runtime/`
- Root-owned shared secrets: purpose-specific files under `/etc/`, mode `600`
- User-owned shared secrets, when appropriate: a purpose-specific private configuration directory, mode `700` with files mode `600`
- Project source and live data: remain in their authoritative repository or service path

## Catalog Schema

`INDEX.md` will list every entry with:

- neutral codename;
- capability or resource type;
- real task triggers and purpose;
- status: `ready`, `partial`, or `disabled`;
- authoritative document path;
- last verified date;
- whether use requires explicit approval.

Each capability or resource document will contain only the fields relevant to it, selected from:

- purpose and natural-language triggers;
- canonical implementation, project, service, database, or knowledge path;
- user-level launcher or skill path;
- protected configuration path and variable names, never values;
- service name and non-secret endpoint;
- read/write or outbound approval boundary;
- preflight checks;
- audit or evidence location;
- current limitations;
- last verified timestamp.

## Initial Entries

### `site-runtime`

The authoritative entry for public website operations:

- canonical repository: `/home/admin/work/huasheng-packing`;
- public domain: `https://gdhspack.com`;
- service: `huasheng-packing.service`;
- current repository branch and deployment state must be checked at use time;
- production configuration remains outside the catalog;
- deployment or external mutation follows the user's explicit task scope.

### `matrix-console`

The authoritative entry for the existing management system and related operational records:

- canonical repository: `/home/admin/work/packaging-system`;
- service: `packaging-system.service`;
- live databases, order records, customer records, quotation records, private formulas, and attachments remain in their existing authoritative storage;
- the catalog provides paths and read conditions but does not duplicate records;
- a session reads or changes actual records only when the task requires and authorizes it.

### `message-relay`

The cross-session email sender entry:

- sender identity: `Huasheng Packaging Editorial Team <sales@gdhspack.com>`;
- protected configuration: `/etc/packaging-system/smtp.env`;
- systemd binding: `/etc/systemd/system/packaging-system.service.d/smtp.conf`;
- Node.js and `nodemailer` runtime requirements;
- exact-message approval and duplicate-send gates;
- SMTP acceptance semantics;
- private and public evidence boundaries;
- warning not to use `/etc/huasheng-packing/production.env` for this sender;
- known security follow-up for the legacy commented credential block, without reproducing its values.

### `stream-publisher`

The cross-session social draft workflow entry:

- installed skill: `/home/admin/.codex/skills/stream-publisher`;
- launcher: `/home/admin/.local/bin/stream-publisher`;
- runtime and operator paths are recorded without copying credentials;
- draft-first policy and explicit publication approval remain mandatory;
- channel status distinguishes connected, deferred, and unavailable platforms.

### `matrix-build-cache`

The user-level private knowledge entry:

- installed skill: `/home/admin/.codex/skills/matrix-build-cache`;
- its real natural-language triggers remain in the skill description;
- source formulas, prices, margins, customer material, and distilled history remain private;
- sessions use it only for tasks matching its trigger conditions;
- uncertain knowledge remains marked unresolved.

WhatsApp or any other API is added only after its runtime is actually configured and minimally verified. It must not be marked `ready` based on a placeholder or intended future setup.

## Registration Lifecycle

Whenever a session adds a reusable capability:

1. Determine whether it is user-wide or truly project-specific.
2. Install reusable skills under `/home/admin/.codex/skills/` and commands under `/home/admin/.local/bin/`.
3. Keep canonical source in its owner project when moving it would break ownership or deployment.
4. Store credentials in a protected purpose-specific configuration file.
5. Run a proportional smoke test without printing secrets.
6. Add or update the neutral catalog entry with status, paths, triggers, approvals, limitations, and verification date.
7. Verify the entry from a clean working directory that is not the owner project.
8. Record only sanitized, durable metadata in version-controlled project documentation when a project handoff also needs it.

A capability is `ready` only when its canonical path exists, required configuration is present, and the documented preflight passes. Missing credentials, deferred authorization, or incomplete setup makes it `partial`. A known-broken or intentionally unavailable capability is `disabled`.

## Session Discovery Flow

For a task involving an API, external communication, website operation, management-system data, or private knowledge:

1. Read `/home/admin/.codex/matrix-runtime/INDEX.md`.
2. Select only the relevant entry.
3. Read the entry completely.
4. Validate current paths, service state, permissions, and configuration presence.
5. Read actual project or business data only when the task requires it.
6. Obtain any required approval before external or consequential action.
7. Update the catalog when a durable capability fact changes.

The catalog is discovery metadata, not a blanket authorization mechanism. Finding a capability never expands the user's task scope.

## Security and Privacy

- Never store passwords, API keys, OAuth tokens, cookies, session material, CAPTCHA data, private customer data, order details, quotation details, private formulas, or complete SMTP identifiers in `AGENTS.md` or the catalog.
- Catalog files should be readable by the `admin` user and protected from unnecessary write access.
- Secret paths and environment-variable names may be documented; secret values may not.
- Do not solve access problems by loosening secret-file permissions, copying protected files, or loading secrets into interactive shell history.
- Public repositories receive sanitized evidence only.
- Private operational identifiers remain in ignored permission-restricted ledgers.
- A different server may receive a synchronized non-secret catalog, but credentials must be provisioned separately; this design does not implement cross-server secret synchronization.

## Error Handling

- Missing path: report the exact missing catalog entry or canonical path and stop if it prevents the requested action.
- Unreadable protected configuration: request the minimum required authorization; do not copy it to a weaker location.
- Sender or account mismatch: stop; do not substitute another account.
- Stale entry: validate the authoritative resource and update the catalog before relying on it.
- Failed smoke test: mark `partial` or `disabled` and record the limitation.
- Duplicate external action risk: check the authoritative state or evidence ledger and refuse an unapproved repeat.

## Verification

Implementation will verify:

1. the user rule points to the catalog;
2. all initial catalog entry files exist;
3. all canonical project, skill, launcher, service-binding, and protected configuration paths resolve as documented;
4. the catalog contains no common secret assignments or SMTP Message-IDs;
5. permissions meet the documented boundary;
6. email preflight identifies `sales@gdhspack.com` without printing credentials;
7. both services are discoverable and their current status is recorded at verification time;
8. a simulated new session starting outside both projects can locate the website, management system, email sender, social workflow, and private knowledge entry from `INDEX.md` alone;
9. missing or deferred capabilities are not labeled `ready`.

## Acceptance Criteria

- Every new session owned by `admin` has a stable rule telling it where shared capabilities and resources are registered.
- Website, management-system, sender, social, and private-knowledge entries are discoverable from one index.
- Actual business data remains authoritative in its existing source and is read only when required.
- No credential or sensitive business record is copied into user instructions or catalog files.
- External-action approvals and duplicate-send protections remain explicit.
- Future verified APIs have a mandatory, repeatable registration process.

## Non-Goals

- No automatic preload of customer, order, quotation, or private knowledge data into every session.
- No cross-server secret replication.
- No relocation or renaming of existing repositories, services, or private codenames.
- No claim that an unconfigured future API is available.
- No expansion of a session's authority merely because a capability is listed.

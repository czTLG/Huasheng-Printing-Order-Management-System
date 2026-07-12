# Runtime Rebuild and Data Hygiene Design

## 1. Objective

Build a reproducible migration path so that possession of the private Git repository and a separately stored private data bundle is sufficient to rebuild the system on a new Ubuntu server.

The migration must preserve orders, order-stage history, work orders, calculation snapshots, quotations, users, permissions, audit records, customer records, messages, uploaded images, attachments, and required business configuration. Cleanup and deduplication must never be allowed to destroy the only recoverable copy.

## 2. Scope and constraints

The target platform is Ubuntu 22.04 or 24.04 with Node.js 22, Nginx, systemd, SQLite, DNS, and HTTPS.

The design follows the existing native deployment architecture. It does not introduce Docker, change legacy API contracts, migrate the database engine, alter calculation formulas, or modify production data directly during the audit phase.

Sensitive business data must not enter Git. This includes:

- `data/app.db` and derived database snapshots;
- customer and user records;
- internal calculation results and material prices;
- uploaded order images and CRM attachments;
- mailbox credentials, synchronization tokens, application secrets, and TLS private keys.

## 3. Selected approach

Use two independently managed artifacts:

1. **Repository artifact**: application source, lock files, deployment templates, backup and verification tooling, environment-variable template, and reconstruction documentation.
2. **Private data artifact**: a verified SQLite snapshot, referenced business files, required data-side JSON configuration, a manifest, checksums, and encrypted secret material or instructions for recreating secrets.

This is preferred over a machine image because it is portable across hosting providers, and over containerization because it preserves the current production architecture and minimizes migration risk.

## 4. Safety model

Migration and cleanup use four immutable stages:

1. Capture an original recovery snapshot before analysis.
2. Audit production data and files read-only.
3. Rehearse proposed cleanup against a disposable copy.
4. Produce the final migration snapshot only after verification.

No cleanup command may run automatically as part of backup or migration. Audit output must classify candidates without deleting them. Any later cleanup implementation must require an explicit allowlist and produce a before/after report.

Core business tables are never automatically deduplicated. Similar orders, work orders, calculation snapshots, quotations, customers, users, or audit records may represent legitimate versions or workflow events.

## 5. Data inventory

### 5.1 Database

The default source is `data/app.db`, unless `DB_PATH` explicitly selects another database. The snapshot contains all SQLite tables, including the following critical groups:

- order records and stage history;
- work orders, templates, and preview drafts;
- calculation snapshots, material prices, aliases, requests, and review records;
- quotations and quotation sheets;
- users, permissions, subscriptions, and audit logs;
- customers, inquiries, specifications, communications, messages, and attachments metadata;
- email synchronization and analysis history.

The database snapshot must be created through SQLite's online backup mechanism exposed by `better-sqlite3`. Copying a live database file with `cp` is not an accepted backup method.

### 5.2 Business files

The data bundle must include files referenced by database paths or URLs and required runtime configuration, including:

- `public/uploads/orders/`;
- attachment files referenced by `crm_message_attachments.storage_path`;
- existing `data/uploads/`, if present;
- `data/product_prefill_map.json`;
- `data/customer_bag_map.json`;
- `data/material_options.json`;
- `data/system_package_config.json`;
- other data-side files explicitly discovered by the inventory command.

Email-analysis prompt/output files are inventoried separately. They are included or excluded according to an explicit retention decision and must not silently disappear.

### 5.3 Secrets

Secrets are recreated from a private secret store or transferred as a separately encrypted file. `.env.example` documents names and safe placeholders only. The reconstruction guide must fail closed when required variables are missing.

## 6. Audit and deduplication

The audit produces machine-readable JSON and a human-readable Markdown summary. It must not reveal passwords, tokens, message bodies, internal prices, or customer contact details in console output.

### 6.1 File classifications

- exact duplicate: identical SHA-256 and size;
- orphan candidate: business file not referenced by the current database or an approved static manifest;
- missing reference: database points to a file that does not exist;
- expired intermediate artifact: generated prompt, output, export, archive, or build artifact older than its configured retention period;
- protected file: current database, required configuration, active upload, or latest verified recovery artifact.

Duplicate files are reported as groups. The report recommends a canonical copy but does not replace files with links and does not delete duplicates.

### 6.2 Database classifications

- structural health: `PRAGMA integrity_check`, foreign-key inspection, schema inventory, page count, and database size;
- critical counts: record counts and maximum update timestamps for critical tables;
- exact-row candidates: rows identical across explicitly selected non-key fields;
- possible business duplicates: similar identifying fields within a defined time window;
- relationship anomalies: orphan foreign-key-like references, missing attachment files, or records referring to absent parents.

Possible duplicates remain unresolved until a human reviews business provenance and relationships. Audit and workflow histories are append-only evidence and are excluded from automatic deletion.

## 7. Backup artifact format

Each successful data artifact contains:

```text
runtime-data-YYYYMMDD_HHMMSS/
├── database/app.db
├── files/public/uploads/orders/
├── files/data/uploads/
├── config/data/*.json
├── manifest.json
├── checksums.sha256
└── verification.json
```

`manifest.json` records the creation time, source host identifier, Git commit, Node version, database path, included roots, excluded roots, file counts, sizes, critical table counts, and migration format version. It contains no secret values.

The artifact is first built in a temporary directory, verified, archived, optionally encrypted, and atomically renamed into its final location. A failed build must leave the prior healthy artifacts unchanged.

Local recovery copies use directory mode `0700` and file mode `0600`. Off-host copies must be encrypted in transit and at rest.

## 8. Verification requirements

A backup is healthy only when all checks pass:

- archive extraction succeeds in a temporary directory;
- SHA-256 verification succeeds;
- SQLite `integrity_check` returns `ok`;
- required tables exist;
- critical table counts match the manifest;
- required configuration files exist and parse successfully;
- referenced attachments are either present or explicitly listed as pre-existing missing references;
- a disposable application instance can open the restored database without modifying production data;
- application health and smoke verification succeed where the environment permits.

Verification status is stored as data, not inferred from the existence of an archive.

## 9. Reconstruction flow

The reconstruction guide will implement this sequence:

1. Provision Ubuntu and create a non-root application account.
2. Configure SSH access, time zone, hostname, firewall, and security updates.
3. Clone the private Git repository at a named commit or release tag.
4. Install Node.js 22, Nginx, and required native build packages.
5. Install locked backend and frontend dependencies with `npm ci`.
6. Build the current React frontend into its expected output directory.
7. Transfer, decrypt, and verify the private data artifact.
8. Restore the database, files, and data configuration with restrictive ownership and permissions.
9. Recreate environment variables from the private secret source.
10. Install and start the templated systemd service.
11. Install Nginx configuration and initially expose only a local or temporary hostname.
12. Run database verification, health checks, smoke tests, and a read-only business checklist.
13. Configure DNS and obtain a Let's Encrypt certificate.
14. Freeze writes on the old server for the final short cutover window, create a final delta snapshot, restore it on the new host, and repeat verification.
15. Switch DNS, monitor the new service, and retain the old server in read-only rollback readiness for the agreed observation period.

## 10. Restore and rollback

Restore never overwrites a database used by a running process. The required order is:

1. verify the selected artifact before touching the service;
2. stop the application service;
3. capture a pre-restore rollback snapshot;
4. restore into a sibling staging path;
5. verify the staged database and files;
6. atomically switch the active data path;
7. start the service;
8. run health, database, and business checks;
9. atomically switch back and restart if any required check fails.

Code rollback uses a named Git commit or release tag. Data rollback uses the pre-restore snapshot. These are separate operations and the guide must state which one is being performed.

## 11. Network and cutover

Nginx terminates HTTP/HTTPS and proxies only to `127.0.0.1:8080`. The firewall exposes SSH, port 80, and port 443; the Node port is not publicly exposed.

Before migration, reduce DNS TTL to 300 seconds. Obtain and test TLS on the new host before final cutover when DNS validation permits. Preserve the old server for rollback until logs, login, order lookup, work-order lookup, calculation snapshot lookup, user permissions, exports, images, and attachments have been confirmed.

## 12. Operational backup policy

The rebuilt server should support:

- hourly snapshots retained for 48 hours;
- daily snapshots retained for 30 days;
- weekly snapshots retained for 12 weeks;
- monthly snapshots retained for 12 months;
- at least one encrypted off-host copy;
- daily automated integrity verification;
- a documented restore rehearsal at least monthly.

Retention cleanup runs only after a new artifact has passed verification and must never remove the last known healthy artifact in any required tier.

## 13. Documentation deliverables

Implementation will update `docs/DEPLOYMENT_FULL_REPRO.md` into the canonical Chinese operator guide. It will contain:

- prerequisites and variable conventions;
- old-server audit, backup, and export commands;
- private artifact transfer and verification;
- new-server bootstrap and frontend build;
- database, attachment, configuration, and secret restoration;
- systemd, Nginx, firewall, DNS, and HTTPS setup;
- final cutover, acceptance, rollback, and troubleshooting;
- recurring backup and restore-rehearsal instructions;
- a one-page fast-rebuild checklist.

The existing README statement that a live SQLite database can be backed up by merely copying the file will be corrected to distinguish an offline copy from an online consistent backup.

## 14. Acceptance criteria

The work is accepted when:

- audit commands run read-only and produce both JSON and Markdown reports;
- no audit or backup output discloses sensitive record contents;
- a verified private artifact contains all required database and file categories;
- corrupt or incomplete artifacts are rejected;
- reconstruction instructions work from a clean supported Ubuntu host using the repository and private artifact;
- the restored system passes integrity, health, smoke, permission, and critical business checks;
- rollback steps are explicit and independently testable;
- no production record or business file is deleted by the migration tooling.


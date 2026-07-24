# Matrix Runtime Ledger Runbook

This runbook cuts all supported session and assistant operations over to the canonical management-service ledger. It does not authorize external delivery or production deployment.

## Safety boundary

- Keep database backups, migration reports, delivery evidence, and unresolved records in a permission-restricted `runtime-data-*` directory.
- Never print or copy protected credential values.
- Migration, readiness checks, preview reads, and inbox reconciliation must not send email.
- External delivery still requires the exact final confirmation text shown by the canonical preview.
- Once `canonical_delivery_only=1`, do not attempt to set it to `0`. Roll back code only; retain authoritative data and the cutover flag.

## 1. Protected backup

Resolve `DB_PATH` from protected service configuration without printing its contents. Create an online SQLite backup in a mode-0700 directory, set the snapshot to mode 0600, run `PRAGMA integrity_check`, and record only its path, size, checksum, and timestamp.

The apply migrator performs this backup preflight automatically before changing rows.

## 2. Prepare and review a protected report

The report must be under a mode-0700 runtime directory and itself mode 0600. It may contain only authorized source identifiers, minimum matching evidence, state, timestamps, and provenance hashes.

```bash
MATRIX_MIGRATION_RUNTIME_DIR=<protected-directory> \
node scripts/run-matrix-ledger-migration.js \
  --dry-run \
  --report <protected-report.json>
```

Stop if `unresolved` or `conflicts` is nonzero. Review the reason-coded records before continuing.

## 3. Apply and prove idempotency

```bash
MATRIX_MIGRATION_RUNTIME_DIR=<protected-directory> \
node scripts/run-matrix-ledger-migration.js \
  --apply \
  --report <protected-report.json> \
  --idempotency-key <approved-unique-key>
```

Run the same report again with a new reconciliation key. The unchanged rerun must import zero rows and create no duplicate customers, contacts, threads, tasks, or delivery jobs.

## 4. Client smoke tests

```bash
node scripts/test-matrix-ledger-cli.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-ledger-client.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-choice-context.js
```

From a clean non-project directory, read `/home/admin/.codex/matrix-runtime/INDEX.md`, locate `matrix-console`, and verify `/home/admin/.local/bin/matrix-runtime` is discoverable. Retrieve a known customer, tasks, threads, and final preview. Stop before confirmation.

## 5. Enable canonical-only mode

After successful migration and explicit production approval, initialize the current schema and call `enableCanonicalDeliveryOnly` with the authorized active administrator ID. Confirm the stored value is exactly `1`.

```bash
node scripts/verify-matrix-ledger-cutover.js --no-send
```

Expected output includes `"ready":true` and `"send_invoked":false`.

## 6. Deployment

Deploy only the reviewed commit. Restart only:

- `packaging-system.service`
- the reviewed Feishu runtime container

Verify service/container health, restart counts, deployed source hashes, the management readiness API, and the public management page. No final confirmation action is permitted during smoke testing.

## 7. Inbox and Sent cycle

Observe at least one complete five-minute polling cycle. Confirm:

- INBOX and Sent checkpoints complete;
- inserted messages reconcile once;
- attachments remain bound to their canonical thread;
- accepted delivery has one pending check-reply task;
- a real customer reply cancels that task and creates one review-reply task;
- unresolved records remain isolated;
- no consecutive polling failures or duplicate tasks appear.

## 8. Rollback

If application verification fails, restore the previous reviewed code release and restart the two scoped services. Do not restore an older database over the canonical ledger and do not disable `canonical_delivery_only`. Preserve the new database and migration backup for diagnosis. Legacy CSV, worktrees, and private evidence remain read-only and cannot become a delivery fallback.

# Task 1 Report: Persisted State and Explicit Permission

## Status

DONE

Implemented and committed the persisted review state, append-only/immutability protections, normalized explicit permission, and Admin permission control. No email was sent and no credential material was read or included in this report.

## TDD evidence

### Schema RED

- Command: `node scripts/test-matrix-stream-review.js`
- Result: exit 1.
- Expected failure: `AssertionError [ERR_ASSERTION]: matrix_stream_versions missing`.
- Interpretation: the new schema test reached database initialization and failed on the first missing required table.

### Schema GREEN

- Command: `node scripts/test-matrix-stream-review.js`
- Result: exit 0 after the migration was added.
- Repeated pre-commit and post-commit with exit 0; command output was redirected because the existing fresh-database initializer emits bootstrap account material.

### Permission RED

- Command: `node scripts/test-admin-access-regression.js`
- Result: exit 1.
- Expected failure: `TypeError: Cannot read properties of undefined (reading 'matrixSend')`.
- Interpretation: the regression test demonstrated that normalized permissions did not yet contain `capabilities`.

### Permission GREEN

- Command: `node scripts/test-admin-access-regression.js`
- Result: exit 0 after role-gated capability normalization was implemented.
- Repeated pre-commit and post-commit with exit 0.

## Verification

- `node -e "JSON.parse(require('node:fs').readFileSync('shared/permissions-model.json','utf8'))" && node scripts/test-admin-access-regression.js`: exit 0.
- `npm run verify:smoke`: initially exposed three stale exact-shape assertions that omitted the newly required default `capabilities.matrixSend: false`; those regression expectations were updated.
- `npm run verify:smoke`: `SMOKE PASS`, exit 0 after the expectation update.
- A later sandboxed smoke rerun could not bind temporary port `19081` (`EPERM`); rerunning through the approved localhost-capable path produced `SMOKE PASS`, exit 0.
- `git diff --check`: exit 0 before commit.
- `git diff --check HEAD^ HEAD`: exit 0 after commit.

### Build-plan baseline difference

- The root `package.json` has no `build` script, so no root build was claimed or added.
- `frontend-next/package.json` does have `build`; its first run exited 127 before compilation because this isolated worktree had no installed frontend toolchain (`tsc: not found`).
- Two lockfile-based dependency restoration attempts were unsuccessful in this environment: the first ended with npm's `Exit handler never called!` error while its log directory was unavailable; the second produced no progress and was stopped to avoid blocking completion. At the implementer handoff, the frontend build was the only unresolved verification item.
- Controller follow-up used the already installed main-workspace frontend dependency tree through a temporary worktree-only symlink, then ran `npm run build` from `frontend-next`: TypeScript and Vite completed successfully with 2,660 modules transformed. Vite reported the existing chunk-size warning; the symlink was removed and no generated source diff remained.

## Files changed in commit

- `src/db.js`
- `shared/permissions-model.json`
- `src/lib/permissions.js`
- `frontend-next/src/components/Admin.tsx`
- `scripts/test-matrix-stream-review.js`
- `scripts/test-admin-access-regression.js` (the task brief called this a modification, but it was absent at the branch baseline, so it was created)
- `scripts/smoke-test.js` (updated exact permission-object expectations for the new normalized capability)

Coordination inputs `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/progress.md` were not committed. This report was written after the feature commit so it could record the immutable commit hash, and is likewise not part of that commit.

## Commit

- Commit: `2dbf508e979f45d4a79d1ba9f9fba1708b06594e`
- Subject: `feat: add matrix stream review state`
- Scope: 7 files, 223 insertions, 18 deletions.

## Self-review

- Required core tables, auxiliary policy/check tables, guarded compatibility columns, stable checks/uniques/foreign keys, required indexes, append-only event triggers, and approved-content immutability trigger are present.
- `matrixSend` is false in every role default, is only requestable by `super_admin` and `foreign_trade_crm_admin`, and `all: true` remains authorized.
- Admin editing initializes and writes the checkbox value while spreading the existing permission object and nested capabilities, so other permission edits do not erase it.
- No unrelated build script or external-send behavior was introduced.

## Concerns

- No blocking concern remains for Task 1. The existing Vite chunk-size warning is outside this task's permission/schema scope.

## Review-fix follow-up

### Disposition

DONE

All Critical, Important, and straightforward Minor findings from `task-1-review.md` were addressed in a separate fix commit.

### Review RED evidence

1. Approved-row deletion guard:
   - Command: `node scripts/test-matrix-stream-review.js > /tmp/task1-review-schema-red.log 2>&1`
   - Result: exit 1 at the approved-version `DELETE` assertion.
   - Expected failure: `assert.throws` received no exception (`actual: undefined`, expected `/immutable/`), proving approved evidence could be deleted.
2. Post-supersession content bypass:
   - Command: `node scripts/test-matrix-stream-review.js > /tmp/task1-review-supersession-red.log 2>&1`
   - Result: exit 1 at the content-edit assertion after the legitimate `approved→superseded` transition.
   - Expected failure: `assert.throws` received no exception (`actual: undefined`, expected `/immutable/`), proving the two-step bypass.
3. Existing-database trigger upgrade:
   - Command: `node scripts/test-matrix-stream-review.js > /tmp/task1-review-upgrade-red.log 2>&1`
   - Result: exit 1 at the post-supersession edit assertion after seeding the prior trigger definition.
   - Expected failure: `CREATE TRIGGER IF NOT EXISTS` retained the vulnerable old trigger.

The added `super_admin` explicit-grant and `all:true` permission assertions passed immediately against the already compliant implementation; they lock down existing security behavior rather than drive a production-code change.

### Review GREEN evidence

- `node scripts/test-matrix-stream-review.js > /tmp/task1-review-upgrade-green.log 2>&1 && node scripts/test-admin-access-regression.js`: exit 0.
- Final focused run `node scripts/test-matrix-stream-review.js > /tmp/task1-review-final-schema.log 2>&1 && node scripts/test-admin-access-regression.js`: both focused tests reached GREEN before smoke execution.
- The schema regression now proves:
  - required named index column order;
  - `(work_item_id, revision)`, job idempotency-key, and message-ID uniqueness;
  - event UPDATE and DELETE rejection;
  - direct approved content-edit rejection;
  - approved-row deletion rejection;
  - legitimate `approved→superseded` transition;
  - post-supersession edit, deletion, and lifecycle rollback rejection;
  - replacement of the vulnerable trigger during an existing-database upgrade.
- Temporary DB close/removal now runs in `finally`.

### Review verification

- `npm run verify:smoke`: `SMOKE PASS`, exit 0 through the approved localhost-capable path. A preceding sandbox-only attempt failed solely because binding temporary port `19081` returned `EPERM`.
- `npm run build` in `frontend-next`, using the controller-confirmed temporary symlink to the main-workspace dependency tree: exit 0; TypeScript and Vite built successfully, 2,660 modules transformed. The ignored symlink was unlinked afterward without modifying the main dependency tree.
- `git diff --check`: exit 0 before the fix commit.
- No outbound behavior or credential handling was added.

### Review-fix implementation

- Approved and superseded versions now lock all protected content plus `approved_by`, `approved_at`, and creation provenance.
- Approved and superseded versions cannot be deleted.
- The approval lifecycle is irreversible while preserving the required `approved→superseded` transition.
- Initialization explicitly drops and recreates the content-immutability trigger so existing databases receive the corrected definition.

### Review-fix commit

- Commit: `f40d2a99deb7d8f45c7eb7b6fb4d54422e27fa5b`
- Subject: `fix: preserve matrix stream approval evidence`
- Scope: `src/db.js`, `scripts/test-matrix-stream-review.js`, `scripts/test-admin-access-regression.js`.

### Review-fix concerns

- No blocking concern remains. Vite's pre-existing large-chunk warning remains outside Task 1 scope.

## Re-review test-completeness follow-up

### Disposition

DONE

Only `scripts/test-matrix-stream-review.js` was changed. No production or UI behavior changed, so frontend build and smoke were intentionally not repeated.

### Test additions and evidence

- Added a direct assertion that `approved → draft` is rejected with the lifecycle-trigger diagnostic.
- Added a second `matrix_stream_events` insert using `event-key-1` and asserted `UNIQUE constraint failed: matrix_stream_events.idempotency_key`.
- These assertions lock down existing, already-reviewed implementation behavior and therefore ran directly GREEN; no RED is claimed or fabricated.
- Command: `node scripts/test-matrix-stream-review.js > /tmp/task1-rereview-schema-green.log 2>&1 && node scripts/test-admin-access-regression.js && git diff --check`
- Result: exit 0 for the focused schema test, permission regression, and diff check.

### Commit

- Commit: `2ccd62b6c45ea76bfd4051f24a4531e8cbc89fee`
- Subject: `test: cover matrix stream lifecycle uniqueness`
- Scope: `scripts/test-matrix-stream-review.js`, 11 insertions.

### Concerns

- None.

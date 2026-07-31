# Task 6 Report

## Status

DONE

## Commit

- `bf2eef3 test: verify matrix stream phase one`

The commit contains exactly:

- `scripts/verify-matrix-phase1.js`
- `docs/operations/matrix-phase1-runbook.md`
- `package.json`

## Implementation

- Added a temporary-database integration verifier covering schema initialization, deterministic classification, signal storage through guarded import, the current-CRM read-only adapter, and the authenticated read-only candidate API.
- Verified the exact six approved countries, 20 accepted records per country, 120 accepted records per run, rejection of a 121-record run, per-country overflow handling, and India exclusion before persistence.
- Snapshotted `customers`, `crm_messages`, `email_messages`, and `communication_logs` to prove guarded import, current-CRM classification, and candidate API listing do not write formal CRM tables.
- Asserted zero Phase 1 delivery exports, dependencies, commands, and Matrix write routes.
- Added the `verify:matrix-phase1` package command.
- Added an operations runbook covering read-only dry run, evidence JSON schema, counters, sampling, conservative run-owned rollback, secret isolation, and unavailable delivery.

## TDD Evidence

- RED: `node scripts/verify-matrix-phase1.js` exited 1 after executing the integration checks with `AssertionError: package command must wire the phase-one verifier`.
- GREEN: `npm run verify:matrix-phase1` exited 0 with `matrix phase-one verification passed`.

## Final Verification

- `npm run verify:matrix-phase1` — PASS (`matrix phase-one verification passed`)
- `npm run verify:smoke` — PASS (`SMOKE PASS`)
- `git diff --check` — PASS (no output)
- `node --check scripts/verify-matrix-phase1.js` — PASS (no output)

## Review / Concerns

- No Critical or Important findings in local diff review.
- The verifier's API check requires permission to bind a temporary localhost port; restricted sandboxes must run it with local-loopback permission.
- The current schema records `run_id` on classifications but not on shared entities/evidence. The runbook therefore rolls back only the run-owned `matrix_classifications` rows and its `matrix_runs` row. It intentionally does not guess ownership of or delete shared `matrix_entities`/`matrix_evidence`.

## Independent Review Fixes

Status: DONE

Commit:

- `585447a test: expand matrix phase one safety verification`

Corrections:

- Expanded the unified `verify:matrix-phase1` command to run the complete guarded-import contract (`test:matrix-stream`) and complete read-only API contract (`test:matrix-api`) before the temporary-database integration verifier.
- The unified command now fails on regressions in all three GET endpoints, authorization, masking/private-field suppression, invalid filters/pagination, write-method rejection, detail audit, private/mapped/mixed DNS address guards, DNS rebinding pinning, peer mismatch, credential/port rejection, per-hop redirects, India exclusion, 20/120 limits, and missing URL/evidence validation.
- Corrected the dry-run output example to the CLI-supported workspace-root path `./matrix-current-summary.json`.
- Corrected counter documentation: import counters come from the returned `importDiscoveryBatch(...)` summary and controlled-runner standard output; the runbook no longer claims or queries persisted `matrix_runs.counters_json` values.

TDD evidence:

- RED 1: `node scripts/verify-matrix-phase1.js` exited 1 with `unified package command must wire guarded-import and full API contracts before integration verification`.
- RED 2: `node scripts/verify-matrix-phase1.js` exited 1 with `runbook output example must use a file in the workspace root`.
- GREEN: expanded `npm run verify:matrix-phase1` ran `matrix-stream tests passed`, `matrix API tests passed`, and `matrix phase-one verification passed` with exit 0.

Fresh verification:

- `npm run verify:matrix-phase1` — PASS
- `npm run verify:smoke` — PASS (`SMOKE PASS`)
- `git diff --check` — PASS
- `node --check scripts/verify-matrix-phase1.js` — PASS

Remaining concern:

- API contract checks require permission to bind localhost test ports. The shared entity/evidence rollback provenance limitation is unchanged and remains accurately documented.

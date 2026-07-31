# Task 2 Report

## Status

DONE

Implemented versioned run, entity, evidence, and classification storage in neutral `matrix_*` tables. All writes exercised by the focused test use a temporary SQLite database. No rows were written to the formal `customers` or `crm_messages` data stores.

## Files

- Modified `src/db.js`
- Created `src/lib/signalCache.js`
- Created `scripts/test-signal-cache.js`
- Modified `package.json`

## RED evidence

1. Initial missing-feature RED:
   - Command: `node scripts/test-signal-cache.js`
   - Exit: `1`
   - Expected failure: `Error: Cannot find module '../src/lib/signalCache'`
   - Interpretation: the requested storage module did not yet exist.

2. Raw-page-content boundary RED:
   - Command: `node scripts/test-signal-cache.js`
   - Exit: `1`
   - Expected assertion failure: `public_contacts_json` contained `raw_html` while the expected value contained only the public email.
   - Interpretation: arbitrary HTML-bearing contact keys could otherwise enter a neutral table.

## GREEN verification

- Command: `node scripts/test-signal-cache.js`
  - Exit: `0`
  - Summary: `signal-cache tests passed`
- Command: `npm run verify:smoke`
  - Exit: `0`
  - Summary: `SMOKE PASS`
- Command: `git diff --check`
  - Exit: `0`
- Commands: `node --check src/lib/signalCache.js` and `node --check scripts/test-signal-cache.js`
  - Exit: `0`

The combined pre-commit verification first saw smoke fail because the restricted sandbox denied the test server's local bind with `listen EPERM 0.0.0.0:19081`; rerunning the same smoke command with the required local-bind permission produced `SMOKE PASS`.

## Commit

- `9063af4` — `feat: add signal cache storage`

## Self-review focus

- Confirmed `RULESET_VERSION` is consumed directly from `src/lib/schemaRank.js` for each run.
- Confirmed domain normalization removes schemes, credentials, ports, leading `www.`, paths, queries, fragments, and a trailing dot.
- Confirmed the two required unique indexes exist and evidence/classification records are append-only.
- Confirmed the four write functions perform their write sequence inside `better-sqlite3` transactions; `listCandidates` is read-only.
- Confirmed blank evidence source URLs and missing retrieval times are rejected.
- Confirmed contact keys containing `html` are removed before JSON storage; no raw-page-content column exists.
- Confirmed candidate listing uses the latest classification per entity and supports classification, priority, country, entity status, and run filters.
- Confirmed the focused test asserts the formal `customers` table remains empty; `crm_messages` is never referenced by the implementation.

Concern for integration review: `listCandidates` intentionally selects the latest classification for each entity before applying filters. If a future caller needs historical classifications for a prior run, that should be a separate history query rather than changing this candidate-list contract implicitly.

## Review fix — 2026-07-16

### Status

DONE. Addressed every Critical, Important, and Minor finding in `task-2-review.md`.

### RED evidence

- Command: `node scripts/test-signal-cache.js`
- Exit: `1`
- Failure: the multiple-trailing-dot assertion reported `AssertionError: 1 == 4` at `scripts/test-signal-cache.js:93`.
- Meaning: `https://www.brand.example.../` was incorrectly persisted as a distinct normalized entity. The same added test revision also introduced rollback-isolated rejection probes for nested/alias page content, executable content, unknown fields, non-digest fingerprint content, and same-entity cross-run classification selection.

### GREEN evidence

- Command: `node scripts/test-signal-cache.js`
  - Exit: `0`
  - Summary: `signal-cache tests passed`
- Command: `npm run verify:smoke`
  - Exit: `0` when rerun with local-bind permission
  - Summary: `SMOKE PASS`
- Commands: `git diff --check`, `node --check src/lib/signalCache.js`, and `node --check scripts/test-signal-cache.js`
  - Exit: `0`

The restricted smoke attempt again failed only because the sandbox denied `0.0.0.0:19081` with `EPERM`; the permission-correct rerun passed.

### Fix summary

- Added explicit allowed-field sets for campaigns, counters, entities, public contacts, evidence, classifications, and candidate filters. Unknown fields and nested object aliases are rejected rather than selectively stripped.
- Added typed and bounded safe-text validation to every persisted text/JSON input, plus hexadecimal-only caller-supplied content fingerprints.
- Changed domain cleanup to remove all trailing dots.
- Changed `run_id` query semantics so the correlated subquery chooses the latest classification inside the requested run.
- Added rollback-isolated negative probes so rejected writes cannot affect subsequent test assertions.

### Commit

- `4068ffe` — `fix: harden signal cache boundaries`

### Self-review focus

- The storage boundary is whitelist-first; content-pattern checks are supplemental and unknown keys never reach JSON serialization or SQL values.
- A supplied run ID is bound as a SQL parameter inside the latest-classification subquery, while other filters remain parameterized outside it.
- Existing required behavior, evidence deduplication, official-table isolation, and smoke coverage remain green.
- Integration consideration: extending public-contact shapes or counter names now requires an intentional whitelist change and a corresponding focused test.

# Task 5 Report: Read-Only Candidate API

## Status

READY. Final independent review found no Critical or Important issues.

## Commits

- `2d32ca2aac0cf57f9f584750a97d8b6895fee239` — `feat: expose read only matrix candidates`
- `400059a231f0472b5cc73861e4608135cdce7049` — `refactor: centralize matrix reason codes`

The second commit is intentionally separate because it modifies `src/lib/schemaRank.js`, which is outside the four Task 5 brief files. It establishes the parent-requested single authoritative `PUBLIC_REASON_CODES` export; the API consumes that export and its regression test verifies coverage of every current `schemaRank` and `matrixCrmAdapter` producer code.

## Delivered

- `GET /api/matrix/runs`
- `GET /api/matrix/candidates?classification=&priority=&country=&page=&page_size=`
- `GET /api/matrix/candidates/:id`
- Existing `fakeAuth` and exact CRM roles (`super_admin`, `foreign_trade_crm_admin`)
- Default page size 20, maximum 100, positive safe-integer validation
- Candidate summaries with public reason codes, evidence URLs, and masked contacts
- Detail-only read audit without candidate/classification mutation
- No POST, PATCH, or DELETE route

## Security / Disclosure Boundary

- Candidate list and detail responses omit raw evidence values/page text, CRM message bodies, original contacts, campaign JSON, ruleset version, fingerprints, extraction methods, human override text/actor, secret/config fields, and arbitrary reason/evidence text.
- Run responses expose only allowlisted campaign name/countries and operational timestamps/status; actor and raw campaign/config are omitted.
- Unknown reason strings are filtered against the frozen authoritative public-code list.

## Verification

- TDD red: missing route returned 404 after authentication.
- TDD red: arbitrary reason text leaked before allowlisting.
- TDD red: authoritative reason-code export was absent before centralization.
- `node scripts/test-matrix-api.js` — PASS (`matrix API tests passed`)
- `node scripts/test-schema-rank.js` — PASS (`schema-rank tests passed`)
- `npm run verify:smoke` — PASS (`SMOKE PASS`)
- `git diff --check` — PASS
- Final independent review — READY, Critical 0, Important 0

## Attention Point

When a classifier adds a new public reason code, add it to the authoritative reason-code contract; otherwise the API intentionally suppresses it as untrusted internal text. The final drift fix below makes the exact update path structural.

## Final Reason-Code Drift Fix

Independent review found that the earlier public array duplicated producer literals and its contract test sampled only 9 of 20 codes. This was corrected in the independent commit:

- `d21d18c08cf5e0542921eeefd7084f2de7b125b7` — `refactor: enforce matrix reason code contract`

Changes:

- `schemaRank` now exports a frozen `REASON_CODES` object with exactly 20 unique values.
- Frozen `PUBLIC_REASON_CODES` is derived from every `REASON_CODES` value.
- Every reason-producing branch in `schemaRank` and `matrixCrmAdapter` consumes `REASON_CODES` constants rather than repeated strings.
- The API continues to consume only `PUBLIC_REASON_CODES`.
- The exhaustive contract verifies all 20 values are public and unique, rejects producer-side reason literals, checks every observed producer result against the public collection, exercises all 13 rank codes and all 7 adapter-specific codes, and returns all 20 through the API while filtering an unknown sentinel.

Fresh verification after the fix:

- `node scripts/test-matrix-api.js` — PASS
- `node scripts/test-schema-rank.js` — PASS
- `node scripts/test-matrix-crm-adapter.js` — PASS
- `npm run test:signal-cache` — PASS
- `npm run test:matrix-stream` — PASS
- `npm run verify:smoke` — PASS
- Independent final review — READY, Critical 0, Important 0

Updated maintenance rule: add each new public reason once to `REASON_CODES`, use the exported constant in its producer, and extend the relevant producer-path contract case. `PUBLIC_REASON_CODES` updates automatically.

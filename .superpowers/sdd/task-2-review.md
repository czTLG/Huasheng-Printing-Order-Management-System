# Task 2 R7 Final Independent Review

## Scope

- Full range: `2ccd62b..b007718`
- R7 repair: `954bddd..b007718`
- Reviewed the updated Task 2 report, `review-task-2-r7.diff`, final source/schema/dependencies, and focused/integration tests.
- Review was read-only with respect to product source. No credentials were read, no external provider was called, and no delivery action was attempted.

## Verdicts

- **Spec Compliance: ✅ PASS**
- **Code Quality: APPROVED**

No Critical or Important findings remain. R7 closes I1-R6 without regressing genuine recipient-facing price or qualification requests.

## Critical findings

None.

## Important findings

None.

## R7 repair assessment — CLOSED

`isNonAssertionRequest` no longer treats question punctuation or a generic leading request word as sufficient. It now uses normalized, anchored Chinese and English request grammars, then scans only the captured request body for declarative markers (`src/services/matrixStreamText.js:27-66`). Consequently, the request syntax itself cannot exempt an assertion body.

Confirmed empty-evidence rejection:

- `价格是99？`
- `价格为99美元？`
- `The price is USD 99?`
- `单价请询价？`
- `Please note our price is USD 99.`
- `Please confirm it is USD 99.`

Additional adversarial probes also reject:

- `Could you confirm our price is USD 99?`
- `Can you note that our price is USD 99?`
- `What is the price? It is USD 99.`
- `请确认价格是99美元。`
- `请问价格是99美元？`

Confirmed genuine requests accepted without evidence:

- `请提供报价。`, `烦请告知报价。`, `能否提供报价？`, `可否确认费用？`
- `是否有Sedex认证？`, `贵司是否有Sedex认证？`
- `Could you quote this item?`, `Please provide a quote.`, `What is the price?`
- Additional probes: `请确认价格。`, `Can you confirm the price?`, `Would you provide your certification?`

The focused regression matrix is present at `scripts/test-matrix-stream-review.js:401-439`.

## Earlier Critical/Important boundaries — NO REGRESSION

- **Recipient/evidence binding and PSL:** persisted evidence remains bound to work item, normalized recipient, source, timestamp, snapshot, and registrable organization domain. `tldts` still runs with private-domain support (`src/services/matrixStreamReview.js:81-139`). Cross-tenant private suffix, wildcard/exception, unknown suffix, and valid owned-domain regressions pass.
- **Dependencies:** `tldts` remains exactly pinned to `7.4.9` in `package.json`; lock entries resolve `tldts`/`tldts-core` 7.4.9.
- **Approval integrity:** approval recomputes the canonical hash from the current persisted row and requires both stored and expected hashes to match before transition (`src/services/matrixStreamReview.js:255-305`).
- **Replay/idempotency:** replay remains gated by active actor, current owner, suppression state, action/scope/fingerprint, result scope, and current recipient evidence, while returning the recorded response plus explicit `current_status` (`src/services/matrixStreamReview.js:165-178`). Exact replays and altered actor/work/action/version/hash/content cases pass.
- **Immutability:** event update/delete, recipient-evidence identity/delete/lifecycle, version content/delete, and approval lifecycle guards remain installed (`src/db.js:989-1096`).
- **Text evidence:** exact sentence evidence, structured amounts/currencies, unknown semantic fallbacks, recursive evidence values, URL restriction, and non-sensitive date/dimension handling remain green.
- **Provider contract:** exact non-empty bilingual JSON shapes and explicit unavailable/failure behavior remain intact.
- **No delivery capability:** R7 changes only the bounded text classifier and its tests. A full Task 2 changed-file scan found no added `sendMail`, SMTP, transport, or equivalent delivery code.

## Verification performed

- `node scripts/test-matrix-stream-review.js` — PASS (`matrix stream review tests passed`)
- Custom R7 assertion-body/request-positive probe matrix — PASS
- `node scripts/test-packet-gate.js` — PASS (`packet gate tests passed`)
- `node scripts/smoke-test.js` — PASS (`SMOKE PASS`, approved localhost bind)
- `node scripts/test-matrix-api.js` — PASS (`matrix API tests passed`, approved localhost bind)
- `node --check` on `src/db.js`, `src/services/matrixStreamReview.js`, and `src/services/matrixStreamText.js` — PASS
- `git diff --check 2ccd62b..b007718` and `git diff --check 954bddd..b007718` — PASS
- R7 changed files are limited to `src/services/matrixStreamText.js` and `scripts/test-matrix-stream-review.js`.

## Final disposition

Task 2 is spec-compliant and approved at `b007718`. No further repair is required for the R7 request-syntax boundary or the previously reviewed recipient evidence, PSL/dependency, approval hash, replay authorization/snapshot, immutable storage, and bounded bilingual-output boundaries.

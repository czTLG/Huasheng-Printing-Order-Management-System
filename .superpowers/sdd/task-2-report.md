# Task 2 Report — Immutable Draft Version Service

## Status

DONE_WITH_CONCERNS

## Commits

- Base: `2ccd62b`
- Initial Task 2: `13cb17d` (`feat: add matrix stream review versions`)
- Review repair: `6bebba0` (`fix: harden matrix stream review integrity`)
- R3 evidence repair: `8d546b8` (`fix: close matrix stream evidence gaps`)
- R4 PSL/claim repair: `dfe3fe6` (`fix: enforce PSL and claim boundaries`)
- R5 semantic-claim repair: `106af07` (`fix: fail closed on semantic claims`)
- R6 sentence-claim repair: `954bddd` (`fix: enforce sentence-level claim evidence`)
- R7 request-syntax repair: `b007718` (`fix: restrict sensitive request exemptions`)
- Full Task 2 scope: `2ccd62b..b007718`
- R2 repair scope: `13cb17d..6bebba0`
- R3 repair scope: `6bebba0..8d546b8`
- R4 repair scope: `8d546b8..dfe3fe6`
- R5 repair scope: `dfe3fe6..106af07`
- R6 repair scope: `106af07..954bddd`
- R7 repair scope: `954bddd..b007718`

## RED / GREEN evidence

### Initial implementation

1. Recipient/version API: module-not-found RED for `matrixStreamReview`; GREEN after the transactional service was added.
2. Bilingual text API: module-not-found RED for `matrixStreamText`; GREEN after the bounded exact-shape service was added.
3. English price prefix: `USD 99` produced `Missing expected rejection`; GREEN after currency-before-amount recognition.
4. Transition freshness: stale persisted recipient data produced `Missing expected exception`; GREEN after transition-time revalidation.

### Independent-review repairs

1. Persisted public evidence
   - RED: focused test exited 1 with `matrix_stream_recipient_evidence missing`.
   - GREEN: added the evidence table and version evidence binding migration.
   - RED: guessed/unrelated recipient self-attestation produced `Missing expected exception`.
   - GREEN: create now requires an active persisted artifact bound to the work item, normalized email, HTTPS source, verification time, organization domain, and matching snapshot fields; approve/revise/replay reload the same artifact.
2. Approval hash integrity
   - RED: after simulating a damaged storage boundary and changing a draft body without its hash, approval produced `Missing expected exception`.
   - GREEN: approve recomputes the canonical hash from the current DB recipient/source/subject/bodies and requires both stored and expected hashes to equal it.
3. Request-bound replay
   - RED: replay with the same key but a changed approval hash produced `Missing expected exception`.
   - GREEN: every event stores a SHA-256 request fingerprint covering action, actor, work item, original expected version, target/base, and relevant content/hash. Replay rechecks active actor, current owner, suppression, work scope, action, fingerprint, result scope, and recipient evidence before returning.
   - Added GREEN rejection coverage for changed expected version, changed target/base, changed revision content, cross-action, cross-work-item, inactive actor, owner transfer, and suppression; exact original create/approve/revise requests replay safely.
4. Bilingual evidence boundary
   - RED: `99美元` produced `Missing expected rejection`.
   - GREEN: Chinese currency-before/after-amount forms now require matching evidence (`99美元`, `99元`, `美元99`).
   - RED: `食品级资质` produced `Missing expected rejection`.
   - GREEN: conservative Chinese certification/qualification extraction rejects unsupported `欧盟认证`, `ISO 22000认证`, and `食品级资质` forms.
5. Database immutability
   - RED: direct UPDATE of a draft subject produced `Missing expected exception`.
   - GREEN: database triggers now prevent identity/content/evidence mutation and deletion for every version status; only lifecycle status/approval metadata/updated time remain mutable. Evidence identity/snapshot rows are also immutable and revocation is irreversible.

### R3 evidence-boundary repairs

1. Registrable organization domains
   - RED: persisted `organization_domain='test'` bound `guessed@person.test` to `unrelated.test`, producing `Missing expected exception`.
   - GREEN: offline registrable-domain parsing rejects bare TLD/public suffix values and requires the organization value itself, recipient email domain, and HTTPS source hostname to resolve to the same registrable domain.
   - Added GREEN coverage for bare `test`, `co.uk`, `com.cn`, an unknown TLD, unrelated sibling domains, and the valid `mail.alpha.co.uk` / `official.alpha.co.uk` organization case.
2. Structured claim matching
   - RED: empty evidence accepted `单价为99。`.
   - GREEN: explicit price language produces a typed claim key with exact normalized amount and currency (`UNSPECIFIED` when omitted); Chinese numerals are normalized.
   - RED: evidence containing only `199美元` supported output `99美元` through substring matching.
   - GREEN: evidence and output claims compare exact structured keys, so different amounts cannot collide.
   - RED: empty evidence accepted `产品已通过认证。` after the initial structured pass.
   - GREEN: known and generic certification/qualification phrases produce explicit normalized identifiers. Regressions cover `食品级要求`, `欧盟认证`, `ISO 22000认证`, `食品级资质`, and unspecified certification language.
   - Date and dimension numbers (`2026-07-18`, `250mm`) remain accepted without being classified as prices.
3. Replay response semantics
   - RED: an exact approval replay after supersession returned current `status='superseded'` instead of the recorded approval response.
   - GREEN: append-only events persist the original response snapshot. Replay returns that recorded state plus an explicit `current_status`, with create/approve/revise coverage before and after supersession.

### R4 PSL and conservative-classifier repairs

1. Maintained offline PSL parsing
   - RED: persisted `organization_domain='workers.dev'` allowed `tenant-a.workers.dev` email to bind to `tenant-b.workers.dev`, producing `Missing expected exception`.
   - GREEN: removed every hand-maintained suffix/TLD list and integrated exact dependency `tldts@7.4.9` with `allowPrivateDomains: true`; parsing is offline and uses its maintained ICANN/private PSL data.
   - Regressions reject cross-tenant `workers.dev`, `onrender.com`, and `*.ck` wildcard cases; the `!www.ck` exception, owned `alpha.co.uk`, and existing `.test` fixtures remain valid. Unknown suffixes fail closed.
2. Conservative structured claim classifier
   - RED: empty evidence accepted `售价为99。`.
   - GREEN: typed price extraction covers `售价/报价/单价/价格/费用/金额/成本` with Arabic or Chinese numeric normalization; an explicit price-language-plus-number form that cannot be normalized enters an exact fallback instead of disappearing.
   - RED: the first normalized pass accepted `售价大约为99。`.
   - GREEN: the bounded price fallback now rejects that uncertain form without classifying ordinary dates or dimensions.
   - RED: empty evidence accepted `产品符合RoHS合规规范。` and adjacent compliance wording.
   - GREEN: qualification classification covers RoHS, REACH, ISO, BRC/BRCGS, FDA, HACCP, GMP, CE, food-grade, certification/credential, compliance, and `符合/满足/达到 … 标准/规范/要求`; unknown compliance language uses an exact normalized phrase fallback.
   - Exact token/claim-set matching rejects `RoHSX` as support for `RoHS` and retains the earlier `199美元` versus `99美元` separation. Exact 99-dollar evidence succeeds; dates and `250mm` remain non-price numbers.

### R5 semantic fallback and evidence-value repairs

1. Semantic price assertions without numbers
   - RED: empty evidence accepted `价格面议。`, producing `Missing expected rejection`.
   - GREEN: a price segment now enters fallback when a bounded price category (`价格/报价/单价/售价/费用/金额/成本`) is paired with a numeric value or explicit state (`面议/待定/另议/请询价/视…而定` and bounded English equivalents).
   - Regressions reject `价格面议`, `报价待定`, and `单价请询价` without evidence while retaining ordinary requests such as `请提供报价` and existing date/dimension prose.
2. Unknown credential and compliance subjects
   - RED: empty evidence accepted `产品已通过Sedex审核。` and `产品拥有XYZ许可证。`.
   - GREEN: bounded qualification signals now include audit, certification, certificate, license/permission, credential, compliance, and `符合/满足/达到 … 标准/规范/要求` semantics. Unknown subjects emit an NFKC-normalized complete statement key instead of disappearing or using substring matching.
3. JSON evidence-wrapper isolation
   - RED context: identical unknown fallback phrases inside `sourceSnapshot.supportedClaims` were rejected because `JSON.stringify` property/array syntax polluted the evidence key.
   - GREEN: claim evidence recursively traverses JSON values (including JSON stored as text) and never includes wrapper property names or delimiters. Exact evidence phrases for `价格面议`, `Sedex审核`, and `XYZ许可证` now pass; absent or merely substring evidence rejects.

### R6 sentence-level sensitive-semantics guard

1. Ultimate sentence guard
   - RED: empty evidence accepted `价格免费。`, `本项目无需费用。`, and `产品已获Sedex认可。`.
   - GREEN: every normalized output sentence containing broad price or qualification semantics is sensitive by default and must exactly match a recursively collected evidence sentence. Substrings do not support it.
   - Unknown assertion regressions include Acme approval/specification wording; exact whole-sentence evidence passes for the three reviewer bypasses.
2. Narrow non-assertion request exception
   - Explicit recipient-facing questions/requests such as `请提供报价`, `Could you quote this item?`, `What is the price?`, and `您是否有Sedex认证？` remain allowed when they have no assertion marker.
   - RED after the first request classifier: `单价请询价。` was incorrectly accepted because any occurrence of `请` was treated as a request.
   - GREEN: request markers are anchored to explicit sentence-leading forms; `单价请询价。` rejects without evidence and succeeds only with the exact sentence in evidence. `是否已通过Sedex审核？` remains an assertion because it contains an assertion marker.
3. Existing boundaries
   - Dates and dimensions remain accepted as non-sensitive numbers.
   - The translation fixture's terse `需要报价` requirement is not request-exempt; the test now supplies its exact source evidence.

### R7 strict request-syntax classifier

1. No punctuation-only exemption
   - RED: `价格是99？` was accepted solely because it ended in a question mark.
   - GREEN: question punctuation and generic request words are never sufficient. Only normalized, anchored request grammar enters the exemption path.
   - Reviewer regressions reject `价格是99？`, `价格为99美元？`, `The price is USD 99?`, `单价请询价？`, and `Please note our price is USD 99.` without exact evidence.
2. Anchored request whitelist with assertion-body scan
   - Chinese request forms are limited to anchored `请/烦请 + 提供/告知/确认...`, `能否/可以/可否...`, and explicit `是否有/贵司是否...` structures.
   - English request forms are limited to anchored `could/would/can you + request verb`, `please + request verb`, and `what is/are` structures.
   - After matching a request prefix, the remaining body is scanned for declarative markers. A second RED showed `Please confirm it is USD 99.` still bypassed; GREEN added generic English `is/are` body rejection while preserving `What is the price?` because its grammatical `is` belongs to the matched prefix.
   - Positive coverage retains real request forms including `请提供报价`, `烦请告知报价`, `能否提供报价`, `可否确认费用`, `贵司是否有Sedex认证`, `Could you quote...`, `Please provide...`, and `What is the price?`.

## Files

- `src/db.js`
  - Adds persisted recipient evidence, event request fingerprints, guarded legacy migrations, universal version immutability/delete triggers, approval metadata lifecycle checks, and evidence identity guards.
- `src/services/matrixStreamReview.js`
  - Adds trusted evidence binding/revalidation, maintained offline PSL/private-suffix organization checks, canonical approval hash recomputation, request fingerprints, scope-safe replay, recorded response snapshots, and active ownership/suppression checks.
- `src/services/matrixStreamText.js`
  - Uses typed exact price and qualification claim keys plus bounded semantic fallbacks and an ultimate normalized sentence guard. Broad sensitive semantics require an exact recursive evidence sentence unless they are explicit non-assertion requests; dates/dimensions remain outside the guard. Evidence keys come from JSON values only.
- `src/services/aiProvider.js`
  - Initial commit adds the generic bounded JSON provider; unchanged by review repair.
- `scripts/test-matrix-stream-review.js`
  - Adds all independent-review bypass regressions and a clear success marker.
- `package.json`, `package-lock.json`
  - Add exact `tldts@7.4.9` plus its locked core package. Installation used `--no-audit --no-fund`; no automated vulnerability fix command ran.

## Final verification

- `node scripts/test-matrix-stream-review.js` — `matrix stream review tests passed` (exit 0)
- `node scripts/smoke-test.js` — `SMOKE PASS` (exit 0)
- `node scripts/test-packet-gate.js` — `packet gate tests passed` (exit 0)
- `node scripts/test-matrix-api.js` — `matrix API tests passed` (exit 0, approved localhost binding)
- `node --check` on `src/db.js`, both Matrix Stream services, `aiProvider.js`, and the focused test — PASS
- Static changed-service scan for delivery terms — no matches
- `git diff --check`, staged diff check, and commit check — PASS

## Self-review

- Approval is fail-closed against current row content even if database triggers are deliberately removed in the test.
- Replay cannot cross actor/work/action/target/base/request payload and cannot bypass current actor, owner, suppression, or evidence state.
- A caller-provided `kind`, URL, timestamp, or snapshot is not sufficient: version creation resolves an existing persisted organization-bound artifact and stores its id and trusted snapshot.
- Normal edits insert a new revision and supersede the base; direct draft UPDATE/DELETE is rejected at the database boundary.
- No delivery transport, message send, SMTP configuration, or credential handling was added.

## Concerns

- Non-blocking: `.test` is accepted only as a compatibility exception for the repository's reserved test fixtures; production ICANN/private suffix parsing comes exclusively from `tldts`.
- Non-blocking: generic price/qualification fallback is deliberately conservative and requires an exact normalized evidence phrase when no recognized identifier can be produced.
- Non-blocking: the sentence guard is deliberately conservative; supported paraphrases still require their own exact normalized evidence sentence rather than semantic similarity.
- Non-blocking: the request whitelist is intentionally narrow; unlisted but benign phrasing fails closed and requires exact sentence evidence.
- The persisted evidence producer is intentionally outside this Task 2 service; the later narrow Matrix API/view integration must insert artifacts only from reviewed official candidate evidence.
- Coordination reports/briefs remain outside the implementation commits.

# Matrix Route Profile Design

Date: 2026-07-28  
Status: approved

## Objective

Extend the deterministic Matrix draft path with one reusable food-product route profile, beginning with the verified Dh Foods case. The profile must support Southeast Asian sauce and seasoning manufacturers without embedding a prospect name or unsupported claim in reusable logic.

The first production outcome is an evidence-bound Dh Foods draft addressed to the official purchasing inbox. Customer selection authorizes the complete internal preparation workflow; delivery remains a separate final action.

## One-Stop Selection Contract

Selecting a named candidate starts the complete preparation workflow without intermediate business-choice prompts:

1. refresh public organizational research and source evidence;
2. reconcile the canonical customer and official organizational contact;
3. audit the localized buyer journey;
4. improve reusable website content when the selected segment exposes a material content gap;
5. build, test, deploy, and verify those in-scope reusable website changes under the user's standing selection authorization;
6. update the deterministic route profile and bilingual ontology when required;
7. calculate strategy readiness;
8. create and internally quality-check one canonical draft;
9. present one final package containing recipient, subject, English body, Chinese translation, local-language closing, links, and attachment state.

The user is not asked to approve research, implementation plans, routine tests, reusable content changes, deployment, record creation, or draft creation separately after selecting the candidate. The final package offers only the consequential customer-facing decision: send or do not send. A material scope expansion unrelated to the selected candidate still requires separate authorization.

## Confirmed Dh Foods Inputs

- Official organization domain: `dhfoods.com.vn`.
- Official organizational contact: `purchase@dhfoods.com.vn`.
- Public categories include sauces, chili sauces, seasonings, soup bases, spices, and rice-based foods.
- The official factory page publishes incoming inspection of packaging and labels, a purchasing-led periodic supplier-evaluation process, and controls for non-conforming deliveries.
- The company publishes more than 100 SKUs across six product lines, distribution in more than 15 countries or territories, and two production sites.
- The public evidence does not establish current pouch structures, incumbent flexible-packaging suppliers, fill temperatures, sealing conditions, or annual flexible-packaging volume.

Every recorded fact must retain its official source URL and observation timestamp. Unknowns remain unknown.

## Architecture

### 1. Reusable route-profile registry

Add a neutral route-profile registry beside the existing liquid route sets. A food-sauce profile contains:

- eligible canonical product concepts;
- supported country codes;
- localized home, about, market, application, and product routes;
- a short local-language courtesy closing;
- the evidence roles required for that profile.

The first profile supports Vietnam with:

- `/vi`
- `/vi/about`
- `/vi/markets/vietnam`
- `/vi/applications/sauce-packaging`
- `/vi/products/spout-pouches`

The registry must not include a prospect name, recipient, pricing, MOQ, lead time, certification promise, or performance guarantee.

### 2. Deterministic food draft builder

The builder derives content only from the current candidate record and verified evidence. For Dh Foods it should:

- name only evidenced categories, such as sauces, chili sauces, seasonings, and soup bases;
- reference the published packaging/label inspection and supplier-evaluation process without claiming an existing supplier relationship;
- position sachets, spout pouches, or roll film as formats to assess, not formats Dh Foods is asserted to use;
- focus on sealing compatibility, filling-line fit, contamination control, and repeat-print consistency;
- request one representative SKU's current pack photo, dimensions, fill weight or volume, filling method, and estimated quantity;
- include one primary Vietnamese application link and one optional Vietnamese company link;
- add one short Vietnamese courtesy closing to the English body;
- generate an aligned Chinese translation for internal review.

The initial message must not promise a completed technical proposal, final structure, barrier result, price, MOQ, or delivery date.

### 3. Strategy and readiness gates

Draft creation remains blocked unless all conditions pass:

1. At least three distinct official organizational sources.
2. Company/profile, product range, production or development workflow, and official organizational contact are evidenced.
3. The recipient email and source page share the verified organization domain.
4. The live Vietnamese route set returns HTTP 200, expected language metadata, and canonical page identity.
5. The deterministic strategy-match score is at least 75 with no critical blocker.
6. The bilingual draft score is at least 80 with no unsupported-claim, unknown-product, or fact-alignment failure.
7. Existing contact, historical delivery, suppression, cooling, and daily-quota checks pass.

Any evidence or route change makes the stored draft stale and requires a new version.

### 4. State flow

The canonical flow is:

`selected → researched → route/content ready → draft_pending → final package → explicit send confirmation → approved-and-sent/declined → accepted/failed/ambiguous → reply check`

- Internal preparation automatically creates one immutable draft but does not send it.
- The final package is the sole review surface. Choosing send approves that exact immutable version and confirms its delivery in one idempotent action.
- Sending still requires explicit confirmation for the exact customer, recipient, content hash, and attachment manifest shown in the final package.
- Choosing do not send leaves the draft unapproved and creates no delivery job.
- An SMTP-accepted result creates one reply-check task three calendar days later, because this operation does not distinguish weekends.
- Failed or ambiguous results do not create a second delivery automatically.

### 5. Data ownership

- Candidate evidence and strategy signals remain in the protected candidate database.
- Customer identity, contact, version, approval, delivery, thread, and follow-up state remain in the canonical management database.
- Reusable route definitions stay in project source.
- No customer record, message body, credential, SMTP identifier, or private operational record is copied into the user-level capability catalog.

## Error Handling

- Unsupported category: fail with a profile-specific blocker and do not create a version.
- Localized route unavailable or wrong language/canonical: mark route readiness blocked.
- Missing purchasing contact: block email generation; a contact form is not silently treated as an email.
- Bilingual mismatch or unsupported claim: roll back the draft transaction.
- Existing delivery or domain cooling: block final preview.
- Stale work version, evidence, or content hash: regenerate the final package and require a new send decision.
- Delivery uncertainty: record `ambiguous`; never report success and never retry automatically.

## Test Plan

### Unit tests

- English and Chinese sauce, chili-sauce, seasoning, soup-base, sachet, spout-pouch, and roll-film terms map to the same canonical concepts.
- The Vietnamese route profile resolves only for supported country/category combinations.
- Unsupported product categories fail closed.
- The generated English and Chinese drafts have aligned product and question facts.

### API regression tests

- A fully evidenced Dh Foods-style fixture creates one score-passing draft.
- Missing official purchasing evidence creates no recipient evidence, version, approval, or job.
- A 404 or wrong-language route blocks draft creation.
- Repeated creation with the same idempotency key returns the same version.
- Approval does not create a delivery job.
- Exact final confirmation creates at most one job.

### Production verification

- Run syntax, draft-gate, Matrix API, cache-view, and strategy-match tests.
- Verify all five Vietnamese production URLs.
- Create one production draft with score and hard-failure evidence.
- Present the complete final package without an intermediate approval prompt.
- Confirm zero approval and zero delivery jobs until the user chooses send.
- Verify the management service is active with no restart loop.

## Acceptance Criteria

The design is complete when:

- Dh Foods reaches strategy-match and draft-quality pass thresholds using current official evidence;
- the draft uses the official purchasing inbox and current Vietnamese buyer journey;
- the draft contains no unsupported current-package or supplier assertion;
- English and Chinese content are aligned and readable;
- creation is idempotent;
- no approval or delivery occurs before the final send decision;
- selecting a candidate completes preparation without intermediate user prompts;
- the existing liquid-care route and previously approved versions continue to pass regression tests.

## Deferred Scope

- Malay-language routes for Bidor Kwong Heng.
- Company-specific website pages.
- Automatic bulk outreach.
- Guessing individual employee addresses.
- Automatic resend after rejection, bounce, or ambiguity.
- Pricing, MOQ, lead-time, or material-structure calculation.

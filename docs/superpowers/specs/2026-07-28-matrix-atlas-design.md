# Matrix Atlas Design

## Objective

Create a reusable user-level capability named `matrix-atlas` that discovers public organizations by location and category, verifies them against public authoritative sources, records provenance, and prepares normalized candidate records for the existing canonical management system.

The capability does not send email, WhatsApp messages, or other external communications.

## Upstream basis

- Upstream project: `gosom/google-maps-scraper`
- Repository: `https://github.com/gosom/google-maps-scraper`
- License: MIT
- Audited upstream skill version: `1.12.1`
- Upstream default branch: `main`
- Audit date: 2026-07-28

The upstream project is a reference implementation and optional data-source adapter. Its provenance, license, selected version, checksum, network behavior, and excluded functions remain documented. Neutral naming is commercial-confidentiality naming only and does not conceal provenance.

## Scope

### Included

- Discover public organizations by country, city, neighborhood, and business category.
- Generate local-language and English search variations.
- Collect public organizational fields:
  - organization name
  - category
  - public address
  - official website
  - public organization phone
  - map URL and coordinates
  - public rating and review count when returned with the listing
- Preserve source URL, collection time, query, adapter, and verification state.
- Normalize names, domains, phone numbers, addresses, and country codes.
- Deduplicate first by official domain, then public phone, then normalized name plus location.
- Verify candidates through official websites and public government, association, or exhibition sources.
- Classify every material claim as `confirmed`, `inferred`, or `unknown`.
- Score organization fit, scale evidence, source quality, and data completeness.
- Produce a review queue and import only approved normalized records into the existing canonical management system.
- Cache searches and enforce conservative request rates.

### Excluded

- CAPTCHA bypass, login bypass, stealth identity, fingerprint evasion, or access-control circumvention.
- Proxy rotation or sponsor/referral integrations.
- Collection from private profiles or non-public sources.
- Guessing personal contact details or enriching private individual records.
- Email extraction by crawling arbitrary websites.
- Bulk review collection or review-text profiling.
- Claims that a search is exhaustive.
- Automatic bulk outreach or any outbound communication.
- Copying customer records, messages, quotations, orders, formulas, or credentials into the user-level runtime catalog.

## Architecture

### 1. User-level skill

Install `/home/admin/.codex/skills/matrix-atlas/` with:

- `SKILL.md`: trigger description, operating sequence, safety boundaries, and output contract.
- `agents/openai.yaml`: neutral user-visible metadata.
- `references/upstream.md`: repository, license, version, commit, checksums, network behavior, selected ideas, and excluded functions.
- `references/schema.md`: normalized candidate schema and verification states.
- `scripts/matrix-atlas.mjs`: deterministic query planning, normalization, deduplication, scoring, and export.

### 2. User-level command

Install `/home/admin/.local/bin/matrix-atlas` as a mode `0750` wrapper. It exposes:

- `plan`: turn countries, locations, categories, and coverage into bounded queries.
- `normalize`: convert supported source output into the canonical candidate schema.
- `dedupe`: merge records deterministically while retaining all provenance.
- `score`: calculate transparent review scores.
- `verify`: validate schema, provenance, limits, and forbidden fields.
- `help`: document inputs, outputs, and safety boundaries.

Discovery adapters remain replaceable. The initial implementation supports normalized CSV or JSONL ingestion and an optional, explicitly invoked upstream adapter. The command never sends communications or writes production records.

### 3. Data flow

1. Receive target geography, organization categories, and coverage limit.
2. Build bounded English and local-language queries.
3. Run a conservative public-source discovery adapter.
4. Normalize and deduplicate results.
5. Verify official organizational sources.
6. Score and place records into a human-review queue.
7. Import only approved records through the existing canonical management interface.

Raw and reviewed results stay in protected project storage. The user-level catalog contains paths and operating boundaries only.

## Query and rate policy

- Default depth: `1`.
- Default concurrency: `1`.
- Default per-run query limit: `20`.
- Default per-run result limit: `200`.
- No proxy configuration.
- No email extraction.
- No extra review retrieval.
- Cache identical queries for 24 hours.
- Stop on repeated access-denied, rate-limit, or challenge responses.
- Label output as sampled public discovery, never exhaustive coverage.

## Candidate schema

Each normalized record contains:

- `candidate_key`
- `organization_name`
- `country_code`
- `locality`
- `categories`
- `address_public`
- `website_official`
- `phone_public`
- `map_url`
- `latitude`
- `longitude`
- `rating`
- `review_count`
- `source_adapter`
- `source_url`
- `source_query`
- `collected_at`
- `verification_state`
- `verification_sources`
- `fit_score`
- `scale_score`
- `source_quality_score`
- `completeness_score`
- `review_status`
- `notes`

The schema does not contain personal email guesses, private-profile identifiers, message bodies, quotations, orders, formulas, credentials, cookies, or tokens.

## Scoring

Scores are transparent and evidence-bound:

- Fit: match between public product categories and supported solution families.
- Scale: public organizational signals such as production footprint, distribution reach, export activity, or facility count.
- Source quality: official website and government/association evidence rank above directory-only evidence.
- Completeness: official domain, location, category, public organization contact, and provenance coverage.

Unknown data contributes no score. Inferred data is visibly marked and cannot be promoted to confirmed without a supporting source.

## Canonical-system integration

- Read `/home/admin/.codex/matrix-runtime/INDEX.md` and the `matrix-console` resource before any integration.
- Run discovery and review without production writes.
- Import through the existing canonical customer/candidate interface only after explicit task-scoped approval.
- Use idempotency keys based on the normalized organization identity and source set.
- Preserve all source URLs and prevent duplicate organization, domain, and contact records.
- Outbound email, WhatsApp, publication, deployment, and production restart retain their existing explicit approval gates.

## Failure handling

- Preserve partial results with an explicit incomplete status.
- Report source adapter, query, error class, and last successful checkpoint.
- Do not silently switch to proxies, higher concurrency, or alternative private sources.
- Reject malformed records and forbidden fields before review or import.
- Never treat missing contact information as proof that no contact exists.

## Verification

The capability is `ready` only after:

1. Unit tests cover query limits, normalization, deterministic deduplication, scoring, forbidden-field rejection, and provenance retention.
2. A local fixture run produces stable output without network access.
3. A bounded public-source smoke run succeeds with conservative settings.
4. A clean session from `/tmp` discovers the capability through `/home/admin/.codex/matrix-runtime/INDEX.md`.
5. The user-level command works from outside the project directory.
6. A safety scan finds no credentials, tokens, cookies, SMTP Message-IDs, customer records, message bodies, quotations, orders, formulas, or private contacts in the skill or catalog.
7. The catalog contains exactly one `matrix-atlas` entry with current status and evidence.

## Acceptance criteria

- The upstream source and license are traceable.
- Only the approved public-organization discovery subset is enabled.
- Query and result limits are enforced by code.
- Every candidate retains reproducible provenance.
- Duplicate candidates merge without losing source evidence.
- No outbound action is available from this capability.
- No production write occurs without explicit approval.
- Clean-session discovery and the safety scan pass.

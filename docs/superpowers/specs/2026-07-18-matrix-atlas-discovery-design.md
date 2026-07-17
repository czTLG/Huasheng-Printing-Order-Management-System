# Matrix Atlas Discovery Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Scope:** Compliant discovery, evidence capture, entity resolution, deep reading, prioritization, and recommendation of public organizations before the Matrix Stream review loop.

## 1. Outcome

Matrix Atlas continuously builds an evidence-backed organization graph from public sources. It discovers up to 100 organizations per day, selects 20 for deeper reading, and recommends at most five to a human operator. It does not send external messages. Selected organizations enter Matrix Stream, where separate quality, permission, duplicate, approval, and delivery controls apply.

The system optimizes for reliable medium-to-large organizations with recurring product lines rather than maximizing raw row count.

## 2. Fixed Scope and Safety Boundaries

- Use public organizational information from official websites, government, trade-promotion, association, exhibition, public registry, retailer, distributor, news, and public trade-record sources.
- Preserve the exact source URL, source type, observed time, page title, content fingerprint, and extraction method for every material fact.
- Respect `robots.txt`, publisher terms, rate limits, retry guidance, and access controls.
- Do not bypass login, CAPTCHA, robots rules, paywalls, or technical restrictions.
- Do not collect private profiles, guessed personal contact details, or login-only data.
- Do not automatically submit website contact forms.
- Do not interpret missing records as proof that an organization, supplier relationship, or shipment does not exist.
- No automatic bulk outreach is part of Matrix Atlas.
- India is excluded. European targets remain paused while current certification scope is insufficient. Initial market focus is Southeast Asia and other countries near China approved by the existing country policy.
- Food, beverage, household cleaning, laundry, bath, personal-care, coffee, tea, snacks, sauces, and related recurring product lines are in scope.
- Internal component, worker, folder, and UI feature names use neutral codenames. Provenance and licenses remain accurate in internal records.

## 3. System Boundary

```text
Market Radar
  -> Source Registry
  -> Matrix Scanner
  -> Evidence Store
  -> Schema Resolver
  -> Matrix Reader
  -> Opportunity + Confidence Scores
  -> Stream Planner
  -> Packet Guard
  -> Human Recommendation
  -> Matrix Stream
```

Matrix Atlas ends when a reviewed recommendation is selected. Matrix Stream owns immutable drafts, two confirmations, restricted delivery, reply matching, and follow-up tasks.

## 4. Source Strategy

### 4.1 Source registry

Every adapter is registered before use with:

- source id and neutral adapter code;
- publisher and public landing URL;
- source class and country coverage;
- allowed paths and disallowed paths;
- robots and terms review timestamps;
- minimum request interval, concurrency, daily request budget, and cache lifetime;
- authentication requirement, limited to `none` or a reviewed read-only public-data API key; user-account login and session reuse are not allowed for autonomous discovery;
- field-level provenance rules;
- parser version, license note, and operational status.

An adapter fails closed when its policy is missing, stale, disallowed, or ambiguous.

### 4.2 Source tiers

**P0 — authoritative organization discovery**

- government exporter, manufacturer, importer, product, and registered-organization directories;
- official trade-promotion directories;
- official exhibition organizer directories;
- public business registries and GLEIF where coverage exists.

**P1 — first-party organization evidence**

- official website home, about, product, brand, catalog, news, distributor, store, and contact pages;
- first-party public PDFs and catalogs;
- official brand and subsidiary sites.

**P2 — corroborating commercial evidence**

- official retailer and distributor product pages;
- association member directories;
- public procurement notices;
- public shipment or trade records with explicit dataset coverage notes.

**P3 — discovery-only leads**

- search-engine results, public news, and other open-web references.

P3 can create a discovery lead but cannot alone establish company identity, scale, supplier relationship, or contact eligibility.

### 4.3 Initial priority adapters

- MATRADE registered exporter/product directories for Malaysia;
- THAIFEX-Anuga Asia official exhibitor directory for food and beverage organizations;
- Vietfood & Beverage / ProPack official exhibitor lists;
- Cosmoprof CBE ASEAN and COSMEX official directories for personal care, bath, beauty, and household-adjacent categories;
- relevant national government exporter/importer directories in approved countries;
- UN Comtrade for country/category market radar only;
- GLEIF for supported legal-entity identity and parent/child evidence;
- public bill-of-lading sources as limited corroborating relationship/volume signals, never as complete coverage.

## 5. Market Radar

Market Radar creates country/category search tasks rather than company records. Inputs are:

- approved country policy;
- product and HS-code mappings;
- UN Comtrade country/category trend and trade-flow data;
- historical inbound CRM inquiries and valid reply patterns;
- existing successful categories, product forms, and specifications;
- certification and delivery constraints;
- source availability and freshness.

Outputs contain country, category, source adapters, search vocabulary, evidence expectations, exclusion reasons, and a daily budget. Aggregate trade data affects market priority but never becomes company-level evidence.

## 6. Compliant Retrieval and Evidence Storage

Matrix Scanner performs conditional HTTP retrieval with a descriptive user agent, per-host queues, robots evaluation, cache validators, exponential backoff, and strict response-size/type limits. It does not execute arbitrary downloaded code.

For each response it stores:

- canonical URL and redirect chain;
- fetch time, status, content type, and cache headers;
- robots decision and source-policy version;
- body fingerprint and parser version;
- extracted facts with exact source spans or structured-data paths;
- error classification without secrets.

Unchanged content reuses the cached parse. A source circuit breaker pauses an adapter after repeated rate-limit, permission, parser, or integrity failures and alerts an operator.

## 7. Organization Evidence Graph

Primary nodes are:

- organization;
- legal entity;
- brand;
- official domain;
- public company email;
- location;
- product category;
- product or SKU;
- product format and specification signal;
- exhibition participation;
- retailer/distributor presence;
- supplier or trade relationship;
- CRM customer/inquiry/order;
- evidence record.

Relationships are directional and time-bound. Each relationship carries confidence, observed time, source ids, and status `confirmed`, `public_lead`, `conflicting`, or `unknown`.

### 7.1 Automatic identity rules

Automatically link when one of these exact identifiers matches:

- normalized official domain;
- verified public company email plus matching official domain;
- legal registration identifier;
- LEI;
- already confirmed organization alias.

### 7.2 Review-only identity rules

Create a possible-duplicate review when:

- normalized names are similar but domains differ;
- addresses are similar but legal identifiers are missing;
- a brand/parent relationship is plausible but not directly stated;
- a public trade record uses an unresolved alternate name.

Review-only matches do not merge records or transfer contacts, history, scores, suppression, or supplier relationships. Confirmed merges preserve all original records and provenance as aliases.

## 8. Two-Pass Reading

### 8.1 Light pass for up to 100 discoveries

Collect only the minimum needed to reject noise:

- organization name, country, official domain, source tier;
- organization type when explicitly stated;
- broad product categories;
- at least one official or authoritative evidence URL;
- obvious exclusion, duplicate, test, domestic-old-customer, small-order-only, or unsupported-market signals.

### 8.2 Deep pass for up to 20 organizations

Read first-party product, catalog, about, export, distributor, news, and contact pages. Extract:

- product families, brands, SKU breadth, sizes, and formats;
- recurring product-line and multi-market signals;
- manufacturer, brand owner, contract manufacturer, distributor, retailer, or trader status;
- factory/site, export-market, retailer, distributor, and exhibition signals;
- public company contact channel and provenance;
- confirmed or lead-only supplier relationships;
- suitable entry product, questions, risks, and evidence gaps.

Absence remains `unknown`, not `false`.

## 9. Scale and Fit Signals

Positive scale evidence includes:

- broad recurring SKU or brand portfolio;
- multiple sizes, flavors, variants, or product lines;
- factories or manufacturing sites explicitly identified;
- contract manufacturing, private-label, OEM, or ODM activity;
- export markets, distributor networks, retailer coverage, or sustained exhibition participation;
- public recurring shipment records with dataset coverage stated;
- multi-country presence or repeated product launches.

Website appearance, social follower count, a single marketplace listing, or an unverified employee estimate cannot independently establish scale.

Small-order-only, consumer-only, inactive, unverifiable, or contact-form-only organizations are deprioritized or held for review.

## 10. Dual Scoring

### 10.1 Opportunity score — 100 points

- product and application fit: 30;
- recurring volume and scale evidence: 25;
- China delivery / factory-inspection practical fit: 15;
- current certification and market fit: 10;
- public organizational contactability: 10;
- target-market priority: 10.

### 10.2 Evidence confidence — 100 points

- authoritative or first-party identity evidence: 25;
- official product evidence: 25;
- multi-source corroboration: 20;
- contact provenance and freshness: 15;
- scale/relationship evidence quality: 15.

Scores are stored with component reasons and evidence ids. Missing evidence scores zero; it is not negatively invented. AI may summarize evidence but cannot create evidence points.

Recommendation eligibility initially requires opportunity score at least 75, evidence confidence at least 80, no hard exclusion, and a completed current review. Thresholds are configuration with audited changes, not hidden prompt values.

## 11. Strategy and Recommendation Packet

Stream Planner produces a structured internal packet containing:

- organization identity and country;
- product families, formats, and specification signals;
- scale evidence and uncertainty;
- why it fits current capabilities;
- recommended entry product and differentiation angle;
- current supplier state: confirmed, public lead, or unknown;
- one to three first-contact questions;
- risks, missing evidence, and next verification step;
- public company contact types and their source URLs;
- English draft and Chinese translation;
- every material claim mapped to evidence ids.

Packet Guard removes or blocks unsupported price, certification, performance, delivery, supplier, and volume claims. The recommendation card displays five reviewed packets at most and never sends.

Before Matrix Stream can treat an organization as send-eligible, a separate country/channel policy registry must have a current human-reviewed record covering corporate-address eligibility, sender identification, opt-out wording, retention, and suppression handling. Missing or expired policy blocks sending without deleting the recommendation.

## 12. Feedback Learning

Feedback is event-based and explainable. Outcomes include selected, deferred, rejected with reason, draft approved, sent, accepted, bounced, replied, qualified inquiry, order, and suppressed.

The system reports cohort performance by country, category, source, organization type, entry strategy, and evidence pattern. Weight changes require an audited human approval and a before/after offline evaluation. The system does not autonomously retrain itself or silently change thresholds.

Negative outcomes do not erase sources or candidates. They change eligibility, cooling, suppression, or ranking state with an append-only reason.

## 13. Scheduling and Capacity

Daily default budget:

- discover up to 100 new organizations;
- deep-read up to 20 eligible organizations;
- recommend up to five;
- send zero from Matrix Atlas;
- Matrix Stream independently allows at most five human-confirmed accepted messages per day.

Budgets are also enforced per host and per adapter. Work queues are idempotent and resumable. Repeated discovery of the same canonical organization refreshes evidence rather than creating a new organization.

## 14. Observability

Required metrics:

- discoveries, unique organizations, duplicate ratio, and exclusions by source;
- source fetch success, cache hit, robots refusal, rate limit, and parser failure;
- light-to-deep, deep-to-recommend, recommend-to-select, select-to-send, send-to-reply, and reply-to-qualified-inquiry conversion;
- evidence completeness and staleness;
- country/category/source cohort response quality;
- queue latency, daily budget use, and circuit-breaker state.

Dashboards never expose full message bodies, credentials, hidden formulas, or unnecessary personal information.

## 15. Open-Source Pattern Review

Useful architectural patterns may be reimplemented after license and dependency review:

- separate discovery, extraction, enrichment, and provenance;
- confidence thresholds before writing enriched fields;
- fill missing fields without silently overwriting reviewed facts;
- fan-out reading workers with bounded time and partial durable results;
- immutable audit diffs and CRM-linked task/email timelines.

No external project is installed or copied merely because it advertises lead automation. Components involving stealth scraping, login automation, CAPTCHA bypass, guessed personal contacts, visitor deanonymization, or automatic bulk outreach are excluded. Any adopted dependency retains its real upstream name, version, license, checksum, network behavior, and internal audit record even when local display names use neutral codenames.

## 16. Automated Acceptance

- source registry rejects missing policy, stale review, disallowed paths, and unbounded rates;
- robots, redirect, content-size, cache, retry, and circuit-breaker tests;
- fixture adapters for government, exhibition, official website, PDF, retailer, and public trade-record evidence;
- exact entity linking and review-only fuzzy duplicate tests;
- no destructive merge and complete provenance retention;
- light-pass and deep-pass budgets of 100 and 20;
- dual score component and threshold tests;
- unsupported-claim and excluded-country hard gates;
- recommendation maximum of five and zero outbound capability in Atlas;
- refresh changes evidence state without duplicating the organization;
- end-to-end fixture: market task -> discovery -> deep read -> recommendation -> Matrix Stream handoff;
- production smoke uses read-only public pages and low request budgets, sends no external message, and records all fetch decisions.

## 17. Rollout Sequence

1. Source registry, policy engine, and evidence store.
2. Organization graph and exact/review-only identity resolution.
3. Market Radar and two initial P0/P1 adapters.
4. Light/deep reading and dual scoring.
5. Strategy packet and Packet Guard.
6. Recommendation handoff to Matrix Stream.
7. Additional government, exhibition, retailer, and corroborating adapters.
8. Feedback analytics and audited weight adjustment.

Each stage is independently testable and can be disabled without deleting accumulated evidence.

## 18. Explicitly Out of Scope

- private-profile or login-only collection;
- CAPTCHA, paywall, or access-control bypass;
- stealth identity or provenance concealment;
- guessed personal email or phone generation;
- automatic contact-form submission;
- visitor deanonymization or tracking pixels;
- autonomous threshold changes;
- automatic bulk email or follow-up;
- using aggregate trade data as company-specific purchasing proof;
- treating absence from a shipment, registry, or LEI dataset as proof of nonexistence.

## 19. Research References

- UN Comtrade API and coverage: https://uncomtrade.org/docs/un-comtrade-api/
- MATRADE Malaysia Products Directory: https://www.matrade.gov.my/en/source-from-malaysia/directories/malaysia-products-directory
- THAIFEX-Anuga Asia official exhibitor list: https://www.thaitradefair.com/fair-content/82/THAIFEX-Anuga%2BAsia%2B2026/2456/Exhibitor%2BList/
- Vietfood & Beverage / ProPack official site: https://hcm.foodexvietnam.com/en/exhibit-categories/
- Cosmoprof CBE ASEAN official site: https://www.cosmoprof.com/en/corporate/cosmoprof-network/cosmoprof-made-exhibitions/cosmoprof-cbe-asean-bangkok/
- GLEIF API: https://www.gleif.org/en/lei-data/gleif-api
- ImportYeti public-data coverage limitations: https://www.importyeti.com/faqs
- Google robots exclusion documentation: https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
- Gmail sender guidelines: https://support.google.com/mail/answer/81126?hl=en
- FTC CAN-SPAM business guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- ICO business-to-business marketing guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/
- Fire Enrich architecture reference: https://github.com/firecrawl/fire-enrich
- Django CRM task/email timeline reference: https://github.com/DjangoCRM/django-crm
- NextCRM confidence, fan-out, and audit reference: https://github.com/pdovhomilja/nextcrm-app

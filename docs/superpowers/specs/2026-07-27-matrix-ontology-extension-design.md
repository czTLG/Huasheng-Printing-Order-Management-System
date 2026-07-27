# Matrix Ontology Extension Design

**Date:** 2026-07-27  
**Status:** proposed  
**Scope:** deterministic bilingual evidence and draft-quality recognition

## Objective

Extend the existing deterministic ontology so that verified sauce and seasoning prospects can pass the same evidence, bilingual-consistency, and draft-quality checks already used for coffee, tea, snacks, and liquid-care prospects.

The change must not weaken provenance, duplicate prevention, quality thresholds, approval gates, country policy, delivery limits, or outbound confirmation.

## Supported concepts

Add reusable English–Chinese concept mappings for:

- sauce / sauces ↔ 酱料 / 酱汁;
- seasoning / seasonings ↔ 调味料 / 调味品;
- seasoning powder ↔ 调味粉;
- soup base ↔ 汤底 / 汤料;
- sachet ↔ 小袋;
- printed roll film / roll stock ↔ 印刷卷膜 / 卷膜.

The matcher continues to strip URLs before extracting facts. English abbreviations and material tokens continue to require word boundaries so that company names cannot accidentally create material facts.

## Evidence behavior

The quality gate may award product, company-specific, entry-value, subject, and bilingual-consistency points only when:

1. the concept appears in the official evidence snapshot;
2. the English and Chinese drafts express the same supported concept;
3. uncertain current packaging formats remain questions rather than assertions.

Statements such as “the company currently uses sachets” remain unsupported unless the official evidence explicitly says so. A question asking whether the company is evaluating sachets, pouches, or roll film is allowed when the public portfolio and development workflow are evidenced.

The word `supplier` must not create an unsupported-supplier failure when it describes the prospect’s published supplier-evaluation process. Named current-supplier claims remain blocked unless supported by relationship evidence.

## Dh Foods workflow

The current Dh Foods dossier remains the authoritative source:

- official company, product, factory, OEM, sustainability, cooperation, and purchasing pages;
- strategy-match score 100/100;
- verified Vietnamese route:
  `https://gdhspack.com/vi/applications/sauce-packaging`;
- official organizational recipient:
  `purchase@dhfoods.com.vn`.

After the ontology passes regression tests, the system may create one immutable bilingual draft for work item `3`. The draft asks whether Dh Foods is evaluating printed sachets, pouches, or roll film and requests one current pack photo, size, fill weight, estimated quantity, and packing-machine type. It must not claim that Dh Foods already uses those formats.

No approval or delivery job is created during this implementation.

## Tests

Add focused regression coverage proving:

1. sauce, seasoning, seasoning powder, soup base, sachet, and roll-film concepts align across English and Chinese;
2. an evidenced Dh Foods-style draft reaches the expected product, company, entry-value, subject, question, and bilingual-consistency components;
3. a question about a possible format does not become an asserted current format;
4. supplier-evaluation wording does not trigger a named-supplier failure;
5. unsupported named suppliers, conflicting bilingual facts, and URL-contained tokens remain blocked;
6. the existing full gate and review suites remain green.

## Operational boundary

Source changes may be committed and pushed after tests pass. Production deployment or service restart still requires explicit approval. Any external message still requires exact draft approval followed by final send confirmation.

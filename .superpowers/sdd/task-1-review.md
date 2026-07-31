# Task 1 Independent Re-review

## Conclusions

- **Specification compliance: PASS（通过）**
- **Code quality: APPROVED（批准）**

All four Important findings and the one Minor finding from the first review are resolved. The revised classifier satisfies the binding country roster and exclusion, deterministic classification precedence, required review routing, neutral codename constraint, and Phase 1 no-outbound/no-formal-CRM-write boundary. The committed regression suite now materially covers the brief rather than only its starter fixture.

## Remaining Findings

### Critical

None.

### Important

None.

### Minor

None.

## Resolution of Prior Findings

1. **Approved-country roster — resolved.**  
   File: `src/lib/schemaRank.js:5`  
   The immutable roster now contains exactly Vietnam, Thailand, Malaysia, Indonesia, Philippines, and Kazakhstan. India remains the sole explicit exclusion. The committed test verifies the complete roster, normalized approved names, exact excluded list, and normalized India behavior at `scripts/test-schema-rank.js:36`.

2. **Impossible calendar dates — resolved.**  
   File: `src/lib/schemaRank.js:61`  
   Date validation now checks supported syntax and round-trips year/month/day calendar components before accepting the value. `2026-02-30` routes to `needs_review` with `malformed_source_time`, with a committed regression at `scripts/test-schema-rank.js:91`.

3. **Whitespace-only WhatsApp identity — resolved.**  
   File: `src/lib/schemaRank.js:84`  
   Sender name and phone are normalized through a trimmed non-empty-string check. Both absent and whitespace-only sender identities route to `needs_review`; both cases are committed at `scripts/test-schema-rank.js:79` and `scripts/test-schema-rank.js:86`.

4. **Insufficient committed coverage — resolved.**  
   File: `scripts/test-schema-rank.js:1`  
   The expanded 125-line suite covers all six approved countries, India exclusion and normalization, test-over-noise and noise-over-review collisions, all five mandatory review conditions, output shape, exported constants/version, reason codes, A/B/C priorities, confidence values, recent/stale valid behavior, impossible dates, and absent/blank WhatsApp identity.

5. **Embedded ambiguous-contact literals — resolved.**  
   File: `src/lib/schemaRank.js:20`  
   The implementation now uses a named immutable domain policy and a deterministic general rule for domains whose first label is `example`. Tests cover both the original example-domain fixture and a named public-email-domain case at `scripts/test-schema-rank.js:72` and `scripts/test-schema-rank.js:101`.

## Binding Constraint Assessment

| Constraint | Result |
|---|---|
| Neutral codename for the new component | Pass (`schemaRank`) |
| Deterministic classification only; no LLM | Pass |
| Exact six-country roster | Pass |
| India excluded | Pass |
| Strict `test -> noise -> needs_review -> valid` precedence | Pass |
| Required review conditions | Pass |
| Phase 1 has no outbound action | Pass |
| Phase 1 does not write formal CRM | Pass |

## Evidence

- Fully reread the updated implementation report and `review-task-1-r2.diff`, then checked them against the original brief and first review.
- Accepted the implementation agent's reported passing `npm run test:matrix-rank` result without duplicating that same full run.
- Ran targeted read-only checks for every previously observed runtime failure: Philippines and Kazakhstan now return approved, India remains unapproved, `2026-02-30` routes to review, whitespace-only WhatsApp identity routes to review, and a test/noise/excluded collision resolves to `test`.
- The reviewed diff remains limited to the requested classifier, its test, and the package script; it contains no LLM, network, outbound, or formal CRM integration.

## 蒸馏进度

- 已确认模块：六国名单与 India 排除、四级分类优先级、五类待核实条件、A/B/C 优先级与置信度、Phase 1 边界。
- 未解决模块：无 Task 1 阻断项；公共邮箱域名集合的未来扩展需依据新的明确规则。
- 下一最高优先级知识缺口：后续阶段如扩展模糊联系规则，需先固化可审计的域名政策与回归用例。

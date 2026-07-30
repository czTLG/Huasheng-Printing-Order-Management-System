'use strict';

const assert = require('node:assert');
const Database = require('better-sqlite3');
const { scoreDraft, extractBilingualFacts } = require('../src/services/matrixStreamGate');
const { isNonAssertionRequest } = require('../src/services/matrixStreamText');
const { extractOntologyFacts } = require('../src/services/matrixStreamOntology');

const base = {
  subject: '250g and 500g coffee pouch options for Alpha Coffee',
  bodyEn: 'Dear Alpha Coffee team,\nWe reviewed your 250g and 500g roasted coffee range. We would like to discuss high-barrier valve pouches with stable repeat printing. Would it be useful if we reviewed one current coffee pack photo and highlighted the first valve-pouch points worth checking?\nBest regards',
  bodyCn: '您好，我们查看了贵司250g和500g烘焙咖啡产品，希望沟通高阻隔带阀袋及稳定套色。如果我们先查看一个现有咖啡包装图片，并指出最值得优先核对的带阀袋要点，这对贵司是否有帮助？',
  recipient: {
    email: 'sales@alpha.test',
    sourceUrl: 'https://alpha.test/contact',
    verifiedAt: '2026-07-17T00:00:00Z',
    kind: 'public_company'
  },
  evidence: {
    company: 'Alpha Coffee',
    categories: ['coffee'],
    products: ['250g roasted coffee', '500g roasted coffee'],
    entryProduct: 'high-barrier valve pouch',
    supportedClaims: ['stable repeat printing'],
    evidenceIds: [11, 12]
  },
  now: '2026-07-18T00:00:00Z'
};

function assertAllComponentsMax(result, label) {
  for (const [name, value] of Object.entries(result.components)) {
    assert.strictEqual(value.points, value.maximum, `${label}:${name}`);
  }
}

const good = scoreDraft(base);
assert.strictEqual(
  isNonAssertionRequest('If COCOME is evaluating an additional packaging supplier, please send us one current pack specification.'),
  true
);
assert.strictEqual(
  isNonAssertionRequest('如果 COCOME 正在评估新的包装供应商，请向我们提供一款现有包装的规格。'),
  true
);
assert.deepStrictEqual(
  extractOntologyFacts('Please send one current pack specification or filling-machine roll drawing.', 'en').package_format,
  ['roll_film']
);
assert.strictEqual(good.score, 100);
assert.strictEqual(good.passed, true);
assert.deepStrictEqual(Object.fromEntries(Object.entries(good.components).map(([key, value]) => [key, value.maximum])), {
  product_match: 20,
  company_specific: 15,
  entry_value: 15,
  questions: 15,
  subject: 10,
  bilingual_consistency: 10,
  readability: 10,
  recipient_provenance: 5
});
for (const component of Object.values(good.components)) assert.ok(Array.isArray(component.reasons));
assert.deepStrictEqual(good.components.product_match.evidence_ids, [11, 12]);
assert.deepStrictEqual(good.components.readability.evidence_ids, []);
assert.deepStrictEqual(good.components.recipient_provenance.evidence_ids, []);

const gulfSnack = scoreDraft({
  subject: 'Pillow pouch and roll-film options for Gulf Nuts private-label snacks',
  bodyEn: 'Dear Gulf Nuts Sales Team,\n\nWe reviewed your private-label range for nuts, dried fruits, spices and other dry foods, including pillow pouches and portion-controlled packs.\n\nWe are Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.\n\nFor these applications, we focus on moisture and aroma protection, seal and roll-film specifications, and print consistency.\n\nIf you have any pillow-pouch or roll-film projects currently under review, you may send us one existing specification, product photo or sample.\n\nBest regards',
  bodyCn: '尊敬的 Gulf Nuts 销售团队：\n\n我们查看了贵司面向坚果、干果、香辛料及其他干货食品的私牌产品系列，其中包括枕式袋及小份量包装。\n\n我们是华胜包装有限公司，一家位于中国的软包装制造商。\n\n针对这些应用，我们重点关注防潮及保香、封口与卷膜规格，以及印刷一致性。\n\n如果贵司目前有正在评估的枕式袋或卷膜项目，可以向我们提供一份现有规格、产品图片或样品。\n\n此致',
  recipient: {
    email: 'sales@gulf-nuts.test',
    sourceUrl: 'https://gulf-nuts.test/contact',
    verifiedAt: '2026-07-27T00:00:00Z',
    kind: 'public_company'
  },
  evidence: {
    company: 'Gulf Nuts Foodstuff Factory LLC',
    categories: ['nuts', 'dried fruit', 'snacks', 'spices'],
    products: ['nuts', 'dried fruits', 'spices', 'pillow pouches', 'portion-controlled packs', 'roll film'],
    entryProduct: 'pillow pouch and roll film',
    supportedClaims: [
      'We are Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
      '我们是华胜包装有限公司，一家位于中国的软包装制造商。',
      'For these applications, we focus on moisture and aroma protection, seal and roll-film specifications, and print consistency.',
      '针对这些应用，我们重点关注防潮及保香、封口与卷膜规格，以及印刷一致性。'
    ],
    evidenceIds: [21, 22, 23]
  },
  now: '2026-07-28T00:00:00Z'
});
assertAllComponentsMax(gulfSnack, 'gulf-snack');
assert.strictEqual(gulfSnack.score, 100);
assert.strictEqual(gulfSnack.passed, true);

const inconsistent = scoreDraft({
  ...base,
  bodyEn: 'Dear Alpha Coffee team,\nWe reviewed your 250g and 500g coffee range and can discuss pouches. Is anyone available?\nBest regards',
  bodyCn: '您好，我们查看了贵司1公斤茶叶产品，希望沟通普通纸盒。今天心情好吗？'
});
assert.ok(inconsistent.score < 80);
assert.strictEqual(inconsistent.passed, false);
assert.strictEqual(inconsistent.components.product_match.points, 0);
assert.strictEqual(inconsistent.components.entry_value.points, 0);
assert.strictEqual(inconsistent.components.questions.points, 0);
assert.strictEqual(inconsistent.components.bilingual_consistency.points, 0);

const confectioneryAligned = scoreDraft({
  ...base,
  subject: 'Confectionery packaging options for Acme Foods',
  bodyEn: 'Dear Acme Foods team,\n\nWe reviewed your confectionery, chocolate, biscuit and wafer range. We would like to discuss confectionery pouch options.\n\nCould you send one current pack photo?\n\nBest regards',
  bodyCn: '尊敬的贵司团队：\n\n我们查看了贵司的糖果食品、巧克力、饼干和威化系列，希望沟通糖果食品袋方案。\n\n能否发送一张现有包装照片？\n\n此致敬礼',
  evidence: {
    ...base.evidence,
    company: 'Acme Foods',
    categories: ['confectionery', 'chocolate', 'biscuits', 'wafers'],
    products: ['confectionery chocolate biscuits wafers'],
    entryProduct: 'confectionery pouch',
    supportedClaims: []
  }
});
assert.strictEqual(confectioneryAligned.components.product_match.points, 20);
assert.strictEqual(confectioneryAligned.components.entry_value.points, 15);
assert.strictEqual(confectioneryAligned.components.bilingual_consistency.points, 10);

const staleProvenance = scoreDraft({
  ...base,
  recipient: { ...base.recipient, verifiedAt: '2025-01-01T00:00:00Z' }
});
assert.strictEqual(staleProvenance.passed, false);
assert.ok(staleProvenance.hardFailures.includes('invalid_recipient_provenance'));
const unrelatedProvenance = scoreDraft({
  ...base,
  recipient: { ...base.recipient, sourceUrl: 'https://unrelated.test/contact' }
});
assert.strictEqual(unrelatedProvenance.passed, false);
assert.ok(unrelatedProvenance.hardFailures.includes('invalid_recipient_provenance'));
const conflictingFacts = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nOur annual volume is 100000 units and the finish is red.`,
  bodyCn: `${base.bodyCn}\n年用量为500000个，颜色为蓝色。`
});
assert.strictEqual(conflictingFacts.components.bilingual_consistency.points, 0);
assert.strictEqual(conflictingFacts.passed, false);
assert.ok(conflictingFacts.hardFailures.includes('bilingual_key_fact_conflict'));
const alignedFacts = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nOur annual volume is 100000 units and the finish is red.`,
  bodyCn: `${base.bodyCn}\n年用量为100000个，颜色为红色。`
});
assert.strictEqual(alignedFacts.components.bilingual_consistency.points, 10);
assert.ok(!alignedFacts.hardFailures.includes('bilingual_key_fact_conflict'));
const textualAlignedFacts = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nOur annual volume is one hundred thousand units and the finish is red.`,
  bodyCn: `${base.bodyCn}\n年用量为十万个，颜色为红色。`
});
assert.strictEqual(textualAlignedFacts.components.bilingual_consistency.points, 10);
assert.ok(!textualAlignedFacts.hardFailures.includes('bilingual_key_fact_conflict'));
const localizedUrlsDoNotCreateFacts = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nProduct reference:\nhttps://gdhspack.com/id/applications/daily-chemical-packaging`,
  bodyCn: `${base.bodyCn}\n产品参考：\nhttps://gdhspack.com/id/applications/daily-chemical-packaging`
});
assert.strictEqual(localizedUrlsDoNotCreateFacts.components.bilingual_consistency.points, 10);
assert.ok(!localizedUrlsDoNotCreateFacts.hardFailures.includes('bilingual_key_fact_conflict'));
assert.deepStrictEqual(
  extractBilingualFacts('PT Nose Herbal Indo', 'cn').material || [],
  [],
  'the letters AL inside a company name must not be treated as aluminum film'
);
assert.deepStrictEqual(
  extractBilingualFacts('sauce, seasoning powder, soup base, sachet and printed roll film', 'en'),
  {
    product_category: ['sauce', 'seasoning_powder', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  },
  'English food categories and flexible formats must map to canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('tea pouch with a zipper and roll-film SKU', 'en'),
  {
    package_format: ['roll_film'],
    zipper: ['present']
  },
  'hyphenated roll-film must map to the same fact as Chinese 卷膜'
);
assert.deepStrictEqual(
  extractBilingualFacts('酱料、调味粉、汤底、印刷小袋和卷膜', 'cn'),
  {
    product_category: ['sauce', 'seasoning_powder', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  },
  'Chinese food categories and flexible formats must map to the same canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('sauces, chili sauces, seasonings, soup bases, sachets, spout pouches and roll film', 'en'),
  {
    bag_type: ['spout_pouch'],
    product_category: ['chili_sauce', 'sauce', 'seasoning', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  },
  'English sauce-route categories and formats must map to canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('酱料、辣椒酱、调味品、汤底、小袋、吸嘴袋和卷膜', 'cn'),
  {
    bag_type: ['spout_pouch'],
    product_category: ['chili_sauce', 'sauce', 'seasoning', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  },
  'Chinese sauce-route categories and formats must map to the same canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('liquid detergent, hand soap, body soap and shampoo', 'en').product_category,
  ['body_soap', 'hand_soap', 'liquid_detergent', 'shampoo'],
  'English liquid-care categories must map to canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('洗衣液、洗手液、沐浴皂和洗发水', 'cn').product_category,
  ['body_soap', 'hand_soap', 'liquid_detergent', 'shampoo'],
  'Chinese liquid-care categories must map to the same canonical ontology facts'
);
assert.deepStrictEqual(
  extractBilingualFacts('official factory and supplier-evaluation process', 'en').supplier || [],
  [],
  'a published supplier-evaluation process is not a named supplier relationship'
);

const dhFoodsDraft = scoreDraft({
  subject: 'Sauce sachet and roll-film sourcing for Dh Foods',
  bodyEn: [
    'Dear Dh Foods Purchasing Team,',
    'We reviewed your official factory and supplier-evaluation process, as well as your sauce, soup-base, and seasoning portfolio.',
    'For one representative sauce or seasoning product, we can assess printed sachets, pouches, or roll film.',
    'Would it be useful if we reviewed one current pack photo and highlighted the first packaging points worth checking?',
    'Best regards,',
    'Gavin'
  ].join('\n\n'),
  bodyCn: [
    'Dh Foods采购团队，您好：',
    '我们查看了贵司官网公开的工厂及供应商评价流程，以及酱料、汤底和调味品产品系列。',
    '针对一个代表性的酱料或调味品产品，我们可以评估印刷小袋、包装袋或卷膜。',
    '如果我们先查看一个现有包装照片，并指出最值得优先核对的包装要点，这对贵司是否有帮助？',
    '此致',
    'Gavin'
  ].join('\n\n'),
  recipient: {
    email: 'purchase@dhfoods.com.vn',
    sourceUrl: 'https://www.dhfoods.com.vn/en/nha-may',
    verifiedAt: '2026-07-27T00:00:00.000Z',
    kind: 'public_company'
  },
  evidence: {
    company: 'Dh Foods',
    categories: ['sauce', 'soup base', 'seasoning'],
    products: ['sauce', 'soup base', 'seasoning'],
    entryProduct: 'printed sachets, pouches, and roll film for sauce or seasoning lines',
    supportedClaims: [],
    evidenceIds: [1, 2, 3, 4]
  },
  now: '2026-07-27T10:00:00.000Z'
});
assert.strictEqual(dhFoodsDraft.score, 100);
assert.strictEqual(dhFoodsDraft.passed, true, JSON.stringify(dhFoodsDraft));
assert.ok(!dhFoodsDraft.hardFailures.includes('unsupported_supplier'));
const linkHeavy = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nhttps://gdhspack.com/about\nhttps://gdhspack.com/products`,
  bodyCn: `${base.bodyCn}\nhttps://gdhspack.com/about\nhttps://gdhspack.com/products`
});
assert.ok(linkHeavy.hardFailures.includes('too_many_first_contact_links'));
const highFriction = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nCould you share your current material structure and expected annual volume?`,
  bodyCn: `${base.bodyCn}\n能否提供当前材料结构和预计年用量？`
});
assert.ok(highFriction.hardFailures.includes('high_friction_first_contact'));
const namedSupplierStillBlocked = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nTheir current supplier is Brand A.`,
  evidence: { ...base.evidence, supportedClaims: [] }
});
assert.ok(namedSupplierStillBlocked.hardFailures.includes('unsupported_supplier'));

for (const recipient of [
  { ...base.recipient, sourceUrl: 'https://test/contact' },
  { ...base.recipient, email: 'sales@tenant-a.workers.dev', sourceUrl: 'https://tenant-b.workers.dev/contact' }
]) {
  const result = scoreDraft({ ...base, recipient });
  assert.ok(result.hardFailures.includes('invalid_recipient_provenance'));
}
assert.ok(!scoreDraft({
  ...base,
  recipient: { ...base.recipient, email: 'sales@tenant-a.workers.dev', sourceUrl: 'https://tenant-a.workers.dev/contact' }
}).hardFailures.includes('invalid_recipient_provenance'));

const unsafe = scoreDraft({
  ...base,
  subject: 'Guaranteed lowest price',
  bodyEn: 'FDA approved. Final price is USD 0.05 with guaranteed lead time.'
});
assert.strictEqual(unsafe.passed, false);
for (const failure of ['unsupported_certification', 'unsupported_lead_time', 'unsupported_price']) {
  assert.ok(unsafe.hardFailures.includes(failure));
}
const mismatchedEvidence = scoreDraft({
  ...base,
  bodyEn: [
    'FDA approved.',
    'Final price is USD 0.05 with guaranteed lead time.',
    'We are an authorized supplier with guaranteed barrier performance and guaranteed delivery.'
  ].join(' '),
  evidence: { ...base.evidence, supportedClaims: ['BRC certified', 'Final price is USD 0.50'] }
});
for (const failure of [
  'unsupported_certification', 'unsupported_delivery', 'unsupported_lead_time',
  'unsupported_performance', 'unsupported_price', 'unsupported_supplier'
]) assert.ok(mismatchedEvidence.hardFailures.includes(failure));
for (const [bodyEn, supportedClaim, expectedFailure] of [
  ['Lead time is 15 days.', 'Lead time is 10 days.', 'unsupported_lead_time'],
  ['Guaranteed shelf life 6 months.', 'Guaranteed shelf life 12 months.', 'unsupported_performance'],
  ['We are an authorized supplier for Brand A.', 'We are an authorized supplier for Brand B.', 'unsupported_supplier'],
  ['Fixed delivery July 20.', 'Fixed delivery July 30.', 'unsupported_delivery']
]) {
  const result = scoreDraft({ ...base, bodyEn, evidence: { ...base.evidence, supportedClaims: [supportedClaim] } });
  assert.ok(result.hardFailures.includes(expectedFailure), `${bodyEn} must require exact evidence`);
}
for (const [bodyEn, expectedFailure] of [
  ['Delivery is guaranteed.', 'unsupported_delivery'],
  ['Lead time is two weeks.', 'unsupported_lead_time'],
  ['Our barrier performance is guaranteed.', 'unsupported_performance'],
  ['We supply Brand A officially.', 'unsupported_supplier'],
  ['交付有保证。', 'unsupported_delivery'],
  ['交期为两周。', 'unsupported_lead_time'],
  ['阻隔性能有保证。', 'unsupported_performance'],
  ['我们正式供应品牌A。', 'unsupported_supplier']
]) {
  const unsupported = scoreDraft({ ...base, bodyEn, evidence: { ...base.evidence, supportedClaims: [] } });
  assert.ok(unsupported.hardFailures.includes(expectedFailure), `${bodyEn} must be detected`);
  const supported = scoreDraft({ ...base, bodyEn, evidence: { ...base.evidence, supportedClaims: [bodyEn] } });
  assert.ok(!supported.hardFailures.includes(expectedFailure), `${bodyEn} exact evidence must support`);
}
for (const [claim, evidence, failure] of [
  ['Lead time is two weeks.', 'Lead time is 2 weeks.', 'unsupported_lead_time'],
  ['交期为两周。', '交期为2周。', 'unsupported_lead_time']
]) {
  const result = scoreDraft({ ...base, bodyEn: claim, evidence: { ...base.evidence, supportedClaims: [evidence] } });
  assert.ok(!result.hardFailures.includes(failure), `${claim} textual number must normalize exactly`);
}
for (const [claim, failure] of [
  ['Price: USD 0.05.', 'unsupported_price'], ['Certification: FDA.', 'unsupported_certification'],
  ['Supplier: Brand A.', 'unsupported_supplier'], ['Barrier performance: excellent.', 'unsupported_performance'],
  ['Delivery: prompt.', 'unsupported_delivery'], ['Lead time: flexible.', 'unsupported_lead_time'],
  ['We can guarantee delivery.', 'unsupported_delivery'], ['价格 USD 0.05。', 'unsupported_price'],
  ['认证 FDA。', 'unsupported_certification'], ['供应商 品牌A。', 'unsupported_supplier'],
  ['阻隔性能 优秀。', 'unsupported_performance'], ['交付 及时。', 'unsupported_delivery'],
  ['交期 灵活。', 'unsupported_lead_time']
]) {
  const result = scoreDraft({ ...base, bodyEn: claim, evidence: { ...base.evidence, supportedClaims: [] } });
  assert.ok(result.hardFailures.includes(failure), `${claim} semantic category must be evidence-gated`);
  const supported = scoreDraft({ ...base, bodyEn: claim, evidence: { ...base.evidence, supportedClaims: [claim] } });
  assert.ok(!supported.hardFailures.includes(failure));
}

for (const [englishFact, chineseFact, evidenceFacts] of [
  ['Material is nylon.', '材料为EVOH。', ['nylon', 'EVOH']],
  ['Finish is matte.', '表面为亮光。', ['matte', '亮光']],
  ['The pouch has a zipper.', '袋子不带拉链。', ['zipper', '不带拉链']],
  ['The color is yellow.', '颜色为紫色。', ['yellow', '紫色']],
  ['Use a stand-up pouch.', '使用方底袋。', ['stand-up pouch', '方底袋']]
]) {
  const result = scoreDraft({
    ...base,
    bodyEn: `${base.bodyEn}\n${englishFact}`,
    bodyCn: `${base.bodyCn}\n${chineseFact}`,
    evidence: { ...base.evidence, supportedClaims: evidenceFacts }
  });
  assert.strictEqual(result.components.bilingual_consistency.points, 0, `${englishFact}/${chineseFact}`);
  assert.ok(result.hardFailures.includes('bilingual_key_fact_conflict'));
}

const canonicalUnits = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nThickness is 100 micron, sample weight is 0.25kg, size is 10cm, target is 50%, date is July 20, 2026.`,
  bodyCn: `${base.bodyCn}\n厚度为0.1毫米，样品重量为250克，尺寸为100毫米，目标为50%，日期为2026年7月20日。`,
  evidence: { ...base.evidence, supportedClaims: ['Thickness is 100 micron', '厚度为0.1毫米', '0.25kg', '250克', 'Size is 10cm', '尺寸为100毫米', '50%', 'July 20, 2026', '2026年7月20日'] }
});
assert.strictEqual(canonicalUnits.components.bilingual_consistency.points, 10);
assert.ok(!canonicalUnits.hardFailures.includes('bilingual_key_fact_conflict'));
assert.strictEqual(canonicalUnits.passed, true);
assert.deepStrictEqual(canonicalUnits.hardFailures, []);

const mixedIntent = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nWe would like to discuss our guaranteed delivery and price is USD 0.05.`,
  evidence: { ...base.evidence, supportedClaims: [] }
});
assert.strictEqual(mixedIntent.passed, false);
assert.ok(mixedIntent.hardFailures.includes('unsupported_delivery'));
assert.ok(mixedIntent.hardFailures.includes('unsupported_price'));

const performanceWrappedByIntent = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nWe would like to discuss guaranteed barrier performance of our high-barrier valve pouch.`,
  evidence: { ...base.evidence, supportedClaims: [] }
});
assert.strictEqual(performanceWrappedByIntent.score, 100);
assert.strictEqual(performanceWrappedByIntent.passed, false);
assertAllComponentsMax(performanceWrappedByIntent, 'performanceWrappedByIntent');
assert.deepStrictEqual(performanceWrappedByIntent.hardFailures, ['unsupported_performance']);

for (const [field, claim, expectedFailure, counterpart] of [
  ['bodyEn', 'We would like to discuss high-barrier FDA-certified valve pouches.', 'unsupported_certification'],
  ['bodyEn', 'We would like to discuss high-barrier guaranteed performance valve pouches.', 'unsupported_performance'],
  ['bodyEn', 'We would like to discuss high-barrier price USD 0.05 valve pouches.', 'unsupported_price'],
  ['bodyEn', 'We would like to discuss high-barrier guaranteed delivery valve pouches.', 'unsupported_delivery'],
  ['bodyEn', 'We would like to discuss high-barrier lead time 7 days valve pouches.', 'unsupported_lead_time', '交期为7天。'],
  ['bodyCn', '希望沟通高阻隔FDA认证带阀袋。', 'unsupported_certification'],
  ['bodyCn', '希望沟通高阻隔保证性能带阀袋。', 'unsupported_performance'],
  ['bodyCn', '希望沟通高阻隔价格USD 0.05带阀袋。', 'unsupported_price'],
  ['bodyCn', '希望沟通高阻隔保证交付带阀袋。', 'unsupported_delivery'],
  ['bodyCn', '希望沟通高阻隔交期为7天带阀袋。', 'unsupported_lead_time', 'Lead time is 7 days.']
]) {
  const otherField = field === 'bodyEn' ? 'bodyCn' : 'bodyEn';
  const result = scoreDraft({
    ...base,
    [field]: `${base[field]}\n${claim}`,
    [otherField]: `${base[otherField]}${counterpart ? `\n${counterpart}` : ''}`,
    evidence: {
      ...base.evidence,
      supportedClaims: expectedFailure === 'unsupported_lead_time' ? ['Lead time: 7 days', '交期：7天'] : []
    }
  });
  assert.strictEqual(result.score, 100, claim);
  assert.strictEqual(result.passed, false, claim);
  assertAllComponentsMax(result, claim);
  assert.deepStrictEqual(result.hardFailures, [expectedFailure], claim);
}

for (const [enFact, cnFact] of [
  ['Lead time is 2 weeks.', '交期为3周。'],
  ['Order quantity is 100000 units.', '订单数量为500000个。'],
  ['Use a Velcro closure and transparent pouch.', '使用扎丝封口和不透明袋。']
]) {
  const result = scoreDraft({ ...base, bodyEn: `${base.bodyEn}\n${enFact}`, bodyCn: `${base.bodyCn}\n${cnFact}`,
    evidence: { ...base.evidence, supportedClaims: [enFact, cnFact] } });
  assert.strictEqual(result.components.bilingual_consistency.points, 0);
  assert.strictEqual(result.passed, false);
  assert.ok(result.hardFailures.includes('bilingual_key_fact_conflict'));
}

for (const [enQuestion, cnQuestion] of [
  ['Could you confirm whether you use PET and a zipper?', '请确认贵司是否使用PET和拉链？'],
  ['Could you share whether you prefer matte or glossy finish?', '请告知贵司偏好哑光还是亮光？']
]) {
  const result = scoreDraft({ ...base, bodyEn: `${base.bodyEn}\n${enQuestion}`, bodyCn: `${base.bodyCn}\n${cnQuestion}` });
  assert.strictEqual(result.score, 100, `${enQuestion}/${cnQuestion}`);
  assert.strictEqual(result.passed, true, `${enQuestion}/${cnQuestion}`);
  assert.deepStrictEqual(result.hardFailures, [], `${enQuestion}/${cnQuestion}`);
  assertAllComponentsMax(result, `${enQuestion}/${cnQuestion}`);
}

const genuineUnknownOptionQuestion = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nCould you confirm whether magnetic closure is available?`,
  bodyCn: `${base.bodyCn}\n请确认磁吸封口是否可选？`
});
assert.strictEqual(genuineUnknownOptionQuestion.score, 100);
assert.strictEqual(genuineUnknownOptionQuestion.passed, true);
assertAllComponentsMax(genuineUnknownOptionQuestion, 'genuineUnknownOptionQuestion');
assert.deepStrictEqual(genuineUnknownOptionQuestion.hardFailures, []);

const unitConflict = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nThickness is 100 micron and date is July 20, 2026.`,
  bodyCn: `${base.bodyCn}\n厚度为0.2毫米，日期为2026年7月21日。`,
  evidence: { ...base.evidence, supportedClaims: ['100 micron', '0.2毫米', 'July 20, 2026', '2026年7月21日'] }
});
assert.strictEqual(unitConflict.components.bilingual_consistency.points, 0);
assert.strictEqual(unitConflict.passed, false);
assert.ok(unitConflict.hardFailures.includes('bilingual_key_fact_conflict'));

const unknownProductFact = scoreDraft({
  ...base,
  bodyEn: `${base.bodyEn}\nClosure is magnetic.`,
  bodyCn: `${base.bodyCn}\n封口为磁吸式。`,
  evidence: { ...base.evidence, supportedClaims: ['magnetic closure', '磁吸封口'] }
});
assert.strictEqual(unknownProductFact.passed, false);
assert.ok(unknownProductFact.hardFailures.includes('unknown_product_fact'));

for (const [enFact, cnFact] of [
  ['Could you confirm our closure is magnetic?', '请确认我们的封口为磁吸式？'],
  ['Could you confirm our closure: magnetic?', '请确认我们的封口：磁吸式？'],
  ['Could you confirm our closure uses magnetic technology?', '请确认我们的封口采用磁吸技术？'],
  ['Closure is magnetic.', '封口为磁吸式。']
]) {
  const result = scoreDraft({
    ...base,
    bodyEn: `${base.bodyEn}\n${enFact}`,
    bodyCn: `${base.bodyCn}\n${cnFact}`,
    evidence: { ...base.evidence, supportedClaims: ['magnetic closure', '磁吸封口'] }
  });
  assert.strictEqual(result.score, 100, `${enFact}/${cnFact}`);
  assert.strictEqual(result.passed, false, `${enFact}/${cnFact}`);
  assertAllComponentsMax(result, `${enFact}/${cnFact}`);
  assert.deepStrictEqual(result.hardFailures, ['unknown_product_fact'], `${enFact}/${cnFact}`);
}

for (const [enFact, cnFact, supportedClaims] of [
  ['Thickness is 100mm.', '厚度为100毫米。', ['Size is 100mm.', '尺寸为100毫米。']],
  ['Size is 100mm.', '尺寸为100毫米。', ['Thickness is 100mm.', '厚度为100毫米。']],
  ['Thickness is 100mm.', '厚度为100毫米。', ['100mm', '100毫米']]
]) {
  const result = scoreDraft({
    ...base,
    bodyEn: `${base.bodyEn}\n${enFact}`,
    bodyCn: `${base.bodyCn}\n${cnFact}`,
    evidence: { ...base.evidence, supportedClaims }
  });
  assert.strictEqual(result.score, 100, `${enFact}/${supportedClaims.join('/')}`);
  assert.strictEqual(result.passed, false, `${enFact}/${supportedClaims.join('/')}`);
  assertAllComponentsMax(result, `${enFact}/${supportedClaims.join('/')}`);
  assert.deepStrictEqual(result.hardFailures, ['unsupported_product_fact'], `${enFact}/${supportedClaims.join('/')}`);
}

const { evaluateInitialContact } = require('../src/services/matrixStreamGate');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE inquiries (id INTEGER PRIMARY KEY, customer_id INTEGER, created_at TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE crm_messages (
    id INTEGER PRIMARY KEY, customer_id INTEGER, sender_contact TEXT, receiver_contact TEXT,
    direction TEXT NOT NULL, received_at TEXT NOT NULL, workflow_status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE matrix_stream_versions (
    id INTEGER PRIMARY KEY, recipient_email TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_jobs (
    id INTEGER PRIMARY KEY, version_id INTEGER, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_events (
    id INTEGER PRIMARY KEY, action TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
`);
db.prepare('INSERT INTO customers VALUES (1, ?, ?, 1)').run('Alpha Coffee', 'sales@alpha.test');
db.prepare('INSERT INTO customers VALUES (2, ?, ?, 1)').run('Acme Foods Limited', 'hello@acme-foods.example');
db.prepare('INSERT INTO orders VALUES (1, ?, ?)').run('Order Buyer', '2026-01-01T00:00:00Z');
db.prepare('INSERT INTO crm_messages VALUES (1, NULL, ?, ?, ?, ?, ?)').run(
  'operator@internal.test', 'new@cooling.test', 'outbound', '2026-06-01T00:00:00Z', 'complete'
);
db.prepare('INSERT INTO crm_messages VALUES (2, NULL, ?, ?, ?, ?, ?)').run(
  'reply@standalone.test', 'operator@internal.test', 'inbound', '2026-06-15T00:00:00Z', 'complete'
);
const insertAccepted = db.prepare('INSERT INTO matrix_stream_jobs VALUES (?, NULL, ?, ?, ?)');
for (let id = 1; id <= 5; id += 1) {
  insertAccepted.run(id, 'accepted', `2026-07-18T0${id}:00:00Z`, `2026-07-18T0${id}:00:00Z`);
}
db.prepare('INSERT INTO matrix_stream_versions VALUES (99, ?)').run('old@repeat.test');
db.prepare('INSERT INTO matrix_stream_jobs VALUES (99, 99, ?, ?, ?)').run('accepted', '2026-07-01T06:00:00Z', '2026-07-01T06:00:00Z');
db.prepare('INSERT INTO matrix_stream_events VALUES (1, ?, ?, ?, ?)').run(
  'suppressed', '{}', JSON.stringify({ email: 'blocked@suppressed.test', domain: 'suppressed.test' }), '2026-07-01T00:00:00Z'
);

assert.strictEqual(evaluateInitialContact(db, {
  email: ' SALES@ALPHA.TEST ', domain: 'alpha.test', companyName: 'Alpha Coffee', now: '2026-07-18T00:00:00Z'
}).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'buyer@order.test', domain: 'order.test', companyName: 'Order Buyer', now: '2026-07-18T00:00:00Z'
}).route, 'existing_relationship');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'new@cooling.test', domain: 'cooling.test', companyName: 'Cooling Ltd', now: '2026-07-18T00:00:00Z'
}).reasons[0], 'domain_cooling_90_days');
assert.deepStrictEqual(evaluateInitialContact(db, {
  email: 'reply@standalone.test', domain: 'standalone.test', companyName: 'Standalone Ltd', now: '2026-07-19T14:00:00+08:00'
}), { allowed: true, route: 'existing_relationship', reasons: ['exact_crm_reply'], matchedCustomerIds: [] });
assert.strictEqual(evaluateInitialContact(db, {
  email: 'new@repeat.test', domain: 'repeat.test', companyName: 'Repeat Ltd', now: '2026-07-19T14:00:00+08:00'
}).reasons[0], 'domain_cooling_90_days');
assert.strictEqual(evaluateInitialContact(db, {
  email: 'sixth@fresh.test', domain: 'fresh.test', companyName: 'Fresh Ltd', now: '2026-07-18T14:00:00+08:00'
}).reasons[0], 'daily_accepted_limit_5');
const possibleDuplicate = evaluateInitialContact(db, {
  email: 'new@other.example', domain: 'other.example', companyName: 'Acme Foods Ltd', now: '2026-07-19T14:00:00+08:00'
});
assert.strictEqual(possibleDuplicate.route, 'possible_duplicate_review');
assert.deepStrictEqual(possibleDuplicate.matchedCustomerIds, [2]);
assert.strictEqual(db.prepare('SELECT count(*) AS count FROM customers').get().count, 2);
assert.strictEqual(evaluateInitialContact(db, {
  email: 'blocked@suppressed.test', domain: 'suppressed.test', companyName: 'Suppressed Ltd', now: '2026-07-19T14:00:00+08:00'
}).route, 'blocked');
db.close();

const incompleteDb = new Database(':memory:');
incompleteDb.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, contact TEXT, active INTEGER)');
assert.deepStrictEqual(evaluateInitialContact(incompleteDb, {
  email: 'new@missing.test', domain: 'missing.test', companyName: 'Missing Ltd', now: '2026-07-19T14:00:00+08:00'
}), { allowed: false, route: 'blocked', reasons: ['identity_check_failed'], matchedCustomerIds: [] });
incompleteDb.close();

const { createMatrixStreamReadiness } = require('../src/services/matrixStreamReadiness');
const { thirdCalendarDayAtTen, scheduleReplyCheck, closeReplyCheck } = require('../src/services/matrixStreamFollowup');

assert.strictEqual(thirdCalendarDayAtTen('2026-07-17T14:00:00+08:00'), '2026-07-20T10:00:00+08:00');
assert.strictEqual(thirdCalendarDayAtTen('2026-07-18T14:00:00+08:00'), '2026-07-21T10:00:00+08:00');

const followupDb = new Database(':memory:');
followupDb.exec(`
  CREATE TABLE matrix_work_items (
    id INTEGER PRIMARY KEY, candidate_id INTEGER, next_action TEXT NOT NULL DEFAULT '', next_followup_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_customer_links (
    canonical_customer_id INTEGER NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL
  );
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE matrix_stream_jobs (
    id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL, state TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE matrix_stream_reply_checks (
    id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL, originating_job_id INTEGER NOT NULL UNIQUE,
    purpose TEXT NOT NULL, channel TEXT NOT NULL, priority TEXT NOT NULL,
    due_at TEXT, state TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, closed_at TEXT
  );
`);
followupDb.prepare('INSERT INTO matrix_work_items VALUES (1, 39, ?, NULL, ?)').run('', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (11, 1, ?, ?)').run('accepted', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (12, 1, ?, ?)').run('pending', '2026-07-17T06:00:00.000Z');
followupDb.prepare('INSERT INTO matrix_stream_jobs VALUES (13, 1, ?, ?)').run('accepted', '2026-07-20T06:00:00.000Z');
const scheduled = scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email', priority: 'normal' });
assert.deepStrictEqual({
  work_item_id: scheduled.work_item_id,
  originating_job_id: scheduled.originating_job_id,
  purpose: scheduled.purpose,
  channel: scheduled.channel,
  priority: scheduled.priority,
  due_at: scheduled.due_at
}, {
  work_item_id: 1, originating_job_id: 11, purpose: 'reply_check', channel: 'email', priority: 'normal',
  due_at: '2026-07-20T10:00:00+08:00'
});
assert.strictEqual(scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email', priority: 'urgent' }).id, scheduled.id);
assert.strictEqual(followupDb.prepare('SELECT count(*) AS count FROM matrix_stream_reply_checks').get().count, 1);
assert.strictEqual(followupDb.prepare('SELECT next_followup_at FROM matrix_work_items WHERE id = 1').get().next_followup_at, scheduled.due_at);
assert.throws(() => scheduleReplyCheck(followupDb, { jobId: 12, channel: 'email' }), /accepted/);
const competing = scheduleReplyCheck(followupDb, { jobId: 13, channel: 'email', priority: 'normal' });
assert.strictEqual(competing.due_at, '2026-07-23T10:00:00+08:00');
assert.strictEqual(followupDb.prepare('SELECT next_followup_at FROM matrix_work_items WHERE id = 1').get().next_followup_at, scheduled.due_at);
const closed = closeReplyCheck(followupDb, { jobId: 11, reason: 'reply', closedAt: '2026-07-19T00:00:00.000Z' });
assert.strictEqual(closed.state, 'closed');
assert.strictEqual(closed.terminal_reason, 'reply');
assert.strictEqual(closed.due_at, null);
assert.deepStrictEqual(followupDb.prepare('SELECT next_action, next_followup_at FROM matrix_work_items WHERE id = 1').get(), {
  next_action: 'reply_check', next_followup_at: competing.due_at
});
assert.throws(() => closeReplyCheck(followupDb, { jobId: 11, reason: 'sent_again' }), /terminal reason/);
assert.strictEqual(scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email' }).state, 'closed');
closeReplyCheck(followupDb, { jobId: 13, reason: 'manual_stop', closedAt: '2026-07-20T08:00:00.000Z' });
assert.deepStrictEqual(followupDb.prepare('SELECT next_action, next_followup_at FROM matrix_work_items WHERE id = 1').get(), {
  next_action: '', next_followup_at: null
});
followupDb.prepare(`UPDATE matrix_work_items SET next_action = 'manual_review', next_followup_at = ?, updated_at = ? WHERE id = 1`)
  .run('2026-07-30T10:00:00+08:00', '2026-07-20T10:00:00.000Z');
const beforeClosedReplay = followupDb.prepare('SELECT * FROM matrix_work_items WHERE id = 1').get();
assert.strictEqual(scheduleReplyCheck(followupDb, { jobId: 11, channel: 'email' }).state, 'closed');
assert.deepStrictEqual(followupDb.prepare('SELECT * FROM matrix_work_items WHERE id = 1').get(), beforeClosedReplay);
followupDb.close();

(async () => {
  const readinessDb = new Database(':memory:');
  readinessDb.exec(`
    CREATE TABLE matrix_stream_sender_checks (
      id INTEGER PRIMARY KEY, sender_domain TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      spf_ok INTEGER NOT NULL, dkim_ok INTEGER NOT NULL, dmarc_ok INTEGER NOT NULL,
      tls_ok INTEGER NOT NULL, smtp_ok INTEGER NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(sender_domain, checked_at)
    );
    CREATE TABLE matrix_stream_country_policies (
      country_code TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL,
      sender_identity_required INTEGER NOT NULL, opt_out_required INTEGER NOT NULL,
      reviewed_by INTEGER NOT NULL, reviewed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      source_urls_json TEXT NOT NULL, PRIMARY KEY(country_code, channel)
    );
  `);
  readinessDb.prepare(`
    INSERT INTO matrix_stream_country_policies VALUES ('US', 'email', 'approved', 1, 1, 1, ?, ?, ?)
  `).run('2026-07-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z', '["https://authority.example/policy"]');
  let txtCalls = 0;
  let transportCalls = 0;
  const readiness = createMatrixStreamReadiness({
    clock: () => new Date('2026-07-18T00:00:00Z'),
    resolveTxt: async name => {
      txtCalls += 1;
      return ({
        'sender.test': ['v=spf1 include:mail.test -all'],
        'selector._domainkey.sender.test': ['v=DKIM1; p=abc'],
        '_dmarc.sender.test': ['v=DMARC1; p=none']
      })[name] || [];
    },
    verifyTransport: async () => {
      transportCalls += 1;
      return { tls: true, smtp: true };
    }
  });
  const readyInput = { db: readinessDb, domain: 'sender.test', selector: 'selector', countryCode: 'US', channel: 'email' };
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, []);
  assert.strictEqual((await readiness.check(readyInput)).ok, true);
  assert.strictEqual(txtCalls, 3);
  assert.strictEqual(transportCalls, 1);
  assert.strictEqual(readinessDb.prepare('SELECT count(*) AS count FROM matrix_stream_sender_checks').get().count, 1);
  readinessDb.prepare("UPDATE matrix_stream_country_policies SET source_urls_json = '[\"http://invalid.example/policy\"]'").run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.prepare(`
    UPDATE matrix_stream_country_policies
    SET source_urls_json = '["https://authority.example/policy"]', sender_identity_required = 0
  `).run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.prepare('UPDATE matrix_stream_country_policies SET sender_identity_required = 1').run();

  const notReady = createMatrixStreamReadiness({
    clock: () => new Date('2026-07-18T00:00:00Z'),
    resolveTxt: async () => [],
    verifyTransport: async () => ({ tls: false, smtp: false })
  });
  const missing = await notReady.check({ db: readinessDb, domain: 'other.test', selector: '', countryCode: 'CA', channel: 'email' });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.hardFailures.sort(), [
    'country_channel_policy_not_approved', 'missing_dkim', 'missing_dmarc', 'missing_selector',
    'missing_smtp_verification', 'missing_spf', 'missing_tls'
  ]);
  readinessDb.prepare("UPDATE matrix_stream_country_policies SET expires_at = '2026-07-17T00:00:00.000Z'").run();
  assert.deepStrictEqual((await readiness.check(readyInput)).hardFailures, ['country_channel_policy_not_approved']);
  readinessDb.close();
  process.stdout.write('matrix stream gate tests passed\n');
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

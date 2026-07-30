'use strict';

const { parse: parseDomain } = require('tldts');
const { isNonAssertionRequest, splitSentences } = require('./matrixStreamText');
const { extractOntologyFacts } = require('./matrixStreamOntology');
const { validateSnapshotRecipientProvenance } = require('./matrixRecipientProvenance');

const MAXIMUMS = Object.freeze({
  product_match: 20,
  company_specific: 15,
  entry_value: 15,
  questions: 15,
  subject: 10,
  bilingual_consistency: 10,
  readability: 10,
  recipient_provenance: 5
});

function normalized(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstContactContentFailures(bodyEn, bodyCn) {
  const failures = [];
  const urlsEn = String(bodyEn || '').match(/https?:\/\/[^\s<>'"）)]+/gi) || [];
  const urlsCn = String(bodyCn || '').match(/https?:\/\/[^\s<>'"）)]+/gi) || [];
  if (urlsEn.length > 1 || urlsCn.length > 1) failures.push('too_many_first_contact_links');
  const highFriction = /current material structure|expected annual volume|annual consumption|package size.{0,80}estimated quantity|pack photo.{0,120}(?:size|dimensions).{0,120}(?:quantity|volume)|当前材料结构|预计年用量|包装(?:图片|照片).{0,80}(?:尺寸).{0,120}(?:数量|年用量)/iu;
  if (highFriction.test(String(bodyEn || '')) || highFriction.test(String(bodyCn || ''))) {
    failures.push('high_friction_first_contact');
  }
  return failures;
}

function compact(value) {
  return normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function includesPhrase(text, phrase) {
  const haystack = compact(text);
  const needle = compact(phrase);
  return Boolean(needle && haystack.includes(needle));
}

function includesCompany(text, company) {
  if (includesPhrase(text, company)) return true;
  const words = normalized(company).split(/\s+/)
    .filter(word => !/^(?:llc|ltd|limited|inc|corp|corporation|company|co)$/i.test(word));
  if (words.length >= 2 && includesPhrase(text, words.slice(0, 2).join(' '))) return true;
  const firstDistinctiveWord = words[0]?.replace(/[^\p{L}\p{N}]+/gu, '') || '';
  return firstDistinctiveWord.length >= 4 && includesPhrase(text, firstDistinctiveWord);
}

function component(points, maximum, reasons, evidenceIds) {
  return { points, maximum, reasons, evidence_ids: evidenceIds };
}

const CLAIM_SEMANTICS = Object.freeze({
  unsupported_price: /(?:[$€£¥]|\b(?:usd|eur|rmb|cny|gbp)\b|美元|元|price|cost|quote|amount|价格|报价|单价|售价|费用|金额|成本)/iu,
  unsupported_certification: /(?:\b(?:fda|iso|brcgs?|haccp|gmp|ce|rohs|sedex)\b|certif|compliant|认证|资质|合规|许可证|审核)/iu,
  unsupported_supplier: /(?:supplier|vendor|manufacturer|\bsuppl(?:y|ies|ied)\b|供应商|制造商|供应)/iu,
  unsupported_performance: /(?:performance|barrier|shelf\s*life|quality|性能|阻隔|保质期|质量)/iu,
  unsupported_delivery: /(?:delivery|arrival|shipping|交付|到货|发货)/iu,
  unsupported_lead_time: /(?:lead[ -]?time|交期|生产周期)/iu
});

function unsupportedClaims(input) {
  const output = claimKeys([input.subject, input.bodyEn, input.bodyCn], input.evidence || {});
  const supported = claimKeys(Array.isArray(input.evidence?.supportedClaims) ? input.evidence.supportedClaims : []);
  return [...new Set(output.filter(claim => !supported.includes(claim)).map(claim => claim.split(':', 1)[0]))];
}

function claimKeys(values, evidence = null) {
  const keys = [];
  for (const value of values) {
    for (const raw of splitSentences(value)) {
      if (isNonAssertionRequest(raw)) continue;
      for (const clause of claimClauses(raw)) {
        const statement = normalizeTextNumbers(clause).replace(/[。.!?！？,，;；]+$/u, '').trim();
        const semanticText = semanticClaimText(clause, evidence);
        for (const [type, semantic] of Object.entries(CLAIM_SEMANTICS)) {
          if (semantic.test(semanticText)) keys.push(`${type}:${compact(statement)}`);
        }
      }
    }
  }
  return [...new Set(keys)];
}

function claimClauses(raw) {
  return String(raw).split(/(?<=[,，;；])\s*|\s+(?:and|but)\s+(?=(?:our\b|the\b|price\b|delivery\b|lead[ -]?time\b|we\b))/iu)
    .map(clause => clause.trim()).filter(Boolean);
}

function semanticClaimText(clause, evidence) {
  const statement = normalized(clause)
    .replace(/\bsupplier[ -](?:evaluation|assessment|qualification)(?:\s+process)?\b/giu, ' ')
    .replace(/供应商(?:评价|评估|审核|准入)(?:流程|制度|程序)?/gu, ' ');
  if (!evidence || !(/^(?:we (?:would like|want) to discuss)\b/i.test(statement) || /(?:希望|想要)(?:沟通|了解)/u.test(statement))) return statement;
  const evidenceText = [evidence.entryProduct, ...(Array.isArray(evidence.products) ? evidence.products : [])].join('\n');
  const statementFacts = [extractOntologyFacts(statement, 'en'), extractOntologyFacts(statement, 'cn')];
  const evidenceFacts = [extractOntologyFacts(evidenceText, 'en'), extractOntologyFacts(evidenceText, 'cn')];
  const evidenceBacked = statementFacts.some(facts => Object.entries(facts).some(([role, values]) => {
    const supported = new Set(evidenceFacts.flatMap(item => item[role] || []));
    return values.some(value => supported.has(value));
  }));
  if (!evidenceBacked) return statement;
  return statement
    .replace(/\bhigh[ -]barrier\b/giu, ' ')
    .replace(/\bvalve\s+pouches?\b/giu, ' ')
    .replace(/高阻隔/gu, ' ')
    .replace(/带阀袋/gu, ' ');
}

const EN_NUMBERS = Object.freeze({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });
const EN_NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)';

function englishNumber(value) {
  let total = 0; let current = 0;
  for (const token of String(value).toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(word => word !== 'and')) {
    if (Object.prototype.hasOwnProperty.call(EN_NUMBERS, token)) current += EN_NUMBERS[token];
    else if (token === 'hundred') current = (current || 1) * 100;
    else if (token === 'thousand') { total += (current || 1) * 1000; current = 0; }
    else if (token === 'million') { total += (current || 1) * 1000000; current = 0; }
    else return null;
  }
  return total + current;
}

function chineseNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0; let section = 0; let number = 0;
  for (const char of String(value)) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) number = digits[char];
    else if (units[char] === 10000) { total += (section + number) * 10000; section = 0; number = 0; }
    else if (units[char]) { section += (number || 1) * units[char]; number = 0; }
    else return null;
  }
  return total + section + number;
}

function normalizeTextNumbers(value) {
  return normalized(value)
    .replace(new RegExp(`\\b${EN_NUMBER_WORD}(?:(?:[ -]+and)?[ -]+${EN_NUMBER_WORD})*\\b`, 'gi'), words => String(englishNumber(words) ?? words))
    .replace(/[零〇一二两三四五六七八九十百千万]+(?=(?:个|件|袋|箱|周|天|月|年|公斤|克|吨|元|%|，|。|、|；|：|\s|$))/gu,
      word => String(chineseNumber(word) ?? word));
}

function withoutUrls(value) {
  return String(value || '')
    .replace(/(^|\n)[^\n]*[:：]\s*\nhttps?:\/\/[^\s<>()]+/giu, '$1 ')
    .replace(/https?:\/\/[^\s<>()]+/giu, ' ');
}

const CONCEPTS = Object.freeze([
  ['coffee', /\bcoffee\b/i, /咖啡/u], ['tea', /\btea\b/i, /茶/u],
  ['nuts', /\bnuts?\b/i, /坚果/u], ['dried_fruit', /\bdried\s+fruits?\b/i, /干果/u],
  ['snacks', /\bsnacks?\b/i, /零食/u], ['spices', /\bspices?\b/i, /香辛料/u],
  ['chili_sauce', /\bchili\s+sauces?\b/i, /辣椒酱/u],
  ['sauce', /\bsauces?\b/i, /(?:酱料|酱汁)/u],
  ['seasoning_powder', /\bseasoning\s+powders?\b/i, /调味粉/u],
  ['seasoning', /\bseasonings?\b(?!\s+powders?\b)/i, /(?:调味料|调味品)/u],
  ['soup_base', /\bsoup[ -]?bases?\b/i, /(?:汤底|汤料)/u],
  ['confectionery', /\bconfectionery\b/i, /糖果食品/u],
  ['chocolate', /\bchocolates?\b/i, /巧克力/u],
  ['biscuit', /\bbiscuits?\b/i, /饼干/u],
  ['wafer', /\bwafers?\b/i, /威化/u],
  ['candy', /\bcand(?:y|ies)\b/i, /糖果/u],
  ['curry', /\bcurr(?:y|ies)\b/i, /咖喱/u],
  ['liquid_detergent', /\bliquid\s+detergents?\b/i, /洗衣液/u],
  ['hand_soap', /\bhand\s+soaps?\b/i, /洗手液/u],
  ['body_soap', /\bbody\s+soaps?\b/i, /沐浴皂/u],
  ['shampoo', /\bshampoo\b/i, /洗发/u], ['body_wash', /\bbody[ -]?wash\b/i, /沐浴/u],
  ['personal_care', /\bpersonal[ -]?care\b/i, /个护/u], ['home_care', /\bhome[ -]?care\b/i, /家清/u],
  ['refill', /\brefill\b/i, /补充/u],
  ['pouch', /\bpouches?\b/i, /袋/u], ['valve', /\bvalve\b/i, /阀/u],
  ['sachet', /\bsachets?\b/i, /小袋/u],
  ['roll_film', /\b(?:(?:printed|packaging)[ -]+)?roll[ -]+(?:film|stock)\b/i, /(?:印刷卷膜|包装卷膜|卷膜)/u],
  ['barrier', /\bbarrier\b/i, /阻隔/u], ['printing', /\bprint(?:ing)?\b/i, /(?:印刷|套色)/u]
]);
const QUESTION_INTENTS = Object.freeze([
  ['structure', /\bstructure\b/i, /结构/u],
  ['volume', /(?:annual\s+volume|yearly\s+volume|volume|quantity)/i, /(?:年用量|年需求|数量|用量)/u],
  ['size', /\b(?:size|format)\b/i, /尺寸/u],
  ['structure', /\bmaterial\b/i, /材料/u],
  ['specification', /\bspecifications?\b/i, /规格/u],
  ['sample', /\b(?:photos?|samples?)\b/i, /(?:图片|照片|样品)/u]
]);

function numericSpecs(text) {
  const value = normalizeTextNumbers(text);
  const facts = [];
  for (const match of value.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|公斤|克)\b/giu)) facts.push(`weight:${canonicalUnit(match[1], match[2])}`);
  for (const match of value.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(cm|mm|厘米|毫米|microns?|um|μm|微米)\b/giu)) facts.push(`length:${canonicalUnit(match[1], match[2])}`);
  return facts;
}

function canonicalUnit(number, unit) {
  const amount = Number(String(number).replace(/,/g, ''));
  const key = String(unit || '').toLowerCase();
  const converted = key === 'kg' || key === '公斤' ? amount * 1000
      : key === 'cm' || key === '厘米' ? amount * 10
        : /micron|um|μm|微米/i.test(key) ? amount / 1000
      : key === 'mm' || key === '毫米' ? amount
          : amount;
  const suffix = /kg|g|公斤|克/i.test(key) ? 'g' : 'mm';
  return `${Number(converted.toFixed(6))}${suffix}`;
}

function isoDate(value) {
  const text = normalizeTextNumbers(value);
  let match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/u) || text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (!match) return null;
  const month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(match[1].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
}

function durationDays(number, unit) {
  return Number(number) * (/week|周/i.test(unit) ? 7 : /month|月/i.test(unit) ? 30 : 1);
}

function bilingualFacts(text, language, evidenceMode = false) {
  const value = normalizeTextNumbers(withoutUrls(text));
  const facts = {};
  const add = (role, item) => { if (item !== undefined) (facts[role] ||= new Set()).add(String(item).toLowerCase()); };
  const annual = language === 'en' ? /annual\s+(?:volume|quantity)\s*(?:is|:)?\s*(\d[\d,.]*)/gi : /年(?:用量|需求|数量)\s*(?:为|是|约|:|：)\s*(\d[\d,.]*)/gu;
  for (const match of value.matchAll(annual)) add('annual_volume', Number(match[1].replace(/,/g, '')));
  const quantity = language === 'en' ? /(?:order\s+)?quantity\s*(?:is|:)?\s*(\d[\d,.]*)/gi : /(?:订单)?数量\s*(?:为|是|:|：)\s*(\d[\d,.]*)/gu;
  for (const match of value.matchAll(quantity)) add('quantity', Number(match[1].replace(/,/g, '')));
  const lead = language === 'en' ? /lead[ -]?time\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)/gi : /交期\s*(?:为|是|:|：)\s*(\d+(?:\.\d+)?)\s*(天|周|个月|月)/gu;
  for (const match of value.matchAll(lead)) add('lead_time', `${durationDays(match[1], match[2])}days`);
  const thickness = language === 'en' ? /thickness[^\d]{0,12}(\d+(?:\.\d+)?)\s*(microns?|um|μm|mm)/gi : /厚度[^\d]{0,8}(\d+(?:\.\d+)?)\s*(微米|毫米|mm)/giu;
  for (const match of value.matchAll(thickness)) {
    add('thickness', canonicalUnit(match[1], match[2]));
  }
  const weight = language === 'en' ? /(?:weight|sample\s+weight)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(kg|g)/gi : /重量[^\d]{0,8}(\d+(?:\.\d+)?)\s*(公斤|克|kg|g)/giu;
  for (const match of value.matchAll(weight)) add('weight', canonicalUnit(match[1], match[2]));
  const size = language === 'en' ? /size[^\d]{0,12}(\d+(?:\.\d+)?)\s*(cm|mm)/gi : /尺寸[^\d]{0,8}(\d+(?:\.\d+)?)\s*(厘米|毫米|cm|mm)/giu;
  for (const match of value.matchAll(size)) add('size_dimension', canonicalUnit(match[1], match[2]));
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)%/g)) add('percent', Number(match[1]));
  const date = isoDate(value); if (date) add('date', date);
  if (evidenceMode) {
    for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|公斤|克)\b/giu)) add('weight', canonicalUnit(match[1], match[2]));
  }
  for (const [role, items] of Object.entries(extractOntologyFacts(value, language))) for (const item of items) add(role, item);
  return Object.fromEntries(Object.entries(facts).map(([role, items]) => [role, [...items].sort()]));
}

function alignedFacts(bodyEn, bodyCn) {
  const asserted = value => splitSentences(value).filter(sentence => !isNonAssertionRequest(sentence)).join('\n');
  const en = bilingualFacts(asserted(bodyEn), 'en');
  const cn = bilingualFacts(asserted(bodyCn), 'cn');
  const roles = new Set([...Object.keys(en), ...Object.keys(cn)]);
  const conflicts = [...roles].filter(role => JSON.stringify(en[role] || []) !== JSON.stringify(cn[role] || []));
  return { aligned: conflicts.length === 0, conflicts };
}

function unsupportedProductFacts(bodyEn, bodyCn, evidence) {
  const asserted = value => splitSentences(value).filter(sentence => !isNonAssertionRequest(sentence)).join('\n');
  const bodyFacts = [bilingualFacts(asserted(bodyEn), 'en'), bilingualFacts(asserted(bodyCn), 'cn')];
  const evidenceText = [
    ...(Array.isArray(evidence.products) ? evidence.products : []),
    evidence.entryProduct || '',
    ...(Array.isArray(evidence.supportedClaims) ? evidence.supportedClaims : [])
  ].join('\n');
  const evidenceFacts = [bilingualFacts(evidenceText, 'en', true), bilingualFacts(evidenceText, 'cn', true)];
  for (const facts of bodyFacts) for (const [role, values] of Object.entries(facts)) {
    const supported = new Set(evidenceFacts.flatMap(item => item[role] || []));
    if (values.some(value => !supported.has(value))) return true;
  }
  return false;
}

function hasUnknownProductFact(bodyEn, bodyCn) {
  return [[bodyEn, 'en'], [bodyCn, 'cn']].some(([body, language]) => splitSentences(body).some(sentence => {
    if (isNonAssertionRequest(sentence)) return false;
    if (language === 'en'
      ? /\b(?:check|review|assess|evaluate)\b/i.test(sentence)
      : /(?:核对|检查|评估)/u.test(sentence)) return false;
    const property = language === 'en'
      ? /\b(?:material|finish|surface|closure|color|colour|transparen|opaque|zipper|velcro|valve|pouch)\b/i.test(sentence)
      : /(?:材料|表面|封口|颜色|透明|不透明|拉链|魔术贴|阀|袋型)/u.test(sentence);
    return property && Object.keys(extractOntologyFacts(sentence, language)).length === 0;
  }));
}

function questionIntents(text, language) {
  const questions = splitSentences(text).filter(part => /[?？]$/u.test(part)
    || (language === 'en'
      ? /\b(?:could you|can you|you may|please (?:send|share|provide))\b/i.test(part)
      : /(?:能否|可以|请)(?:向我们)?(?:提供|发送|分享)/u.test(part)));
  const intents = new Set();
  for (const question of questions) {
    for (const [name, en, cn] of QUESTION_INTENTS) if ((language === 'en' ? en : cn).test(question)) intents.add(name);
    if (isNonAssertionRequest(question)) {
      for (const [role, values] of Object.entries(extractOntologyFacts(question, language))) {
        for (const value of values) intents.add(`option:${role}:${value}`);
      }
    }
  }
  return { count: questions.length, intents: [...intents].sort() };
}

function conceptMatches(text, language) {
  return CONCEPTS.filter(([, en, cn]) => (language === 'en' ? en : cn).test(text)).map(([name]) => name);
}

function domainIdentity(value) {
  const parsed = parseDomain(String(value || '').toLowerCase().replace(/\.$/, ''), { allowPrivateDomains: true, validateHostname: true });
  const supported = parsed.isIcann || parsed.isPrivate || parsed.publicSuffix === 'test';
  return supported && !parsed.isIp && parsed.hostname && parsed.domain ? parsed.domain : null;
}

function validProvenance(recipient, evidence, nowMs) {
  try {
    const email = normalized(recipient.email);
    const source = new URL(String(recipient.sourceUrl || ''));
    const verifiedAt = Date.parse(String(recipient.verifiedAt || ''));
    if (recipient.kind !== 'public_company' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || source.protocol !== 'https:' || !Number.isFinite(verifiedAt)) return false;
    validateSnapshotRecipientProvenance({
      email,
      sourceUrl: source.toString(),
      verifiedAt: new Date(verifiedAt).toISOString(),
      organizationDomain: evidence.organization_domain || domainIdentity(source.hostname),
      organizationName: evidence.company,
      snapshot: evidence,
      now: new Date(nowMs).toISOString()
    });
    return true;
  } catch (_) { return false; }
}

function scoreDraft(input = {}) {
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const evidenceIds = Array.isArray(evidence.evidenceIds) ? [...evidence.evidenceIds] : [];
  const subject = normalized(input.subject);
  const bodyEn = normalized(input.bodyEn);
  const bodyCn = normalized(input.bodyCn);
  const products = Array.isArray(evidence.products) ? evidence.products.filter(Boolean) : [];
  const categories = Array.isArray(evidence.categories) ? evidence.categories.filter(Boolean) : [];
  const expectedSpecs = [...new Set(products.flatMap(numericSpecs))];
  const enConcepts = conceptMatches(bodyEn, 'en');
  const cnConcepts = conceptMatches(bodyCn, 'cn');
  const expectedConcepts = conceptMatches([...products, ...categories].join(' '), 'en');
  const sharedProductConcepts = expectedConcepts.filter(value => enConcepts.includes(value) && cnConcepts.includes(value));
  const specsMatch = expectedSpecs.length > 0 && expectedSpecs.every(value => numericSpecs(bodyEn).includes(value) && numericSpecs(bodyCn).includes(value));
  const productMatch = sharedProductConcepts.length > 0 && (expectedSpecs.length === 0 || specsMatch);
  const productPoints = productMatch ? MAXIMUMS.product_match : 0;
  const companyMatch = includesCompany(bodyEn, evidence.company)
    && /(?:贵司|您(?:司|们)?|公司)/u.test(bodyCn) && productMatch;
  const companyPoints = companyMatch ? MAXIMUMS.company_specific : 0;
  const expectedEntryConcepts = conceptMatches(evidence.entryProduct, 'en');
  const entryMatch = expectedEntryConcepts.length > 0
    && expectedEntryConcepts.every(value => enConcepts.includes(value) && cnConcepts.includes(value));
  const entryPoints = entryMatch ? MAXIMUMS.entry_value : 0;
  const enQuestions = questionIntents(input.bodyEn, 'en');
  const cnQuestions = questionIntents(input.bodyCn, 'cn');
  const questionMatch = enQuestions.count >= 1 && enQuestions.count <= 3 && cnQuestions.count >= 1 && cnQuestions.count <= 3
    && enQuestions.intents.length > 0 && JSON.stringify(enQuestions.intents) === JSON.stringify(cnQuestions.intents);
  const questionPoints = questionMatch ? MAXIMUMS.questions : 0;
  const subjectPoints = subject.length >= 12 && subject.length <= 120
    && includesCompany(subject, evidence.company)
    && (expectedSpecs.some(value => numericSpecs(subject).includes(value)) || categories.some(value => includesPhrase(subject, value)))
    ? MAXIMUMS.subject : 0;
  const bilingualMatch = productMatch && entryMatch && questionMatch
    && alignedFacts(input.bodyEn, input.bodyCn).aligned;
  const bilingualPoints = bilingualMatch ? MAXIMUMS.bilingual_consistency : 0;
  const readabilityPoints = bodyEn.length >= 80 && bodyEn.length <= 1200 && bodyCn.length >= 30 && bodyCn.length <= 800
    && String(input.bodyEn || '').split(/\r?\n/).filter(line => line.trim()).length >= 2
    && /\b(?:dear|hello|hi)\b/i.test(bodyEn) && /(?:您好|你好|尊敬)/u.test(bodyCn)
    ? MAXIMUMS.readability : 0;

  const recipient = input.recipient && typeof input.recipient === 'object' ? input.recipient : {};
  const nowMs = Date.parse(String(input.now || ''));
  const provenanceOk = Number.isFinite(nowMs) && validProvenance(recipient, evidence, nowMs);
  const provenancePoints = provenanceOk ? MAXIMUMS.recipient_provenance : 0;

  const components = {
    product_match: component(productPoints, MAXIMUMS.product_match, productMatch ? [expectedSpecs.length ? 'same_evidence_product_specs_in_both_languages' : 'same_evidence_product_categories_in_both_languages'] : ['product_evidence_not_bilingual'], productMatch ? evidenceIds : []),
    company_specific: component(companyPoints, MAXIMUMS.company_specific, companyMatch ? ['company_and_observed_range_specific'] : ['company_context_not_bilingual'], companyMatch ? evidenceIds : []),
    entry_value: component(entryPoints, MAXIMUMS.entry_value, entryMatch ? ['same_entry_value_concepts_in_both_languages'] : ['entry_value_not_bilingual'], entryMatch ? evidenceIds : []),
    questions: component(questionPoints, MAXIMUMS.questions, questionMatch
      ? [`matching_question_intents:${enQuestions.intents.join(',')}`]
      : [`question_intents_not_aligned:en=${enQuestions.intents.join(',')}:cn=${cnQuestions.intents.join(',')}`], []),
    subject: component(subjectPoints, MAXIMUMS.subject, subjectPoints ? ['company_and_evidence_product_in_subject'] : ['subject_not_evidence_specific'], subjectPoints ? evidenceIds : []),
    bilingual_consistency: component(bilingualPoints, MAXIMUMS.bilingual_consistency, bilingualMatch ? ['company_product_entry_and_question_facts_aligned'] : ['key_facts_not_aligned'], bilingualMatch ? evidenceIds : []),
    readability: component(readabilityPoints, MAXIMUMS.readability, readabilityPoints ? ['bounded_greeting_and_paragraph_structure'] : ['readability_boundary_failed'], []),
    recipient_provenance: component(provenancePoints, MAXIMUMS.recipient_provenance, provenanceOk ? ['fresh_public_company_domain_bound_source'] : ['recipient_provenance_invalid'], [])
  };
  const score = Object.values(components).reduce((sum, value) => sum + value.points, 0);
  const hardFailures = unsupportedClaims(input);
  const factAlignment = alignedFacts(input.bodyEn, input.bodyCn);
  if (!factAlignment.aligned) hardFailures.push('bilingual_key_fact_conflict');
  if (unsupportedProductFacts(input.bodyEn, input.bodyCn, evidence)) hardFailures.push('unsupported_product_fact');
  if (hasUnknownProductFact(input.bodyEn, input.bodyCn)) hardFailures.push('unknown_product_fact');
  if (!provenanceOk) hardFailures.push('invalid_recipient_provenance');
  hardFailures.push(...firstContactContentFailures(input.bodyEn, input.bodyCn));
  const uniqueHardFailures = [...new Set(hardFailures)];
  return { score, passed: score >= 80 && uniqueHardFailures.length === 0, components, hardFailures: uniqueHardFailures };
}

function normalizedEmail(value) {
  return normalized(value);
}

function normalizedDomain(value) {
  return normalized(value).replace(/^@/, '').replace(/^www\./, '').replace(/\.$/, '');
}

function contactDomain(value) {
  const match = normalizedEmail(value).match(/@([^\s,;>]+)/);
  return match ? normalizedDomain(match[1]) : '';
}

function companyKey(value) {
  return normalized(value)
    .replace(/\b(?:limited|ltd|incorporated|inc|corporation|corp|company|co)\b\.?/g, '')
    .replace(/(?:有限公司|股份公司|股份有限公司)$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function requiredRows(db, name) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (!exists) throw new Error(`required identity relation missing: ${name}`);
  return db.prepare(`SELECT * FROM ${name}`).all();
}

function jsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function evaluateInitialContact(db, input = {}) {
  const email = normalizedEmail(input.email);
  const emailDomain = contactDomain(email);
  const domain = normalizedDomain(input.domain || emailDomain);
  const companyName = normalized(input.companyName);
  const excludedCustomerIds = new Set((Array.isArray(input.excludeCustomerIds) ? input.excludeCustomerIds : [])
    .map(Number).filter(value => Number.isInteger(value) && value > 0));
  const nowMs = Date.parse(String(input.now || ''));
  if (!db || typeof db.prepare !== 'function' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !domain || !emailDomain || !companyName || !Number.isFinite(nowMs)) {
    return { allowed: false, route: 'blocked', reasons: ['invalid_identity_input'], matchedCustomerIds: [] };
  }

  try {
    const read = db.transaction(() => {
      const customers = requiredRows(db, 'customers');
      const inquiries = requiredRows(db, 'inquiries');
      const orders = requiredRows(db, 'orders');
      const messages = requiredRows(db, 'crm_messages');
      const events = requiredRows(db, 'matrix_stream_events');
      const jobs = requiredRows(db, 'matrix_stream_jobs');
      const versions = requiredRows(db, 'matrix_stream_versions');
      const aliases = Array.isArray(input.aliases) ? input.aliases.map(normalized).filter(Boolean) : [];

      const suppressed = events.some(event => {
        if (!/suppress|unsubscribe|refusal|blocked/i.test(String(event.action || ''))) return false;
        const payloads = [jsonObject(event.before_json), jsonObject(event.after_json)];
        return payloads.some(payload => normalizedEmail(payload.email) === email
          || normalizedDomain(payload.domain) === domain
          || contactDomain(payload.recipient_email) === domain);
      });
      if (suppressed) return { allowed: false, route: 'blocked', reasons: ['suppression_event'], matchedCustomerIds: [] };

      const exactInbound = messages.filter(message => normalized(message.direction) === 'inbound'
        && [message.sender_contact, message.receiver_contact].some(contact => normalizedEmail(contact) === email || contactDomain(contact) === domain));
      if (exactInbound.length) {
        const ids = [...new Set(exactInbound.map(message => message.customer_id)
          .filter(value => value !== null && value !== undefined && value !== '')
          .map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
        return { allowed: true, route: 'existing_relationship', reasons: ['exact_crm_reply'], matchedCustomerIds: ids };
      }

      const messageCustomerIds = new Set(messages.filter(message => {
        const contacts = [message.sender_contact, message.receiver_contact];
        return contacts.some(contact => normalizedEmail(contact) === email || contactDomain(contact) === domain);
      }).map(message => Number(message.customer_id)).filter(Number.isInteger));
      const exactCustomers = customers.filter(customer => {
        const contact = normalizedEmail(customer.contact);
        return !excludedCustomerIds.has(Number(customer.id)) && customer.active !== 0
          && (contact === email || contactDomain(contact) === domain || messageCustomerIds.has(Number(customer.id)));
      });
      const inquiryCustomerIds = new Set(inquiries.map(inquiry => Number(inquiry.customer_id)).filter(id => Number.isInteger(id) && !excludedCustomerIds.has(id)));
      const exactCompanyCustomers = customers.filter(customer => inquiryCustomerIds.has(Number(customer.id))
        && normalized(customer.name) === companyName);
      const exactOrder = orders.some(order => normalized(order.customer_name) === companyName);
      const exactMatches = [...new Set([...exactCustomers, ...exactCompanyCustomers].map(customer => Number(customer.id)))].sort((a, b) => a - b);
      if (exactMatches.length || exactOrder) {
        return { allowed: true, route: 'existing_relationship', reasons: ['exact_identity_match'], matchedCustomerIds: exactMatches };
      }

      const coolingStart = nowMs - 90 * 86400000;
      const recentDomainContact = messages.some(message => {
        const at = Date.parse(String(message.received_at || message.created_at || ''));
        return Number.isFinite(at) && at >= coolingStart && at <= nowMs
          && [message.sender_contact, message.receiver_contact].some(contact => contactDomain(contact) === domain);
      });
      const versionById = new Map(versions.map(version => [Number(version.id), version]));
      const recentAcceptedDomain = jobs.some(job => {
        if (job.state !== 'accepted') return false;
        const version = versionById.get(Number(job.version_id));
        const at = Date.parse(String(job.updated_at || job.created_at || ''));
        let versionDomain = '';
        try { versionDomain = normalizedDomain(JSON.parse(version?.source_snapshot_json || '{}').organization_domain); } catch (_) {}
        if (!versionDomain) versionDomain = contactDomain(version?.recipient_email);
        return version && versionDomain === domain
          && Number.isFinite(at) && at >= coolingStart && at <= nowMs;
      });
      if (recentDomainContact || recentAcceptedDomain) {
        return { allowed: false, route: 'blocked', reasons: ['domain_cooling_90_days'], matchedCustomerIds: [] };
      }

      const shanghaiDay = new Date(nowMs + 8 * 3600000).toISOString().slice(0, 10);
      const acceptedToday = jobs.filter(job => {
        if (job.state !== 'accepted') return false;
        const at = Date.parse(String(job.updated_at || job.created_at || ''));
        return Number.isFinite(at) && new Date(at + 8 * 3600000).toISOString().slice(0, 10) === shanghaiDay;
      }).length;
      if (acceptedToday >= 5) {
        return { allowed: false, route: 'blocked', reasons: ['daily_accepted_limit_5'], matchedCustomerIds: [] };
      }

      const candidateKeys = new Set([companyKey(companyName), ...aliases.map(companyKey)].filter(Boolean));
      const possible = customers.filter(customer => {
        const customerDomain = contactDomain(customer.contact);
        return !excludedCustomerIds.has(Number(customer.id)) && candidateKeys.has(companyKey(customer.name)) && customerDomain !== domain;
      }).map(customer => Number(customer.id)).filter(Number.isInteger).sort((a, b) => a - b);
      if (possible.length) {
        return { allowed: false, route: 'possible_duplicate_review', reasons: ['similar_name_different_domain'], matchedCustomerIds: possible };
      }
      return { allowed: true, route: 'initial_contact', reasons: [], matchedCustomerIds: [] };
    });
    return read();
  } catch (_) {
    return { allowed: false, route: 'blocked', reasons: ['identity_check_failed'], matchedCustomerIds: [] };
  }
}

module.exports = { MAXIMUMS, scoreDraft, evaluateInitialContact, extractBilingualFacts: bilingualFacts, unsupportedProductFacts };

'use strict';

const { parse: parseDomain } = require('tldts');
const { isNonAssertionRequest, splitSentences } = require('./matrixStreamText');

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

function compact(value) {
  return normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function includesPhrase(text, phrase) {
  const haystack = compact(text);
  const needle = compact(phrase);
  return Boolean(needle && haystack.includes(needle));
}

function component(points, maximum, reasons, evidenceIds) {
  return { points, maximum, reasons, evidence_ids: evidenceIds };
}

const CLAIM_SEMANTICS = Object.freeze({
  unsupported_price: /(?:[$€£¥]|\b(?:usd|eur|rmb|cny|gbp)\b|美元|元|price|cost|quote|amount|价格|报价|单价|售价|费用|金额|成本)/iu,
  unsupported_certification: /(?:\b(?:fda|iso|brcgs?|haccp|gmp|ce|rohs|reach|sedex)\b|certif|compliant|认证|资质|合规|许可证|审核)/iu,
  unsupported_supplier: /(?:supplier|vendor|manufacturer|\bsuppl(?:y|ies|ied)\b|供应商|制造商|供应)/iu,
  unsupported_performance: /(?:performance|barrier|shelf\s*life|quality|性能|阻隔|保质期|质量)/iu,
  unsupported_delivery: /(?:delivery|arrival|shipping|交付|到货|发货)/iu,
  unsupported_lead_time: /(?:lead[ -]?time|交期|生产周期)/iu
});
const ASSERTION = /(?:\b(?:is|are|has|have|guaranteed|fixed|proven|approved|certified|officially|official|authorized|exclusive|we\s+supply)\b|(?:为|是|有保证|保证|固定|已|通过|正式|官方|授权|独家|供应))/iu;

function unsupportedClaims(input) {
  const output = claimKeys([input.subject, input.bodyEn, input.bodyCn]);
  const supported = claimKeys(Array.isArray(input.evidence?.supportedClaims) ? input.evidence.supportedClaims : []);
  return [...new Set(output.filter(claim => !supported.includes(claim)).map(claim => claim.split(':', 1)[0]))];
}

function claimKeys(values) {
  const keys = [];
  for (const value of values) {
    for (const raw of splitSentences(value)) {
      if (isNonAssertionRequest(raw)) continue;
      const statement = normalizeTextNumbers(raw).replace(/[。.!?！？]+$/u, '').trim();
      for (const [type, semantic] of Object.entries(CLAIM_SEMANTICS)) {
        if (semantic.test(statement) && ASSERTION.test(statement)) keys.push(`${type}:${compact(statement)}`);
      }
    }
  }
  return [...new Set(keys)];
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
    .replace(/[零〇一二两三四五六七八九十百千万]+/gu, word => String(chineseNumber(word) ?? word));
}

const CONCEPTS = Object.freeze([
  ['coffee', /\bcoffee\b/i, /咖啡/u], ['tea', /\btea\b/i, /茶/u],
  ['pouch', /\bpouches?\b/i, /袋/u], ['valve', /\bvalve\b/i, /阀/u],
  ['barrier', /\bbarrier\b/i, /阻隔/u], ['printing', /\bprint(?:ing)?\b/i, /(?:印刷|套色)/u]
]);
const QUESTION_INTENTS = Object.freeze([
  ['structure', /\bstructure\b/i, /结构/u],
  ['volume', /(?:annual\s+volume|yearly\s+volume|volume|quantity)/i, /(?:年用量|年需求|数量|用量)/u],
  ['size', /\b(?:size|format)\b/i, /(?:尺寸|规格)/u],
  ['structure', /\bmaterial\b/i, /材料/u]
]);

function numericSpecs(text) {
  return [...normalizeTextNumbers(text).matchAll(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|克|公斤|mm|cm|毫米|厘米)\b/giu)]
    .map(match => compact(match[0]).replace('克', 'g').replace('公斤', 'kg'));
}

const CONTROLLED_FACTS = Object.freeze({
  color: [['red', /\bred\b/i, /红/u], ['blue', /\bblue\b/i, /蓝/u], ['black', /\bblack\b/i, /黑/u], ['white', /\bwhite\b/i, /白/u], ['green', /\bgreen\b/i, /绿/u]],
  material: [['pet', /\bpet\b/i, /聚酯|PET/iu], ['pe', /\bpe\b/i, /聚乙烯|PE/iu], ['kraft', /\bkraft\b/i, /牛皮纸/u], ['aluminum', /alumin(?:um|ium)\s*foil/i, /铝箔/u]],
  bag_type: [['valve_pouch', /valve\s+pouch/i, /带阀袋/u], ['stand_up_pouch', /stand[ -]?up\s+pouch/i, /自立袋/u], ['flat_bottom', /flat[ -]?bottom/i, /方底/u], ['spout_pouch', /spout\s+pouch/i, /吸嘴袋/u]]
});

function bilingualFacts(text, language) {
  const value = normalizeTextNumbers(text);
  const facts = {};
  const add = (role, item) => { if (item !== undefined) (facts[role] ||= new Set()).add(String(item).toLowerCase()); };
  const patterns = language === 'en' ? {
    annual_volume: /annual\s+(?:volume|quantity)[^\d]{0,16}(\d[\d,.]*)/gi,
    quantity: /(?:quantity|volume)[^\d]{0,16}(\d[\d,.]*)/gi,
    thickness: /thickness[^\d]{0,12}(\d+(?:\.\d+)?\s*(?:micron|um|μm|mm)?)/gi,
    lead_time: /lead[ -]?time[^\d]{0,16}(\d+(?:\.\d+)?\s*(?:day|week|month)s?)/gi,
    percent: /(\d+(?:\.\d+)?%)/g,
    date: /\b(\d{4}-\d{1,2}-\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2})\b/gi
  } : {
    annual_volume: /年(?:用量|需求|数量)[^\d]{0,8}(\d[\d,.]*)/gu,
    quantity: /(?:数量|用量)[^\d]{0,8}(\d[\d,.]*)/gu,
    thickness: /厚度[^\d]{0,8}(\d+(?:\.\d+)?\s*(?:微米|丝|毫米|mm)?)/giu,
    lead_time: /(?:交期|生产周期)[^\d]{0,8}(\d+(?:\.\d+)?\s*(?:天|周|个月|月))/gu,
    percent: /(\d+(?:\.\d+)?%)/g,
    date: /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})/gu
  };
  for (const [role, pattern] of Object.entries(patterns)) for (const match of value.matchAll(pattern)) add(role, compact(match[1]));
  for (const spec of numericSpecs(value)) add('size', spec);
  for (const [role, entries] of Object.entries(CONTROLLED_FACTS)) {
    for (const [name, en, cn] of entries) if ((language === 'en' ? en : cn).test(value)) add(role, name);
  }
  return Object.fromEntries(Object.entries(facts).map(([role, items]) => [role, [...items].sort()]));
}

function alignedFacts(bodyEn, bodyCn) {
  const en = bilingualFacts(bodyEn, 'en');
  const cn = bilingualFacts(bodyCn, 'cn');
  const roles = new Set([...Object.keys(en), ...Object.keys(cn)]);
  const conflicts = [...roles].filter(role => JSON.stringify(en[role] || []) !== JSON.stringify(cn[role] || []));
  return { aligned: conflicts.length === 0, conflicts };
}

function questionIntents(text, language) {
  const questions = normalized(text).split(/(?<=[?？])/u).filter(part => /[?？]/u.test(part));
  const intents = new Set();
  for (const question of questions) {
    for (const [name, en, cn] of QUESTION_INTENTS) if ((language === 'en' ? en : cn).test(question)) intents.add(name);
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

function validProvenance(recipient, nowMs) {
  try {
    const email = normalized(recipient.email);
    const emailDomain = email.split('@')[1];
    const source = new URL(String(recipient.sourceUrl || ''));
    const verifiedAt = Date.parse(String(recipient.verifiedAt || ''));
    const emailIdentity = domainIdentity(emailDomain);
    const sourceIdentity = domainIdentity(source.hostname);
    const bound = emailIdentity !== null && emailIdentity === sourceIdentity;
    return recipient.kind === 'public_company' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      && source.protocol === 'https:' && bound && Number.isFinite(verifiedAt) && verifiedAt <= nowMs
      && nowMs - verifiedAt <= 180 * 86400000;
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
  const productMatch = specsMatch && sharedProductConcepts.length > 0;
  const productPoints = productMatch ? MAXIMUMS.product_match : 0;
  const companyMatch = includesPhrase(bodyEn, evidence.company) && /(?:贵司|您(?:司|们)?|公司)/u.test(bodyCn) && productMatch;
  const companyPoints = companyMatch ? MAXIMUMS.company_specific : 0;
  const expectedEntryConcepts = conceptMatches(evidence.entryProduct, 'en');
  const entryMatch = expectedEntryConcepts.length > 0
    && expectedEntryConcepts.every(value => enConcepts.includes(value) && cnConcepts.includes(value));
  const entryPoints = entryMatch ? MAXIMUMS.entry_value : 0;
  const enQuestions = questionIntents(bodyEn, 'en');
  const cnQuestions = questionIntents(bodyCn, 'cn');
  const questionMatch = enQuestions.count >= 1 && enQuestions.count <= 3 && cnQuestions.count >= 1 && cnQuestions.count <= 3
    && enQuestions.intents.length > 0 && JSON.stringify(enQuestions.intents) === JSON.stringify(cnQuestions.intents);
  const questionPoints = questionMatch ? MAXIMUMS.questions : 0;
  const subjectPoints = subject.length >= 12 && subject.length <= 120
    && includesPhrase(subject, evidence.company)
    && (expectedSpecs.some(value => numericSpecs(subject).includes(value)) || categories.some(value => includesPhrase(subject, value)))
    ? MAXIMUMS.subject : 0;
  const bilingualMatch = productMatch && entryMatch && questionMatch
    && alignedFacts(bodyEn, bodyCn).aligned;
  const bilingualPoints = bilingualMatch ? MAXIMUMS.bilingual_consistency : 0;
  const readabilityPoints = bodyEn.length >= 80 && bodyEn.length <= 1200 && bodyCn.length >= 30 && bodyCn.length <= 800
    && String(input.bodyEn || '').split(/\r?\n/).filter(line => line.trim()).length >= 2
    && /\b(?:dear|hello|hi)\b/i.test(bodyEn) && /(?:您好|你好)/u.test(bodyCn)
    ? MAXIMUMS.readability : 0;

  const recipient = input.recipient && typeof input.recipient === 'object' ? input.recipient : {};
  const nowMs = Date.parse(String(input.now || ''));
  const provenanceOk = Number.isFinite(nowMs) && validProvenance(recipient, nowMs);
  const provenancePoints = provenanceOk ? MAXIMUMS.recipient_provenance : 0;

  const components = {
    product_match: component(productPoints, MAXIMUMS.product_match, productMatch ? ['same_evidence_product_specs_in_both_languages'] : ['product_specs_not_bilingual'], productMatch ? evidenceIds : []),
    company_specific: component(companyPoints, MAXIMUMS.company_specific, companyMatch ? ['company_and_observed_range_specific'] : ['company_context_not_bilingual'], companyMatch ? evidenceIds : []),
    entry_value: component(entryPoints, MAXIMUMS.entry_value, entryMatch ? ['same_entry_value_concepts_in_both_languages'] : ['entry_value_not_bilingual'], entryMatch ? evidenceIds : []),
    questions: component(questionPoints, MAXIMUMS.questions, questionMatch ? [`matching_question_intents:${enQuestions.intents.join(',')}`] : ['question_intents_not_aligned'], []),
    subject: component(subjectPoints, MAXIMUMS.subject, subjectPoints ? ['company_and_evidence_product_in_subject'] : ['subject_not_evidence_specific'], subjectPoints ? evidenceIds : []),
    bilingual_consistency: component(bilingualPoints, MAXIMUMS.bilingual_consistency, bilingualMatch ? ['company_product_entry_and_question_facts_aligned'] : ['key_facts_not_aligned'], bilingualMatch ? evidenceIds : []),
    readability: component(readabilityPoints, MAXIMUMS.readability, readabilityPoints ? ['bounded_greeting_and_paragraph_structure'] : ['readability_boundary_failed'], []),
    recipient_provenance: component(provenancePoints, MAXIMUMS.recipient_provenance, provenanceOk ? ['fresh_public_company_domain_bound_source'] : ['recipient_provenance_invalid'], [])
  };
  const score = Object.values(components).reduce((sum, value) => sum + value.points, 0);
  const hardFailures = unsupportedClaims(input);
  const factAlignment = alignedFacts(bodyEn, bodyCn);
  if (!factAlignment.aligned) hardFailures.push('bilingual_key_fact_conflict');
  if (!provenanceOk) hardFailures.push('invalid_recipient_provenance');
  return { score, passed: score >= 80 && hardFailures.length === 0, components, hardFailures };
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
  const nowMs = Date.parse(String(input.now || ''));
  if (!db || typeof db.prepare !== 'function' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !domain || domain !== emailDomain || !companyName || !Number.isFinite(nowMs)) {
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
        return customer.active !== 0 && (contact === email || contactDomain(contact) === domain || messageCustomerIds.has(Number(customer.id)));
      });
      const inquiryCustomerIds = new Set(inquiries.map(inquiry => Number(inquiry.customer_id)).filter(Number.isInteger));
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
        return version && contactDomain(version.recipient_email) === domain
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
        return candidateKeys.has(companyKey(customer.name)) && customerDomain !== domain;
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

module.exports = { MAXIMUMS, scoreDraft, evaluateInitialContact };

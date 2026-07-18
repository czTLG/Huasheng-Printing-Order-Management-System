'use strict';

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

const CLAIM_TYPES = Object.freeze({
  unsupported_price: /(?:[$€£¥]\s*\d|\b(?:usd|eur|rmb|cny|gbp)\s*\d|\d+(?:[.,]\d+)?\s*(?:usd|eur|rmb|cny|gbp|美元|元)\b|(?:price|cost|quote|amount|价格|报价|单价|售价|费用|金额|成本).{0,24}(?:\d|面议|待定))/iu,
  unsupported_certification: /(?:\b(?:fda|iso|brcgs?|haccp|gmp|ce|rohs|reach|sedex)\b|approved|certified|compliant|认证|资质|合规|许可证|审核通过)/iu,
  unsupported_supplier: /(?:(?:approved|authorized|exclusive|official)\s+(?:supplier|vendor|manufacturer)|(?:指定|授权|独家|官方)(?:供应商|制造商))/iu,
  unsupported_performance: /(?:(?:guaranteed|proven).{0,40}(?:performance|barrier|shelf\s*life|quality)|shelf\s*life\s+\d|(?:保证|确保|已验证).{0,24}(?:性能|阻隔|保质期|质量))/iu,
  unsupported_delivery: /(?:(?:guaranteed|fixed)\s+(?:delivery|arrival|shipping)|(?:delivery|arrival|shipping).{0,24}(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(?:保证|固定).{0,16}(?:交付|到货|发货))/iu,
  unsupported_lead_time: /(?:lead[ -]?time.{0,24}(?:\d|guaranteed|fixed)|(?:guaranteed|fixed)\s+lead[ -]?time|(?:交期|生产周期).{0,16}\d|(?:保证|固定).{0,12}(?:交期|生产周期))/iu
});

function unsupportedClaims(input) {
  const output = claimKeys([input.subject, input.bodyEn, input.bodyCn]);
  const supported = claimKeys(Array.isArray(input.evidence?.supportedClaims) ? input.evidence.supportedClaims : []);
  return [...new Set(output.filter(claim => !supported.includes(claim)).map(claim => claim.split(':', 1)[0]))];
}

function claimKeys(values) {
  const keys = [];
  for (const value of values) {
    for (const statement of normalized(value).split(/(?:[!?。！？\n]+|\.(?=\s|$))/u).map(part => part.trim()).filter(Boolean)) {
      for (const [type, pattern] of Object.entries(CLAIM_TYPES)) {
        if (pattern.test(statement)) keys.push(`${type}:${compact(statement)}`);
      }
    }
  }
  return [...new Set(keys)];
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
  return [...normalized(text).matchAll(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|克|公斤|mm|cm|毫米|厘米)\b/giu)]
    .map(match => compact(match[0]).replace('克', 'g').replace('公斤', 'kg'));
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

function validProvenance(recipient, nowMs) {
  try {
    const email = normalized(recipient.email);
    const emailDomain = email.split('@')[1];
    const source = new URL(String(recipient.sourceUrl || ''));
    const verifiedAt = Date.parse(String(recipient.verifiedAt || ''));
    const bound = source.hostname === emailDomain || source.hostname.endsWith(`.${emailDomain}`) || emailDomain.endsWith(`.${source.hostname}`);
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
    && JSON.stringify([...new Set(numericSpecs(bodyEn))].sort()) === JSON.stringify([...new Set(numericSpecs(bodyCn))].sort());
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
        const ids = [...new Set(exactInbound.map(message => Number(message.customer_id)).filter(Number.isInteger))].sort((a, b) => a - b);
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

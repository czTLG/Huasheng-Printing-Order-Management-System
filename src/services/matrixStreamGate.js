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

const HARD_FAILURE_PATTERNS = Object.freeze({
  unsupported_price: [
    /\b(?:usd|eur|rmb|cny|gbp)\s*\d+(?:[.,]\d+)?/i,
    /\b(?:price|cost|quote|amount)\s+(?:is|of|at)\b/i,
    /(?:价格|报价|单价|售价|费用|金额|成本).{0,12}\d/u
  ],
  unsupported_certification: [
    /\b(?:fda|iso|brcgs?|haccp|gmp|ce|rohs|reach|sedex)\b.{0,24}\b(?:approved|certified|compliant|qualification)/i,
    /\b(?:approved|certified|compliant)\b/i,
    /(?:认证|资质|合规|许可证|审核通过)/u
  ],
  unsupported_supplier: [
    /\b(?:approved|authorized|exclusive|official)\s+(?:supplier|vendor|manufacturer)\b/i,
    /(?:指定|授权|独家|官方)(?:供应商|制造商)/u
  ],
  unsupported_performance: [
    /\b(?:guaranteed|proven)\s+(?:performance|barrier|shelf\s*life|quality)/i,
    /(?:保证|确保|已验证).{0,16}(?:性能|阻隔|保质期|质量)/u
  ],
  unsupported_delivery: [
    /\b(?:guaranteed|fixed)\s+(?:delivery|arrival|shipping)\b/i,
    /(?:保证|固定).{0,12}(?:交付|到货|发货)/u
  ],
  unsupported_lead_time: [
    /\b(?:guaranteed|fixed)\s+lead[ -]?time\b/i,
    /\blead[ -]?time\s+(?:is|of)\s+\d/i,
    /(?:保证|固定).{0,12}(?:交期|生产周期)/u
  ]
});

function unsupportedClaims(input) {
  const text = [input.subject, input.bodyEn, input.bodyCn].map(normalized).join('\n');
  const supported = Array.isArray(input.evidence?.supportedClaims)
    ? input.evidence.supportedClaims.map(normalized).filter(Boolean)
    : [];
  return Object.entries(HARD_FAILURE_PATTERNS).filter(([, patterns]) => {
    const keys = claimKeys(text, patterns);
    if (!keys.size) return false;
    const supportedKeys = claimKeys(supported.join('\n'), patterns);
    return [...keys].some(key => !supportedKeys.has(key));
  }).map(([failure]) => failure);
}

function claimKeys(text, patterns) {
  const keys = new Set();
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of String(text || '').matchAll(new RegExp(pattern.source, flags))) {
      const key = compact(match[0]);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function scoreDraft(input = {}) {
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const evidenceIds = Array.isArray(evidence.evidenceIds) ? [...evidence.evidenceIds] : [];
  const subject = normalized(input.subject);
  const bodyEn = normalized(input.bodyEn);
  const bodyCn = normalized(input.bodyCn);
  const allText = `${subject}\n${bodyEn}\n${bodyCn}`;
  const products = Array.isArray(evidence.products) ? evidence.products.filter(Boolean) : [];
  const categories = Array.isArray(evidence.categories) ? evidence.categories.filter(Boolean) : [];

  const productSignals = [...products, ...categories].filter(value => includesPhrase(allText, value));
  const productPoints = productSignals.length ? MAXIMUMS.product_match : 0;
  const companyPoints = includesPhrase(allText, evidence.company) ? MAXIMUMS.company_specific : 0;
  const entryPoints = includesPhrase(allText, evidence.entryProduct)
    || (normalized(evidence.entryProduct).includes('pouch') && /\bpouches?\b/i.test(allText))
    ? MAXIMUMS.entry_value : 0;
  const questionPoints = /[?？]/u.test(bodyEn) && /[?？]/u.test(bodyCn) ? MAXIMUMS.questions : 0;
  const subjectPoints = subject.length >= 12 && subject.length <= 120
    && (includesPhrase(subject, evidence.company) || productSignals.some(value => includesPhrase(subject, value)))
    ? MAXIMUMS.subject : 0;
  const bilingualPoints = bodyEn.length >= 40 && bodyCn.length >= 20 ? MAXIMUMS.bilingual_consistency : 0;
  const readabilityPoints = bodyEn.length <= 1200 && bodyCn.length <= 800
    && /\b(?:dear|hello|hi)\b/i.test(bodyEn) && /(?:您好|你好)/u.test(bodyCn)
    ? MAXIMUMS.readability : 0;

  const recipient = input.recipient && typeof input.recipient === 'object' ? input.recipient : {};
  let provenancePoints = 0;
  try {
    const source = new URL(String(recipient.sourceUrl || ''));
    const verifiedAt = Date.parse(String(recipient.verifiedAt || ''));
    const now = Date.parse(String(input.now || ''));
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized(recipient.email))
        && source.protocol === 'https:' && Number.isFinite(verifiedAt) && Number.isFinite(now)
        && verifiedAt <= now) provenancePoints = MAXIMUMS.recipient_provenance;
  } catch (_) {}

  const components = {
    product_match: component(productPoints, MAXIMUMS.product_match, productPoints ? ['evidence_product_match'] : ['no_evidence_product_match'], evidenceIds),
    company_specific: component(companyPoints, MAXIMUMS.company_specific, companyPoints ? ['company_named'] : ['company_not_named'], evidenceIds),
    entry_value: component(entryPoints, MAXIMUMS.entry_value, entryPoints ? ['entry_product_named'] : ['entry_product_missing'], evidenceIds),
    questions: component(questionPoints, MAXIMUMS.questions, questionPoints ? ['bilingual_question_present'] : ['bilingual_question_missing'], evidenceIds),
    subject: component(subjectPoints, MAXIMUMS.subject, subjectPoints ? ['specific_subject'] : ['subject_not_specific'], evidenceIds),
    bilingual_consistency: component(bilingualPoints, MAXIMUMS.bilingual_consistency, bilingualPoints ? ['both_languages_substantive'] : ['bilingual_content_incomplete'], evidenceIds),
    readability: component(readabilityPoints, MAXIMUMS.readability, readabilityPoints ? ['bounded_readable_copy'] : ['readability_boundary_failed'], evidenceIds),
    recipient_provenance: component(provenancePoints, MAXIMUMS.recipient_provenance, provenancePoints ? ['current_https_public_source'] : ['recipient_provenance_invalid'], evidenceIds)
  };
  const score = Object.values(components).reduce((sum, value) => sum + value.points, 0);
  const hardFailures = unsupportedClaims(input);
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

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function rowsIfPresent(db, name) {
  return tableExists(db, name) ? db.prepare(`SELECT * FROM ${name}`).all() : [];
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
      const customers = rowsIfPresent(db, 'customers');
      const inquiries = rowsIfPresent(db, 'inquiries');
      const orders = rowsIfPresent(db, 'orders');
      const messages = rowsIfPresent(db, 'crm_messages');
      const events = rowsIfPresent(db, 'matrix_stream_events');
      const jobs = rowsIfPresent(db, 'matrix_stream_jobs');
      const aliases = Array.isArray(input.aliases) ? input.aliases.map(normalized).filter(Boolean) : [];

      const suppressed = events.some(event => {
        if (!/suppress|unsubscribe|refusal|blocked/i.test(String(event.action || ''))) return false;
        const payloads = [jsonObject(event.before_json), jsonObject(event.after_json)];
        return payloads.some(payload => normalizedEmail(payload.email) === email
          || normalizedDomain(payload.domain) === domain
          || contactDomain(payload.recipient_email) === domain);
      });
      if (suppressed) return { allowed: false, route: 'blocked', reasons: ['suppression_event'], matchedCustomerIds: [] };

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
      if (recentDomainContact) {
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

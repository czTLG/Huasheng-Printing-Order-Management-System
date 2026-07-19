'use strict';

const { buildThreadContext } = require('./matrixThreadContext');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function tokensFor(value) {
  const query = text(value).toLowerCase();
  if (query.length < 2 || query.length > 160) throw new Error('context query must contain at least 2 and at most 160 characters');
  const tokens = [...new Set(query.split(/[\s,，;；|/]+/u).map(item => item.trim()).filter(item => item.length >= 2))];
  return { query, tokens: tokens.length ? tokens : [query] };
}

function contextForCustomer(db, customer) {
  const latest = db.prepare(`
    SELECT id FROM email_messages
    WHERE matched_customer_id = ? AND direction IN ('inbound', 'outbound')
    ORDER BY datetime(COALESCE(received_at, sent_at, created_at)) DESC, id DESC
    LIMIT 1
  `).get(customer.id);
  if (latest) return buildThreadContext(db, Number(latest.id));
  return {
    target_email_message_id: null,
    thread_key: '',
    contact: { name: text(customer.contact_person), email: text(customer.email), domain: '' },
    customer,
    inquiry: null,
    specifications: [],
    research: null,
    messages: [],
    attachments: [],
    existing_tasks: []
  };
}

function contextByRecordId(db, value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error('context record id must be a positive integer');
  const customer = db.prepare(`
    SELECT id, company_name, name, contact_person, email, country, website,
           priority, stage, next_action, created_at, updated_at
    FROM customers
    WHERE id = ? AND active = 1
  `).get(id);
  return { matches: customer ? [contextForCustomer(db, customer)] : [] };
}

function resolveMatrixContext(db, value, { limit = 3 } = {}) {
  const source = text(value);
  if (source.length < 2 || source.length > 2000) throw new Error('conversation context must contain 2 to 2000 characters');
  const normalized = source.toLowerCase();
  const countryAliases = [
    { patterns: ['新加坡', 'singapore'], value: 'singapore' },
    { patterns: ['阿联酋', '迪拜', 'united arab emirates', 'uae', 'dubai'], value: 'united arab emirates' },
    { patterns: ['突尼斯', 'tunisia'], value: 'tunisia' },
    { patterns: ['越南', 'vietnam'], value: 'vietnam' },
    { patterns: ['马来西亚', 'malaysia'], value: 'malaysia' },
    { patterns: ['印度尼西亚', '印尼', 'indonesia'], value: 'indonesia' },
    { patterns: ['菲律宾', 'philippines'], value: 'philippines' },
    { patterns: ['泰国', 'thailand'], value: 'thailand' }
  ];
  const mentionedCountries = countryAliases.filter(item => item.patterns.some(pattern => normalized.includes(pattern))).map(item => item.value);
  const aliasStopwords = new Set(['international', 'company', 'customer', 'limited', 'ltd', 'pte', 'group', 'image', 'images', 'photo', 'photos', 'show', 'display']);
  const sourceAliasTokens = [...new Set(normalized.match(/[a-z0-9][a-z0-9._-]{2,}/g) || [])]
    .filter(token => !aliasStopwords.has(token));
  const rows = db.prepare(`
    SELECT id, company_name, name, contact_person, email, country, website,
           priority, stage, next_action, created_at, updated_at
    FROM customers
    WHERE active = 1
    ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
    LIMIT 10000
  `).all();
  const ranked = rows.map(customer => {
    const identities = [customer.company_name, customer.name, customer.contact_person, customer.email]
      .map(item => text(item).toLowerCase()).filter(item => item.length >= 3);
    let score = identities.reduce((sum, identity) => sum + (normalized.includes(identity) ? 100 : 0), 0);
    const aliasMatches = sourceAliasTokens.filter(token => identities.some(identity => identity.includes(token)));
    score += aliasMatches.length * 60;
    const country = text(customer.country).toLowerCase();
    if (mentionedCountries.some(item => country.includes(item) || item.includes(country))) score += 30;
    return { customer, score };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  const maximum = Math.max(1, Math.min(5, Number(limit) || 3));
  return { query: source, matches: ranked.slice(0, maximum).map(item => contextForCustomer(db, item.customer)) };
}

function searchMatrixContext(db, value, { limit = 5 } = {}) {
  const { query, tokens } = tokensFor(value);
  const maximum = Math.max(1, Math.min(10, Number(limit) || 5));
  const patterns = tokens.map(token => `%${token.replace(/[\\%_]/g, match => `\\${match}`)}%`);
  const customerClauses = patterns.map(() => `(
    LOWER(COALESCE(c.company_name, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(c.name, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(c.contact_person, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(c.email, '')) LIKE ? ESCAPE '\\'
  )`);
  const customerParams = patterns.flatMap(pattern => [pattern, pattern, pattern, pattern]);
  const customerRows = db.prepare(`
    SELECT c.id, c.company_name, c.name, c.contact_person, c.email, c.country,
           c.website, c.priority, c.stage, c.next_action
    FROM customers c
    WHERE ${customerClauses.join(' OR ')}
    ORDER BY datetime(COALESCE(c.updated_at, c.created_at)) DESC, c.id DESC
    LIMIT 30
  `).all(...customerParams);

  const messageClauses = patterns.map(() => `(
    LOWER(COALESCE(em.from_name, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(em.from_email, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(em.contact_email, '')) LIKE ? ESCAPE '\\'
    OR LOWER(COALESCE(em.subject, '')) LIKE ? ESCAPE '\\'
  )`);
  const messageParams = patterns.flatMap(pattern => [pattern, pattern, pattern, pattern]);
  const messageRows = db.prepare(`
    SELECT em.id, em.matched_customer_id, em.from_name, em.from_email,
           em.contact_email, em.subject
    FROM email_messages em
    WHERE em.direction IN ('inbound', 'outbound')
      AND (${messageClauses.join(' OR ')})
    ORDER BY datetime(COALESCE(em.received_at, em.sent_at, em.created_at)) DESC, em.id DESC
    LIMIT 30
  `).all(...messageParams);

  const candidates = new Map();
  for (const customer of customerRows) {
    const searchable = [customer.company_name, customer.name, customer.contact_person, customer.email, customer.country]
      .map(item => text(item).toLowerCase()).join(' ');
    const score = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 10 : 0), searchable.includes(query) ? 50 : 0);
    candidates.set(`customer:${customer.id}`, { customer, score, targetEmailId: null });
  }
  for (const row of messageRows) {
    const searchable = [row.from_name, row.from_email, row.contact_email, row.subject]
      .map(item => text(item).toLowerCase()).join(' ');
    const messageScore = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 10 : 0), searchable.includes(query) ? 50 : 0);
    const key = row.matched_customer_id ? `customer:${row.matched_customer_id}` : `email:${row.id}`;
    const current = candidates.get(key);
    if (current) {
      if (!current.targetEmailId) current.targetEmailId = Number(row.id);
      current.score += messageScore;
    } else {
      const customer = row.matched_customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(row.matched_customer_id)
        : null;
      candidates.set(key, { customer, score: messageScore, targetEmailId: Number(row.id) });
    }
  }

  const ranked = [...candidates.values()].sort((left, right) => right.score - left.score);
  const minimumScore = Math.max(10, Number(ranked[0]?.score || 0) * 0.35);
  const matches = [];
  const seen = new Set();
  for (const item of ranked) {
    if (item.score < minimumScore) continue;
    let targetEmailId = item.targetEmailId;
    if (!targetEmailId && item.customer?.id) {
      const latest = db.prepare(`
        SELECT id FROM email_messages
        WHERE matched_customer_id = ? AND direction IN ('inbound', 'outbound')
        ORDER BY datetime(COALESCE(received_at, sent_at, created_at)) DESC, id DESC
        LIMIT 1
      `).get(item.customer.id);
      targetEmailId = latest ? Number(latest.id) : null;
    }
    if (targetEmailId) {
      const context = buildThreadContext(db, targetEmailId);
      const key = `${context.customer?.id || context.contact?.email || ''}::${context.thread_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(context);
    } else if (item.customer) {
      const key = `customer:${item.customer.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(contextForCustomer(db, item.customer));
    }
    if (matches.length >= maximum) break;
  }
  return { query: text(value), matches };
}

module.exports = { searchMatrixContext, resolveMatrixContext, contextByRecordId };

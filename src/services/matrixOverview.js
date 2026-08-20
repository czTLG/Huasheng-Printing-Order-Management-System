'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value) {
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch (_) { return {}; }
}

function threadKey(row) {
  return `${text(row.contact_email).toLowerCase()}::${text(row.normalized_subject).toLowerCase()}`;
}

const TLD_COUNTRIES = Object.freeze({
  sg: 'Singapore', ae: 'United Arab Emirates', tn: 'Tunisia', il: 'Israel',
  uk: 'United Kingdom', gb: 'United Kingdom', us: 'United States', ca: 'Canada',
  au: 'Australia', bd: 'Bangladesh', pk: 'Pakistan', nz: 'New Zealand'
});

function inferCountry(rows, customer, research) {
  if (text(customer?.country)) return { country: text(customer.country), basis: 'customer_profile' };
  if (text(research?.country)) return { country: text(research.country), basis: 'research_note' };
  const source = rows.map(row => `${text(row.subject)}\n${text(row.cleaned_text)}`).join('\n');
  const named = [
    [/\bsingapore\b/i, 'Singapore'], [/\btunisia\b/i, 'Tunisia'], [/\bisrael\b/i, 'Israel'],
    [/\bunited arab emirates\b|\buae\b/i, 'United Arab Emirates'], [/\bunited kingdom\b|\buk\b/i, 'United Kingdom'],
    [/\bbangladesh\b/i, 'Bangladesh'], [/\bpakistan\b/i, 'Pakistan']
  ].find(([pattern]) => pattern.test(source));
  if (named) return { country: named[1], basis: 'message_signature' };
  const domain = text(rows.at(-1)?.email_domain || text(rows.at(-1)?.contact_email).split('@')[1]).toLowerCase();
  const tld = domain.split('.').at(-1);
  if (TLD_COUNTRIES[tld]) return { country: TLD_COUNTRIES[tld], basis: 'email_domain' };
  return { country: '待核实', basis: 'unverified' };
}

function buildMatrixOverview(db, { backlogItems = [] } = {}) {
  const rows = db.prepare(`
    SELECT em.*, j.message_class, j.workflow_state, j.analysis_json
    FROM email_messages em
    LEFT JOIN matrix_inbox_jobs j ON j.email_message_id = em.id
    WHERE datetime(COALESCE(em.received_at, em.created_at)) >= datetime('2026-06-30T16:00:00.000Z')
      AND em.direction IN ('inbound', 'outbound')
    ORDER BY datetime(COALESCE(em.received_at, em.created_at)) ASC, em.id ASC
  `).all();
  const groups = new Map();
  for (const row of rows) {
    const key = threadKey(row);
    if (!text(row.contact_email) || !text(row.normalized_subject)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const threads = [];
  for (const [key, messages] of groups) {
    const review = db.prepare(`
      SELECT * FROM matrix_thread_reviews WHERE thread_key = ?
      ORDER BY quality_rank DESC, id DESC LIMIT 1
    `).get(key) || null;
    const latest = messages.at(-1);
    const inbound = messages.filter(row => row.direction === 'inbound');
    const outbound = messages.filter(row => row.direction === 'outbound');
    const latestInbound = inbound.at(-1) || null;
    const latestOutbound = outbound.at(-1) || null;
    const customerId = Number(latest.matched_customer_id || latestInbound?.matched_customer_id || latestOutbound?.matched_customer_id || 0) || null;
    const inquiryId = Number(latest.matched_inquiry_id || latestInbound?.matched_inquiry_id || latestOutbound?.matched_inquiry_id || 0) || null;
    const customer = customerId ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) : null;
    const inquiry = inquiryId ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId) : null;
    const research = customerId ? db.prepare(`
      SELECT * FROM customer_research_notes WHERE customer_id = ? AND status = 'active'
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(customerId) : null;
    const inboundAnalyses = inbound.map(row => parseJson(row.analysis_json));
    const analysis = inboundAnalyses.at(-1) || {};
    const subjectCorpus = messages.map(row => text(row.subject)).join('\n');
    if (/Huasheng Packaging Weekly Website Report|Packaging System database backup|SMTP sender verification|^生产开单通知/im.test(subjectCorpus)) continue;
    let messageClass = text(latestInbound?.message_class || analysis.message_class || 'customer_reply');
    if (/Preliminary topic inquiry/i.test(subjectCorpus)) messageClass = 'stream_response';
    const outboundMessageIds = new Set(outbound.map(row => text(row.message_id)).filter(Boolean));
    const hasQuotedOutbound = inbound.some(row => {
      const refs = `${text(row.in_reply_to)} ${text(row.references_header)}`;
      return /\.sales@gdhspack\.com>/i.test(refs) || [...outboundMessageIds].some(id => refs.includes(id));
    });
    const outboundEvidence = outbound.length > 0 || hasQuotedOutbound;
    const costing = db.prepare(`
      SELECT id, status, updated_at FROM foreign_costing_drafts
      WHERE (? IS NOT NULL AND customer_id = ?) OR (? IS NOT NULL AND crm_inquiry_id = ?)
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(customerId, customerId, inquiryId, inquiryId);
    const costingRequest = inquiryId ? db.prepare(`
      SELECT id, status, updated_at FROM costing_requests
      WHERE inquiry_id = ? AND status IN ('pending', 'in_progress', 'pending_review')
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(inquiryId) : null;
    const quoteRequired = Number(inquiry?.costing_required || 0) === 1
      || ['quote_pending', 'costing', 'pending_quote'].includes(text(inquiry?.status))
      || inbound.some((row, index) => row.message_class === 'quote_request'
        || inboundAnalyses[index]?.quote_required === true
        || row.workflow_state === 'quote_required');
    const translationStates = inbound.map((row, index) => text(inboundAnalyses[index]?.translation_state || (row.analysis_state === 'translation_failed' ? 'failed' : 'pending_ai')));
    const translationState = !inbound.length ? 'not_required'
      : translationStates.every(value => value === 'complete') ? 'complete'
        : translationStates.some(value => value === 'failed') ? 'failed' : 'pending_ai';
    let state;
    if (messageClass === 'advertising') state = 'filtered_advertising';
    else if (messageClass === 'stream_response') state = latest.direction === 'outbound' || !inbound.length ? 'outreach_waiting' : 'awaiting_our_reply';
    else if (['system_notice', 'delivery_notice', 'supplier_service'].includes(messageClass)) state = 'archive_review';
    else if (latest.direction === 'outbound') state = 'waiting_customer';
    else if (quoteRequired && ((costing && ['blocked', 'internal_estimate', 'internal_pre_quote', 'draft', 'pending_review'].includes(text(costing.status))) || costingRequest)) state = 'quote_in_progress';
    else if (quoteRequired) state = 'quote_required';
    else if (!outboundEvidence) state = 'first_contact_unanswered';
    else state = 'awaiting_our_reply';
    const country = inferCountry(messages, customer, research);
    const websiteMatch = messages.map(row => text(row.cleaned_text)).join('\n').match(/https?:\/\/(?:www\.)?([^\s/>]+)/i);
    const backgroundState = research ? 'researched' : customer && (text(customer.website) || text(customer.business_background))
      ? 'profile_available' : websiteMatch ? 'official_source_identified' : 'research_required';
    threads.push({
      source: 'email_thread', thread_key: key, contact_email: text(latest.contact_email),
      priority: text(inquiry?.priority || customer?.priority || 'C'),
      customer_id: customerId, inquiry_id: inquiryId,
      customer_name: text(customer?.company_name || customer?.name || latestInbound?.contact_name || latestInbound?.from_name || latest.contact_name || '待关联客户'),
      country: country.country, country_basis: country.basis,
      background_state: backgroundState, website_hint: websiteMatch ? `https://${websiteMatch[1]}` : text(customer?.website),
      state, message_class: messageClass, message_count: messages.length,
      inbound_count: inbound.length, outbound_count: outbound.length,
      first_inbound_at: text(inbound[0]?.received_at), last_inbound_at: text(latestInbound?.received_at),
      last_outbound_at: text(latestOutbound?.received_at), latest_direction: latest.direction,
      subject: text(latest.subject), summary_cn: text(review?.summary_cn || analysis.thread_summary_cn || analysis.summary_cn),
      translation_state: translationState,
      responsible_party: text(review?.responsible_party), review_source: text(review?.analysis_source),
      next_action_cn: review ? text(review.next_action_cn) : state === 'waiting_customer' ? '我方已回复，等待客户反馈；不要重复催促。'
        : state === 'quote_in_progress' ? text(analysis.suggested_next_action_cn) || '继续现有核价，不新建重复报价。'
          : state === 'quote_required' ? text(analysis.suggested_next_action_cn) || '先合并规格、附件与历史回复，再建立唯一报价任务。'
            : state === 'first_contact_unanswered' ? '完成客户背景核验和中文分析后准备首次回复。'
              : state === 'awaiting_our_reply' ? text(analysis.suggested_next_action_cn) || '客户在我方回复后又有更新，需要处理最新问题。'
                : '核验后归档。',
      quote_state: costing ? text(costing.status) : costingRequest ? text(costingRequest.status) : quoteRequired ? 'required' : 'not_required',
      research_summary: text(review?.background_summary_cn || research?.research_summary || customer?.business_background)
    });
  }

  const outboundOnlyOutreach = threads.filter(row => row.state === 'outreach_waiting' && row.inbound_count === 0);
  const visibleThreads = threads.filter(row => row.state !== 'filtered_advertising'
    && !(row.state === 'outreach_waiting' && row.inbound_count === 0)
    && !(row.inbound_count === 0 && !row.customer_id && !row.inquiry_id));
  const counts = {};
  for (const row of visibleThreads) counts[row.state] = Number(counts[row.state] || 0) + 1;
  const backlog = backlogItems.map((item, index) => ({
    source: 'supervisor_backlog', priority: text(item.priority || 'P1'),
    stable_key: text(item.inquiry_key || `backlog-${index + 1}`), customer_name: text(item.company),
    state: text(item.state), summary_cn: text(item.summary_cn || item.summary),
    next_actions: Array.isArray(item.next_actions_cn) ? item.next_actions_cn : Array.isArray(item.next_actions) ? item.next_actions : []
  }));
  const statePriority = { quote_in_progress: 90, quote_required: 80, awaiting_our_reply: 70, first_contact_unanswered: 60, waiting_customer: 20, outreach_waiting: 15, archive_review: 10 };
  const priorityWeight = { A: 3, B: 2, C: 1 };
  visibleThreads.sort((a, b) => (statePriority[b.state] || 0) - (statePriority[a.state] || 0)
    || (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0)
    || text(b.last_inbound_at).localeCompare(text(a.last_inbound_at)));
  return { counts, threads: visibleThreads, items: [...backlog, ...visibleThreads], outbound_only_outreach_count: outboundOnlyOutreach.length, generated_at: new Date().toISOString() };
}

module.exports = { threadKey, inferCountry, buildMatrixOverview };

const { normalizeCrmAttachments } = require('./crmAttachments');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseJsonObject(value, fallback = {}) {
  if (!text(value)) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function parseJsonArray(value, fallback = []) {
  const parsed = parseJsonObject(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function countOne(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(row?.total || 0) || 0;
}

function customerDisplaySelect(prefix = 'c') {
  return `COALESCE(NULLIF(${prefix}.company_name, ''), NULLIF(${prefix}.name, ''), NULLIF(${prefix}.contact_person, ''), '未匹配客户')`;
}

function priorityWeight(priority) {
  if (priority === 'A') return 300;
  if (priority === 'B') return 200;
  if (priority === 'C') return 100;
  return 0;
}

function typeWeight(type) {
  const weights = {
    father_done_pending_sales: 80,
    message_pending_ai: 70,
    father_task_pending: 60,
    costing_draft_pending_review: 50,
    message_parsed_pending_inquiry: 40,
    quoted_waiting_customer: 30,
    a_customer_updated: 20
  };
  return weights[type] || 0;
}

function normalizeItem(row, type, extra = {}) {
  return {
    type,
    customer_id: row.customer_id ? Number(row.customer_id) : null,
    inquiry_id: row.inquiry_id ? Number(row.inquiry_id) : null,
    message_id: row.message_id ? Number(row.message_id) : null,
    father_task_id: row.father_task_id ? Number(row.father_task_id) : null,
    costing_draft_id: row.costing_draft_id ? Number(row.costing_draft_id) : null,
    source_type: row.source_type || '',
    title: row.title || row.customer_display_name || row.inquiry_title || '',
    summary: row.summary || '',
    customer_display_name: row.customer_display_name || '',
    country: row.country || '',
    inquiry_title: row.inquiry_title || '',
    current_stage: row.current_stage || '',
    priority_level: row.priority_level || row.customer_priority || row.inquiry_priority || 'C',
    next_action: row.next_action || '',
    owner: row.owner || '业务员',
    updated_at: row.updated_at || row.received_at || row.created_at || '',
    ...extra
  };
}

function sortItems(items) {
  return items.sort((a, b) => {
    const scoreA = priorityWeight(a.priority_level) + typeWeight(a.type);
    const scoreB = priorityWeight(b.priority_level) + typeWeight(b.type);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

function buildCrmWorkbench(db) {
  const counts = {
    messages_pending_ai: countOne(db, "SELECT COUNT(*) AS total FROM crm_messages WHERE ai_status = 'pending'"),
    messages_parsed_pending_inquiry: countOne(db, `
      SELECT COUNT(*) AS total
      FROM crm_messages
      WHERE ai_status IN ('parsed', 'analyzed')
        AND COALESCE(workflow_status, 'pending') NOT IN ('created_inquiry', 'inquiry_updated', 'no_action', 'archived')
    `),
    father_tasks_pending: countOne(db, "SELECT COUNT(*) AS total FROM crm_father_review_tasks WHERE status = 'pending'"),
    father_tasks_done_pending_sales: countOne(db, "SELECT COUNT(*) AS total FROM crm_father_review_tasks WHERE status = 'done' AND COALESCE(sales_handled_at, '') = ''"),
    costing_drafts_pending_review: countOne(db, "SELECT COUNT(*) AS total FROM foreign_costing_drafts WHERE COALESCE(status, '') IN ('blocked', 'internal_estimate', 'internal_pre_quote', 'draft', 'pending_review')"),
    quoted_waiting_customer: countOne(db, `
      SELECT COUNT(*) AS total
      FROM customers
      WHERE COALESCE(stage, '') IN ('quoted_no_reply', 'quoted')
    `),
    a_customers_updated: countOne(db, `
      SELECT COUNT(*) AS total
      FROM customers
      WHERE priority = 'A' AND COALESCE(updated_at, created_at, '') >= datetime('now', '-7 days')
    `)
  };

  const items = [];

  db.prepare(`
    SELECT
      m.id AS message_id, m.customer_id, m.inquiry_id, m.source_type, m.message_text AS summary,
      m.received_at, m.updated_at, ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority, c.stage AS current_stage, c.next_action,
      i.inquiry_title, i.priority AS inquiry_priority
    FROM crm_messages m
    LEFT JOIN customers c ON c.id = m.customer_id
    LEFT JOIN inquiries i ON i.id = m.inquiry_id
    WHERE m.ai_status = 'pending'
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'message_pending_ai', { title: '新消息待 AI 解读', owner: '业务员' })));

  db.prepare(`
    SELECT
      m.id AS message_id, m.customer_id, m.inquiry_id, m.source_type, m.message_text AS summary,
      m.received_at, m.updated_at, ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority, c.stage AS current_stage, c.next_action,
      i.inquiry_title, i.priority AS inquiry_priority
    FROM crm_messages m
    LEFT JOIN customers c ON c.id = m.customer_id
    LEFT JOIN inquiries i ON i.id = m.inquiry_id
    WHERE m.ai_status IN ('parsed', 'analyzed')
      AND COALESCE(m.workflow_status, 'pending') NOT IN ('created_inquiry', 'inquiry_updated', 'no_action', 'archived')
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'message_parsed_pending_inquiry', { title: 'AI 已解读待更新询盘', owner: '业务员' })));

  db.prepare(`
    SELECT
      t.id AS father_task_id, t.customer_id, t.inquiry_id, t.source_message_id AS message_id,
      t.task_type, t.question_cn AS summary, t.created_at, t.updated_at,
      ${customerDisplaySelect('c')} AS customer_display_name, c.country, c.priority AS customer_priority,
      c.stage AS current_stage, c.next_action, i.inquiry_title, i.priority AS inquiry_priority
    FROM crm_father_review_tasks t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN inquiries i ON i.id = t.inquiry_id
    WHERE t.status = 'pending'
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'father_task_pending', { title: '待父亲确认', owner: '父亲' })));

  db.prepare(`
    SELECT
      t.id AS father_task_id, t.customer_id, t.inquiry_id, t.source_message_id AS message_id,
      t.task_type, t.father_reply_cn AS summary, t.completed_at, t.updated_at,
      ${customerDisplaySelect('c')} AS customer_display_name, c.country, c.priority AS customer_priority,
      c.stage AS current_stage, c.next_action, i.inquiry_title, i.priority AS inquiry_priority
    FROM crm_father_review_tasks t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN inquiries i ON i.id = t.inquiry_id
    WHERE t.status = 'done' AND COALESCE(t.sales_handled_at, '') = ''
    ORDER BY COALESCE(t.completed_at, t.updated_at) DESC, t.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'father_done_pending_sales', { title: '父亲已回复待业务处理', owner: '业务员' })));

  db.prepare(`
    SELECT
      d.id AS costing_draft_id, d.customer_id, d.crm_inquiry_id AS inquiry_id, d.source_text AS summary,
      d.status, d.created_at, d.updated_at, ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority, c.stage AS current_stage, c.next_action,
      i.inquiry_title, i.priority AS inquiry_priority
    FROM foreign_costing_drafts d
    LEFT JOIN customers c ON c.id = d.customer_id
    LEFT JOIN inquiries i ON i.id = d.crm_inquiry_id
    WHERE COALESCE(d.status, '') IN ('blocked', 'internal_estimate', 'internal_pre_quote', 'draft', 'pending_review')
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'costing_draft_pending_review', { title: '待报价助手复核', owner: '父亲' })));

  db.prepare(`
    SELECT
      c.id AS customer_id, c.latest_inquiry_id AS inquiry_id, ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority, c.stage AS current_stage, c.next_action,
      c.updated_at, i.inquiry_title, i.priority AS inquiry_priority
    FROM customers c
    LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
    WHERE COALESCE(c.stage, '') IN ('quoted_no_reply', 'quoted')
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'quoted_waiting_customer', { title: '已报价待客户回复', summary: row.next_action || '', owner: '客户' })));

  db.prepare(`
    SELECT
      c.id AS customer_id, c.latest_inquiry_id AS inquiry_id, ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority, c.stage AS current_stage, c.next_action,
      c.updated_at, i.inquiry_title, i.priority AS inquiry_priority
    FROM customers c
    LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
    WHERE c.priority = 'A' AND COALESCE(c.updated_at, c.created_at, '') >= datetime('now', '-7 days')
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 30
  `).all().forEach((row) => items.push(normalizeItem(row, 'a_customer_updated', { title: 'A 类客户有新更新', summary: row.next_action || '', owner: '业务员' })));

  return { counts, items: sortItems(items).slice(0, 120) };
}

function hydrateFatherTask(db, row) {
  if (!row) return null;
  const attachmentIds = parseJsonArray(row.attachment_ids_json, []).map(Number).filter(Boolean);
  const sourceMessage = row.source_message_id ? db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(row.source_message_id) : null;
  const attachments = sourceMessage
    ? normalizeCrmAttachments(db, sourceMessage).attachments.filter((item) => attachmentIds.includes(Number(item.id)))
    : [];
  return {
    ...row,
    id: Number(row.id),
    customer_id: row.customer_id ? Number(row.customer_id) : null,
    inquiry_id: row.inquiry_id ? Number(row.inquiry_id) : null,
    source_message_id: row.source_message_id ? Number(row.source_message_id) : null,
    interpretation_id: row.interpretation_id ? Number(row.interpretation_id) : null,
    attachment_ids: attachmentIds,
    attachments,
    required_fields: parseJsonArray(row.required_fields_json, [])
  };
}

function listFatherReviewTasks(db, filters = {}) {
  const params = [];
  let where = 'WHERE 1 = 1';
  ['status', 'task_type'].forEach((key) => {
    if (!text(filters[key])) return;
    where += ` AND t.${key} = ?`;
    params.push(text(filters[key]));
  });
  ['customer_id', 'inquiry_id'].forEach((key) => {
    const id = Number(filters[key]);
    if (!Number.isInteger(id) || id <= 0) return;
    where += ` AND t.${key} = ?`;
    params.push(id);
  });
  const rows = db.prepare(`
    SELECT
      t.*,
      ${customerDisplaySelect('c')} AS customer_display_name,
      c.country, c.priority AS customer_priority,
      i.inquiry_title,
      m.source_type, m.sender_name, m.sender_contact, m.received_at AS source_received_at,
      SUBSTR(COALESCE(m.message_text, ''), 1, 240) AS source_message_preview
    FROM crm_father_review_tasks t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN inquiries i ON i.id = t.inquiry_id
    LEFT JOIN crm_messages m ON m.id = t.source_message_id
    ${where}
    ORDER BY CASE WHEN t.status = 'pending' THEN 0 WHEN t.status = 'done' AND COALESCE(t.sales_handled_at, '') = '' THEN 1 ELSE 2 END,
             t.created_at DESC, t.id DESC
    LIMIT 300
  `).all(...params).map((row) => {
    const task = hydrateFatherTask(db, row);
    task.attachments_count = task.attachments.length;
    return task;
  });
  return { rows };
}

function getFatherReviewTaskDetail(db, taskId) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('invalid father task id');
  const taskRow = db.prepare('SELECT * FROM crm_father_review_tasks WHERE id = ?').get(id);
  if (!taskRow) return null;
  const task = hydrateFatherTask(db, taskRow);
  const customer = task.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(task.customer_id) : null;
  const inquiry = task.inquiry_id ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(task.inquiry_id) : null;
  const sourceMessage = task.source_message_id ? db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(task.source_message_id) : null;
  const latestInterpretation = task.interpretation_id
    ? db.prepare('SELECT * FROM crm_ai_interpretations WHERE id = ?').get(task.interpretation_id)
    : (task.source_message_id ? db.prepare('SELECT * FROM crm_ai_interpretations WHERE message_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(task.source_message_id) : null);
  return {
    task,
    customer,
    inquiry,
    source_message: sourceMessage,
    attachments: task.attachments,
    latest_interpretation: latestInterpretation ? {
      ...latestInterpretation,
      parsed: parseJsonObject(latestInterpretation.parsed_json, {}),
      changed_fields: parseJsonArray(latestInterpretation.changed_fields_json, [])
    } : null
  };
}

function markFatherTaskSalesHandled(db, taskId, payload = {}) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('invalid father task id');
  const task = db.prepare('SELECT * FROM crm_father_review_tasks WHERE id = ?').get(id);
  if (!task) throw new Error('father task not found');
  const ts = new Date().toISOString();
  db.prepare(`
    UPDATE crm_father_review_tasks
    SET sales_handled_at = ?, sales_handled_by = ?, sales_note = ?, updated_at = ?
    WHERE id = ?
  `).run(ts, text(payload.sales_handled_by || payload.handled_by || 'sales'), text(payload.sales_note || ''), ts, id);
  return { ok: true, task: hydrateFatherTask(db, db.prepare('SELECT * FROM crm_father_review_tasks WHERE id = ?').get(id)) };
}

module.exports = {
  buildCrmWorkbench,
  getFatherReviewTaskDetail,
  listFatherReviewTasks,
  markFatherTaskSalesHandled
};

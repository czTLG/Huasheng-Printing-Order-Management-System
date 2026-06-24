const express = require('express');
const { db, now, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');

const router = express.Router();
const CRM_ROLES = ['super_admin', 'foreign_trade_crm_admin'];

router.use(allowRoles(...CRM_ROLES));

function idParam(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function intFlag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function jsonDetail(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '{}';
  }
}

function handleError(res, err, fallback = 'CRM 操作失败') {
  console.warn('[crm]', err?.message || err);
  return res.status(400).json({ ok: false, error: fallback });
}

function crmAudit(req, action, resourceType, resourceId, detail = {}) {
  audit({
    role: req.user.role,
    userName: req.user.userName,
    action,
    resourceType,
    resourceId,
    detail: typeof detail === 'string' ? detail : jsonDetail(detail)
  });
}

function customerDisplaySelect(prefix = 'c') {
  return `
    ${prefix}.*,
    COALESCE(NULLIF(${prefix}.company_name, ''), NULLIF(${prefix}.name, ''), NULLIF(${prefix}.contact_person, ''), '未命名客户') AS display_name
  `;
}

function getCustomer(id) {
  return db.prepare(`SELECT ${customerDisplaySelect('c')} FROM customers c WHERE c.id = ?`).get(id);
}

function changesFrom(oldRow, body, fields) {
  return fields
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => ({
      field,
      oldValue: oldRow ? oldRow[field] ?? '' : '',
      newValue: body[field] ?? ''
    }))
    .filter((item) => String(item.oldValue ?? '') !== String(item.newValue ?? ''));
}

function updateByFields(table, id, body, fields) {
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!present.length) return { changed: false };
  const sets = present.map((field) => `${field} = ?`);
  const values = present.map((field) => body[field] === undefined ? null : body[field]);
  sets.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return { changed: true };
}

const CUSTOMER_FIELDS = [
  'customer_code', 'company_name', 'country', 'city', 'contact_person', 'email', 'whatsapp',
  'source_channel', 'priority', 'stage', 'owner_id', 'ai_summary', 'risk_notes', 'next_action',
  'next_followup_at', 'last_contact_at', 'contact', 'phone', 'default_bag_type', 'default_spec',
  'default_use_case', 'default_roller', 'notes'
];

router.get('/customers', (req, res) => {
  try {
    const q = text(req.query.q);
    const params = [];
    let where = 'WHERE COALESCE(c.active, 1) = 1';
    if (q) {
      const like = `%${q}%`;
      where += `
        AND (
          c.company_name LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ?
          OR c.whatsapp LIKE ? OR c.country LIKE ? OR c.customer_code LIKE ?
        )
      `;
      params.push(like, like, like, like, like, like, like);
    }
    const rows = db.prepare(`
      SELECT
        ${customerDisplaySelect('c')},
        i.inquiry_title AS latest_inquiry_title,
        i.status AS latest_inquiry_status,
        i.updated_at AS latest_inquiry_updated_at
      FROM customers c
      LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
      ${where}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '客户列表读取失败');
  }
});

router.post('/customers', (req, res) => {
  try {
    const body = req.body || {};
    const companyName = text(body.company_name || body.name || body.customer_name);
    if (!companyName) return res.status(400).json({ ok: false, error: 'company_name 必填' });
    const ts = now();
    const name = companyName;
    const result = db.prepare(`
      INSERT INTO customers (
        salesperson_id, name, customer_code, company_name, country, city, contact_person, email,
        whatsapp, source_channel, priority, stage, owner_id, ai_summary, risk_notes, next_action,
        next_followup_at, last_contact_at, contact, phone, notes, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      body.salesperson_id || null,
      name,
      text(body.customer_code),
      companyName,
      text(body.country),
      text(body.city),
      text(body.contact_person),
      text(body.email),
      text(body.whatsapp),
      text(body.source_channel),
      text(body.priority || 'C'),
      text(body.stage || 'new'),
      body.owner_id || req.user.id || null,
      text(body.ai_summary),
      text(body.risk_notes),
      text(body.next_action),
      text(body.next_followup_at),
      text(body.last_contact_at),
      text(body.contact || body.contact_person),
      text(body.phone),
      text(body.notes),
      ts,
      ts
    );
    crmAudit(req, 'create_customer', 'crm_customer', result.lastInsertRowid, {
      entity: 'customer',
      action: 'create',
      company_name: companyName
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '客户创建失败');
  }
});

router.get('/customers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const customer = getCustomer(id);
    if (!customer) return res.status(404).json({ ok: false, error: '客户不存在' });
    const latestInquiry = customer.latest_inquiry_id
      ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(customer.latest_inquiry_id) || null
      : null;
    const inquiries = db.prepare('SELECT * FROM inquiries WHERE customer_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100').all(id);
    const communications = db.prepare('SELECT * FROM communication_logs WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 100').all(id);
    res.json({ ok: true, customer, latestInquiry, inquiries, communications });
  } catch (err) {
    handleError(res, err, '客户详情读取失败');
  }
});

router.patch('/customers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getCustomer(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '客户不存在' });
    const body = req.body || {};
    const normalized = { ...body };
    if (Object.prototype.hasOwnProperty.call(normalized, 'company_name') && text(normalized.company_name)) {
      normalized.name = text(normalized.company_name);
    }
    const fields = [...CUSTOMER_FIELDS, 'name'];
    const changes = changesFrom(oldRow, normalized, fields);
    updateByFields('customers', id, normalized, fields);
    crmAudit(req, 'update_customer', 'crm_customer', id, {
      entity: 'customer',
      action: 'update',
      changes
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '客户更新失败');
  }
});

router.get('/customers/:id/communications', (req, res) => {
  try {
    const id = idParam(req.params.id);
    if (!getCustomer(id)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const rows = db.prepare('SELECT * FROM communication_logs WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 300').all(id);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '沟通记录读取失败');
  }
});

router.post('/customers/:id/communications', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const body = req.body || {};
    const rawContent = text(body.raw_content);
    const subject = text(body.subject);
    if (!rawContent && !subject) return res.status(400).json({ ok: false, error: 'subject 或 raw_content 必填' });
    const ts = now();
    const result = db.prepare(`
      INSERT INTO communication_logs (
        customer_id, inquiry_id, channel, direction, sender, recipient, subject, raw_content,
        ai_summary, attachments_json, message_id, thread_id, received_at, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      body.inquiry_id || null,
      text(body.channel || 'manual'),
      text(body.direction || 'inbound'),
      text(body.sender),
      text(body.recipient),
      subject,
      rawContent,
      text(body.ai_summary),
      body.attachments_json ? String(body.attachments_json) : '',
      text(body.message_id),
      text(body.thread_id),
      text(body.received_at || ts),
      req.user.userName,
      ts,
      ts
    );
    db.prepare('UPDATE customers SET last_contact_at = ?, updated_at = ? WHERE id = ?').run(text(body.received_at || ts), ts, customerId);
    crmAudit(req, 'create_communication_log', 'crm_communication_log', result.lastInsertRowid, {
      entity: 'communication_log',
      action: 'create',
      customer_id: customerId,
      inquiry_id: body.inquiry_id || null,
      channel: text(body.channel || 'manual')
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '沟通记录创建失败');
  }
});

const INQUIRY_FIELDS = [
  'inquiry_code', 'customer_id', 'inquiry_title', 'product_type', 'application', 'packaging_type',
  'status', 'priority', 'quantity', 'destination_country', 'destination_port', 'destination_address',
  'trade_term_requested', 'customer_target_price', 'missing_info', 'customer_questions',
  'technical_risks', 'commercial_risks', 'costing_required', 'latest_cost_sheet_id',
  'latest_quote_id', 'order_id', 'next_action', 'next_followup_at'
];

router.get('/inquiries', (req, res) => {
  try {
    const q = text(req.query.q);
    const status = text(req.query.status);
    const priority = text(req.query.priority);
    const params = [];
    let where = 'WHERE 1 = 1';
    if (q) {
      const like = `%${q}%`;
      where += `
        AND (
          i.inquiry_title LIKE ? OR i.product_type LIKE ? OR i.packaging_type LIKE ?
          OR i.destination_country LIKE ? OR c.company_name LIKE ? OR c.name LIKE ?
        )
      `;
      params.push(like, like, like, like, like, like);
    }
    if (status) {
      where += ' AND i.status = ?';
      params.push(status);
    }
    if (priority) {
      where += ' AND i.priority = ?';
      params.push(priority);
    }
    const rows = db.prepare(`
      SELECT
        i.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
        c.country AS customer_country
      FROM inquiries i
      LEFT JOIN customers c ON c.id = i.customer_id
      ${where}
      ORDER BY i.updated_at DESC, i.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '询盘列表读取失败');
  }
});

router.post('/inquiries', (req, res) => {
  try {
    const body = req.body || {};
    const customerId = idParam(body.customer_id);
    if (!customerId || !getCustomer(customerId)) return res.status(400).json({ ok: false, error: '有效 customer_id 必填' });
    const title = text(body.inquiry_title);
    if (!title) return res.status(400).json({ ok: false, error: 'inquiry_title 必填' });
    const ts = now();
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO inquiries (
          inquiry_code, customer_id, inquiry_title, product_type, application, packaging_type, status,
          priority, quantity, destination_country, destination_port, destination_address, trade_term_requested,
          customer_target_price, missing_info, customer_questions, technical_risks, commercial_risks,
          costing_required, next_action, next_followup_at, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        text(body.inquiry_code),
        customerId,
        title,
        text(body.product_type),
        text(body.application),
        text(body.packaging_type),
        text(body.status || 'new'),
        text(body.priority || 'C'),
        text(body.quantity),
        text(body.destination_country),
        text(body.destination_port),
        text(body.destination_address),
        text(body.trade_term_requested),
        text(body.customer_target_price),
        text(body.missing_info),
        text(body.customer_questions),
        text(body.technical_risks),
        text(body.commercial_risks),
        intFlag(body.costing_required),
        text(body.next_action),
        text(body.next_followup_at),
        req.user.userName,
        ts,
        ts
      );
      db.prepare('UPDATE customers SET latest_inquiry_id = ?, updated_at = ? WHERE id = ?').run(result.lastInsertRowid, ts, customerId);
      return result.lastInsertRowid;
    });
    const id = tx();
    crmAudit(req, 'create_inquiry', 'crm_inquiry', id, {
      entity: 'inquiry',
      action: 'create',
      customer_id: customerId,
      inquiry_title: title
    });
    crmAudit(req, 'update_customer_latest_inquiry', 'crm_customer', customerId, {
      entity: 'customer',
      action: 'update_customer_latest_inquiry',
      latest_inquiry_id: id
    });
    res.json({ ok: true, id });
  } catch (err) {
    handleError(res, err, '询盘创建失败');
  }
});

function getInquiry(id) {
  return db.prepare(`
    SELECT
      i.*,
      COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name
    FROM inquiries i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(id);
}

function getSpecification(id) {
  const spec = db.prepare('SELECT * FROM inquiry_specifications WHERE id = ?').get(id);
  if (!spec) return null;
  spec.layers = db.prepare('SELECT * FROM specification_layers WHERE specification_id = ? ORDER BY layer_order ASC, id ASC').all(id);
  return spec;
}

router.get('/inquiries/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const inquiry = getInquiry(id);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const specifications = db.prepare('SELECT * FROM inquiry_specifications WHERE inquiry_id = ? ORDER BY version_no DESC, id DESC').all(id);
    const currentBase = specifications.find((row) => Number(row.is_current) === 1) || specifications[0] || null;
    const currentSpecification = currentBase ? getSpecification(currentBase.id) : null;
    const communications = db.prepare('SELECT * FROM communication_logs WHERE inquiry_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 100').all(id);
    res.json({ ok: true, inquiry, currentSpecification, specifications, communications });
  } catch (err) {
    handleError(res, err, '询盘详情读取失败');
  }
});

router.patch('/inquiries/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getInquiry(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'customer_id') && !getCustomer(idParam(body.customer_id))) {
      return res.status(400).json({ ok: false, error: '有效 customer_id 必填' });
    }
    const changes = changesFrom(oldRow, body, INQUIRY_FIELDS);
    updateByFields('inquiries', id, body, INQUIRY_FIELDS);
    crmAudit(req, 'update_inquiry', 'crm_inquiry', id, {
      entity: 'inquiry',
      action: 'update',
      changes
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '询盘更新失败');
  }
});

const SPEC_FIELDS = [
  'product_type', 'bag_type', 'film_type', 'size_width', 'size_height', 'gusset_size', 'roll_width',
  'roll_length', 'repeat_length', 'thickness_total', 'thickness_unit', 'material_structure_text',
  'printing_colors', 'surface_finish', 'zipper_required', 'valve_required', 'spout_required',
  'tear_notch_required', 'window_required', 'filling_weight', 'packing_machine_type', 'artwork_status',
  'notes', 'source_communication_id'
];

router.get('/inquiries/:id/specifications', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    if (!getInquiry(inquiryId)) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const rows = db.prepare('SELECT * FROM inquiry_specifications WHERE inquiry_id = ? ORDER BY version_no DESC, id DESC').all(inquiryId);
    const layersBySpec = new Map();
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(',');
      const layers = db.prepare(`SELECT * FROM specification_layers WHERE specification_id IN (${placeholders}) ORDER BY layer_order ASC, id ASC`).all(...ids);
      layers.forEach((layer) => {
        const key = Number(layer.specification_id);
        if (!layersBySpec.has(key)) layersBySpec.set(key, []);
        layersBySpec.get(key).push(layer);
      });
    }
    res.json({ ok: true, rows: rows.map((row) => ({ ...row, layers: layersBySpec.get(Number(row.id)) || [] })) });
  } catch (err) {
    handleError(res, err, '规格版本读取失败');
  }
});

router.post('/inquiries/:id/specifications', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    if (!getInquiry(inquiryId)) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const body = req.body || {};
    const ts = now();
    const tx = db.transaction(() => {
      const maxRow = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM inquiry_specifications WHERE inquiry_id = ?').get(inquiryId);
      const versionNo = Number(maxRow?.max_version || 0) + 1;
      db.prepare('UPDATE inquiry_specifications SET is_current = 0, updated_at = ? WHERE inquiry_id = ?').run(ts, inquiryId);
      const result = db.prepare(`
        INSERT INTO inquiry_specifications (
          inquiry_id, version_no, is_current, product_type, bag_type, film_type, size_width, size_height,
          gusset_size, roll_width, roll_length, repeat_length, thickness_total, thickness_unit,
          material_structure_text, printing_colors, surface_finish, zipper_required, valve_required,
          spout_required, tear_notch_required, window_required, filling_weight, packing_machine_type,
          artwork_status, notes, source_communication_id, created_by, created_at, updated_at
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        inquiryId,
        versionNo,
        text(body.product_type),
        text(body.bag_type),
        text(body.film_type),
        text(body.size_width),
        text(body.size_height),
        text(body.gusset_size),
        text(body.roll_width),
        text(body.roll_length),
        text(body.repeat_length),
        text(body.thickness_total),
        text(body.thickness_unit),
        text(body.material_structure_text),
        text(body.printing_colors),
        text(body.surface_finish),
        intFlag(body.zipper_required),
        intFlag(body.valve_required),
        intFlag(body.spout_required),
        intFlag(body.tear_notch_required),
        intFlag(body.window_required),
        text(body.filling_weight),
        text(body.packing_machine_type),
        text(body.artwork_status),
        text(body.notes),
        body.source_communication_id || null,
        req.user.userName,
        ts,
        ts
      );
      db.prepare('UPDATE inquiries SET latest_specification_id = ?, updated_at = ? WHERE id = ?').run(result.lastInsertRowid, ts, inquiryId);
      return { id: result.lastInsertRowid, versionNo };
    });
    const result = tx();
    crmAudit(req, 'create_specification_version', 'crm_specification', result.id, {
      entity: 'specification',
      action: 'create_version',
      inquiry_id: inquiryId,
      version_no: result.versionNo
    });
    res.json({ ok: true, id: result.id, version_no: result.versionNo });
  } catch (err) {
    handleError(res, err, '规格版本创建失败');
  }
});

router.get('/specifications/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const specification = getSpecification(id);
    if (!specification) return res.status(404).json({ ok: false, error: '规格不存在' });
    res.json({ ok: true, specification });
  } catch (err) {
    handleError(res, err, '规格读取失败');
  }
});

router.post('/specifications/:id/layers', (req, res) => {
  try {
    const specificationId = idParam(req.params.id);
    if (!getSpecification(specificationId)) return res.status(404).json({ ok: false, error: '规格不存在' });
    const body = req.body || {};
    const materialName = text(body.material_name);
    if (!materialName) return res.status(400).json({ ok: false, error: 'material_name 必填' });
    const ts = now();
    const maxRow = db.prepare('SELECT COALESCE(MAX(layer_order), 0) AS max_order FROM specification_layers WHERE specification_id = ?').get(specificationId);
    const layerOrder = Number(body.layer_order || 0) > 0 ? Number(body.layer_order) : Number(maxRow?.max_order || 0) + 1;
    const result = db.prepare(`
      INSERT INTO specification_layers (
        specification_id, layer_order, material_name, material_code, thickness, thickness_unit, layer_role,
        is_customer_required, is_system_suggested, is_confirmed_by_costing, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      specificationId,
      layerOrder,
      materialName,
      text(body.material_code),
      text(body.thickness),
      text(body.thickness_unit),
      text(body.layer_role),
      intFlag(body.is_customer_required),
      intFlag(body.is_system_suggested),
      intFlag(body.is_confirmed_by_costing),
      text(body.notes),
      ts,
      ts
    );
    crmAudit(req, 'create_specification_layer', 'crm_specification_layer', result.lastInsertRowid, {
      entity: 'specification_layer',
      action: 'create',
      specification_id: specificationId,
      layer_order: layerOrder,
      material_name: materialName
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '材料层创建失败');
  }
});

router.get('/audit-logs', (req, res) => {
  try {
    const resourceType = text(req.query.resourceType);
    const action = text(req.query.action);
    const user = text(req.query.user);
    const params = [];
    let where = "WHERE (resource_type LIKE 'crm_%' OR action IN ('create_customer','update_customer','create_communication_log','create_inquiry','update_inquiry','create_specification_version','create_specification_layer','update_customer_latest_inquiry'))";
    if (resourceType) {
      where += ' AND resource_type = ?';
      params.push(resourceType);
    }
    if (action) {
      where += ' AND action = ?';
      params.push(action);
    }
    if (user) {
      where += ' AND user_name LIKE ?';
      params.push(`%${user}%`);
    }
    const rows = db.prepare(`
      SELECT *
      FROM audit_logs
      ${where}
      ORDER BY id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, 'CRM 日志读取失败');
  }
});

module.exports = router;

'use strict';

const { importEmailToCrmMessage } = require('../lib/emailToCrmMessage');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function required(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} required`);
  return normalized;
}

function integerList(value) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error('email_message_ids required');
  return ids;
}

function present(value) {
  return value === undefined || value === null ? null : text(value);
}

function reconcileThread(db, input = {}, { clock = () => new Date() } = {}) {
  const emailIds = integerList(input.email_message_ids);
  const customer = input.customer && typeof input.customer === 'object' ? input.customer : {};
  const inquiry = input.inquiry && typeof input.inquiry === 'object' ? input.inquiry : {};
  const specification = input.specification && typeof input.specification === 'object' ? input.specification : {};
  const research = input.research && typeof input.research === 'object' ? input.research : {};
  const companyName = required(customer.company_name || customer.name, 'customer company_name');
  const email = required(customer.email, 'customer email').toLowerCase();
  const inquiryCode = required(inquiry.inquiry_code, 'inquiry inquiry_code');
  const ts = clock().toISOString();

  const result = db.transaction(() => {
    const placeholders = emailIds.map(() => '?').join(',');
    const foundEmails = db.prepare(`SELECT id FROM email_messages WHERE id IN (${placeholders})`).all(...emailIds);
    if (foundEmails.length !== emailIds.length) throw new Error('one or more email messages not found');

    let customerRow = db.prepare(`
      SELECT * FROM customers
      WHERE LOWER(COALESCE(email, '')) = LOWER(?) OR LOWER(COALESCE(company_name, name, '')) = LOWER(?)
      ORDER BY CASE WHEN LOWER(COALESCE(email, '')) = LOWER(?) THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(email, companyName, email);
    if (!customerRow) {
      const inserted = db.prepare(`
        INSERT INTO customers (
          name, company_name, contact_person, email, country, city, website, customer_type, industry,
          main_product, business_background, source_channel, source_notes, priority, stage, next_action,
          active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inquiry', ?, 1, ?, ?)
      `).run(
        companyName, companyName, present(customer.contact_person), email, present(customer.country),
        present(customer.city), present(customer.website), present(customer.customer_type), present(customer.industry),
        present(customer.main_product), present(customer.business_background), present(customer.source_channel) || 'email',
        present(customer.source_notes), present(customer.priority) || 'B', present(inquiry.next_action), ts, ts
      );
      customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(inserted.lastInsertRowid));
    } else {
      db.prepare(`
        UPDATE customers SET
          company_name = COALESCE(NULLIF(?, ''), company_name), name = COALESCE(NULLIF(?, ''), name),
          contact_person = COALESCE(NULLIF(?, ''), contact_person), email = COALESCE(NULLIF(?, ''), email),
          country = COALESCE(NULLIF(?, ''), country), city = COALESCE(NULLIF(?, ''), city),
          website = COALESCE(NULLIF(?, ''), website), customer_type = COALESCE(NULLIF(?, ''), customer_type),
          industry = COALESCE(NULLIF(?, ''), industry), main_product = COALESCE(NULLIF(?, ''), main_product),
          business_background = COALESCE(NULLIF(?, ''), business_background),
          source_channel = COALESCE(NULLIF(?, ''), source_channel), source_notes = COALESCE(NULLIF(?, ''), source_notes),
          priority = COALESCE(NULLIF(?, ''), priority), stage = 'inquiry',
          next_action = COALESCE(NULLIF(?, ''), next_action), updated_at = ?
        WHERE id = ?
      `).run(
        companyName, companyName, present(customer.contact_person), email, present(customer.country), present(customer.city),
        present(customer.website), present(customer.customer_type), present(customer.industry), present(customer.main_product),
        present(customer.business_background), present(customer.source_channel) || 'email', present(customer.source_notes),
        present(customer.priority) || 'B', present(inquiry.next_action), ts, customerRow.id
      );
    }
    const customerId = Number(customerRow.id);

    let inquiryRow = db.prepare('SELECT * FROM inquiries WHERE customer_id = ? AND inquiry_code = ? LIMIT 1').get(customerId, inquiryCode);
    if (!inquiryRow) {
      const inserted = db.prepare(`
        INSERT INTO inquiries (
          inquiry_code, customer_id, inquiry_title, product_type, application, packaging_type, status, priority,
          quantity, destination_country, destination_port, destination_address, trade_term_requested,
          customer_target_price, missing_info, customer_questions, technical_risks, commercial_risks,
          costing_required, next_action, next_followup_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matrix-runtime', ?, ?)
      `).run(
        inquiryCode, customerId, present(inquiry.inquiry_title) || inquiryCode, present(inquiry.product_type),
        present(inquiry.application), present(inquiry.packaging_type), present(inquiry.status) || 'quote_pending',
        present(inquiry.priority) || 'B', present(inquiry.quantity), present(inquiry.destination_country),
        present(inquiry.destination_port), present(inquiry.destination_address), present(inquiry.trade_term_requested),
        present(inquiry.customer_target_price), present(inquiry.missing_info), present(inquiry.customer_questions),
        present(inquiry.technical_risks), present(inquiry.commercial_risks), inquiry.costing_required === 0 ? 0 : 1,
        present(inquiry.next_action), present(inquiry.next_followup_at), ts, ts
      );
      inquiryRow = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(inserted.lastInsertRowid));
    } else {
      db.prepare(`
        UPDATE inquiries SET inquiry_title = COALESCE(NULLIF(?, ''), inquiry_title),
          product_type = COALESCE(NULLIF(?, ''), product_type), application = COALESCE(NULLIF(?, ''), application),
          packaging_type = COALESCE(NULLIF(?, ''), packaging_type), status = COALESCE(NULLIF(?, ''), status),
          priority = COALESCE(NULLIF(?, ''), priority), quantity = COALESCE(NULLIF(?, ''), quantity),
          destination_country = COALESCE(NULLIF(?, ''), destination_country),
          destination_port = COALESCE(NULLIF(?, ''), destination_port),
          destination_address = COALESCE(NULLIF(?, ''), destination_address),
          trade_term_requested = COALESCE(NULLIF(?, ''), trade_term_requested),
          costing_required = MAX(costing_required, ?), next_action = COALESCE(NULLIF(?, ''), next_action), updated_at = ?
        WHERE id = ?
      `).run(
        present(inquiry.inquiry_title), present(inquiry.product_type), present(inquiry.application),
        present(inquiry.packaging_type), present(inquiry.status), present(inquiry.priority), present(inquiry.quantity),
        present(inquiry.destination_country), present(inquiry.destination_port), present(inquiry.destination_address),
        present(inquiry.trade_term_requested), inquiry.costing_required === 0 ? 0 : 1,
        present(inquiry.next_action), ts, inquiryRow.id
      );
    }
    const inquiryId = Number(inquiryRow.id);

    let specRow = db.prepare('SELECT id FROM inquiry_specifications WHERE inquiry_id = ? AND is_current = 1 ORDER BY version_no DESC, id DESC LIMIT 1').get(inquiryId);
    if (!specRow && Object.keys(specification).length) {
      const inserted = db.prepare(`
        INSERT INTO inquiry_specifications (
          inquiry_id, version_no, is_current, product_type, bag_type, film_type, size_width, size_height,
          gusset_size, thickness_total, thickness_unit, material_structure_text, printing_colors, surface_finish,
          zipper_required, valve_required, spout_required, tear_notch_required, window_required, filling_weight,
          packing_machine_type, artwork_status, notes, created_by, created_at, updated_at
        ) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matrix-runtime', ?, ?)
      `).run(
        inquiryId, present(specification.product_type), present(specification.bag_type), present(specification.film_type),
        present(specification.size_width), present(specification.size_height), present(specification.gusset_size),
        present(specification.thickness_total), present(specification.thickness_unit), present(specification.material_structure_text),
        present(specification.printing_colors), present(specification.surface_finish), specification.zipper_required ? 1 : 0,
        specification.valve_required ? 1 : 0, specification.spout_required ? 1 : 0,
        specification.tear_notch_required ? 1 : 0, specification.window_required ? 1 : 0,
        present(specification.filling_weight), present(specification.packing_machine_type), present(specification.artwork_status),
        present(specification.notes), ts, ts
      );
      specRow = { id: Number(inserted.lastInsertRowid) };
      db.prepare('UPDATE inquiries SET latest_specification_id = ?, updated_at = ? WHERE id = ?').run(specRow.id, ts, inquiryId);
    }

    let costingRequest = db.prepare(`
      SELECT id FROM costing_requests
      WHERE inquiry_id = ? AND status IN ('pending', 'in_progress', 'pending_review')
      ORDER BY id DESC LIMIT 1
    `).get(inquiryId);
    if (!costingRequest && inquiry.costing_required !== 0) {
      const code = `MX-${inquiryCode}`.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
      const inserted = db.prepare(`
        INSERT INTO costing_requests (
          costing_request_code, customer_id, inquiry_id, specification_id, requested_by, assigned_to,
          status, request_note, required_quote_terms, required_currency, required_unit, urgency,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'matrix-runtime', 'owner-review', 'pending', ?, ?, 'USD', 'customer-requested', ?, ?, ?)
      `).run(
        code, customerId, inquiryId, Number(specRow?.id || 0) || null,
        present(inquiry.next_action), present(inquiry.trade_term_requested),
        present(inquiry.priority) === 'A' ? 'high' : 'normal', ts, ts
      );
      costingRequest = { id: Number(inserted.lastInsertRowid) };
    }

    if (text(research.title) || text(research.research_summary)) {
      const title = text(research.title) || 'Official source verification';
      const existingResearch = db.prepare('SELECT id FROM customer_research_notes WHERE customer_id = ? AND title = ? AND status = \'active\' LIMIT 1').get(customerId, title);
      const sourcesJson = JSON.stringify(Array.isArray(research.sources) ? research.sources : []);
      if (existingResearch) {
        db.prepare(`UPDATE customer_research_notes SET research_summary = ?, customer_type = ?, industry = ?, main_products = ?, website = ?, country = ?, city = ?, company_size_note = ?, buyer_authenticity_note = ?, business_match_note = ?, risk_flags = ?, suggested_priority = ?, suggested_next_action = ?, sources_json = ?, updated_at = ? WHERE id = ?`).run(
          present(research.research_summary), present(research.customer_type), present(research.industry), present(research.main_products),
          present(research.website), present(research.country), present(research.city), present(research.company_size_note),
          present(research.buyer_authenticity_note), present(research.business_match_note), present(research.risk_flags),
          present(research.suggested_priority), present(research.suggested_next_action), sourcesJson, ts, existingResearch.id
        );
      } else {
        db.prepare(`INSERT INTO customer_research_notes (customer_id, source_type, title, research_summary, customer_type, industry, main_products, website, country, city, company_size_note, buyer_authenticity_note, business_match_note, risk_flags, suggested_priority, suggested_next_action, sources_json, status, created_by, created_at, updated_at) VALUES (?, 'public_official', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'matrix-runtime', ?, ?)`).run(
          customerId, title, present(research.research_summary), present(research.customer_type), present(research.industry),
          present(research.main_products), present(research.website), present(research.country), present(research.city),
          present(research.company_size_note), present(research.buyer_authenticity_note), present(research.business_match_note),
          present(research.risk_flags), present(research.suggested_priority), present(research.suggested_next_action), sourcesJson, ts, ts
        );
      }
    }

    db.prepare(`UPDATE email_messages SET matched_customer_id = ?, matched_inquiry_id = ?, updated_at = ? WHERE id IN (${placeholders})`).run(customerId, inquiryId, ts, ...emailIds);
    db.prepare(`UPDATE matrix_inbox_jobs SET matched_customer_id = ?, matched_inquiry_id = ?, correlation_state = 'matched', updated_at = ? WHERE email_message_id IN (${placeholders})`).run(customerId, inquiryId, ts, ...emailIds);
    db.prepare('UPDATE customers SET latest_inquiry_id = ?, next_action = COALESCE(NULLIF(?, \'\'), next_action), updated_at = ? WHERE id = ?').run(inquiryId, present(inquiry.next_action), ts, customerId);

    const imported = emailIds.map(id => importEmailToCrmMessage(db, id));
    return { customer_id: customerId, inquiry_id: inquiryId, specification_id: Number(specRow?.id || 0) || null, costing_request_id: Number(costingRequest?.id || 0) || null, email_message_ids: emailIds, imported };
  });

  return result();
}

module.exports = { reconcileThread };

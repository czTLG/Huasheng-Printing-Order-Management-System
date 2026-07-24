'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value, fallback = {}) {
  try { const parsed = JSON.parse(String(value || '')); return parsed && typeof parsed === 'object' ? parsed : fallback; }
  catch (_) { return fallback; }
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 80);
}

function attachmentPath(value) {
  const key = text(value).replace(/^\/+/, '');
  if (!key || key.split('/').some(part => !part || part === '.' || part === '..')) return '';
  if (!/^[\p{L}\p{N}._/-]+$/u.test(key)) return '';
  return `/refs/matrix-inbox-attachments/${key}`;
}

function buildThreadContext(db, emailMessageId) {
  const targetId = Number(emailMessageId);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('valid email_message_id required');
  const target = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(targetId);
  if (!target) throw new Error('email message not found');
  const normalizedSubject = text(target.normalized_subject);
  const contactEmail = text(target.contact_email).toLowerCase();
  const rows = db.prepare(`
    SELECT em.*, j.message_class, j.workflow_state, j.analysis_state, j.analysis_json
    FROM email_messages em
    LEFT JOIN matrix_inbox_jobs j ON j.email_message_id = em.id
    WHERE LOWER(COALESCE(em.contact_email, '')) = LOWER(?)
      AND LOWER(COALESCE(em.normalized_subject, '')) = LOWER(?)
      AND em.direction IN ('inbound', 'outbound')
    ORDER BY datetime(COALESCE(em.received_at, em.sent_at, em.created_at)) ASC, em.id ASC
    LIMIT 20
  `).all(contactEmail, normalizedSubject);
  const thread = rows.length ? rows : [target];
  const customerId = thread.map(row => Number(row.matched_customer_id || 0)).find(Boolean) || null;
  const inquiryId = thread.map(row => Number(row.matched_inquiry_id || 0)).find(Boolean) || null;
  const customer = customerId ? db.prepare(`
    SELECT id, company_name, name, contact_person, country, city, website, customer_type, industry,
           main_product, business_background, priority, stage, next_action
    FROM customers WHERE id = ?
  `).get(customerId) : null;
  const inquiry = inquiryId ? db.prepare(`
    SELECT id, inquiry_code, inquiry_title, product_type, application, packaging_type, status, priority,
           quantity, destination_country, destination_port, trade_term_requested, missing_info,
           customer_questions, technical_risks, commercial_risks, costing_required, next_action
    FROM inquiries WHERE id = ?
  `).get(inquiryId) : null;
  const research = customerId ? db.prepare(`
    SELECT research_summary, customer_type, industry, main_products, website, country, city,
           company_size_note, buyer_authenticity_note, business_match_note, risk_flags,
           suggested_priority, suggested_next_action, sources_json
    FROM customer_research_notes
    WHERE customer_id = ? AND status = 'active'
    ORDER BY updated_at DESC, id DESC LIMIT 1
  `).get(customerId) : null;
  const existingTasks = inquiryId ? db.prepare(`
    SELECT id, status, request_note, required_quote_terms, required_currency, required_unit, urgency,
           due_at, updated_at
    FROM costing_requests
    WHERE inquiry_id = ? AND status IN ('pending', 'in_progress', 'pending_review')
    ORDER BY updated_at DESC, id DESC
  `).all(inquiryId) : [];
  const specifications = inquiryId ? db.prepare(`
    SELECT id, version_no, is_current, product_type, bag_type, film_type,
           size_width, size_height, gusset_size, roll_width, roll_length,
           repeat_length, thickness_total, thickness_unit, material_structure_text,
           printing_colors, surface_finish, zipper_required, valve_required,
           spout_required, tear_notch_required, window_required, filling_weight,
           packing_machine_type, artwork_status, notes, source_communication_id,
           created_at, updated_at
    FROM inquiry_specifications
    WHERE inquiry_id = ?
    ORDER BY is_current DESC, version_no DESC, id DESC
    LIMIT 20
  `).all(inquiryId) : [];
  const specificationIds = specifications.map(item => Number(item.id));
  const specificationPlaceholders = specificationIds.map(() => '?').join(',');
  const layers = specificationIds.length ? db.prepare(`
    SELECT specification_id, layer_order, material_name, material_code, thickness,
           thickness_unit, layer_role, is_customer_required,
           is_system_suggested, is_confirmed_by_costing, notes
    FROM specification_layers
    WHERE specification_id IN (${specificationPlaceholders})
    ORDER BY specification_id, layer_order, id
  `).all(...specificationIds) : [];
  const ids = thread.map(row => Number(row.id));
  const placeholders = ids.map(() => '?').join(',');
  const attachments = ids.length ? db.prepare(`
    SELECT email_message_id, media_order, storage_key, original_file_name, detected_mime_type,
           file_size, availability_state, canonical_thread_id, canonical_customer_id
    FROM matrix_inbox_attachments WHERE email_message_id IN (${placeholders})
    ORDER BY email_message_id, media_order
  `).all(...ids) : [];
  const attachmentReviews = ids.length ? db.prepare(`
    SELECT id, email_message_id, original_file_name, customer_id, inquiry_id,
           ai_status, ai_summary_cn, extracted_specs_json, raw_metadata_json
    FROM crm_message_attachments
    WHERE CAST(email_message_id AS INTEGER) IN (${placeholders})
    ORDER BY id ASC
  `).all(...ids) : [];
  const reviewByAttachment = new Map(attachmentReviews.map(item => [
    `${Number(item.email_message_id)}\0${text(item.original_file_name)}`,
    item
  ]));

  return {
    target_email_message_id: targetId,
    first_email_message_id: Number(thread[0].id),
    thread_key: `${contactEmail}::${normalizedSubject}`,
    contact: { name: text(target.contact_name || target.from_name), email: contactEmail, domain: text(target.email_domain) },
    customer: customer ? { ...customer, company_name: text(customer.company_name || customer.name) } : null,
    inquiry: inquiry || null,
    specifications: specifications.map(item => ({
      ...item,
      id: Number(item.id), version_no: Number(item.version_no || 0), is_current: Boolean(item.is_current),
      zipper_required: Boolean(item.zipper_required), valve_required: Boolean(item.valve_required),
      spout_required: Boolean(item.spout_required), tear_notch_required: Boolean(item.tear_notch_required),
      window_required: Boolean(item.window_required),
      layers: layers.filter(layer => Number(layer.specification_id) === Number(item.id)).map(layer => ({
        ...layer,
        specification_id: Number(layer.specification_id), layer_order: Number(layer.layer_order || 0),
        is_customer_required: Boolean(layer.is_customer_required),
        is_system_suggested: Boolean(layer.is_system_suggested),
        is_confirmed_by_costing: Boolean(layer.is_confirmed_by_costing)
      }))
    })),
    research: research ? {
      summary_cn: text(research.research_summary), customer_type: text(research.customer_type),
      industry: text(research.industry), main_products: text(research.main_products), website: text(research.website),
      country: text(research.country), city: text(research.city), company_size_note: text(research.company_size_note),
      authenticity_note_cn: text(research.buyer_authenticity_note), match_note_cn: text(research.business_match_note),
      risk_flags: text(research.risk_flags), suggested_priority: text(research.suggested_priority),
      suggested_next_action_cn: text(research.suggested_next_action), sources: parseJson(research.sources_json, [])
    } : null,
    messages: thread.map(row => {
      const analysis = parseJson(row.analysis_json);
      return {
        email_message_id: Number(row.id), direction: text(row.direction),
        occurred_at: text(row.received_at || row.sent_at || row.created_at), subject: text(row.subject),
        lines: lines(row.cleaned_text || row.text_body), attachment_count: attachments.filter(item => Number(item.email_message_id) === Number(row.id)).length,
        prior_analysis: {
          quality: analysis.translation_state === 'complete' ? 'complete' : 'fallback',
          message_class: text(row.message_class || analysis.message_class), summary_cn: text(analysis.summary_cn),
          suggested_next_action_cn: text(analysis.suggested_next_action_cn)
        }
      };
    }),
    attachments: attachments.map(item => {
      const review = reviewByAttachment.get(`${Number(item.email_message_id)}\0${text(item.original_file_name)}`) || null;
      const metadata = parseJson(review?.raw_metadata_json, {});
      return {
        email_message_id: Number(item.email_message_id), order: Number(item.media_order),
        filename: text(item.original_file_name), mime_type: text(item.detected_mime_type),
        file_size: Number(item.file_size || 0), availability: text(item.availability_state),
        canonical_thread_id: item.canonical_thread_id ? Number(item.canonical_thread_id) : null,
        canonical_customer_id: item.canonical_customer_id ? Number(item.canonical_customer_id) : null,
        reusable_externally: item.availability_state === 'available'
          && Boolean(item.canonical_thread_id) && Boolean(item.canonical_customer_id),
        local_path: item.availability_state === 'available' ? attachmentPath(item.storage_key) : '',
        crm_attachment_id: review ? Number(review.id) : null,
        customer_id: review?.customer_id ? Number(review.customer_id) : customerId,
        inquiry_id: review?.inquiry_id ? Number(review.inquiry_id) : inquiryId,
        review_status: text(review?.ai_status),
        evidence_role: text(metadata.evidence_role),
        display_recommended: metadata.display_recommended === true,
        summary_cn: text(review?.ai_summary_cn),
        extracted_evidence: parseJson(review?.extracted_specs_json, {})
      };
    }),
    existing_tasks: existingTasks.map(item => ({
      id: Number(item.id), status: text(item.status), note_cn: text(item.request_note),
      trade_terms: text(item.required_quote_terms), currency: text(item.required_currency),
      unit: text(item.required_unit), urgency: text(item.urgency), due_at: text(item.due_at), updated_at: text(item.updated_at)
    }))
  };
}

module.exports = { buildThreadContext };

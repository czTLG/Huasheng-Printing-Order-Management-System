'use strict';

const EVIDENCE_ROLES = new Set(['product_reference', 'signature_asset', 'document_image', 'other']);
const SOURCES = new Set(['human_verified', 'ai_visual']);

function text(value, maximum = 1000) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum) throw new Error('attachment review text too long');
  return result;
}

function stringList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > 50) throw new Error(`${label} has too many items`);
  return value.map(item => text(item, 200)).filter(Boolean);
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function applyAttachmentReviews(db, reviews, { reviewer = 'matrix-runtime', now = () => new Date() } = {}) {
  if (!Array.isArray(reviews) || reviews.length === 0) throw new Error('attachment reviews required');
  const seen = new Set();
  const normalized = reviews.map(input => {
    const attachmentId = Number(input?.attachment_id);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) throw new Error('valid attachment id required');
    if (seen.has(attachmentId)) throw new Error('duplicate attachment review');
    seen.add(attachmentId);
    const evidenceRole = text(input.evidence_role, 40);
    if (!EVIDENCE_ROLES.has(evidenceRole)) throw new Error('invalid evidence role');
    const source = text(input.source, 40);
    if (!SOURCES.has(source)) throw new Error('invalid attachment review source');
    const summaryCn = text(input.summary_cn);
    if (!summaryCn) throw new Error('attachment review summary required');
    const displayRecommended = input.display_recommended === true;
    if (displayRecommended && evidenceRole !== 'product_reference') throw new Error('only product reference may be displayed');
    return {
      attachmentId, evidenceRole, source, summaryCn, displayRecommended,
      visibleFacts: stringList(input.visible_facts || [], 'visible facts'),
      unconfirmedFields: stringList(input.unconfirmed_fields || [], 'unconfirmed fields')
    };
  });
  const reviewedAt = now().toISOString();
  const reviewerName = text(reviewer, 120) || 'matrix-runtime';
  db.transaction(() => {
    for (const review of normalized) {
      const row = db.prepare('SELECT * FROM crm_message_attachments WHERE id = ?').get(review.attachmentId);
      if (!row) throw new Error('attachment not found');
      if (row.attachment_type !== 'image' && !String(row.mime_type || '').startsWith('image/')) throw new Error('attachment is not an image');
      const metadata = {
        ...parseObject(row.raw_metadata_json),
        evidence_role: review.evidenceRole,
        display_recommended: review.displayRecommended,
        review_source: review.source,
        reviewed_by: reviewerName,
        reviewed_at: reviewedAt
      };
      db.prepare(`
        UPDATE crm_message_attachments
        SET ai_status = ?, ai_summary_cn = ?, extracted_specs_json = ?,
            raw_metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        review.source,
        review.summaryCn,
        JSON.stringify({ visible_facts: review.visibleFacts, unconfirmed_fields: review.unconfirmedFields }),
        JSON.stringify(metadata),
        reviewedAt,
        review.attachmentId
      );
    }
  })();
  return { updated: normalized.length, attachment_ids: normalized.map(item => item.attachmentId) };
}

module.exports = { applyAttachmentReviews, EVIDENCE_ROLES, SOURCES };

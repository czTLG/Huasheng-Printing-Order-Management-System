function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeJsonParse(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function extFromName(name = '') {
  const clean = text(name).split('?')[0].split('#')[0];
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

function typeFromMimeOrExt(mimeType = '', ext = '') {
  const mime = text(mimeType).toLowerCase();
  const fileExt = text(ext).toLowerCase();
  if (/^image\/(jpeg|jpg|png|webp|gif)$/.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt)) return 'image';
  if (mime === 'application/pdf' || fileExt === 'pdf') return 'pdf';
  if (/word|msword|officedocument\.wordprocessingml/.test(mime) || ['doc', 'docx'].includes(fileExt)) return 'document';
  if (/excel|spreadsheet|csv/.test(mime) || ['xls', 'xlsx', 'csv'].includes(fileExt)) return 'spreadsheet';
  if (/zip|rar|7z|compressed|archive/.test(mime) || ['zip', 'rar', '7z'].includes(fileExt)) return 'archive';
  return 'other';
}

function fileNameFromMeta(meta = {}) {
  return text(
    meta.original_file_name ||
    meta.originalFileName ||
    meta.file_name ||
    meta.fileName ||
    meta.filename ||
    meta.name ||
    meta.title ||
    meta.stored_file_name ||
    meta.storedFileName ||
    meta.url ||
    meta.file_url ||
    meta.public_url ||
    ''
  );
}

function normalizeAttachmentRecord(raw = {}, context = {}, index = 0) {
  const originalFileName = fileNameFromMeta(raw);
  const mimeType = text(raw.mime_type || raw.mimeType || raw.content_type || raw.contentType || raw.type || '');
  const fileExt = text(raw.file_ext || raw.fileExt || extFromName(originalFileName) || extFromName(raw.public_url || raw.url || raw.file_url || ''));
  const attachmentType = text(raw.attachment_type || raw.attachmentType || typeFromMimeOrExt(mimeType, fileExt));
  const publicUrl = text(raw.public_url || raw.publicUrl || raw.file_url || raw.fileUrl || raw.url || raw.href || '');
  const previewUrl = text(raw.preview_url || raw.previewUrl || publicUrl);
  const thumbnailUrl = text(raw.thumbnail_url || raw.thumbnailUrl || raw.thumb_url || raw.thumbUrl || '');
  const storagePath = text(raw.storage_path || raw.storagePath || '');
  const hasReadableUrl = !!(publicUrl || previewUrl || thumbnailUrl);
  const canPreview = !!((attachmentType === 'image' && (thumbnailUrl || previewUrl || publicUrl)) || (attachmentType === 'pdf' && (previewUrl || publicUrl)));
  const canDownload = !!(publicUrl || previewUrl);
  const rawMetadata = raw.raw_metadata_json ? safeJsonParse(raw.raw_metadata_json, raw) : raw;

  return {
    id: raw.id ? Number(raw.id) : null,
    message_id: raw.message_id ? Number(raw.message_id) : (context.message_id ? Number(context.message_id) : null),
    customer_id: raw.customer_id ? Number(raw.customer_id) : (context.customer_id ? Number(context.customer_id) : null),
    inquiry_id: raw.inquiry_id ? Number(raw.inquiry_id) : (context.inquiry_id ? Number(context.inquiry_id) : null),
    source_type: text(raw.source_type || context.source_type || ''),
    source_message_id: text(raw.source_message_id || context.source_message_id || ''),
    original_file_name: originalFileName || `attachment-${index + 1}`,
    mime_type: mimeType,
    file_ext: fileExt,
    file_size: Number(raw.file_size || raw.fileSize || raw.size || 0) || 0,
    attachment_type: attachmentType,
    media_order: Number(raw.media_order || raw.mediaOrder || raw.order || index + 1) || index + 1,
    caption_text: text(raw.caption_text || raw.caption || raw.description || ''),
    public_url: publicUrl,
    preview_url: previewUrl,
    thumbnail_url: thumbnailUrl,
    download_url: publicUrl || previewUrl,
    storage_path: storagePath,
    can_preview: canPreview,
    can_download: canDownload,
    ai_status: text(raw.ai_status || raw.aiStatus || 'skipped'),
    ai_summary_cn: text(raw.ai_summary_cn || raw.aiSummaryCn || ''),
    ai_summary_en: text(raw.ai_summary_en || raw.aiSummaryEn || ''),
    extracted_specs_json: raw.extracted_specs_json || raw.extractedSpecsJson || '',
    risk_flags_json: raw.risk_flags_json || raw.riskFlagsJson || '',
    raw_metadata_json: typeof rawMetadata === 'string' ? rawMetadata : JSON.stringify(rawMetadata || {}),
    unavailable_reason: hasReadableUrl ? '' : '文件已记录，但当前没有可预览文件'
  };
}

function attachmentsFromJson(attachmentsJson, context = {}) {
  if (!text(attachmentsJson)) return { attachments: [], format_error: false, raw: '' };
  const parsed = safeJsonParse(attachmentsJson, null);
  if (!parsed) return { attachments: [], format_error: true, raw: String(attachmentsJson) };
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.attachments)
      ? parsed.attachments
      : Array.isArray(parsed.files)
        ? parsed.files
        : Array.isArray(parsed.media)
          ? parsed.media
          : [parsed];
  return {
    attachments: list.map((item, index) => normalizeAttachmentRecord(item || {}, context, index)).sort((a, b) => a.media_order - b.media_order),
    format_error: false,
    raw: typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  };
}

function tableExists(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch (_) {
    return false;
  }
}

function normalizeCrmAttachments(db, message = {}) {
  const messageId = Number(message.id || message.message_id || 0) || 0;
  const context = {
    message_id: messageId,
    customer_id: message.customer_id || null,
    inquiry_id: message.inquiry_id || null,
    source_type: message.source_type || '',
    source_message_id: message.source_message_id || ''
  };
  if (messageId && tableExists(db, 'crm_message_attachments')) {
    const rows = db.prepare(`
      SELECT *
      FROM crm_message_attachments
      WHERE message_id = ?
      ORDER BY media_order ASC, id ASC
    `).all(messageId);
    if (rows.length) {
      return {
        attachments: rows.map((row, index) => normalizeAttachmentRecord(row, context, index)),
        format_error: false,
        source: 'crm_message_attachments'
      };
    }
  }
  const fallback = attachmentsFromJson(message.attachments_json, context);
  return { ...fallback, source: 'attachments_json' };
}

function summarizeAttachments(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  return {
    attachments_count: list.length,
    latest_attachment_type: list[0]?.attachment_type || '',
    has_image: list.some((item) => item.attachment_type === 'image') ? 1 : 0,
    has_pdf: list.some((item) => item.attachment_type === 'pdf') ? 1 : 0
  };
}

module.exports = {
  attachmentsFromJson,
  normalizeAttachmentRecord,
  normalizeCrmAttachments,
  summarizeAttachments,
  typeFromMimeOrExt
};

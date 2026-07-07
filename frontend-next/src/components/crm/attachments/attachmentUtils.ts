export type CrmAttachment = {
  id?: number | null;
  message_id?: number | null;
  customer_id?: number | null;
  inquiry_id?: number | null;
  source_type?: string;
  original_file_name?: string;
  mime_type?: string;
  file_ext?: string;
  file_size?: number;
  attachment_type?: 'image' | 'pdf' | 'document' | 'spreadsheet' | 'archive' | 'other' | string;
  media_order?: number;
  caption_text?: string;
  public_url?: string;
  preview_url?: string;
  thumbnail_url?: string;
  download_url?: string;
  can_preview?: boolean | number;
  can_download?: boolean | number;
  ai_status?: string;
  ai_summary_cn?: string;
  unavailable_reason?: string;
  source_message?: {
    id?: number;
    received_at?: string;
    summary?: string;
    sender_name?: string;
    sender_contact?: string;
    customer_display_name?: string;
  };
};

export function safeText(value: any, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

export function formatFileSize(size: any) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '大小未知';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function previewUrl(item: CrmAttachment) {
  return item.preview_url || item.thumbnail_url || item.public_url || '';
}

export function downloadUrl(item: CrmAttachment) {
  return item.download_url || item.public_url || item.preview_url || '';
}

export function canPreview(item: CrmAttachment) {
  return Boolean(item.can_preview && previewUrl(item));
}

export function canDownload(item: CrmAttachment) {
  return Boolean(item.can_download && downloadUrl(item));
}

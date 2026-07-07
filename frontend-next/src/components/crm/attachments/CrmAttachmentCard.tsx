import React from 'react';
import { Archive, Download, File, FileSpreadsheet, FileText } from 'lucide-react';
import { canDownload, downloadUrl, formatFileSize, safeText, type CrmAttachment } from './attachmentUtils';

const typeIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  archive: Archive,
  other: File,
};

export default function CrmAttachmentCard({ attachment, compact = false, showSource = false }: { attachment: CrmAttachment; compact?: boolean; showSource?: boolean }) {
  const type = String(attachment.attachment_type || 'other');
  const Icon = typeIcon[type] || File;
  const fileName = safeText(attachment.original_file_name, '未命名附件');
  const downloadable = canDownload(attachment);

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${compact ? 'p-2' : 'p-3'} text-left`}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-slate-800">{fileName}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
            <span>{safeText(attachment.file_ext || attachment.mime_type || type, type)}</span>
            <span>{formatFileSize(attachment.file_size)}</span>
            {attachment.ai_status ? <span>AI: {attachment.ai_status}</span> : null}
          </div>
          {!downloadable ? (
            <div className="mt-2 text-xs font-bold text-amber-700">{attachment.unavailable_reason || '文件已记录，但当前没有可下载文件'}</div>
          ) : null}
          {showSource && attachment.source_message ? (
            <div className="mt-2 text-xs text-slate-500">
              来源消息 #{attachment.source_message.id || '-'} · {attachment.source_message.received_at || '-'}
            </div>
          ) : null}
        </div>
        {downloadable ? (
          <a
            href={downloadUrl(attachment)}
            download={fileName}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            onClick={(event) => event.stopPropagation()}
            title="下载附件"
          >
            <Download className="h-4 w-4" />
          </a>
        ) : null}
      </div>
      {attachment.caption_text ? <div className="mt-2 text-xs text-slate-600">{attachment.caption_text}</div> : null}
      {attachment.ai_summary_cn ? <div className="mt-2 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-800">{attachment.ai_summary_cn}</div> : null}
    </div>
  );
}

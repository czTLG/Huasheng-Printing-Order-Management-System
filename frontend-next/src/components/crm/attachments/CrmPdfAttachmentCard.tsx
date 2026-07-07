import React, { useState } from 'react';
import { Download, ExternalLink, FileText, X } from 'lucide-react';
import { canDownload, canPreview, downloadUrl, formatFileSize, previewUrl, safeText, type CrmAttachment } from './attachmentUtils';

export default function CrmPdfAttachmentCard({ attachment, compact = false, showSource = false }: { attachment: CrmAttachment; compact?: boolean; showSource?: boolean }) {
  const [open, setOpen] = useState(false);
  const fileName = safeText(attachment.original_file_name, 'PDF 附件');
  const previewable = canPreview(attachment);
  const downloadable = canDownload(attachment);
  const url = previewUrl(attachment);

  return (
    <>
      <div className={`rounded-lg border border-rose-100 bg-white ${compact ? 'p-2' : 'p-3'}`}>
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black text-slate-800">{fileName}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
              <span>PDF</span>
              <span>{formatFileSize(attachment.file_size)}</span>
              {attachment.ai_status ? <span>AI: {attachment.ai_status}</span> : null}
            </div>
            {!previewable ? <div className="mt-2 text-xs font-bold text-amber-700">当前只有附件记录，文件未保存，暂不能预览</div> : null}
            {showSource && attachment.source_message ? (
              <div className="mt-2 text-xs text-slate-500">来源消息 #{attachment.source_message.id || '-'} · {attachment.source_message.received_at || '-'}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={!previewable}
              onClick={(event) => { event.stopPropagation(); setOpen(true); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="预览 PDF"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            {downloadable ? (
              <a
                href={downloadUrl(attachment)}
                download={fileName}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="下载 PDF"
              >
                <Download className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </div>
        {attachment.ai_summary_cn ? <div className="mt-2 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-800">{attachment.ai_summary_cn}</div> : null}
      </div>
      {open && previewable ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 p-4" onClick={() => setOpen(false)}>
          <div className="mx-auto flex h-full max-w-5xl flex-col rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-900">{fileName}</div>
                <div className="text-xs text-slate-500">{formatFileSize(attachment.file_size)}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600">
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
            <iframe title={fileName} src={url} className="min-h-0 flex-1 rounded-b-lg" />
          </div>
        </div>
      ) : null}
    </>
  );
}

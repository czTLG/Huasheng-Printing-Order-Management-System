import React from 'react';
import { ArrowLeft, ArrowRight, Download, X } from 'lucide-react';
import { canDownload, downloadUrl, formatFileSize, previewUrl, safeText, type CrmAttachment } from './attachmentUtils';

export default function CrmImagePreviewModal({
  images,
  index,
  onClose,
  onChange,
  onJumpToMessage,
}: {
  images: CrmAttachment[];
  index: number;
  onClose: () => void;
  onChange: (index: number) => void;
  onJumpToMessage?: (id: number) => void;
}) {
  const image = images[index];
  if (!image) return null;
  const url = previewUrl(image);
  const fileName = safeText(image.original_file_name, '图片附件');
  const source = image.source_message || {};

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 p-4" onClick={onClose}>
      <div className="mx-auto grid h-full max-w-6xl grid-cols-1 overflow-hidden rounded-lg bg-white shadow-xl lg:grid-cols-[1fr_320px]" onClick={(event) => event.stopPropagation()}>
        <div className="relative flex min-h-[360px] items-center justify-center bg-slate-950">
          <img src={url} alt={fileName} className="max-h-full max-w-full object-contain" />
          {images.length > 1 ? (
            <>
              <button type="button" onClick={() => onChange((index - 1 + images.length) % images.length)} className="absolute left-3 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-white/90 text-slate-800">
                <ArrowLeft className="mx-auto h-4 w-4" />
              </button>
              <button type="button" onClick={() => onChange((index + 1) % images.length)} className="absolute right-3 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-white/90 text-slate-800">
                <ArrowRight className="mx-auto h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
        <aside className="flex flex-col gap-3 border-l border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">图片 {index + 1} / {images.length}</div>
            <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600">
              <X className="mx-auto h-4 w-4" />
            </button>
          </div>
          <div>
            <div className="break-words text-sm font-black text-slate-800">{fileName}</div>
            <div className="mt-1 text-xs text-slate-500">{formatFileSize(image.file_size)}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-black text-slate-700">来源消息</div>
            <div className="mt-1">#{source.id || image.message_id || '-'}</div>
            <div className="mt-1">{source.received_at || '-'}</div>
            <div className="mt-2 whitespace-pre-wrap">{source.summary || image.caption_text || '无消息摘要'}</div>
          </div>
          {image.ai_summary_cn ? <div className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-800">{image.ai_summary_cn}</div> : null}
          <div className="mt-auto flex flex-wrap gap-2">
            {canDownload(image) ? (
              <a href={downloadUrl(image)} download={fileName} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700">
                <Download className="h-4 w-4" /> 下载
              </a>
            ) : null}
            {(source.id || image.message_id) && onJumpToMessage ? (
              <button type="button" onClick={() => onJumpToMessage(Number(source.id || image.message_id))} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-black text-white">
                跳转来源消息
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

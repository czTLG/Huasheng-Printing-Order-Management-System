import React, { useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import CrmAttachmentCard from './CrmAttachmentCard';
import CrmImagePreviewModal from './CrmImagePreviewModal';
import CrmPdfAttachmentCard from './CrmPdfAttachmentCard';
import { canPreview, previewUrl, safeText, type CrmAttachment } from './attachmentUtils';

export default function CrmAttachmentGallery({
  attachments,
  compact = false,
  maxVisible = 12,
  showSource = false,
  showAiSummary = false,
  allowDownload = true,
  emptyText = '',
  onJumpToMessage,
}: {
  attachments: CrmAttachment[];
  compact?: boolean;
  maxVisible?: number;
  showSource?: boolean;
  showAiSummary?: boolean;
  allowDownload?: boolean;
  emptyText?: string;
  onJumpToMessage?: (id: number) => void;
}) {
  const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const images = useMemo(() => list.filter((item) => item.attachment_type === 'image'), [list]);
  const visible = list.slice(0, maxVisible);
  const hiddenCount = Math.max(0, list.length - visible.length);

  if (!list.length) {
    return emptyText ? <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-400">{emptyText}</div> : null;
  }

  const openImage = (attachment: CrmAttachment) => {
    const index = images.findIndex((item) => item === attachment || item.id === attachment.id);
    if (index >= 0 && canPreview(attachment)) setImageIndex(index);
  };

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${compact ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
        {visible.map((attachment, index) => {
          const key = `${attachment.id || attachment.message_id || 'attachment'}-${index}`;
          if (attachment.attachment_type === 'image') {
            const imageUrl = previewUrl(attachment);
            const previewable = canPreview(attachment);
            return (
              <button
                type="button"
                key={key}
                disabled={!previewable}
                onClick={(event) => { event.stopPropagation(); openImage(attachment); }}
                className={`overflow-hidden rounded-lg border text-left ${previewable ? 'border-slate-200 bg-white hover:border-indigo-300' : 'border-amber-200 bg-amber-50'} disabled:cursor-not-allowed`}
              >
                {previewable ? (
                  <img src={imageUrl} alt={safeText(attachment.original_file_name, '图片附件')} className={`${compact ? 'h-20' : 'h-32'} w-full object-cover`} />
                ) : (
                  <div className={`${compact ? 'h-20' : 'h-32'} flex items-center justify-center bg-amber-50 text-amber-700`}>
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="space-y-1 p-2">
                  <div className="truncate text-xs font-black text-slate-800">{safeText(attachment.original_file_name, '图片附件')}</div>
                  {attachment.caption_text ? <div className="line-clamp-2 text-[11px] text-slate-500">{attachment.caption_text}</div> : null}
                  {!previewable ? <div className="text-[11px] font-bold text-amber-700">文件未保存，暂不能预览</div> : null}
                  {showAiSummary && attachment.ai_summary_cn ? <div className="text-[11px] text-indigo-700">{attachment.ai_summary_cn}</div> : null}
                </div>
              </button>
            );
          }
          if (attachment.attachment_type === 'pdf') {
            return <CrmPdfAttachmentCard key={key} attachment={attachment} compact={compact} showSource={showSource} />;
          }
          return <CrmAttachmentCard key={key} attachment={{ ...attachment, can_download: allowDownload ? attachment.can_download : false }} compact={compact} showSource={showSource} />;
        })}
        {hiddenCount > 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-black text-slate-500">+{hiddenCount}</div>
        ) : null}
      </div>
      {imageIndex !== null ? (
        <CrmImagePreviewModal
          images={images}
          index={imageIndex}
          onClose={() => setImageIndex(null)}
          onChange={setImageIndex}
          onJumpToMessage={onJumpToMessage}
        />
      ) : null}
    </div>
  );
}

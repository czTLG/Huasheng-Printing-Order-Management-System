import React, { useEffect, useState } from 'react';
import { ArrowLeft, BrainCircuit, Calculator, FileJson, Info, MailCheck, MessageSquare, RefreshCcw, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmAttachmentGallery from './attachments/CrmAttachmentGallery';

type Props = {
  messageId: number;
  onBack: () => void;
};

const fieldClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700';

function formatJson(value: any) {
  if (!value) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusPill({ label, value }: { label: string; value: string }) {
  const color =
    value === 'created_inquiry'
      ? 'bg-indigo-100 text-indigo-800'
      : value === 'archived'
        ? 'bg-slate-200 text-slate-700'
        : value === 'no_action'
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className={`px-2 py-0.5 rounded text-xs font-black ${color}`}>{value || '-'}</span>
    </div>
  );
}

function displayValue(value: any) {
  if (Array.isArray(value)) return value.join('、') || '-';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value || '-');
}

export default function CrmMessageDetail({ messageId, onBack }: Props) {
  const [message, setMessage] = useState<any>(null);
  const [interpretation, setInterpretation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.getCrmWhatsappMessage(messageId);
      setMessage(data?.message ? { ...data.message, attachments: Array.isArray(data.attachments) ? data.attachments : [] } : null);
      setInterpretation(data?.latest_interpretation || null);
      const drafts = await mockService.listCrmReplyDrafts({ source_message_id: messageId }).catch(() => ({ rows: [] }));
      setReplyDrafts(Array.isArray(drafts?.rows) ? drafts.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [messageId]);

  const runAction = async (name: string, action: () => Promise<any>, success: string) => {
    setActionBusy(name);
    setActionMessage('');
    try {
      const result = await action();
      setActionMessage(success);
      await load();
      return result;
    } catch (error: any) {
      setActionMessage(error?.message || '操作失败');
      return null;
    } finally {
      setActionBusy('');
    }
  };

  if (loading) {
    return <div className="p-6 text-sm font-bold text-slate-400">加载消息详情...</div>;
  }

  if (!message) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回消息列表
        </button>
        <div className="p-6 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-500">消息不存在</div>
      </div>
    );
  }

  const rawPayload = formatJson(message.raw_payload_json);
  const rawAttachments = formatJson(message.attachments_json);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const fallbackBody = attachments.some((item: any) => item.attachment_type === 'image')
    ? '[图片消息]'
    : attachments.some((item: any) => item.attachment_type === 'pdf')
      ? '[PDF 文件]'
      : attachments.length > 0
        ? '[文件消息]'
        : '-';
  const messageBody = message.message_text || fallbackBody;
  const parsed = interpretation?.parsed || {};
  const extractedFields = [
    ['产品类型', parsed.product_type], ['袋型', parsed.bag_type], ['卷膜/袋子', parsed.roll_or_bag],
    ['尺寸/装量', parsed.size_text], ['装量', parsed.capacity_text], ['材料结构', parsed.material_structure], ['厚度', parsed.thickness_text],
    ['数量', parsed.quantity_text], ['印刷颜色', parsed.printing_colors], ['设计稿', parsed.artwork_status],
    ['目的地原文', parsed.destination_text], ['目的国', parsed.destination_country], ['目的港', parsed.destination_port],
    ['贸易条款', parsed.trade_term], ['配件', parsed.accessories]
  ];

  const parseMessage = () => runAction('parse', () => mockService.parseCrmMessage(message.id), 'AI 解读已保存。');
  const updateInquiry = () => runAction('inquiry', () => mockService.updateInquiryFromCrmMessage(message.id, interpretation.id), '询盘已按只填空规则更新。');
  const createFatherTask = () => runAction('father', () => mockService.createFatherTaskFromCrmMessage(message.id, {
    interpretation_id: interpretation.id,
    inquiry_id: message.inquiry_id || undefined
  }), '父亲确认任务已创建，当前消息附件已关联。');
  const sendToCosting = () => runAction('costing', () => mockService.createForeignCostingDraft({
    text: messageBody,
    customer_id: message.customer_id || null,
    inquiry_id: message.inquiry_id || null,
    customer_name: message.display_name || message.sender_name || '',
    source_message_ids: [message.id],
    attachment_ids: attachments.map((item: any) => Number(item.id)).filter(Boolean),
    crm_spec: parsed
  }), '已创建内部预核价草稿，待陈湧杰复核。');
  const generateReplyDraft = () => runAction('reply-draft', () => mockService.generateReplyDraftFromMessage(message.id, {
    tone: 'professional',
    reply_channel: message.source_type === 'email' ? 'email' : 'whatsapp'
  }), '已生成客户回复草稿，不会自动发送。');
  const isLogisticsOnly = parsed.message_type === 'logistics_question' && !parsed.product_type && !parsed.bag_type && !parsed.material_structure;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回消息列表
        </button>
        <button
          type="button"
          className="h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-bold text-slate-400"
          disabled
          title="Task 3 实现"
        >
          绑定客户
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h1 className="text-xl font-black">消息详情 #{message.id}</h1>
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">仅用于查看同步入库的 WhatsApp 消息，不包含任何发送操作。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={parseMessage} disabled={!!actionBusy} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center gap-2 disabled:opacity-50"><RefreshCcw className="w-4 h-4" />{interpretation ? '重新解读' : 'AI 解读'}</button>
            <button type="button" onClick={updateInquiry} disabled={!!actionBusy || !interpretation} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">更新询盘</button>
            <button type="button" onClick={createFatherTask} disabled={!!actionBusy || !interpretation} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 flex items-center gap-2 disabled:opacity-50"><UserRoundCheck className="w-4 h-4" />创建父亲确认任务</button>
            <button type="button" onClick={sendToCosting} disabled={!!actionBusy || !interpretation || !message.inquiry_id} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-black flex items-center gap-2 disabled:opacity-50"><Calculator className="w-4 h-4" />发送到报价助手</button>
            <button type="button" onClick={generateReplyDraft} disabled={!!actionBusy || !interpretation} className="h-9 px-3 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-black flex items-center gap-2 disabled:opacity-50"><MailCheck className="w-4 h-4" />生成回复草稿</button>
          </div>
        </div>
        {actionMessage ? <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-800">{actionMessage}</div> : null}
        {isLogisticsOnly ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">该消息更像物流跟进，建议先补充产品规格后再发送到报价助手。可强制发送，但需要人工二次确认。</div> : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">客户</div>
            <div className="mt-1 font-black text-slate-900">{message.display_name || message.sender_name || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">{message.customer_phone || message.customer_whatsapp || message.sender_contact || '-'}</div>
          </div>
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">customer_id / inquiry_id</div>
            <div className="mt-1 font-black text-slate-900">
              {message.customer_id ? `#${message.customer_id}` : '-'} / {message.inquiry_id ? `#${message.inquiry_id}` : '-'}
            </div>
          </div>
          <div className={fieldClass}>
            <StatusPill label="AI 状态" value={String(message.ai_status || 'pending')} />
          </div>
          <div className={fieldClass}>
            <StatusPill label="Workflow" value={String(message.workflow_status || 'pending')} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">direction</div>
            <div className="mt-1 font-black text-slate-900">{message.direction || '-'}</div>
          </div>
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">sender / receiver</div>
            <div className="mt-1 font-black text-slate-900">{message.sender_name || message.sender_contact || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">{message.receiver_contact || '-'}</div>
          </div>
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">received_at</div>
            <div className="mt-1 font-black text-slate-900">{message.received_at || '-'}</div>
          </div>
          <div className={fieldClass}>
            <div className="text-xs font-bold text-slate-500">source_type</div>
            <div className="mt-1 font-black text-slate-900">{message.source_type || '-'}</div>
          </div>
          {message.message_subject ? (
            <div className={`${fieldClass} md:col-span-2`}>
              <div className="text-xs font-bold text-slate-500">email subject</div>
              <div className="mt-1 font-black text-slate-900">{message.message_subject}</div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <Info className="w-4 h-4 text-indigo-600" /> 完整消息
          </div>
          <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{messageBody}</pre>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900"><MailCheck className="w-4 h-4 text-indigo-600" />关联回复草稿</div>
          {replyDrafts.length === 0 ? (
            <div className="text-sm font-bold text-slate-400">暂无回复草稿</div>
          ) : replyDrafts.map((draft) => (
            <div key={draft.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-slate-900">Draft #{draft.id}</div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700">{draft.status}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{draft.reply_channel} · {draft.created_at}</div>
              <div className="mt-2 line-clamp-2 text-slate-700">{draft.draft_summary_cn || draft.draft_text_cn || draft.draft_text_en}</div>
            </div>
          ))}
        </div>

        <div className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900"><BrainCircuit className="w-4 h-4 text-indigo-600" />AI 解读</div>
            {interpretation ? <span className="text-xs font-bold text-slate-500">#{interpretation.id} · {interpretation.provider || 'rule_based'} · {interpretation.status}</span> : null}
          </div>
          {!interpretation ? (
            <div className="text-sm font-bold text-slate-400">尚未 AI 解读</div>
          ) : interpretation.status === 'failed' ? (
            <div className="text-sm font-bold text-red-700">解析失败：{interpretation.error_message || '未记录原因'}</div>
          ) : (
            <>
              <div className="rounded-lg bg-white border border-indigo-100 p-3">
                <div className="text-xs font-black text-indigo-700">中文总结</div>
                <div className="mt-1 text-sm text-slate-700">{parsed.summary_cn || '-'}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {extractedFields.map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                    <div className="text-xs font-bold text-slate-500">{label}</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">{displayValue(value)}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-lg bg-white border border-amber-200 p-3"><div className="text-xs font-black text-amber-700">缺失信息</div><div className="mt-1 text-sm text-slate-700">{displayValue(parsed.missing_information)}</div></div>
                <div className="rounded-lg bg-white border border-red-200 p-3"><div className="text-xs font-black text-red-700">风险提示</div><div className="mt-1 text-sm text-slate-700">{displayValue(parsed.risk_flags)}</div></div>
                <div className="rounded-lg bg-white border border-emerald-200 p-3"><div className="text-xs font-black text-emerald-700">建议下一步</div><div className="mt-1 text-sm text-slate-700">{parsed.suggested_next_action_cn || '-'}</div></div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3">
                <div className="text-xs font-black text-slate-600">建议英文回复草稿（不会自动发送）</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{parsed.suggested_customer_reply_en || '-'}</div>
              </div>
              {Array.isArray(interpretation.changed_fields) && interpretation.changed_fields.length ? (
                <div className="rounded-lg bg-white border border-slate-200 p-3"><div className="text-xs font-black text-slate-600">本次已更新字段</div><div className="mt-2 space-y-1 text-xs text-slate-600">{interpretation.changed_fields.map((row: any, index: number) => <div key={`${row.field}-${index}`}>{row.field}: {displayValue(row.old_value)} → {displayValue(row.new_value)}</div>)}</div></div>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <ShieldCheck className="w-4 h-4 text-indigo-600" /> 附件 / Attachments
          </div>
          <CrmAttachmentGallery attachments={attachments} showAiSummary emptyText="暂无附件" />
          {message.attachments_format_error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">附件数据格式异常，已保留原始 JSON。</div>
          ) : null}
        </div>

        <details className="space-y-3">
          <summary className="cursor-pointer text-sm font-black text-slate-900">
            <span className="inline-flex items-center gap-2"><FileJson className="w-4 h-4 text-indigo-600" /> 原始 JSON</span>
          </summary>
          <div className="mt-3 space-y-3">
            <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">{rawAttachments || '[]'}</pre>
            <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">{rawPayload || '{}'}</pre>
          </div>
        </details>
      </section>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MailCheck, RefreshCcw, Save, UserRoundCheck } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmAttachmentGallery from './attachments/CrmAttachmentGallery';
import CrmTaskBadge from './CrmTaskBadge';

type Props = {
  taskId?: number | null;
  onBack?: () => void;
  onOpenMessage?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onOpenInquiry?: (id: number) => void;
};

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[96px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

function display(value: any, fallback = '-') {
  if (Array.isArray(value)) return value.length ? value.join('、') : fallback;
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseJson(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return {};
  }
}

export default function CrmFatherReviewList({ taskId, onBack, onOpenMessage, onOpenCustomer, onOpenInquiry }: Props) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reply, setReply] = useState('');
  const [salesNote, setSalesNote] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const loadRows = async () => {
    setLoading(true);
    try {
      const ret = await mockService.getFatherReviewTasks(status ? { status } : {});
      setRows(Array.isArray(ret?.rows) ? ret.rows : []);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    const ret = await mockService.getFatherReviewTask(id);
    setDetail(ret);
    setReply(ret?.task?.father_reply_cn || '');
    setSalesNote(ret?.task?.sales_note || '');
  };

  useEffect(() => { loadRows().catch(() => setLoading(false)); }, [status]);
  useEffect(() => { if (taskId) loadDetail(taskId).catch(() => null); }, [taskId]);

  const selectedTask = detail?.task;
  const parsed = useMemo(() => parseJson(detail?.latest_interpretation?.parsed || detail?.latest_interpretation?.parsed_json), [detail]);

  const saveReply = async () => {
    if (!selectedTask?.id || !reply.trim()) return;
    setSaving(true);
    try {
      const ret = await mockService.replyFatherReviewTask(selectedTask.id, { father_reply_cn: reply });
      setDetail((prev: any) => ({ ...prev, task: ret?.task || prev?.task }));
      await loadRows();
    } finally {
      setSaving(false);
    }
  };

  const markHandled = async () => {
    if (!selectedTask?.id) return;
    setSaving(true);
    try {
      const ret = await mockService.markFatherTaskSalesHandled(selectedTask.id, { sales_note: salesNote });
      setDetail((prev: any) => ({ ...prev, task: ret?.task || prev?.task }));
      await loadRows();
    } finally {
      setSaving(false);
    }
  };

  const generateReplyDraft = async () => {
    if (!selectedTask?.id) return;
    setSaving(true);
    setActionMessage('');
    try {
      const ret = await mockService.generateReplyDraftFromFatherTask(selectedTask.id, {
        tone: 'professional',
        reply_channel: detail?.source_message?.source_type === 'email' ? 'email' : 'whatsapp'
      });
      setActionMessage(`已生成客户回复草稿 #${ret?.reply_draft_id}，不会自动发送。`);
    } catch (error: any) {
      setActionMessage(error?.message || '生成客户回复草稿失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><UserRoundCheck className="h-5 w-5 text-indigo-600" /> 父亲确认中心</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">只展示需要老板/父亲确认的问题、附件和 AI 中文上下文。保存中文意见后不会自动发给客户。</p>
        </div>
        <div className="flex items-center gap-2">
          {onBack ? <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> 返回</button> : null}
          <button onClick={loadRows} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> 刷新</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 p-3">
            <select className={`${inputClass} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">待确认</option>
              <option value="done">已回复</option>
              <option value="">全部</option>
            </select>
          </div>
          <div className="max-h-[720px] overflow-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-6 text-sm font-bold text-slate-400">加载中...</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm font-bold text-slate-400">暂无任务</div>
            ) : rows.map((row) => (
              <button key={row.id} onClick={() => loadDetail(Number(row.id))} className={`w-full p-4 text-left hover:bg-slate-50 ${selectedTask?.id === row.id ? 'bg-indigo-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-slate-900">{display(row.customer_display_name, '未匹配客户')}</div>
                  <CrmTaskBadge type={row.status === 'pending' ? 'father_task_pending' : 'father_done_pending_sales'} label={row.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{display(row.country)} · {display(row.inquiry_title)}</div>
                <div className="mt-2 line-clamp-2 text-sm text-slate-700">{display(row.question_cn)}</div>
                <div className="mt-2 text-xs text-slate-400">{display(row.task_type)} · 附件 {Number(row.attachments_count || 0)} · {display(row.created_at)}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          {!selectedTask ? (
            <div className="py-20 text-center text-sm font-bold text-slate-400">选择一个父亲确认任务查看详情</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-slate-900">{display(detail?.customer?.company_name || detail?.customer?.name, '未匹配客户')}</div>
                  <div className="mt-1 text-xs text-slate-500">{display(detail?.customer?.country)} · 优先级 {display(detail?.customer?.priority, 'C')} · {display(detail?.source_message?.source_type)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedTask.source_message_id ? <button onClick={() => onOpenMessage?.(Number(selectedTask.source_message_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">查看消息</button> : null}
                  {selectedTask.customer_id ? <button onClick={() => onOpenCustomer?.(Number(selectedTask.customer_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">查看客户</button> : null}
                  {selectedTask.inquiry_id ? <button onClick={() => onOpenInquiry?.(Number(selectedTask.inquiry_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">查看询盘</button> : null}
                  {selectedTask.status === 'done' ? <button onClick={generateReplyDraft} className="h-8 px-2 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold inline-flex items-center gap-1"><MailCheck className="h-3.5 w-3.5" />生成客户回复草稿</button> : null}
                </div>
              </div>
              {actionMessage ? <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-800">{actionMessage}</div> : null}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  ['产品类型', parsed.product_type || detail?.inquiry?.product_type],
                  ['袋型 / 卷膜', parsed.bag_type || detail?.inquiry?.packaging_type],
                  ['尺寸 / 装量', parsed.size_text || parsed.capacity_text],
                  ['材料', parsed.material_structure],
                  ['厚度', parsed.thickness_text],
                  ['数量', parsed.quantity_text || detail?.inquiry?.quantity],
                  ['印刷颜色', parsed.printing_colors],
                  ['目的地', [parsed.destination_port, parsed.destination_country].filter(Boolean).join(', ')],
                  ['贸易条款', parsed.trade_term || detail?.inquiry?.trade_term_requested],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="text-xs font-bold text-slate-500">{label}</div>
                    <div className="mt-1 text-sm font-black text-slate-800">{display(value)}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-black text-amber-700">技术要求</div><div className="mt-1 text-sm text-slate-700">{display(parsed.technical_requirements)}</div></div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-xs font-black text-red-700">风险提示</div><div className="mt-1 text-sm text-slate-700">{display(parsed.risk_flags)}</div></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-xs font-black text-slate-600">缺失信息</div><div className="mt-1 text-sm text-slate-700">{display(parsed.missing_information)}</div></div>
              </div>

              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                <div className="text-xs font-black text-indigo-700">AI 中文上下文</div>
                <div className="mt-1 text-sm text-slate-700">{display(selectedTask.ai_context_cn || parsed.summary_cn)}</div>
                <div className="mt-3 text-xs font-black text-indigo-700">需要确认</div>
                <div className="mt-1 text-sm font-bold text-slate-800">{display(selectedTask.question_cn)}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-black text-slate-900">客户原始消息</div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">{display(selectedTask.customer_original_text || detail?.source_message?.message_text)}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-black text-slate-900">附件</div>
                <CrmAttachmentGallery attachments={Array.isArray(detail?.attachments) ? detail.attachments : []} showSource emptyText="暂无附件" />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-black text-slate-900">父亲中文回复</div>
                <textarea className={`${areaClass} w-full`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="填写中文意见，例如材料、工艺、核价边界、需要客户确认的问题" />
                <button disabled={saving || !reply.trim()} onClick={saveReply} className="h-9 px-4 rounded-lg bg-indigo-600 text-sm font-black text-white disabled:opacity-50 inline-flex items-center gap-2"><Save className="h-4 w-4" /> 保存回复</button>
              </div>

              {selectedTask.status === 'done' ? (
                <div className="space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                  <div className="text-sm font-black text-slate-900">业务员处理</div>
                  <textarea className={`${areaClass} w-full`} value={salesNote} onChange={(e) => setSalesNote(e.target.value)} placeholder="记录业务员已如何处理父亲意见，不会自动发客户" />
                  <button disabled={saving} onClick={markHandled} className="h-9 px-4 rounded-lg bg-emerald-600 text-sm font-black text-white disabled:opacity-50">标记已处理</button>
                  {selectedTask.sales_handled_at ? <div className="text-xs font-bold text-emerald-700">已处理：{selectedTask.sales_handled_at}</div> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

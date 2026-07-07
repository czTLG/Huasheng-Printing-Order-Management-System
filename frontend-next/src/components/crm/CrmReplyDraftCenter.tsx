import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, Copy, MailCheck, RefreshCcw, Save, SendHorizontal } from 'lucide-react';
import { mockService } from '../../lib/mockService';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[260px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

function display(value: any, fallback = '-') {
  if (Array.isArray(value)) return value.length ? value.join('、') : fallback;
  const text = String(value ?? '').trim();
  return text || fallback;
}

function riskKeywords(text: string) {
  const lower = String(text || '').toLowerCase();
  return ['price', 'lead time', 'compliance', 'fda', 'eu', 'retort', 'otr', 'wvtr', 'cif', 'ddp'].filter((word) => lower.includes(word));
}

export default function CrmReplyDraftCenter() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [draftText, setDraftText] = useState('');
  const [draftCn, setDraftCn] = useState('');
  const [tone, setTone] = useState('professional');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadRows = async () => {
    setLoading(true);
    try {
      const ret = await mockService.listCrmReplyDrafts(status ? { status } : {});
      const nextRows = Array.isArray(ret?.rows) ? ret.rows : [];
      setRows(nextRows);
      if (!selectedId && nextRows.length) setSelectedId(Number(nextRows[0].id));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    const ret = await mockService.getCrmReplyDraft(id);
    const row = ret?.row || null;
    setDetail(row);
    setDraftText(row?.draft_text_en || '');
    setDraftCn(row?.draft_text_cn || row?.draft_summary_cn || '');
    setTone(row?.tone || 'professional');
  };

  useEffect(() => { loadRows().catch(() => setLoading(false)); }, [status]);
  useEffect(() => { if (selectedId) loadDetail(selectedId).catch(() => null); }, [selectedId]);

  const risks = useMemo(() => riskKeywords(draftText), [draftText]);
  const context = detail?.crm_context || {};

  const save = async () => {
    if (!detail?.id) return;
    setMessage('');
    const ret = await mockService.updateCrmReplyDraft(detail.id, { draft_text_en: draftText, draft_text_cn: draftCn, tone, status: detail.status === 'draft' ? 'edited' : detail.status });
    setDetail(ret?.row || detail);
    setMessage('草稿已保存。');
    await loadRows();
  };

  const approve = async () => {
    if (!detail?.id) return;
    const ret = await mockService.approveCrmReplyDraft(detail.id);
    setDetail(ret?.row || detail);
    setMessage('草稿已批准，但不会自动发送客户。');
    await loadRows();
  };

  const markSent = async () => {
    if (!detail?.id) return;
    const ret = await mockService.markCrmReplyDraftSentManually(detail.id);
    setDetail(ret?.row || detail);
    setMessage('已标记为业务员手动发送。系统没有调用任何发送接口。');
    await loadRows();
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(draftText || '');
    setMessage('英文草稿已复制，发送前仍需人工确认。');
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><MailCheck className="h-5 w-5 text-indigo-600" /> 客户回复草稿中心</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">AI/模板草稿仅供内部参考，发送客户前必须人工确认。不得直接作为正式报价或技术承诺。</p>
          </div>
          <div className="flex items-center gap-2">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部状态</option>
              <option value="draft">draft</option>
              <option value="edited">edited</option>
              <option value="approved">approved</option>
              <option value="cancelled">cancelled</option>
              <option value="sent_manually">sent_manually</option>
            </select>
            <button onClick={loadRows} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 flex items-center gap-2"><RefreshCcw className="h-4 w-4" />刷新</button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">草稿列表</div>
          <div className="max-h-[760px] overflow-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-6 text-sm font-bold text-slate-400">加载中...</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm font-bold text-slate-400">暂无回复草稿</div>
            ) : rows.map((row) => (
              <button key={row.id} onClick={() => setSelectedId(Number(row.id))} className={`w-full p-4 text-left hover:bg-slate-50 ${selectedId === Number(row.id) ? 'bg-indigo-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-slate-900">{display(row.customer_display_name, '未匹配客户')}</div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-700">{row.status}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{display(row.reply_channel)} · {display(row.source_type)} · inquiry #{display(row.inquiry_id)}</div>
                <div className="mt-2 line-clamp-2 text-sm text-slate-700">{display(row.draft_summary_cn || row.draft_text_cn)}</div>
                <div className="mt-2 text-xs text-slate-400">{display(row.created_at)}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          {!detail ? (
            <div className="py-24 text-center text-sm font-bold text-slate-400">选择一条草稿查看详情</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-slate-900">回复草稿 #{detail.id}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{display(detail.reply_channel)} · {display(detail.status)} · {display(detail.generation_method)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={save} className="h-9 px-3 rounded-lg bg-indigo-600 text-sm font-black text-white flex items-center gap-2"><Save className="h-4 w-4" />保存修改</button>
                  <button onClick={approve} className="h-9 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />批准草稿</button>
                  <button onClick={copyText} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 flex items-center gap-2"><Copy className="h-4 w-4" />复制英文草稿</button>
                  <button onClick={markSent} className="h-9 px-3 rounded-lg border border-amber-200 bg-amber-50 text-sm font-black text-amber-700 flex items-center gap-2"><SendHorizontal className="h-4 w-4" />标记已手动发送</button>
                </div>
              </div>

              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-800">
                AI/模板草稿仅供内部参考，发送客户前必须人工确认。不得直接作为正式报价或技术承诺。
                {risks.length ? <div className="mt-1 text-xs">风险词：{risks.join('、')}。请确认价格、交期、合规、技术指标或物流费用后再发送。</div> : null}
              </div>
              {context.is_logistics_followup ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">该消息更像物流跟进，不适合直接进入报价助手；建议先补充产品规格后再核价。</div>
              ) : null}
              {message ? <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-800">{message}</div> : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="text-sm font-black text-slate-900 flex items-center gap-2"><Clipboard className="h-4 w-4 text-indigo-600" />上下文</div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 space-y-2">
                    <div><span className="font-black">客户原文：</span>{display(context.message?.text_preview)}</div>
                    <div><span className="font-black">AI 中文摘要：</span>{display(context.interpretation?.summary_cn)}</div>
                    <div><span className="font-black">父亲中文回复：</span>{display(context.father_task?.father_reply_cn)}</div>
                    <div><span className="font-black">询盘规格：</span>{display([context.inquiry?.product_type, context.inquiry?.packaging_type, context.inquiry?.quantity, context.inquiry?.trade_term_requested].filter(Boolean).join(' · '))}</div>
                    <div><span className="font-black">报价助手 draft：</span>{context.costing_draft ? `#${context.costing_draft.id} · ${context.costing_draft.status}` : '-'}</div>
                    <div><span className="font-black">缺失信息：</span>{display(detail.missing_info)}</div>
                    <div><span className="font-black">风险提示：</span>{display(detail.risk_flags)}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-sm font-black text-slate-900">中文摘要</div>
                  <textarea className={`${areaClass} min-h-[180px] w-full`} value={draftCn} onChange={(e) => setDraftCn(e.target.value)} />
                  <select className={inputClass} value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option value="professional">professional</option>
                    <option value="friendly">friendly</option>
                    <option value="firm">firm</option>
                    <option value="technical">technical</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-black text-slate-900">英文草稿（可编辑）</div>
                <textarea className={`${areaClass} w-full font-mono`} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

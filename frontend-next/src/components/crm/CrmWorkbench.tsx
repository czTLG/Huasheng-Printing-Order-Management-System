import React, { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Calculator, MessageSquare, RefreshCcw, UserRoundCheck, Users } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmTaskBadge from './CrmTaskBadge';

type Props = {
  onOpenMessage?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onOpenInquiry?: (id: number) => void;
  onOpenFatherTask?: (id: number) => void;
};

const countCards = [
  ['messages_pending_ai', '新消息待 AI 解读', MessageSquare],
  ['messages_parsed_pending_inquiry', 'AI 已解读待更新询盘', BrainCircuit],
  ['father_tasks_pending', '待父亲确认', UserRoundCheck],
  ['father_tasks_done_pending_sales', '父亲已回复待处理', UserRoundCheck],
  ['costing_drafts_pending_review', '待报价助手复核', Calculator],
  ['quoted_waiting_customer', '已报价待客户回复', MessageSquare],
  ['a_customers_updated', 'A 类客户有新更新', Users],
] as const;

const typeByCountKey: Record<string, string> = {
  messages_pending_ai: 'message_pending_ai',
  messages_parsed_pending_inquiry: 'message_parsed_pending_inquiry',
  father_tasks_pending: 'father_task_pending',
  father_tasks_done_pending_sales: 'father_done_pending_sales',
  costing_drafts_pending_review: 'costing_draft_pending_review',
  quoted_waiting_customer: 'quoted_waiting_customer',
  a_customers_updated: 'a_customer_updated',
};

function safeText(value: any, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export default function CrmWorkbench({ onOpenMessage, onOpenCustomer, onOpenInquiry, onOpenFatherTask }: Props) {
  const [data, setData] = useState<any>({ counts: {}, items: [] });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const ret = await mockService.getCrmWorkbench();
      setData(ret || { counts: {}, items: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const rows = useMemo(() => {
    const list = Array.isArray(data?.items) ? data.items : [];
    return filterType ? list.filter((item: any) => item.type === filterType) : list;
  }, [data, filterType]);

  const parseMessage = async (id: number) => {
    setBusy(`parse-${id}`);
    try {
      await mockService.parseCrmMessage(id);
      await load();
    } finally {
      setBusy('');
    }
  };

  const markSalesHandled = async (id: number) => {
    setBusy(`handled-${id}`);
    try {
      await mockService.markFatherTaskSalesHandled(id, { sales_note: '业务员已在作战台处理父亲回复。' });
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">外贸作战台</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">集中显示新消息、AI 解读、父亲确认、报价复核和已报价跟进，不自动发送客户消息。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="h-4 w-4" /> 刷新
        </button>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {countCards.map(([key, label, Icon]) => {
          const active = filterType === typeByCountKey[key];
          return (
            <button
              key={key}
              onClick={() => setFilterType(active ? '' : typeByCountKey[key])}
              className={`rounded-lg border p-4 text-left ${active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black text-slate-500">{label}</div>
                <Icon className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900">{Number(data?.counts?.[key] || 0)}</div>
            </button>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-black text-slate-900">待处理列表</div>
          <div className="text-xs font-bold text-slate-500">{rows.length} 条</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">客户 / 国家</th>
                <th className="px-4 py-3">待处理类型</th>
                <th className="px-4 py-3">摘要</th>
                <th className="px-4 py-3">询盘 / 阶段</th>
                <th className="px-4 py-3">负责人</th>
                <th className="px-4 py-3">更新时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无待处理事项</td></tr>
              ) : rows.map((item: any, index: number) => (
                <tr key={`${item.type}-${item.message_id || item.father_task_id || item.costing_draft_id || item.customer_id || index}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">
                    <div className="font-black text-slate-900">{safeText(item.customer_display_name, '未匹配客户')}</div>
                    <div className="mt-1 text-xs text-slate-500">{safeText(item.country)} · 优先级 {safeText(item.priority_level, 'C')}</div>
                  </td>
                  <td className="px-4 py-3"><CrmTaskBadge type={item.type} /></td>
                  <td className="px-4 py-3 max-w-[420px]">
                    <div className="line-clamp-2 text-sm font-medium text-slate-700">{safeText(item.summary)}</div>
                    <div className="mt-1 text-xs text-slate-400">{safeText(item.source_type || item.title)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-bold text-slate-800">{safeText(item.inquiry_title)}</div>
                    <div className="mt-1 text-xs text-slate-500">{safeText(item.current_stage)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-700">{safeText(item.owner)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{safeText(item.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {item.message_id ? <button onClick={() => onOpenMessage?.(Number(item.message_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">消息</button> : null}
                      {item.customer_id ? <button onClick={() => onOpenCustomer?.(Number(item.customer_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">客户</button> : null}
                      {item.inquiry_id ? <button onClick={() => onOpenInquiry?.(Number(item.inquiry_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">询盘</button> : null}
                      {item.father_task_id ? <button onClick={() => onOpenFatherTask?.(Number(item.father_task_id))} className="h-8 px-2 rounded border border-slate-200 text-xs font-bold">父亲任务</button> : null}
                      {item.type === 'message_pending_ai' && item.message_id ? (
                        <button disabled={busy === `parse-${item.message_id}`} onClick={() => parseMessage(Number(item.message_id))} className="h-8 px-2 rounded bg-indigo-600 text-xs font-black text-white disabled:opacity-50">AI 解读</button>
                      ) : null}
                      {item.type === 'father_done_pending_sales' && item.father_task_id ? (
                        <button disabled={busy === `handled-${item.father_task_id}`} onClick={() => markSalesHandled(Number(item.father_task_id))} className="h-8 px-2 rounded bg-emerald-600 text-xs font-black text-white disabled:opacity-50">标记已处理</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

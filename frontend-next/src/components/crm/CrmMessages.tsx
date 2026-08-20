import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquare, RefreshCcw, Search } from 'lucide-react';
import { mockService } from '../../lib/mockService';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

type Props = {
  onOpenMessage?: (id: number) => void;
};

function summarizeMessage(text: any) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) return '-';
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function badgeClass(value: string, type: 'ai' | 'workflow') {
  if (type === 'ai') {
    if (value === 'pending') return 'bg-amber-100 text-amber-800';
    if (value === 'analyzed' || value === 'parsed') return 'bg-emerald-100 text-emerald-800';
    return 'bg-rose-100 text-rose-800';
  }
  if (value === 'created_inquiry') return 'bg-indigo-100 text-indigo-800';
  if (value === 'archived') return 'bg-slate-200 text-slate-700';
  if (value === 'no_action') return 'bg-emerald-100 text-emerald-800';
  return 'bg-amber-100 text-amber-800';
}

export default function CrmMessages({ onOpenMessage }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [whatsappControl, setWhatsappControl] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    source_type: 'whatsapp',
    customer: '',
    direction: '',
    ai_status: '',
    date_from: '',
    date_to: '',
    q: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listCrmWhatsappMessages(filters);
      setWhatsappControl(await mockService.getWhatsappControlState().catch(() => null));
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-indigo-600" /> CRM 消息中心</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">统一展示 WhatsApp / Email CRM 消息，只做接收、去重、入库和客户匹配，不发送任何消息。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {whatsappControl && <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
        <div className="font-black">WhatsApp 官方接管：尚未接入</div>
        <div className="mt-1 leading-5">仅允许 Meta WhatsApp Business Platform Cloud API；当前自动化关闭、外发关闭、未接凭据。24 小时窗口外只能使用已批准模板。</div>
        <div className="mt-2 font-bold">人工接管状态：可自动处理 → 请求人工 → 人工处理中 → 自动化暂停 → 已关闭。询价承诺、规格不确定、投诉、付款、合规问题或客户要求人工时必须接管。</div>
      </section>}

      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select className={inputClass} value={filters.source_type} onChange={(e) => setFilters((prev) => ({ ...prev, source_type: e.target.value }))}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="all">全部来源</option>
          </select>
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className={`${inputClass} w-full pl-9`} value={filters.q} onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))} placeholder="消息内容 / 发件人 / 客户" />
          </div>
          <input className={inputClass} value={filters.customer} onChange={(e) => setFilters((prev) => ({ ...prev, customer: e.target.value }))} placeholder="客户" />
          <select className={inputClass} value={filters.direction} onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}>
            <option value="">全部方向</option>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
            <option value="unknown">unknown</option>
          </select>
          <select className={inputClass} value={filters.ai_status} onChange={(e) => setFilters((prev) => ({ ...prev, ai_status: e.target.value }))}>
            <option value="">全部 AI 状态</option>
            <option value="pending">pending</option>
            <option value="analyzed">analyzed</option>
            <option value="failed">failed</option>
          </select>
          <input className={inputClass} type="date" value={filters.date_from} onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))} />
          <input className={inputClass} type="date" value={filters.date_to} onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))} />
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选</button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-black text-slate-900">CRM 消息列表</div>
          <div className="text-xs text-slate-500">{visibleRows.length} 条</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">客户</th>
                <th className="px-4 py-3">方向</th>
                <th className="px-4 py-3">摘要</th>
                <th className="px-4 py-3">收到时间</th>
                <th className="px-4 py-3">附件</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">customer_id</th>
                <th className="px-4 py-3">inquiry_id</th>
                <th className="px-4 py-3">消息</th>
                <th className="px-4 py-3">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无消息</td></tr>
              ) : visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className={`${row.is_new ? 'bg-amber-50/60' : ''} hover:bg-slate-50 cursor-pointer`}
                  onClick={() => onOpenMessage?.(Number(row.id))}
                >
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <div className="font-black text-slate-900">#{row.id}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <div className="font-bold text-slate-700">{row.customer_display_name || row.sender_name || row.sender_contact || '未匹配客户'}</div>
                    <div className="text-slate-400 mt-1">{row.customer_whatsapp || row.customer_phone || row.sender_contact || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.direction || '-'}</td>
                  <td className="px-4 py-3">
                    {row.message_subject ? <div className="text-xs font-black text-slate-900 mb-1 line-clamp-1">{row.message_subject}</div> : null}
                    <div className="text-sm font-medium text-slate-700 line-clamp-2">{summarizeMessage(row.message_text)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <div className="font-bold text-slate-700">{row.received_at || '-'}</div>
                    <div>{row.created_at || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    {Number(row.attachments_count || 0) > 0 ? (
                      <div className="space-y-1">
                        <div className="font-black text-slate-800">{row.attachments_count} 个附件</div>
                        <div className="flex gap-1">
                          {Number(row.has_image || 0) ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-black text-emerald-700">图片</span> : null}
                          {Number(row.has_pdf || 0) ? <span className="rounded bg-rose-100 px-1.5 py-0.5 font-black text-rose-700">PDF</span> : null}
                          {!Number(row.has_image || 0) && !Number(row.has_pdf || 0) ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-black text-slate-600">{row.latest_attachment_type || '文件'}</span> : null}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">无</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-black ${badgeClass(String(row.ai_status || 'pending'), 'ai')}`}>{row.ai_status || 'pending'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-black ${badgeClass(String(row.workflow_status || 'pending'), 'workflow')}`}>{row.workflow_status || 'pending'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.customer_id ? `#${row.customer_id}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.inquiry_id ? `#${row.inquiry_id}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 max-w-[420px]">
                    <div className="font-bold text-slate-900 line-clamp-1">{row.sender_name || row.sender_contact || (row.source_type === 'email' ? 'Email' : 'WhatsApp')}</div>
                    <div className="text-xs text-slate-500 mt-1">点击整行打开详情</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <div>{row.source_type || 'whatsapp'}</div>
                    <div className="mt-1">{row.dedupe_hash ? String(row.dedupe_hash).slice(0, 12) : '-'}</div>
                    {row.is_new ? <div className="mt-1 text-amber-700 font-black">新消息</div> : null}
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

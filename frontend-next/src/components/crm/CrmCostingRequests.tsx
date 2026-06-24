import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, RefreshCcw, Search } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmCostingRequestDetail from './CrmCostingRequestDetail';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmCostingRequests() {
  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState({ q: '', status: '', urgency: '', assigned_to: '' });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listCostingRequests(filters);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const visibleRows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row => [row.costing_request_code, row.customer_display_name, row.inquiry_title, row.product_type, row.assigned_to]
      .some(v => String(v || '').toLowerCase().includes(q)));
  }, [rows, filters.q]);

  if (selectedId) return <CrmCostingRequestDetail requestId={selectedId} onBack={() => { setSelectedId(null); load().catch(() => {}); }} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-600" /> CRM 核价</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">从询盘规格发起的成本核算请求，不改动现有成本计算公式。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className={`${inputClass} w-full pl-9`} value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="搜索客户、询盘、负责人" />
          </div>
          <select className={inputClass} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">全部状态</option><option value="pending">pending</option><option value="in_progress">in_progress</option><option value="completed">completed</option><option value="revision_needed">revision_needed</option><option value="rejected">rejected</option><option value="cancelled">cancelled</option>
          </select>
          <select className={inputClass} value={filters.urgency} onChange={e => setFilters(f => ({ ...f, urgency: e.target.value }))}>
            <option value="">全部紧急度</option><option value="normal">normal</option><option value="urgent">urgent</option>
          </select>
          <input className={inputClass} value={filters.assigned_to} onChange={e => setFilters(f => ({ ...f, assigned_to: e.target.value }))} placeholder="负责人" />
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">请求编号</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">紧急度</th><th className="px-4 py-3">客户</th><th className="px-4 py-3">国家</th><th className="px-4 py-3">询盘</th><th className="px-4 py-3">产品/数量</th><th className="px-4 py-3">贸易条款</th><th className="px-4 py-3">负责人</th><th className="px-4 py-3">截止/创建</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无成本核算请求</td></tr>
              ) : visibleRows.map(row => (
                <tr key={row.id} onClick={() => setSelectedId(Number(row.id))} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-black text-slate-900">{row.costing_request_code}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.status}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.urgency || 'normal'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.customer_display_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.customer_country || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[240px] truncate">{row.inquiry_title || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.product_type || row.bag_type || '-'} / {row.quantity || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.required_quote_terms || row.trade_term_requested || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.assigned_to || row.assigned_to_user_id || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{row.due_at || row.created_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, Ship } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmFreightQuoteDetail from './CrmFreightQuoteDetail';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmFreightQuotes() {
  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState({ q: '', status: '', forwarder_name: '', destination_country: '', destination_port: '', shipping_mode: '', assigned_to: '' });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listFreightQuotes(filters);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const visibleRows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row => [row.freight_quote_code, row.customer_display_name, row.inquiry_title, row.forwarder_name, row.destination_country, row.destination_port]
      .some(v => String(v || '').toLowerCase().includes(q)));
  }, [rows, filters.q]);

  if (selectedId) return <CrmFreightQuoteDetail freightQuoteId={selectedId} onBack={() => { setSelectedId(null); load().catch(() => {}); }} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><Ship className="w-5 h-5 text-indigo-600" /> CRM 物流</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">货代、海运/空运、清关、港杂和本地派送费用逐项记录。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className={`${inputClass} w-full pl-9`} value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="搜索客户、询盘、货代、目的港" />
          </div>
          <select className={inputClass} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">全部状态</option><option value="draft">draft</option><option value="requested">requested</option><option value="received">received</option><option value="selected">selected</option><option value="expired">expired</option><option value="rejected">rejected</option><option value="cancelled">cancelled</option>
          </select>
          <select className={inputClass} value={filters.shipping_mode} onChange={e => setFilters(f => ({ ...f, shipping_mode: e.target.value }))}>
            <option value="">全部运输</option><option value="sea">sea</option><option value="air">air</option><option value="truck">truck</option><option value="express">express</option>
          </select>
          <input className={inputClass} value={filters.forwarder_name} onChange={e => setFilters(f => ({ ...f, forwarder_name: e.target.value }))} placeholder="货代" />
          <input className={inputClass} value={filters.destination_country} onChange={e => setFilters(f => ({ ...f, destination_country: e.target.value }))} placeholder="目的国" />
          <input className={inputClass} value={filters.destination_port} onChange={e => setFilters(f => ({ ...f, destination_port: e.target.value }))} placeholder="目的港" />
          <input className={inputClass} value={filters.assigned_to} onChange={e => setFilters(f => ({ ...f, assigned_to: e.target.value }))} placeholder="负责人" />
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">报价编号</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">客户</th><th className="px-4 py-3">询盘</th><th className="px-4 py-3">产品/数量</th><th className="px-4 py-3">目的地</th><th className="px-4 py-3">方式</th><th className="px-4 py-3">货代</th><th className="px-4 py-3">费用</th><th className="px-4 py-3">有效期/负责人</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无物流报价</td></tr>
              ) : visibleRows.map(row => (
                <tr key={row.id} onClick={() => setSelectedId(Number(row.id))} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-black text-slate-900">{row.freight_quote_code}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.status}</span></td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.customer_display_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[220px] truncate">{row.inquiry_title || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.product_type || '-'} / {row.quantity || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{[row.destination_country, row.destination_port].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.shipping_mode || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.forwarder_name || '-'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.currency || ''} {row.total_freight_cost || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{row.valid_until || '-'} · {row.assigned_to || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


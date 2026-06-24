import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCcw, Search, Star } from 'lucide-react';
import { mockService } from '../../lib/mockService';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const priorityOrder = ['A', 'B', 'C', 'D'];

export default function CrmCustomerPriority() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', priority: '', stage: '', country: '', customer_type: '', pending_costing: '', pending_freight: '', pending_suggestions: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.getCustomerPriority(filters);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const visibleRows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.priority && row.priority !== filters.priority) return false;
      if (filters.stage && row.stage !== filters.stage) return false;
      if (filters.country && !String(row.country || '').toLowerCase().includes(filters.country.toLowerCase())) return false;
      if (filters.customer_type && !String(row.customer_type || '').toLowerCase().includes(filters.customer_type.toLowerCase())) return false;
      if (filters.pending_costing === '1' && Number(row.pending_costing_count || 0) <= 0) return false;
      if (filters.pending_freight === '1' && Number(row.pending_freight_count || 0) <= 0) return false;
      if (filters.pending_suggestions === '1' && Number(row.pending_import_suggestion_count || 0) <= 0) return false;
      if (!q) return true;
      return [
        row.display_name,
        row.country,
        row.customer_type,
        row.stage,
        row.latest_inquiry_title,
        row.next_action,
        row.risk_notes,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, filters]);

  const grouped = useMemo(() => {
    return priorityOrder.map((priority) => ({
      priority,
      rows: visibleRows.filter((row) => String(row.priority || 'D') === priority),
    }));
  }, [visibleRows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><Star className="w-5 h-5 text-amber-500" /> 客户优先级</h2>
          <p className="text-xs font-medium text-slate-500 mt-1">按 A/B/C/D 分组查看重点客户、卡在核价/物流的客户，以及需要马上跟进的客户。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className={`${inputClass} w-full pl-9`} value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="搜索客户、阶段、询盘、风险" />
          </div>
          <select className={inputClass} value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
            <option value="">全部优先级</option>
            {priorityOrder.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className={inputClass} value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))} placeholder="阶段" />
          <input className={inputClass} value={filters.country} onChange={e => setFilters(f => ({ ...f, country: e.target.value }))} placeholder="国家" />
          <input className={inputClass} value={filters.customer_type} onChange={e => setFilters(f => ({ ...f, customer_type: e.target.value }))} placeholder="客户类型" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={filters.pending_costing === '1'} onChange={e => setFilters(f => ({ ...f, pending_costing: e.target.checked ? '1' : '' }))} />
              待核价
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={filters.pending_freight === '1'} onChange={e => setFilters(f => ({ ...f, pending_freight: e.target.checked ? '1' : '' }))} />
              待物流
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={filters.pending_suggestions === '1'} onChange={e => setFilters(f => ({ ...f, pending_suggestions: e.target.checked ? '1' : '' }))} />
              待确认建议
            </label>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm font-bold text-slate-400">加载客户优先级...</div>
      ) : grouped.map((group) => (
        <section key={group.priority} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">Priority {group.priority}</div>
            <div className="text-xs font-bold text-slate-400">{group.rows.length} 客户</div>
          </div>
          {group.rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-400">暂无客户</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
              {group.rows.map((row) => (
                <div key={row.id} className="border border-slate-100 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{row.display_name}</div>
                      <div className="text-xs text-slate-500 mt-1">{[row.country, row.customer_type, row.stage].filter(Boolean).join(' · ') || '未补充客户标签'}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-black">{row.priority || 'D'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                    <div>
                      <div className="font-bold text-slate-700">最新询盘</div>
                      <div>{row.latest_inquiry_title || '-'}</div>
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">待处理</div>
                      <div>核价 {row.pending_costing_count || 0} / 物流 {row.pending_freight_count || 0} / 建议 {row.pending_import_suggestion_count || 0}</div>
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">下一步</div>
                      <div>{row.next_action || row.latest_inquiry_next_action || '-'}</div>
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">下次跟进</div>
                      <div>{row.next_followup_at || row.last_contact_at || '-'}</div>
                    </div>
                  </div>
                  {(row.risk_notes || row.latest_research_risk_flags) && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{row.risk_notes || row.latest_research_risk_flags}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

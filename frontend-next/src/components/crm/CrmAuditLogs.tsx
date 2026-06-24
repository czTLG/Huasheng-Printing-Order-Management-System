import React, { useEffect, useState } from 'react';
import { Clock, RefreshCcw, Search } from 'lucide-react';
import { mockService } from '../../lib/mockService';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmAuditLogs() {
  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState({ resourceType: '', action: '', user: '' });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listCrmAuditLogs(filters);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><Clock className="w-5 h-5 text-indigo-600" /> CRM 日志</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">客户、沟通、询盘、规格和材料层的关键写操作。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <select className={inputClass} value={filters.resourceType} onChange={e => setFilters(f => ({ ...f, resourceType: e.target.value }))}>
            <option value="">全部资源</option>
            <option value="crm_customer">客户</option>
            <option value="crm_communication_log">沟通</option>
            <option value="crm_inquiry">询盘</option>
            <option value="crm_specification">规格</option>
            <option value="crm_specification_layer">材料层</option>
          </select>
          <input className={inputClass} value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} placeholder="action" />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className={`${inputClass} pl-9`} value={filters.user} onChange={e => setFilters(f => ({ ...f, user: e.target.value }))} placeholder="用户" />
          </div>
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">时间</th><th className="px-4 py-3">用户</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">动作</th><th className="px-4 py-3">资源</th><th className="px-4 py-3">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无 CRM 日志</td></tr>
              ) : rows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs font-mono text-slate-500 whitespace-nowrap">{row.created_at}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.user_name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{row.role}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.action}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.resource_type} #{row.resource_id}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[520px] truncate">{row.detail || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


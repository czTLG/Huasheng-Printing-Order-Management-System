import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw, Search, Users } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmCustomerDetail from './CrmCustomerDetail';
import CrmInquiryDetail from './CrmInquiryDetail';
import { CRM_STAGE_OPTIONS, getCrmStageLabel, normalizeCrmStage } from '../../lib/crmStage';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

type Props = {
  onOpenCustomer?: (id: number) => void;
  onOpenInquiry?: (id: number) => void;
};

export default function CrmCustomers({ onOpenCustomer, onOpenInquiry }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('priority');
  const [sortDirection, setSortDirection] = useState('asc');
  const [loading, setLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedInquiryId, setSelectedInquiryId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: '', contact_person: '', email: '', whatsapp: '', country: '', priority: 'C', stage: 'new_unprocessed', next_action: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listCrmCustomers({ q, sortBy, sortDirection });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => [row.company_name, row.display_name, row.contact_person, row.email, row.whatsapp, row.country]
      .some(v => String(v || '').toLowerCase().includes(needle)));
  }, [q, rows]);

  const createCustomer = async () => {
    if (!form.company_name) return;
    setCreating(true);
    try {
      const ret = await mockService.createCrmCustomer(form);
      setForm({ company_name: '', contact_person: '', email: '', whatsapp: '', country: '', priority: 'C', stage: 'new_unprocessed', next_action: '' });
      await load();
      if (ret?.id) setSelectedCustomerId(Number(ret.id));
    } finally {
      setCreating(false);
    }
  };

  if (selectedInquiryId) {
    return <CrmInquiryDetail inquiryId={selectedInquiryId} onBack={() => setSelectedInquiryId(null)} />;
  }
  if (selectedCustomerId) {
    return <CrmCustomerDetail customerId={selectedCustomerId} onBack={() => { setSelectedCustomerId(null); load().catch(() => {}); }} onOpenInquiry={onOpenInquiry || setSelectedInquiryId} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600" /> CRM 客户</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">以客户档案展示、优先级排序、最近询盘和待处理状态为主，手工建档只是辅助能力。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="text-sm font-black text-slate-900">快速建档</div>
        <p className="text-xs text-slate-500">用于补录基础客户。完整调研资料、询盘、核价、物流状态在客户档案页内聚合展示。</p>
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <input className={inputClass} value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="公司名称" />
          <input className={inputClass} value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="联系人" />
          <input className={inputClass} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
          <input className={inputClass} value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="WhatsApp" />
          <input className={inputClass} value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="国家" />
          <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
          <select className={inputClass} value={form.stage} onChange={e => setForm(f => ({ ...f, stage: normalizeCrmStage(e.target.value) }))}>
            {CRM_STAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input className={inputClass} value={form.next_action} onChange={e => setForm(f => ({ ...f, next_action: e.target.value }))} placeholder="下一步" />
          <button disabled={creating} onClick={createCustomer} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-60">
            <Plus className="w-4 h-4" /> 创建
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} className={`${inputClass} w-full pl-9`} placeholder="搜索公司、联系人、邮箱、WhatsApp、国家" />
          </div>
          <select className={inputClass} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="priority">按优先级</option>
            <option value="last_contact_at">按最近联系</option>
            <option value="next_followup_at">按下次跟进</option>
            <option value="latest_inquiry_status">按询盘状态</option>
            <option value="pending_costing">按待核价</option>
            <option value="pending_freight">按待物流</option>
            <option value="updated_at">按最后更新</option>
          </select>
          <select className={inputClass} value={sortDirection} onChange={e => setSortDirection(e.target.value)}>
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">搜索</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">客户</th><th className="px-4 py-3">类型/国家</th><th className="px-4 py-3">优先级</th><th className="px-4 py-3">阶段</th><th className="px-4 py-3">最近询盘</th><th className="px-4 py-3">核价/物流</th><th className="px-4 py-3">下一步</th><th className="px-4 py-3">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无客户</td></tr>
              ) : filteredRows.map(row => (
                <tr key={row.id} onClick={() => {
                  if (onOpenCustomer) onOpenCustomer(Number(row.id));
                  else setSelectedCustomerId(Number(row.id));
                }} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="text-sm font-black text-slate-900">{row.display_name}</div>
                    <div className="text-xs text-slate-400">{row.contact_person || row.contact || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{[row.customer_type, row.country].filter(Boolean).join(' / ') || row.country || '-'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.priority || 'C'}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{getCrmStageLabel(row.stage || 'new_unprocessed')}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.latest_inquiry_title || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{`核价 ${row.latest_costing_status || '-'} / 物流 ${row.latest_freight_status || '-'}`}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[220px] truncate">{row.next_action || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{row.updated_at || row.last_contact_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

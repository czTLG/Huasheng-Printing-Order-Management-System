import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, RefreshCcw, Search } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmInquiryDetail from './CrmInquiryDetail';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

type Props = {
  onOpenInquiry?: (id: number) => void;
};

export default function CrmInquiries({ onOpenInquiry }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedInquiryId, setSelectedInquiryId] = useState<number | null>(null);
  const [form, setForm] = useState({ customer_id: '', inquiry_title: '', product_type: '', packaging_type: '', quantity: '', destination_country: '', priority: 'C' });

  const load = async () => {
    setLoading(true);
    try {
      const [inquiries, customerList] = await Promise.all([
        mockService.listCrmInquiries({ q, status, priority }),
        mockService.listCrmCustomers(),
      ]);
      setRows(Array.isArray(inquiries?.rows) ? inquiries.rows : []);
      setCustomers(Array.isArray(customerList?.rows) ? customerList.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => [row.inquiry_title, row.customer_display_name, row.status, row.priority, row.product_type, row.destination_country]
      .some(v => String(v || '').toLowerCase().includes(needle)));
  }, [q, rows]);

  const createInquiry = async () => {
    if (!form.customer_id || !form.inquiry_title) return;
    const ret = await mockService.createCrmInquiry({ ...form, customer_id: Number(form.customer_id) });
    setForm({ customer_id: '', inquiry_title: '', product_type: '', packaging_type: '', quantity: '', destination_country: '', priority: 'C' });
    await load();
    if (ret?.id) setSelectedInquiryId(Number(ret.id));
  };

  if (selectedInquiryId) {
    return <CrmInquiryDetail inquiryId={selectedInquiryId} onBack={() => { setSelectedInquiryId(null); load().catch(() => {}); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-600" /> CRM 询盘</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">询盘状态、规格版本和材料层入口。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <select className={inputClass} value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
            <option value="">选择客户</option>
            {customers.map((c: any) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
          <input className={inputClass} value={form.inquiry_title} onChange={e => setForm(f => ({ ...f, inquiry_title: e.target.value }))} placeholder="询盘标题" />
          <input className={inputClass} value={form.product_type} onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))} placeholder="产品类型" />
          <input className={inputClass} value={form.packaging_type} onChange={e => setForm(f => ({ ...f, packaging_type: e.target.value }))} placeholder="包装类型" />
          <input className={inputClass} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="数量" />
          <input className={inputClass} value={form.destination_country} onChange={e => setForm(f => ({ ...f, destination_country: e.target.value }))} placeholder="目的国" />
          <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
          <button onClick={createInquiry} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> 创建
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} className={`${inputClass} w-full pl-9`} placeholder="搜索客户、状态、优先级、产品、国家" />
          </div>
          <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">全部状态</option><option value="new">new</option><option value="specifying">specifying</option><option value="costing">costing</option><option value="quoted">quoted</option>
          </select>
          <select className={inputClass} value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">全部优先级</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">询盘</th><th className="px-4 py-3">客户</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">优先级</th><th className="px-4 py-3">产品</th><th className="px-4 py-3">国家</th><th className="px-4 py-3">数量</th><th className="px-4 py-3">下一步</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">暂无询盘</td></tr>
              ) : filteredRows.map(row => (
                <tr key={row.id} onClick={() => {
                  if (onOpenInquiry) onOpenInquiry(Number(row.id));
                  else setSelectedInquiryId(Number(row.id));
                }} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-black text-slate-900">{row.inquiry_title}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.customer_display_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.status || 'new'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.priority || 'C'}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.product_type || row.packaging_type || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.destination_country || row.customer_country || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.quantity || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[220px] truncate">{row.next_action || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

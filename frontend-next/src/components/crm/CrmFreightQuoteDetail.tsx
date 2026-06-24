import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCcw, Save } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  freightQuoteId: number;
  onBack: () => void;
};

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[72px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

const fields = [
  'assigned_to', 'forwarder_name', 'forwarder_contact', 'shipping_mode', 'trade_term',
  'origin_city', 'origin_port', 'destination_country', 'destination_port', 'destination_address',
  'container_type', 'cargo_weight', 'cargo_volume', 'package_type', 'package_count', 'currency',
  'ocean_freight', 'air_freight', 'trucking_origin', 'trucking_destination', 'documentation_fee',
  'thc_origin', 'thc_destination', 'customs_clearance_fee', 'duty_tax_estimate',
  'destination_local_charge', 'delivery_fee', 'insurance_fee', 'other_fee', 'total_freight_cost',
  'valid_from', 'valid_until', 'quote_file_url', 'notes', 'status'
];

export default function CrmFreightQuoteDetail({ freightQuoteId, onBack }: Props) {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const detail = await mockService.getFreightQuote(freightQuoteId);
      setData(detail);
      const quote = detail.freight_quote || {};
      const next: any = {};
      fields.forEach((field) => { next[field] = quote[field] || ''; });
      next.assigned_to_user_id = quote.assigned_to_user_id || '';
      setForm(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [freightQuoteId]);

  const setField = (field: string, value: string) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const save = async (extra: any = {}) => {
    setSaving(true);
    try {
      await mockService.updateFreightQuote(freightQuoteId, { ...form, ...extra });
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载物流报价...</div>;
  if (!data?.freight_quote) return <div className="p-8 text-sm font-bold text-slate-400">物流报价不存在</div>;

  const quote = data.freight_quote;
  const customer = data.customer || {};
  const inquiry = data.inquiry || {};
  const spec = data.current_specification || {};
  const logs = Array.isArray(data.audit_logs) ? data.audit_logs : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回物流列表
        </button>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">{quote.freight_quote_code}</h2>
            <p className="text-xs font-bold text-slate-400 mt-1">{customer.display_name || '-'} · {inquiry.inquiry_title || '-'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={saving} onClick={() => save()} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center gap-2 disabled:opacity-60"><Save className="w-4 h-4" /> 保存修改</button>
            <button disabled={saving} onClick={() => save({ status: 'selected' })} className="h-9 px-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-black">标记 selected</button>
            <button disabled={saving} onClick={() => save({ status: 'expired' })} className="h-9 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-black">标记 expired</button>
            <button disabled={saving} onClick={() => save({ status: 'cancelled' })} className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-sm font-black">取消</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className={inputClass} value={form.assigned_to || ''} onChange={e => setField('assigned_to', e.target.value)} placeholder="负责人" />
          <input className={inputClass} value={form.assigned_to_user_id || ''} onChange={e => setField('assigned_to_user_id', e.target.value)} placeholder="负责人 ID" />
          <select className={inputClass} value={form.status || 'draft'} onChange={e => setField('status', e.target.value)}>
            <option value="draft">draft</option><option value="requested">requested</option><option value="received">received</option><option value="selected">selected</option><option value="expired">expired</option><option value="rejected">rejected</option><option value="cancelled">cancelled</option>
          </select>
          <input className={inputClass} value={form.forwarder_name || ''} onChange={e => setField('forwarder_name', e.target.value)} placeholder="货代名称" />
          <input className={inputClass} value={form.forwarder_contact || ''} onChange={e => setField('forwarder_contact', e.target.value)} placeholder="货代联系人" />
          <select className={inputClass} value={form.shipping_mode || 'sea'} onChange={e => setField('shipping_mode', e.target.value)}>
            <option value="sea">sea</option><option value="air">air</option><option value="truck">truck</option><option value="express">express</option>
          </select>
          <input className={inputClass} value={form.trade_term || ''} onChange={e => setField('trade_term', e.target.value)} placeholder="贸易条款" />
          <input className={inputClass} value={form.currency || ''} onChange={e => setField('currency', e.target.value)} placeholder="币种" />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
          <h3 className="text-sm font-black text-slate-800">客户安全摘要</h3>
          <div className="text-sm font-black text-slate-900">{customer.display_name || '-'}</div>
          <div className="text-sm text-slate-600">{customer.country || '-'} {customer.city || ''}</div>
          {customer.email && <div className="text-sm text-slate-600">Email: {customer.email}</div>}
          {customer.whatsapp && <div className="text-sm text-slate-600">WhatsApp: {customer.whatsapp}</div>}
        </section>
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
          <h3 className="text-sm font-black text-slate-800">询盘摘要</h3>
          <div className="text-sm font-black text-slate-900">{inquiry.inquiry_title || '-'}</div>
          <div className="text-sm text-slate-600">产品：{inquiry.product_type || '-'}</div>
          <div className="text-sm text-slate-600">数量：{inquiry.quantity || '-'}</div>
          <div className="text-sm text-slate-600">目的地：{[inquiry.destination_country, inquiry.destination_port].filter(Boolean).join(' / ') || '-'}</div>
        </section>
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
          <h3 className="text-sm font-black text-slate-800">规格摘要</h3>
          <div className="text-sm text-slate-600">袋型：{spec.bag_type || spec.film_type || '-'}</div>
          <div className="text-sm text-slate-600">尺寸：{[spec.size_width, spec.size_height, spec.gusset_size].filter(Boolean).join(' x ') || '-'}</div>
          <div className="text-sm text-slate-600">材料：{spec.material_structure_text || '-'}</div>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-800">货物与路线</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {['origin_city','origin_port','destination_country','destination_port','destination_address','container_type','cargo_weight','cargo_volume','package_type','package_count','valid_from','valid_until'].map(field => (
            <input key={field} className={inputClass} value={form[field] || ''} onChange={e => setField(field, e.target.value)} placeholder={field} />
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-800">费用明细</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {['ocean_freight','air_freight','trucking_origin','trucking_destination','documentation_fee','thc_origin','thc_destination','customs_clearance_fee','duty_tax_estimate','destination_local_charge','delivery_fee','insurance_fee','other_fee','total_freight_cost'].map(field => (
            <input key={field} className={inputClass} value={form[field] || ''} onChange={e => setField(field, e.target.value)} placeholder={field} />
          ))}
        </div>
        <textarea className={`${areaClass} w-full`} value={form.notes || ''} onChange={e => setField('notes', e.target.value)} placeholder="备注" />
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">修改日志</h3>
        {logs.length === 0 ? <div className="text-sm text-slate-400">暂无日志</div> : logs.map((log: any) => (
          <div key={log.id} className="rounded-lg border border-slate-100 p-3">
            <div className="text-xs font-bold text-slate-400">{log.created_at} · {log.user_name}</div>
            <div className="text-sm font-black text-slate-800 mt-1">{log.action}</div>
            <div className="text-xs text-slate-500 mt-1 truncate">{log.detail || '-'}</div>
          </div>
        ))}
      </section>
    </div>
  );
}


import React, { useEffect, useState } from 'react';
import { ArrowLeft, Edit, MessageSquarePlus, Plus, RefreshCcw, Save } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  customerId: number;
  onBack: () => void;
  onOpenInquiry?: (id: number) => void;
};

const fieldClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[80px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmCustomerDetail({ customerId, onBack, onOpenInquiry }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState<any>({});
  const [commForm, setCommForm] = useState({ channel: 'whatsapp', direction: 'inbound', subject: '', raw_content: '' });
  const [inquiryForm, setInquiryForm] = useState({ inquiry_title: '', product_type: '', packaging_type: '', quantity: '', destination_country: '', priority: 'C', next_action: '' });

  const load = async () => {
    setLoading(true);
    try {
      const detail = await mockService.getCrmCustomer(customerId);
      setData(detail);
      setCustomerForm({
        company_name: detail.customer?.company_name || detail.customer?.display_name || '',
        contact_person: detail.customer?.contact_person || '',
        email: detail.customer?.email || '',
        whatsapp: detail.customer?.whatsapp || '',
        country: detail.customer?.country || '',
        city: detail.customer?.city || '',
        priority: detail.customer?.priority || 'C',
        stage: detail.customer?.stage || 'new',
        next_action: detail.customer?.next_action || '',
        risk_notes: detail.customer?.risk_notes || '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [customerId]);

  const updateField = (key: string, value: string) => setCustomerForm((prev: any) => ({ ...prev, [key]: value }));

  const saveCustomer = async () => {
    setSaving(true);
    try {
      await mockService.updateCrmCustomer(customerId, customerForm);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const addCommunication = async () => {
    if (!commForm.subject && !commForm.raw_content) return;
    setSaving(true);
    try {
      await mockService.createCustomerCommunication(customerId, commForm);
      setCommForm({ channel: 'whatsapp', direction: 'inbound', subject: '', raw_content: '' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const createInquiry = async () => {
    if (!inquiryForm.inquiry_title) return;
    setSaving(true);
    try {
      const ret = await mockService.createCrmInquiry({ ...inquiryForm, customer_id: customerId });
      setInquiryForm({ inquiry_title: '', product_type: '', packaging_type: '', quantity: '', destination_country: '', priority: 'C', next_action: '' });
      await load();
      if (ret?.id && onOpenInquiry) onOpenInquiry(Number(ret.id));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载客户详情...</div>;
  if (!data?.customer) return <div className="p-8 text-sm font-bold text-slate-400">客户不存在</div>;

  const latest = data.latestInquiry;
  const inquiries = Array.isArray(data.inquiries) ? data.inquiries : [];
  const communications = Array.isArray(data.communications) ? data.communications : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回客户列表
        </button>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">{data.customer.display_name}</h2>
          <button disabled={saving} onClick={saveCustomer} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center gap-2 disabled:opacity-60">
            <Save className="w-4 h-4" /> 保存客户
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className={fieldClass} value={customerForm.company_name} onChange={e => updateField('company_name', e.target.value)} placeholder="公司名称" />
          <input className={fieldClass} value={customerForm.contact_person} onChange={e => updateField('contact_person', e.target.value)} placeholder="联系人" />
          <input className={fieldClass} value={customerForm.email} onChange={e => updateField('email', e.target.value)} placeholder="Email" />
          <input className={fieldClass} value={customerForm.whatsapp} onChange={e => updateField('whatsapp', e.target.value)} placeholder="WhatsApp" />
          <input className={fieldClass} value={customerForm.country} onChange={e => updateField('country', e.target.value)} placeholder="国家" />
          <input className={fieldClass} value={customerForm.city} onChange={e => updateField('city', e.target.value)} placeholder="城市" />
          <select className={fieldClass} value={customerForm.priority} onChange={e => updateField('priority', e.target.value)}>
            <option value="A">A 优先</option><option value="B">B 跟进</option><option value="C">C 普通</option>
          </select>
          <select className={fieldClass} value={customerForm.stage} onChange={e => updateField('stage', e.target.value)}>
            <option value="new">新客户</option><option value="qualified">已确认需求</option><option value="quoted">已报价</option><option value="won">已转订单</option><option value="lost">暂停</option>
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea className={areaClass} value={customerForm.next_action} onChange={e => updateField('next_action', e.target.value)} placeholder="下一步动作" />
          <textarea className={areaClass} value={customerForm.risk_notes} onChange={e => updateField('risk_notes', e.target.value)} placeholder="风险备注" />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-black text-slate-800 mb-3">最近一单询盘</h3>
        {latest ? (
          <button onClick={() => onOpenInquiry?.(Number(latest.id))} className="w-full text-left rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 hover:border-indigo-300">
            <div className="text-sm font-black text-indigo-900">{latest.inquiry_title}</div>
            <div className="text-xs font-bold text-indigo-600 mt-1">{latest.status} · {latest.priority} · {latest.quantity || '-'}</div>
          </button>
        ) : <div className="text-sm text-slate-400">暂无询盘</div>}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-indigo-600" /> 添加沟通记录</h3>
          <div className="grid grid-cols-2 gap-3">
            <select className={fieldClass} value={commForm.channel} onChange={e => setCommForm(f => ({ ...f, channel: e.target.value }))}>
              <option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="wechat">微信</option><option value="manual">手动记录</option>
            </select>
            <select className={fieldClass} value={commForm.direction} onChange={e => setCommForm(f => ({ ...f, direction: e.target.value }))}>
              <option value="inbound">客户发来</option><option value="outbound">我方发出</option>
            </select>
          </div>
          <input className={`${fieldClass} w-full`} value={commForm.subject} onChange={e => setCommForm(f => ({ ...f, subject: e.target.value }))} placeholder="主题" />
          <textarea className={`${areaClass} w-full`} value={commForm.raw_content} onChange={e => setCommForm(f => ({ ...f, raw_content: e.target.value }))} placeholder="原始沟通内容" />
          <button disabled={saving} onClick={addCommunication} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black disabled:opacity-60">保存沟通</button>
          <div className="space-y-3 pt-2">
            {communications.map((item: any) => (
              <div key={item.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex justify-between gap-3 text-xs font-bold text-slate-400">
                  <span>{item.channel || 'manual'} · {item.direction || '-'}</span><span>{item.received_at || item.created_at}</span>
                </div>
                <div className="text-sm font-bold text-slate-800 mt-1">{item.subject || '-'}</div>
                <div className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{item.raw_content || '-'}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-600" /> 创建询盘</h3>
          <input className={`${fieldClass} w-full`} value={inquiryForm.inquiry_title} onChange={e => setInquiryForm(f => ({ ...f, inquiry_title: e.target.value }))} placeholder="询盘标题" />
          <div className="grid grid-cols-2 gap-3">
            <input className={fieldClass} value={inquiryForm.product_type} onChange={e => setInquiryForm(f => ({ ...f, product_type: e.target.value }))} placeholder="产品类型" />
            <input className={fieldClass} value={inquiryForm.packaging_type} onChange={e => setInquiryForm(f => ({ ...f, packaging_type: e.target.value }))} placeholder="包装类型" />
            <input className={fieldClass} value={inquiryForm.quantity} onChange={e => setInquiryForm(f => ({ ...f, quantity: e.target.value }))} placeholder="数量" />
            <input className={fieldClass} value={inquiryForm.destination_country} onChange={e => setInquiryForm(f => ({ ...f, destination_country: e.target.value }))} placeholder="目的国" />
          </div>
          <textarea className={`${areaClass} w-full`} value={inquiryForm.next_action} onChange={e => setInquiryForm(f => ({ ...f, next_action: e.target.value }))} placeholder="下一步动作" />
          <button disabled={saving} onClick={createInquiry} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">创建询盘</button>
          <div className="space-y-3 pt-2">
            {inquiries.map((item: any) => (
              <button key={item.id} onClick={() => onOpenInquiry?.(Number(item.id))} className="block w-full text-left border border-slate-100 rounded-lg p-3 hover:border-indigo-200">
                <div className="text-sm font-black text-slate-800">{item.inquiry_title}</div>
                <div className="text-xs text-slate-500 mt-1">{item.status} · {item.priority} · {item.destination_country || '-'}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


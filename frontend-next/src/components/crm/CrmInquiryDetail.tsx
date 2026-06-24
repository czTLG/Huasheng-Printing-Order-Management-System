import React, { useEffect, useState } from 'react';
import { ArrowLeft, Calculator, Copy, Layers, Plus, RefreshCcw, Save, Ship } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  inquiryId: number;
  onBack: () => void;
};

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[76px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmInquiryDetail({ inquiryId, onBack }: Props) {
  const [data, setData] = useState<any>(null);
  const [costingRequests, setCostingRequests] = useState<any[]>([]);
  const [freightQuotes, setFreightQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inquiryForm, setInquiryForm] = useState<any>({});
  const [specForm, setSpecForm] = useState({
    product_type: '', bag_type: '', film_type: '', size_width: '', size_height: '',
    gusset_size: '', thickness_total: '', thickness_unit: 'mic', material_structure_text: '',
    printing_colors: '', zipper_required: false, notes: ''
  });
  const [layerForm, setLayerForm] = useState({ material_name: '', material_code: '', thickness: '', thickness_unit: 'mic', layer_role: '' });
  const [costingForm, setCostingForm] = useState({
    assigned_to: '',
    assigned_to_user_id: '',
    required_quote_terms: 'EXW',
    required_currency: 'RMB',
    required_unit: 'pcs',
    target_margin: '',
    urgency: 'normal',
    due_at: '',
    request_note: '',
  });
  const [freightForm, setFreightForm] = useState({
    assigned_to: '',
    assigned_to_user_id: '',
    forwarder_name: '',
    shipping_mode: 'sea',
    origin_port: '',
    destination_country: '',
    destination_port: '',
    destination_address: '',
    container_type: '',
    cargo_weight: '',
    cargo_volume: '',
    package_type: '',
    package_count: '',
    trade_term: '',
    currency: 'RMB',
    ocean_freight: '',
    trucking_origin: '',
    trucking_destination: '',
    documentation_fee: '',
    thc_origin: '',
    thc_destination: '',
    customs_clearance_fee: '',
    duty_tax_estimate: '',
    destination_local_charge: '',
    delivery_fee: '',
    insurance_fee: '',
    other_fee: '',
    total_freight_cost: '',
    valid_until: '',
    notes: '',
    status: 'draft',
  });

  const load = async () => {
    setLoading(true);
    try {
      const detail = await mockService.getCrmInquiry(inquiryId);
      const [costing, freight] = await Promise.all([
        mockService.listCostingRequests({ inquiry_id: inquiryId }),
        mockService.listInquiryFreightQuotes(inquiryId),
      ]);
      setData(detail);
      setCostingRequests(Array.isArray(costing?.rows) ? costing.rows : []);
      setFreightQuotes(Array.isArray(freight?.rows) ? freight.rows : []);
      setInquiryForm({
        inquiry_title: detail.inquiry?.inquiry_title || '',
        status: detail.inquiry?.status || 'new',
        priority: detail.inquiry?.priority || 'C',
        product_type: detail.inquiry?.product_type || '',
        packaging_type: detail.inquiry?.packaging_type || '',
        quantity: detail.inquiry?.quantity || '',
        destination_country: detail.inquiry?.destination_country || '',
        destination_port: detail.inquiry?.destination_port || '',
        next_action: detail.inquiry?.next_action || '',
        customer_questions: detail.inquiry?.customer_questions || '',
        technical_risks: detail.inquiry?.technical_risks || '',
        commercial_risks: detail.inquiry?.commercial_risks || '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [inquiryId]);

  const saveInquiry = async () => {
    setSaving(true);
    try {
      await mockService.updateCrmInquiry(inquiryId, inquiryForm);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const createSpecification = async () => {
    setSaving(true);
    try {
      await mockService.createInquirySpecification(inquiryId, specForm);
      setSpecForm({ product_type: '', bag_type: '', film_type: '', size_width: '', size_height: '', gusset_size: '', thickness_total: '', thickness_unit: 'mic', material_structure_text: '', printing_colors: '', zipper_required: false, notes: '' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const addLayer = async () => {
    const specId = data?.currentSpecification?.id;
    if (!specId || !layerForm.material_name) return;
    setSaving(true);
    try {
      await mockService.createSpecificationLayer(specId, layerForm);
      setLayerForm({ material_name: '', material_code: '', thickness: '', thickness_unit: 'mic', layer_role: '' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const createCostingRequest = async () => {
    if (!data?.currentSpecification?.id) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '请先创建规格版本' } }));
      return;
    }
    setSaving(true);
    try {
      await mockService.createCostingRequest(inquiryId, {
        ...costingForm,
        assigned_to_user_id: Number(costingForm.assigned_to_user_id || 0) || undefined,
      });
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '成本核算请求已创建' } }));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const createFreightQuote = async () => {
    setSaving(true);
    try {
      await mockService.createFreightQuote(inquiryId, {
        ...freightForm,
        assigned_to_user_id: Number(freightForm.assigned_to_user_id || 0) || undefined,
      });
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '物流报价已创建' } }));
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载询盘详情...</div>;
  if (!data?.inquiry) return <div className="p-8 text-sm font-bold text-slate-400">询盘不存在</div>;

  const current = data.currentSpecification;
  const specifications = Array.isArray(data.specifications) ? data.specifications : [];
  const layers = Array.isArray(current?.layers) ? current.layers : [];
  const latestCosting = costingRequests[0] || null;
  const currentFreight = freightQuotes.find((row: any) => Number(row.is_current) === 1) || freightQuotes[0] || null;
  const costingSummary = [
    `客户简称：${data.inquiry.customer_display_name || '-'}`,
    `询盘编号：${data.inquiry.inquiry_code || data.inquiry.id || '-'}`,
    `产品：${data.inquiry.product_type || current?.product_type || '-'}`,
    `袋型/膜型：${current?.bag_type || current?.film_type || '-'}`,
    `尺寸：${[current?.size_width, current?.size_height, current?.gusset_size].filter(Boolean).join(' x ') || '-'}`,
    `数量：${data.inquiry.quantity || '-'}`,
    `材料结构：${current?.material_structure_text || '-'}`,
    `材料层：${layers.map((l: any) => `${l.layer_order}.${l.material_name}${l.thickness ? ` ${l.thickness}${l.thickness_unit || ''}` : ''}`).join(' / ') || '-'}`,
    `厚度：${current?.thickness_total || '-'} ${current?.thickness_unit || ''}`,
    `印刷颜色：${current?.printing_colors || '-'}`,
    `目的地：${[data.inquiry.destination_country, data.inquiry.destination_port].filter(Boolean).join(' / ') || '-'}`,
    `贸易条款：${data.inquiry.trade_term_requested || costingForm.required_quote_terms || '-'}`,
    `客户目标价：${data.inquiry.customer_target_price || '-'}`,
    `备注：${costingForm.request_note || current?.notes || '-'}`,
  ].join('\n');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回询盘列表
        </button>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">{data.inquiry.inquiry_title}</h2>
            <p className="text-xs font-bold text-slate-400 mt-1">{data.inquiry.customer_display_name || '-'} · #{data.inquiry.id}</p>
          </div>
          <button disabled={saving} onClick={saveInquiry} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center gap-2 disabled:opacity-60">
            <Save className="w-4 h-4" /> 保存询盘
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className={inputClass} value={inquiryForm.inquiry_title} onChange={e => setInquiryForm((f: any) => ({ ...f, inquiry_title: e.target.value }))} placeholder="询盘标题" />
          <select className={inputClass} value={inquiryForm.status} onChange={e => setInquiryForm((f: any) => ({ ...f, status: e.target.value }))}>
            <option value="new">new</option><option value="specifying">specifying</option><option value="costing">costing</option><option value="quoted">quoted</option><option value="won">won</option><option value="lost">lost</option>
          </select>
          <select className={inputClass} value={inquiryForm.priority} onChange={e => setInquiryForm((f: any) => ({ ...f, priority: e.target.value }))}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
          <input className={inputClass} value={inquiryForm.quantity} onChange={e => setInquiryForm((f: any) => ({ ...f, quantity: e.target.value }))} placeholder="数量" />
          <input className={inputClass} value={inquiryForm.product_type} onChange={e => setInquiryForm((f: any) => ({ ...f, product_type: e.target.value }))} placeholder="产品类型" />
          <input className={inputClass} value={inquiryForm.packaging_type} onChange={e => setInquiryForm((f: any) => ({ ...f, packaging_type: e.target.value }))} placeholder="包装类型" />
          <input className={inputClass} value={inquiryForm.destination_country} onChange={e => setInquiryForm((f: any) => ({ ...f, destination_country: e.target.value }))} placeholder="目的国" />
          <input className={inputClass} value={inquiryForm.destination_port} onChange={e => setInquiryForm((f: any) => ({ ...f, destination_port: e.target.value }))} placeholder="目的港" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <textarea className={areaClass} value={inquiryForm.next_action} onChange={e => setInquiryForm((f: any) => ({ ...f, next_action: e.target.value }))} placeholder="下一步动作" />
          <textarea className={areaClass} value={inquiryForm.technical_risks} onChange={e => setInquiryForm((f: any) => ({ ...f, technical_risks: e.target.value }))} placeholder="技术风险" />
          <textarea className={areaClass} value={inquiryForm.commercial_risks} onChange={e => setInquiryForm((f: any) => ({ ...f, commercial_risks: e.target.value }))} placeholder="商务风险" />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><Layers className="w-4 h-4 text-indigo-600" /> 当前规格版本</h3>
        {current ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-indigo-600 text-white text-xs font-black">V{current.version_no}</span>
              <span className="text-sm font-black text-indigo-950">{current.bag_type || current.film_type || current.product_type || '未填写袋型'}</span>
              <span className="text-xs font-bold text-indigo-700">{current.size_width || '-'} x {current.size_height || '-'} {current.gusset_size ? `+ ${current.gusset_size}` : ''}</span>
            </div>
            <div className="text-sm text-indigo-900 mt-2">{current.material_structure_text || '-'}</div>
            <div className="text-xs font-bold text-indigo-700 mt-1">厚度 {current.thickness_total || '-'} {current.thickness_unit || ''} · 印色 {current.printing_colors || '-'}</div>
          </div>
        ) : <div className="text-sm text-slate-400">暂无规格版本</div>}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className={inputClass} value={specForm.product_type} onChange={e => setSpecForm(f => ({ ...f, product_type: e.target.value }))} placeholder="产品类型" />
          <input className={inputClass} value={specForm.bag_type} onChange={e => setSpecForm(f => ({ ...f, bag_type: e.target.value }))} placeholder="袋型" />
          <input className={inputClass} value={specForm.size_width} onChange={e => setSpecForm(f => ({ ...f, size_width: e.target.value }))} placeholder="宽" />
          <input className={inputClass} value={specForm.size_height} onChange={e => setSpecForm(f => ({ ...f, size_height: e.target.value }))} placeholder="高" />
          <input className={inputClass} value={specForm.gusset_size} onChange={e => setSpecForm(f => ({ ...f, gusset_size: e.target.value }))} placeholder="底/风琴" />
          <input className={inputClass} value={specForm.thickness_total} onChange={e => setSpecForm(f => ({ ...f, thickness_total: e.target.value }))} placeholder="总厚度" />
          <input className={inputClass} value={specForm.material_structure_text} onChange={e => setSpecForm(f => ({ ...f, material_structure_text: e.target.value }))} placeholder="材料结构" />
          <input className={inputClass} value={specForm.printing_colors} onChange={e => setSpecForm(f => ({ ...f, printing_colors: e.target.value }))} placeholder="印色" />
          <label className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
            <input type="checkbox" checked={specForm.zipper_required} onChange={e => setSpecForm(f => ({ ...f, zipper_required: e.target.checked }))} /> 拉链
          </label>
          <button disabled={saving} onClick={createSpecification} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-60">
            <Plus className="w-4 h-4" /> 新规格版本
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800">材料层明细</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className={inputClass} value={layerForm.material_name} onChange={e => setLayerForm(f => ({ ...f, material_name: e.target.value }))} placeholder="材料名" />
            <input className={inputClass} value={layerForm.material_code} onChange={e => setLayerForm(f => ({ ...f, material_code: e.target.value }))} placeholder="材料编码" />
            <input className={inputClass} value={layerForm.thickness} onChange={e => setLayerForm(f => ({ ...f, thickness: e.target.value }))} placeholder="厚度" />
            <input className={inputClass} value={layerForm.layer_role} onChange={e => setLayerForm(f => ({ ...f, layer_role: e.target.value }))} placeholder="层用途" />
            <button disabled={saving || !current} onClick={addLayer} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">添加层</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="px-3 py-2">顺序</th><th className="px-3 py-2">材料</th><th className="px-3 py-2">厚度</th><th className="px-3 py-2">用途</th><th className="px-3 py-2">来源</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {layers.map((layer: any) => (
                  <tr key={layer.id}>
                    <td className="px-3 py-2 text-sm">{layer.layer_order}</td>
                    <td className="px-3 py-2 text-sm font-bold">{layer.material_name}</td>
                    <td className="px-3 py-2 text-sm">{layer.thickness} {layer.thickness_unit}</td>
                    <td className="px-3 py-2 text-sm">{layer.layer_role || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{Number(layer.is_system_suggested) ? '系统建议' : '手动'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">规格版本历史</h3>
          {specifications.map((spec: any) => (
            <div key={spec.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-900">V{spec.version_no} · {spec.bag_type || spec.product_type || '-'}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${Number(spec.is_current) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{Number(spec.is_current) ? 'CURRENT' : 'OLD'}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{spec.material_structure_text || '-'} · {spec.created_at || '-'}</div>
            </div>
          ))}
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><Calculator className="w-4 h-4 text-indigo-600" /> 成本核算</h3>
            <p className="text-xs text-slate-500 mt-1">
              当前规格：{current ? `V${current.version_no}` : '无'} · 材料层 {layers.length} 层 · 数量 {data.inquiry.quantity || '-'} · 贸易条款 {data.inquiry.trade_term_requested || costingForm.required_quote_terms}
            </p>
          </div>
          <div className="text-xs font-bold text-slate-500">
            {latestCosting ? `最近请求 ${latestCosting.costing_request_code} · ${latestCosting.status}` : '暂无成本核算请求'}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className={inputClass} value={costingForm.assigned_to} onChange={e => setCostingForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="核价负责人用户名" />
          <input className={inputClass} value={costingForm.assigned_to_user_id} onChange={e => setCostingForm(f => ({ ...f, assigned_to_user_id: e.target.value }))} placeholder="负责人用户 ID" />
          <select className={inputClass} value={costingForm.required_quote_terms} onChange={e => setCostingForm(f => ({ ...f, required_quote_terms: e.target.value }))}>
            <option value="EXW">EXW</option><option value="FOB">FOB</option><option value="CIF">CIF</option><option value="DDP">DDP</option>
          </select>
          <select className={inputClass} value={costingForm.required_currency} onChange={e => setCostingForm(f => ({ ...f, required_currency: e.target.value }))}>
            <option value="RMB">RMB</option><option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
          <input className={inputClass} value={costingForm.required_unit} onChange={e => setCostingForm(f => ({ ...f, required_unit: e.target.value }))} placeholder="单位 pcs/kg/roll" />
          <input className={inputClass} value={costingForm.target_margin} onChange={e => setCostingForm(f => ({ ...f, target_margin: e.target.value }))} placeholder="目标利润" />
          <select className={inputClass} value={costingForm.urgency} onChange={e => setCostingForm(f => ({ ...f, urgency: e.target.value }))}>
            <option value="normal">normal</option><option value="urgent">urgent</option>
          </select>
          <input className={inputClass} value={costingForm.due_at} onChange={e => setCostingForm(f => ({ ...f, due_at: e.target.value }))} placeholder="截止时间" />
        </div>
        <textarea className={`${areaClass} w-full`} value={costingForm.request_note} onChange={e => setCostingForm(f => ({ ...f, request_note: e.target.value }))} placeholder="核价备注" />
        <div className="flex flex-wrap gap-3">
          <button disabled={saving || !current} onClick={createCostingRequest} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">发起成本核算请求</button>
          <button onClick={async () => {
            try {
              await navigator.clipboard.writeText(costingSummary);
              window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '成本核算摘要已复制' } }));
            } catch {
              window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '复制失败，请手动复制摘要' } }));
            }
          }} className="h-9 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-black flex items-center gap-2"><Copy className="w-4 h-4" /> 复制成本核算摘要</button>
        </div>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-4 text-sm text-slate-700">{costingSummary}</pre>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><Ship className="w-4 h-4 text-indigo-600" /> 物流/清关费用</h3>
            <p className="text-xs text-slate-500 mt-1">
              目的地 {data.inquiry.destination_country || '-'} / {data.inquiry.destination_port || '-'} · 数量 {data.inquiry.quantity || '-'} · 贸易条款 {data.inquiry.trade_term_requested || '-'}
            </p>
          </div>
          <div className="text-xs font-bold text-slate-500">
            {currentFreight ? `当前 ${currentFreight.freight_quote_code} · ${currentFreight.status} · ${currentFreight.currency || ''} ${currentFreight.total_freight_cost || '-'}` : '暂无物流报价'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className={inputClass} value={freightForm.assigned_to} onChange={e => setFreightForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="物流负责人用户名" />
          <input className={inputClass} value={freightForm.assigned_to_user_id} onChange={e => setFreightForm(f => ({ ...f, assigned_to_user_id: e.target.value }))} placeholder="负责人用户 ID" />
          <input className={inputClass} value={freightForm.forwarder_name} onChange={e => setFreightForm(f => ({ ...f, forwarder_name: e.target.value }))} placeholder="货代名称" />
          <select className={inputClass} value={freightForm.shipping_mode} onChange={e => setFreightForm(f => ({ ...f, shipping_mode: e.target.value }))}>
            <option value="sea">sea</option><option value="air">air</option><option value="truck">truck</option><option value="express">express</option>
          </select>
          {['origin_port','destination_country','destination_port','destination_address','container_type','cargo_weight','cargo_volume','package_type','package_count','trade_term','currency','ocean_freight','trucking_origin','trucking_destination','documentation_fee','thc_origin','thc_destination','customs_clearance_fee','duty_tax_estimate','destination_local_charge','delivery_fee','insurance_fee','other_fee','total_freight_cost','valid_until'].map(field => (
            <input key={field} className={inputClass} value={(freightForm as any)[field] || ''} onChange={e => setFreightForm(f => ({ ...f, [field]: e.target.value }))} placeholder={field} />
          ))}
          <select className={inputClass} value={freightForm.status} onChange={e => setFreightForm(f => ({ ...f, status: e.target.value }))}>
            <option value="draft">draft</option><option value="requested">requested</option><option value="received">received</option><option value="selected">selected</option>
          </select>
        </div>
        <textarea className={`${areaClass} w-full`} value={freightForm.notes} onChange={e => setFreightForm(f => ({ ...f, notes: e.target.value }))} placeholder="物流/清关备注" />
        <button disabled={saving} onClick={createFreightQuote} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">新增物流报价</button>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-3 py-2">编号</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">货代</th><th className="px-3 py-2">目的地</th><th className="px-3 py-2">方式</th><th className="px-3 py-2">费用</th><th className="px-3 py-2">有效期</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {freightQuotes.map((row: any) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-sm font-black">{row.freight_quote_code}{Number(row.is_current) === 1 ? ' · current' : ''}</td>
                  <td className="px-3 py-2 text-sm">{row.status}</td>
                  <td className="px-3 py-2 text-sm">{row.forwarder_name || '-'}</td>
                  <td className="px-3 py-2 text-sm">{[row.destination_country, row.destination_port].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-3 py-2 text-sm">{row.shipping_mode || '-'}</td>
                  <td className="px-3 py-2 text-sm font-bold">{row.currency || ''} {row.total_freight_cost || '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{row.valid_until || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

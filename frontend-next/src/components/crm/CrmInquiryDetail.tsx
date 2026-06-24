import React, { useEffect, useState } from 'react';
import { ArrowLeft, Layers, Plus, RefreshCcw, Save } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  inquiryId: number;
  onBack: () => void;
};

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[76px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmInquiryDetail({ inquiryId, onBack }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inquiryForm, setInquiryForm] = useState<any>({});
  const [specForm, setSpecForm] = useState({
    product_type: '', bag_type: '', film_type: '', size_width: '', size_height: '',
    gusset_size: '', thickness_total: '', thickness_unit: 'mic', material_structure_text: '',
    printing_colors: '', zipper_required: false, notes: ''
  });
  const [layerForm, setLayerForm] = useState({ material_name: '', material_code: '', thickness: '', thickness_unit: 'mic', layer_role: '' });

  const load = async () => {
    setLoading(true);
    try {
      const detail = await mockService.getCrmInquiry(inquiryId);
      setData(detail);
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

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载询盘详情...</div>;
  if (!data?.inquiry) return <div className="p-8 text-sm font-bold text-slate-400">询盘不存在</div>;

  const current = data.currentSpecification;
  const specifications = Array.isArray(data.specifications) ? data.specifications : [];
  const layers = Array.isArray(current?.layers) ? current.layers : [];

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
    </div>
  );
}


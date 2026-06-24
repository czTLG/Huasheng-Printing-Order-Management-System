import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calculator, CheckCircle2, Copy, RefreshCcw, XCircle } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  requestId: number;
  onBack: () => void;
};

const buttonClass = 'h-9 px-3 rounded-lg text-sm font-black border disabled:opacity-50';

export default function CrmCostingRequestDetail({ requestId, onBack }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await mockService.getCostingRequest(requestId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [requestId]);

  const summary = useMemo(() => {
    if (!data) return '';
    const req = data.costing_request || {};
    const customer = data.customer || {};
    const inquiry = data.inquiry || {};
    const spec = data.current_specification || {};
    const layers = Array.isArray(data.specification_layers) ? data.specification_layers : [];
    return [
      `客户简称：${customer.display_name || '-'}`,
      `询盘编号：${inquiry.inquiry_code || inquiry.id || '-'}`,
      `产品：${inquiry.product_type || spec.product_type || '-'}`,
      `袋型/膜型：${spec.bag_type || spec.film_type || '-'}`,
      `尺寸：${[spec.size_width, spec.size_height, spec.gusset_size].filter(Boolean).join(' x ') || '-'}`,
      `数量：${inquiry.quantity || '-'}`,
      `材料结构：${spec.material_structure_text || '-'}`,
      `材料层：${layers.map((l: any) => `${l.layer_order}.${l.material_name}${l.thickness ? ` ${l.thickness}${l.thickness_unit || ''}` : ''}`).join(' / ') || '-'}`,
      `厚度：${spec.thickness_total || '-'} ${spec.thickness_unit || ''}`,
      `印刷颜色：${spec.printing_colors || '-'}`,
      `目的地：${[inquiry.destination_country, inquiry.destination_port].filter(Boolean).join(' / ') || '-'}`,
      `贸易条款：${req.required_quote_terms || inquiry.trade_term_requested || '-'}`,
      `客户目标价：${req.customer_target_price || inquiry.customer_target_price || '-'}`,
      `备注：${req.request_note || spec.notes || '-'}`,
    ].join('\n');
  }, [data]);

  const updateStatus = async (status: string) => {
    setSaving(true);
    try {
      await mockService.updateCostingRequest(requestId, { status });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '成本核算摘要已复制' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '当前浏览器不允许自动复制，请手动选中文本复制' } }));
    }
  };

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载成本核算请求...</div>;
  if (!data?.costing_request) return <div className="p-8 text-sm font-bold text-slate-400">成本核算请求不存在</div>;

  const req = data.costing_request;
  const customer = data.customer || {};
  const inquiry = data.inquiry || {};
  const spec = data.current_specification || {};
  const layers = Array.isArray(data.specification_layers) ? data.specification_layers : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> 返回核价列表
        </button>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-600" /> {req.costing_request_code}</h2>
            <p className="text-xs font-bold text-slate-400 mt-1">{customer.display_name || '-'} · {inquiry.inquiry_title || '-'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={saving || req.status !== 'pending'} onClick={() => updateStatus('in_progress')} className={`${buttonClass} bg-indigo-50 border-indigo-200 text-indigo-700`}>标记处理中</button>
            <button disabled={saving || req.status !== 'in_progress'} onClick={() => updateStatus('completed')} className={`${buttonClass} bg-emerald-50 border-emerald-200 text-emerald-700`}><CheckCircle2 className="inline w-4 h-4 mr-1" />标记完成</button>
            <button disabled={saving || req.status !== 'in_progress'} onClick={() => updateStatus('revision_needed')} className={`${buttonClass} bg-amber-50 border-amber-200 text-amber-700`}>需要修改</button>
            <button disabled={saving || !['pending', 'in_progress'].includes(req.status)} onClick={() => updateStatus('rejected')} className={`${buttonClass} bg-rose-50 border-rose-200 text-rose-700`}><XCircle className="inline w-4 h-4 mr-1" />驳回</button>
            <button disabled={saving || !['pending', 'in_progress', 'revision_needed'].includes(req.status)} onClick={() => updateStatus('cancelled')} className={`${buttonClass} bg-slate-50 border-slate-200 text-slate-600`}>取消</button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">请求信息</h3>
          {[
            ['状态', req.status], ['紧急度', req.urgency], ['负责人', req.assigned_to || req.assigned_to_user_id],
            ['贸易条款', req.required_quote_terms], ['币种', req.required_currency], ['单位', req.required_unit],
            ['目标利润', req.target_margin], ['截止时间', req.due_at], ['请求备注', req.request_note],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 text-sm"><span className="text-slate-400 font-bold">{k}</span><span className="text-slate-800 font-bold text-right">{v || '-'}</span></div>)}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">客户安全摘要</h3>
          <div className="text-sm font-black text-slate-900">{customer.display_name || '-'}</div>
          <div className="text-sm text-slate-600">{customer.country || '-'} {customer.city || ''}</div>
          {customer.email && <div className="text-sm text-slate-600">Email: {customer.email}</div>}
          {customer.whatsapp && <div className="text-sm text-slate-600">WhatsApp: {customer.whatsapp}</div>}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">询盘摘要</h3>
          <div className="text-sm font-black text-slate-900">{inquiry.inquiry_title || '-'}</div>
          <div className="text-sm text-slate-600">产品：{inquiry.product_type || '-'}</div>
          <div className="text-sm text-slate-600">数量：{inquiry.quantity || '-'}</div>
          <div className="text-sm text-slate-600">目的地：{[inquiry.destination_country, inquiry.destination_port].filter(Boolean).join(' / ') || '-'}</div>
          <div className="text-sm text-slate-600">客户目标价：{inquiry.customer_target_price || req.customer_target_price || '-'}</div>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-800">当前规格</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-slate-400 font-bold">产品</span><div className="font-bold text-slate-900">{spec.product_type || '-'}</div></div>
          <div><span className="text-slate-400 font-bold">袋型/膜型</span><div className="font-bold text-slate-900">{spec.bag_type || spec.film_type || '-'}</div></div>
          <div><span className="text-slate-400 font-bold">尺寸</span><div className="font-bold text-slate-900">{[spec.size_width, spec.size_height, spec.gusset_size].filter(Boolean).join(' x ') || '-'}</div></div>
          <div><span className="text-slate-400 font-bold">厚度</span><div className="font-bold text-slate-900">{spec.thickness_total || '-'} {spec.thickness_unit || ''}</div></div>
        </div>
        <div className="text-sm text-slate-700"><span className="font-bold text-slate-400">材料结构：</span>{spec.material_structure_text || '-'}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-3 py-2">顺序</th><th className="px-3 py-2">材料</th><th className="px-3 py-2">编码</th><th className="px-3 py-2">厚度</th><th className="px-3 py-2">用途</th><th className="px-3 py-2">标记</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {layers.map((layer: any) => (
                <tr key={layer.id}>
                  <td className="px-3 py-2 text-sm">{layer.layer_order}</td>
                  <td className="px-3 py-2 text-sm font-bold">{layer.material_name}</td>
                  <td className="px-3 py-2 text-sm">{layer.material_code || '-'}</td>
                  <td className="px-3 py-2 text-sm">{layer.thickness || '-'} {layer.thickness_unit || ''}</td>
                  <td className="px-3 py-2 text-sm">{layer.layer_role || '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{Number(layer.is_system_suggested) ? '系统建议' : Number(layer.is_customer_required) ? '客户指定' : '手动'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">成本核算输入摘要</h3>
          <button onClick={copySummary} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-black flex items-center gap-2"><Copy className="w-4 h-4" /> 复制摘要</button>
        </div>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-4 text-sm text-slate-700">{summary}</pre>
      </section>
    </div>
  );
}


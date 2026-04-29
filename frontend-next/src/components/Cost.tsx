import React, { useState, useEffect } from 'react';
import { 
  Calculator, RotateCcw, Save, Download, FileText, Settings, 
  ChevronRight, CheckCircle2, AlertCircle, History, BookOpen
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { mockService } from '../lib/mockService';

const TEMPLATES = [
  { id: 'stand_zipper_bag', name: '自立拉链袋' },
  { id: 'three_side_seal', name: '三边封' },
  { id: 'eight_side_seal', name: '八边封' },
  { id: 'back_seal', name: '背封袋' },
  { id: 'side_seal', name: '侧边封袋' },
  { id: 'four_side_seal', name: '四边封袋' },
  { id: 'irregular_zipper_bag', name: '自立异形拉链袋' },
  { id: 'auto_bag', name: '自动包 (卷膜)' },
];

const MAT_DICT: Record<string, { density: number, price: number }> = {
  'PET': { density: 1.38, price: 9.8 },
  'BOPP': { density: 0.91, price: 9.2 },
  'CPP': { density: 0.90, price: 9.3 },
  'PE': { density: 0.92, price: 9.0 },
  'NY': { density: 1.14, price: 12.5 },
  'AL': { density: 2.7, price: 18.0 },
  'MOPP': { density: 0.90, price: 11.0 },
  'VMCPP': { density: 1.05, price: 13.5 },
  'VMPET': { density: 1.40, price: 14.0 },
  '纸': { density: 0.80, price: 7.6 }
};

type MaterialLayer = {
  enabled: boolean;
  name: string;
  spec: string;
  thickness: number | '';
  density: number | '';
  width: number | '';
  length: number | '';
  loss_rate: number | '';
  unit_price: number | '';
  _weight?: number;
  _amount?: number;
};

type CostFormData = {
  cost_template: string;
  quote_customer: string;
  quote_product_name: string;
  quote_qty: number | '';

  bag_width: number | '';
  bag_height: number | '';
  side_gusset: number | '';
  bottom_gusset: number | '';
  top_margin: number | '';
  bottom_margin: number | '';
  zipper_length: number | '';
  zipper_width: number | '';
  hole_size: number | '';
  edge_width: number | '';
  one_row_count: number | '';
  print_repeat: number | '';
  
  auto_roll_width: number | '';
  auto_cut_length: number | '';
  auto_speed_loss: number | '';
  auto_cursor_gap: number | '';
  auto_punch_fee: number | '';
  auto_slit_fee: number | '';

  materials: MaterialLayer[];

  zipper_price: number | '';
  zipper_cost_mode: '按条' | '按米';
  valve_price: number | '';
  spout_price: number | '';
  print_plate_fee: number | '';
  print_fee: number | '';
  lamination_fee: number | '';
  bagging_fee: number | '';
  labor_fee: number | '';
  packing_fee: number | '';
  shipping_fee: number | '';
  misc_fee: number | '';

  overall_loss_rate: number | '';
  profit_rate: number | '';
  quote_round_mode: '保留2位' | '保留4位' | '角分取整';
};

const DEFAULT_MATERIALS: MaterialLayer[] = [
  { enabled: true, name: '', spec: '', thickness: '', density: '', width: '', length: '', loss_rate: 0, unit_price: '' },
  { enabled: true, name: '', spec: '', thickness: '', density: '', width: '', length: '', loss_rate: 0, unit_price: '' },
  { enabled: false, name: '', spec: '', thickness: '', density: '', width: '', length: '', loss_rate: 0, unit_price: '' },
  { enabled: false, name: '', spec: '', thickness: '', density: '', width: '', length: '', loss_rate: 0, unit_price: '' },
];

const DEFAULT_FORM: CostFormData = {
  cost_template: 'stand_zipper_bag',
  quote_customer: '',
  quote_product_name: '',
  quote_qty: 10000,
  bag_width: '', bag_height: '', side_gusset: '', bottom_gusset: '',
  top_margin: '', bottom_margin: '', zipper_length: '', zipper_width: '',
  hole_size: '', edge_width: '', one_row_count: 1, print_repeat: '',
  auto_roll_width: '', auto_cut_length: '', auto_speed_loss: 0, auto_cursor_gap: 0,
  auto_punch_fee: 0, auto_slit_fee: 0,
  materials: [...DEFAULT_MATERIALS.map(m => ({...m}))],
  zipper_price: 0, zipper_cost_mode: '按条', valve_price: 0, spout_price: 0,
  print_plate_fee: 0, print_fee: 0, lamination_fee: 0, bagging_fee: 0, labor_fee: 0,
  packing_fee: 0, shipping_fee: 0, misc_fee: 0,
  overall_loss_rate: 2, profit_rate: 8, quote_round_mode: '保留4位'
};

export default function Cost() {
  const [formData, setFormData] = useState<CostFormData>({ ...DEFAULT_FORM });
  const [result, setResult] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [traceLines, setTraceLines] = useState<string[]>([]);
  const [materialDict, setMaterialDict] = useState(MAT_DICT);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadResources();
  }, []);

  const loadResources = async () => {
    try {
      const [prices, history] = await Promise.all([
        mockService.getMaterialPrices(),
        mockService.getCostSnapshots('history')
      ]);
      const nextDict = { ...MAT_DICT } as Record<string, { density: number; price: number }>;
      (prices || []).forEach((row: any) => {
        const code = String(row.code || '').trim();
        if (!code) return;
        nextDict[code] = { density: Number(row.prop || 0), price: Number(row.price || 0) / 1000 };
      });
      setMaterialDict(nextDict);
      setHistoryItems(Array.isArray(history) ? history.slice(0, 12) : []);
    } catch (err: any) {
      setError(err?.message || '成本资源加载失败');
    }
  };

  // Update handlers
  const updateField = (key: keyof CostFormData, val: any) => {
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  const updateMaterial = (idx: number, key: keyof MaterialLayer, val: any) => {
    const arr = [...formData.materials];
    arr[idx] = { ...arr[idx], [key]: val };
    
    // Auto-fill from dictionary
    if (key === 'name' && typeof val === 'string' && materialDict[val]) {
      arr[idx].density = materialDict[val].density;
      arr[idx].unit_price = materialDict[val].price;
      arr[idx].spec = val;
    }
    
    setFormData(prev => ({ ...prev, materials: arr }));
  };

  const loadSample = () => {
    const sample = { ...DEFAULT_FORM, cost_template: formData.cost_template };
    if (formData.cost_template === 'stand_zipper_bag') {
      sample.bag_width = 18; sample.bag_height = 26; sample.bottom_gusset = 4;
      sample.materials[0] = { enabled: true, name: 'PET', spec: 'PET12', thickness: 12, density: 1.4, width: 380, length: '', loss_rate: 2, unit_price: 9.8 };
      sample.materials[1] = { enabled: true, name: 'AL', spec: 'AL7', thickness: 7, density: 2.7, width: 380, length: '', loss_rate: 3, unit_price: 28 };
      sample.materials[2] = { enabled: true, name: 'PE', spec: 'PE60', thickness: 60, density: 0.92, width: 380, length: '', loss_rate: 2, unit_price: 9.0 };
      sample.zipper_price = 0.15; sample.bagging_fee = 20; sample.print_fee = 15;
    } else if (formData.cost_template === 'auto_bag') {
      sample.auto_roll_width = 32; sample.auto_cut_length = 150;
      sample.materials[0] = { enabled: true, name: 'PET', spec: 'PET12', thickness: 12, density: 1.4, width: 320, length: '', loss_rate: 2, unit_price: 9.8 };
      sample.materials[1] = { enabled: true, name: 'PE', spec: 'PE60', thickness: 60, density: 0.92, width: 320, length: '', loss_rate: 2, unit_price: 9.0 };
      sample.print_fee = 10;
    }
    setFormData(sample);
  };

  const buildPayload = () => {
    const costType = formData.cost_template;
    const ba_di = costType === 'three_side_seal' ? 0 : Number(formData.bottom_gusset || 0);
    const ba_ce = ['back_seal', 'side_seal', 'four_side_seal'].includes(costType)
      ? Number(formData.side_gusset || 0)
      : (costType === 'eight_side_seal' ? ba_di : 0);
    const materials = formData.materials;
    const thick = materials.map(m => Number(m.thickness || 0));
    const proportion = materials.map(m => Number(m.density || 0));
    const price = materials.map(m => Number(m.unit_price || 0) * 1000);
    return {
      costType,
      input: {
        ba_chang: Number(formData.bag_height || 0),
        ba_kuang: Number(formData.bag_width || 0),
        ba_ce,
        ba_di,
        irregular_has_bottom: Number(formData.bottom_gusset || 0) > 0 ? 1 : 0,
        thick,
        price,
        proportion,
        jgf: Number(formData.print_fee || 0) + Number(formData.lamination_fee || 0) + Number(formData.bagging_fee || 0),
        zxyf: Number(formData.shipping_fee || 0),
        sh: Number(formData.overall_loss_rate || 0) / 100,
        lr: Number(formData.profit_rate || 0) / 100,
        lldj: Number(formData.zipper_price || 0),
        ba_zdf: 0,
        z_mian_2: 0,
        z_mian_3: 0,
        z_mian_4: 0,
        chang: Number(formData.bag_height || 0),
        kuang: Number(formData.bag_width || 0),
        t1: thick[0] || 0,
        t2: thick[1] || 0,
        t3: thick[2] || 0,
        t4: thick[3] || 0,
        p1: proportion[0] || 0,
        p2: proportion[1] || 0,
        p3: proportion[2] || 0,
        p4: proportion[3] || 0,
        pr1: price[0] || 0,
        pr2: price[1] || 0,
        pr3: price[2] || 0,
        pr4: price[3] || 0,
        mat1: materials[0]?.name || '',
        mat2: materials[1]?.name || '',
        mat3: materials[2]?.name || '',
        mat4: materials[3]?.name || '',
        fqfy: Number(formData.auto_slit_fee || 0),
        yf: Number(formData.shipping_fee || 0),
        zt: 0,
        btzt: 0,
        roll_w: Number(formData.auto_roll_width || 0),
        roll_l: Number(formData.auto_cut_length || 0),
      }
    };
  };

  const calculate = async () => {
    setIsCalculating(true);
    setError('');
    try {
      const payload = buildPayload();
      const response = await mockService.calculateCost(payload.costType, payload.input, true);
      const raw = response?.result || {};
      const qty = Math.max(1, Number(formData.quote_qty || 1));
      const totalCost = Number(raw.totalCost ?? raw.costBeforeProfit ?? 0);
      const quoteUnitPrice = Number(raw.finalQuote ?? 0);
      const quoteTotalPrice = quoteUnitPrice * qty;
      const totalMaterialCost = Number(raw.materialCost ?? 0);
      const totalProcessCost = Number(raw.processCost ?? raw.baseCost ?? 0) - totalMaterialCost;
      const totalAccessoryCost = Number(raw.zipperCost ?? 0);
      const unitCost = Number(raw.unitCost ?? (totalCost / qty));
      setResult({
        raw,
        costType: payload.costType,
        input: payload.input,
        totalMaterialCost,
        totalProcessCost: Math.max(0, totalProcessCost),
        totalAccessoryCost,
        totalCost,
        unitCost,
        quoteUnitPrice,
        quoteTotalPrice,
        grossProfit: quoteTotalPrice - totalCost,
        grossProfitRate: Number(formData.profit_rate || 0),
      });
      setTraceLines(Array.isArray(response?.trace?.steps)
        ? response.trace.steps.map((step: any) => `${step.key}: ${step.formula} = ${JSON.stringify(step.value)}`)
        : []);
      await mockService.saveCostSnapshot({ kind: 'history', costType: payload.costType, input: payload.input, result: raw });
      const history = await mockService.getCostSnapshots('history');
      setHistoryItems(Array.isArray(history) ? history.slice(0, 12) : []);
    } catch (err: any) {
      setError(err?.message || '核算失败');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleSaveHistory = async () => {
    if (!result) return;
    const payload = buildPayload();
    await mockService.saveCostSnapshot({
      kind: 'case',
      name: `${TEMPLATES.find(t => t.id === formData.cost_template)?.name || formData.cost_template}-${formData.quote_customer || '未命名'}`,
      costType: payload.costType,
      input: payload.input,
      result: result.raw || result,
    });
    const history = await mockService.getCostSnapshots('history');
    setHistoryItems(Array.isArray(history) ? history.slice(0, 12) : []);
  };

  const applyHistory = (item: any) => {
    if (!item?.input) return;
    const input = item.input;
    const materials = [0, 1, 2, 3].map(idx => ({
      enabled: true,
      name: input[`mat${idx + 1}`] || '',
      spec: input[`mat${idx + 1}`] || '',
      thickness: input.thick?.[idx] || input[`t${idx + 1}`] || '',
      density: input.proportion?.[idx] || input[`p${idx + 1}`] || '',
      width: '' as '',
      length: '' as '',
      loss_rate: '' as '',
      unit_price: (input.price?.[idx] || input[`pr${idx + 1}`] || 0) ? Number(input.price?.[idx] || input[`pr${idx + 1}`] || 0) / 1000 : ('' as ''),
      _weight: undefined,
      _amount: undefined,
    }));
    setFormData(prev => ({
      ...prev,
      cost_template: item.costType || prev.cost_template,
      bag_height: input.ba_chang || '',
      bag_width: input.ba_kuang || '',
      side_gusset: input.ba_ce || '',
      bottom_gusset: input.ba_di || '',
      auto_roll_width: input.roll_w || '',
      auto_cut_length: input.roll_l || '',
      overall_loss_rate: Number(input.sh || 0) * 100,
      profit_rate: Number(input.lr || 0) * 100,
      shipping_fee: input.zxyf || input.yf || '',
      zipper_price: input.lldj || '',
      print_fee: input.jgf || '',
      materials,
    }));
  };

  const FormField = ({ label, tip, value, onChange, suffix, prefix, placeholder, type = "number", required = false, inputClass = "" }: any) => (
    <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <b className="text-[12px] font-black text-slate-700">{label}</b>
        {required && <span className="text-rose-500 text-[10px]">*</span>}
      </div>
      {tip && <span className="text-[10px] text-slate-400 font-medium">{tip}</span>}
      <div className="relative flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-sm">
        {prefix && <span className="pl-2.5 text-slate-400 text-[10px] font-black">{prefix}</span>}
        <input type={type} value={value} onChange={onChange} placeholder={placeholder || ''}
          className={`flex-1 w-full h-[34px] px-3 text-[13px] font-bold text-slate-900 bg-transparent outline-none placeholder:text-slate-300 ${inputClass}`} />
        {suffix && <span className="pr-2.5 text-slate-400 text-[10px] font-black uppercase tracking-widest">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 bg-slate-50 min-h-screen">
      
      {/* 顶部动作条 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full md:flex-1">
            <div className="flex flex-col gap-1.5">
               <label className="text-[11px] font-black text-slate-500 tracking-wider">袋型模板选择 *</label>
               <select value={formData.cost_template} onChange={e=>updateField('cost_template', e.target.value)} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold text-indigo-700 outline-none focus:border-indigo-500">
                  {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
               </select>
               <div className="flex flex-wrap items-center gap-2 mt-2">
                  {TEMPLATES.map(t => (
                    <button key={t.id}
                      onClick={() => updateField('cost_template', t.id)}
                      className={cn(
                        "px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-colors",
                        formData.cost_template === t.id
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
                      )}
                    >{t.name}</button>
                  ))}
               </div>
            </div>
            <div className="flex flex-col gap-1.5">
               <label className="text-[11px] font-black text-slate-500 tracking-wider">客户名称</label>
               <input value={formData.quote_customer} onChange={e=>updateField('quote_customer', e.target.value)} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none" placeholder="选填" />
            </div>
            <div className="flex flex-col gap-1.5">
               <label className="text-[11px] font-black text-slate-500 tracking-wider">核算品名</label>
               <input value={formData.quote_product_name} onChange={e=>updateField('quote_product_name', e.target.value)} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold outline-none" placeholder="选填" />
            </div>
            <div className="flex flex-col gap-1.5">
               <label className="text-[11px] font-black text-slate-500 tracking-wider">订单数量 *</label>
               <input type="number" value={formData.quote_qty} onChange={e=>updateField('quote_qty', Number(e.target.value))} className="h-10 px-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[13px] font-bold text-emerald-700 outline-none" />
            </div>
         </div>
         <div className="flex flex-wrap items-center gap-3 w-full md:w-auto pt-2 md:pt-0">
            <button onClick={loadSample} className="h-10 px-4 text-[12px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors">加载样例</button>
            <button onClick={()=>setFormData({...DEFAULT_FORM})} className="h-10 px-4 text-[12px] font-black text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">重置</button>
            <button onClick={calculate} disabled={isCalculating} className="h-10 px-6 text-[13px] font-black text-white bg-indigo-600 rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2">
               {isCalculating ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} 开始核算
            </button>
            <button onClick={handleSaveHistory} disabled={!result} className="h-10 px-4 text-[12px] font-black text-white bg-slate-800 rounded-xl hover:bg-slate-900 transition-colors flex items-center gap-1 disabled:opacity-50"><Save className="w-4 h-4"/>保存样例</button>
            <button
              onClick={async () => {
                if (!result) return;
                const blob = await mockService.exportCost('xls', { costType: result.costType, input: result.input, result: result.raw || result });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              }}
              disabled={!result}
              className="h-10 px-4 text-[12px] font-black text-indigo-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1 disabled:opacity-50"
            ><Download className="w-4 h-4"/>导出 Excel</button>
            <button
              onClick={async () => {
                if (!result) return;
                const blob = await mockService.exportCost('pdf', { costType: result.costType, input: result.input, result: result.raw || result });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              }}
              disabled={!result}
              className="h-10 px-4 text-[12px] font-black text-indigo-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1 disabled:opacity-50"
            ><FileText className="w-4 h-4"/>导出 PDF</button>
            <button
              onClick={async () => {
                if (!result) return;
                const to = prompt('收件人邮箱，多个用分号分隔');
                if (!to) return;
                const cc = prompt('抄送邮箱，可空') || '';
                await mockService.sendCostEmail({ costType: result.costType, input: result.input, result: result.raw || result, to, cc });
                window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '成本核算邮件已提交发送' } }));
              }}
              disabled={!result}
              className="h-10 px-4 text-[12px] font-black text-indigo-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1 disabled:opacity-50"
            ><BookOpen className="w-4 h-4"/>发送邮件</button>
         </div>
      </div>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm font-bold">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
         <div className="xl:col-span-8 flex flex-col gap-8">
            
            {/* 基础尺寸参数区 */}
            <div className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200">
               <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                 <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />基础尺寸参数区 (单位: cm)
               </h3>
               {formData.cost_template !== 'auto_bag' ? (
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                    <FormField label="袋宽" tip="袋子展开宽度" value={formData.bag_width} onChange={(e:any)=>updateField('bag_width', e.target.value)} suffix="cm" required />
                    <FormField label="袋高" tip="袋子高度/长度" value={formData.bag_height} onChange={(e:any)=>updateField('bag_height', e.target.value)} suffix="cm" required />

                    {(formData.cost_template === 'stand_zipper_bag' || formData.cost_template === 'eight_side_seal' || formData.cost_template === 'side_seal' || formData.cost_template === 'four_side_seal') && (
                      <FormField label="底边 / 底插" tip="袋子底部宽度" value={formData.bottom_gusset} onChange={(e:any)=>updateField('bottom_gusset', e.target.value)} suffix="cm" />
                    )}
                    {(formData.cost_template === 'eight_side_seal' || formData.cost_template === 'back_seal' || formData.cost_template === 'side_seal' || formData.cost_template === 'four_side_seal') && (
                      <FormField label="侧边 / 侧风琴" tip="袋子侧边宽度" value={formData.side_gusset} onChange={(e:any)=>updateField('side_gusset', e.target.value)} suffix="cm" />
                    )}

                    <FormField label="上边" tip="封口上方留边" value={formData.top_margin} onChange={(e:any)=>updateField('top_margin', e.target.value)} suffix="cm" />
                    <FormField label="下边" tip="封口下方留边" value={formData.bottom_margin} onChange={(e:any)=>updateField('bottom_margin', e.target.value)} suffix="cm" />

                    {formData.cost_template === 'stand_zipper_bag' && (
                       <>
                         <FormField label="拉链长度" tip="拉链有效长度" value={formData.zipper_length} onChange={(e:any)=>updateField('zipper_length', e.target.value)} suffix="cm" />
                         <FormField label="拉链宽度" tip="拉链带宽" value={formData.zipper_width} onChange={(e:any)=>updateField('zipper_width', e.target.value)} suffix="cm" />
                       </>
                    )}
                    <FormField label="封边宽度" tip="热封边宽度" value={formData.edge_width} onChange={(e:any)=>updateField('edge_width', e.target.value)} suffix="cm" />
                    <FormField label="挂孔尺寸" tip="挂孔直径/边长" value={formData.hole_size} onChange={(e:any)=>updateField('hole_size', e.target.value)} suffix="cm" />
                    <FormField label="一出几" tip="每版出几个" value={formData.one_row_count} onChange={(e:any)=>updateField('one_row_count', e.target.value)} suffix="出" />
                    <FormField label="印刷周长" tip="印刷辊筒周长" value={formData.print_repeat} onChange={(e:any)=>updateField('print_repeat', e.target.value)} suffix="cm" />
                 </div>
               ) : (
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                    <FormField label="卷膜宽度" tip="薄膜卷宽度" value={formData.auto_roll_width} onChange={(e:any)=>updateField('auto_roll_width', e.target.value)} suffix="cm" required />
                    <FormField label="单包长度" tip="每段裁切长度" value={formData.auto_cut_length} onChange={(e:any)=>updateField('auto_cut_length', e.target.value)} suffix="m" required />
                    <FormField label="机速损耗" tip="机器速度损耗率" value={formData.auto_speed_loss} onChange={(e:any)=>updateField('auto_speed_loss', e.target.value)} suffix="%" />
                    <FormField label="光标间距" tip="色标间距" value={formData.auto_cursor_gap} onChange={(e:any)=>updateField('auto_cursor_gap', e.target.value)} suffix="cm" />
                    <FormField label="打孔费用" tip="每千个打孔费" value={formData.auto_punch_fee} onChange={(e:any)=>updateField('auto_punch_fee', e.target.value)} suffix="元" />
                    <FormField label="分切费用" tip="分切加工费" value={formData.auto_slit_fee} onChange={(e:any)=>updateField('auto_slit_fee', e.target.value)} suffix="元" />
                 </div>
               )}
            </div>

            {/* 材料层参数表 */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
               <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                 <div className="w-1.5 h-4 bg-blue-500 rounded-full" />材料层参数表 (核心)
               </h3>
               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500 border-y border-slate-200">
                       <th className="py-3 px-3">启用</th>
                       <th className="py-3 px-3 w-32">材料名称</th>
                       <th className="py-3 px-3">规格</th>
                       <th className="py-3 px-3">厚(um)</th>
                       <th className="py-3 px-3">比重</th>
                       <th className="py-3 px-3">宽(mm)</th>
                       <th className="py-3 px-3">长(m)</th>
                       <th className="py-3 px-3 shrink-0">损耗(%)</th>
                       <th className="py-3 px-3">单价(元/kg)</th>
                       <th className="py-3 px-3 bg-blue-50/50">量(kg)</th>
                       <th className="py-3 px-3 bg-blue-50/50">金额(元)</th>
                     </tr>
                   </thead>
                   <tbody>
                     {formData.materials.map((m, i) => (
                       <tr key={i} className={cn("border-b border-slate-100 group transition-colors", m.enabled ? "bg-white hover:bg-slate-50" : "bg-slate-50/50 opacity-60")}>
                         <td className="py-2.5 px-3">
                           <input type="checkbox" checked={m.enabled} onChange={e=>updateMaterial(i, 'enabled', e.target.checked)} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
                         </td>
                         <td className="py-2.5 px-3">
                           <select disabled={!m.enabled} value={m.name} onChange={e=>updateMaterial(i, 'name', e.target.value)} className="w-full h-8 text-xs font-bold border rounded px-1 disabled:opacity-50">
                             <option value="">自定义</option>
                             {Object.keys(materialDict).map(k=><option key={k} value={k}>{k}</option>)}
                           </select>
                         </td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} value={m.spec} onChange={e=>updateMaterial(i, 'spec', e.target.value)} className="w-[60px] h-8 text-xs font-bold border rounded px-2" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.thickness} onChange={e=>updateMaterial(i, 'thickness', e.target.value)} className="w-[50px] h-8 text-xs font-bold border rounded px-2" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.density} onChange={e=>updateMaterial(i, 'density', e.target.value)} className="w-[50px] h-8 text-xs font-bold border rounded px-2" step="0.01" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.width} onChange={e=>updateMaterial(i, 'width', e.target.value)} className="w-[60px] h-8 text-xs font-bold border rounded px-2" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.length} onChange={e=>updateMaterial(i, 'length', e.target.value)} className="w-[60px] h-8 text-xs font-bold border rounded px-2 text-indigo-600" placeholder="1000" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.loss_rate} onChange={e=>updateMaterial(i, 'loss_rate', e.target.value)} className="w-[50px] h-8 text-xs font-bold border rounded px-2 text-rose-600" /></td>
                         <td className="py-2.5 px-2"><input disabled={!m.enabled} type="number" value={m.unit_price} onChange={e=>updateMaterial(i, 'unit_price', e.target.value)} className="w-[60px] h-8 text-xs font-bold border rounded px-2 text-emerald-700" /></td>
                         <td className="py-2.5 px-3 bg-blue-50/30 text-[11px] font-black text-slate-600">{m._weight ? m._weight.toFixed(2) : '-'}</td>
                         <td className="py-2.5 px-3 bg-blue-50/30 text-[11px] font-black text-rose-600">{m._amount ? m._amount.toFixed(2) : '-'}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>

            {/* 辅料、工艺、损耗费率区 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                    <div className="w-1.5 h-4 bg-orange-500 rounded-full" />辅料与工艺参数
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                     <FormField label="拉链单价" tip="每条/每米拉链成本" value={formData.zipper_price} onChange={(e:any)=>updateField('zipper_price', e.target.value)} suffix="元" />
                     <FormField label="印刷费" tip="每千个印刷加工费" value={formData.print_fee} onChange={(e:any)=>updateField('print_fee', e.target.value)} suffix="元" />
                     <FormField label="覆膜费" tip="每千个覆膜加工费" value={formData.lamination_fee} onChange={(e:any)=>updateField('lamination_fee', e.target.value)} suffix="元" />
                     <FormField label="制袋费" tip="每千个制袋加工费" value={formData.bagging_fee} onChange={(e:any)=>updateField('bagging_fee', e.target.value)} suffix="元" />
                     <FormField label="运费" tip="运输费用" value={formData.shipping_fee} onChange={(e:any)=>updateField('shipping_fee', e.target.value)} suffix="元" />
                  </div>
                </div>

                <div className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                    <div className="w-1.5 h-4 bg-rose-500 rounded-full" />损耗与利润
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                     <FormField label="总损耗率" tip="生产综合损耗" value={formData.overall_loss_rate} onChange={(e:any)=>updateField('overall_loss_rate', e.target.value)} suffix="%" />
                     <FormField label="利润率" tip="目标利润率" value={formData.profit_rate} onChange={(e:any)=>updateField('profit_rate', e.target.value)} suffix="%" required />
                  </div>
                </div>
            </div>

            {/* 过程追踪区 */}
            {traceLines.length > 0 && (
               <div className="bg-slate-800 p-6 rounded-2xl shadow-sm text-slate-300 font-mono text-xs leading-relaxed">
                  <h3 className="text-sm font-black text-white flex items-center gap-2 mb-4 border-b border-slate-700 pb-3">
                    <History className="w-4 h-4 text-slate-400" /> 过程追踪区
                  </h3>
                  <div className="flex flex-col gap-1.5 opacity-90">
                     {traceLines.map((l, i) => (
                        <div key={i} className="flex gap-3">
                           <span className="text-slate-500 shrink-0">[{String(i+1).padStart(2, '0')}]</span>
                           <span>{l}</span>
                        </div>
                     ))}
                  </div>
               </div>
            )}
         </div>
         
         {/* 右侧：结果与历史区 (首屏可见) */}
         <div className="xl:col-span-4 flex flex-col gap-6">
            <div className="sticky top-6">
               
               <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-8 rounded-[2.5rem] shadow-2xl border border-indigo-500/20 text-white relative overflow-hidden">
                  <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>
                  
                  <h3 className="text-sm font-black text-indigo-200 tracking-widest uppercase mb-8 flex items-center gap-3">
                     <CheckCircle2 className="w-5 h-5 text-emerald-400" /> 计算结果面板
                  </h3>

                  {!result ? (
                     <div className="py-20 text-center opacity-50 flex flex-col items-center">
                        <Calculator className="w-16 h-16 mb-4" />
                        <p className="text-xs font-black tracking-widest uppercase">等待执行核算</p>
                     </div>
                  ) : (
                     <AnimatePresence mode="wait">
                        <motion.div initial={{opacity:0, y:10}} animate={{opacity:1,y:0}} className="space-y-8">
                           {/* 核心大字展示区 */}
                           <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm relative overload-hidden">
                              <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-2">最终建议对外报价 (单价/元)</p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-bold text-emerald-400">¥</span>
                                <span className="text-6xl font-black font-display tracking-tight text-white">{result.quoteUnitPrice.toFixed(4)}</span>
                              </div>
                              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                                <span className="text-[10px] text-slate-400 font-bold uppercase">报价总价 ({formData.quote_qty})</span>
                                <span className="text-lg font-black tracking-wider">¥ {result.quoteTotalPrice.toFixed(2)}</span>
                              </div>
                           </div>

                           {/* 分类成本摘要 */}
                           <div className="space-y-3">
                              <div className="flex justify-between items-center bg-black/20 p-3 rounded-xl">
                                <span className="text-[11px] text-slate-400 font-bold tracking-wider">材料总成本</span>
                                <span className="text-sm font-black tracking-wider text-blue-300">¥ {result.totalMaterialCost.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center bg-black/20 p-3 rounded-xl">
                                <span className="text-[11px] text-slate-400 font-bold tracking-wider">工艺总成本</span>
                                <span className="text-sm font-black tracking-wider text-orange-300">¥ {result.totalProcessCost.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center bg-black/20 p-3 rounded-xl">
                                <span className="text-[11px] text-slate-400 font-bold tracking-wider">辅料总成本</span>
                                <span className="text-sm font-black tracking-wider text-purple-300">¥ {result.totalAccessoryCost.toFixed(2)}</span>
                              </div>
                           </div>

                           <div className="border-t border-white/10 pt-6 grid grid-cols-2 gap-4">
                              <div>
                                 <p className="text-[10px] text-slate-400 font-black tracking-widest uppercase mb-1">内部总成本</p>
                                 <p className="text-xl font-black text-rose-300">¥ {result.totalCost.toFixed(2)}</p>
                              </div>
                              <div className="text-right">
                                 <p className="text-[10px] text-slate-400 font-black tracking-widest uppercase mb-1">预估毛利润 ({result.grossProfitRate.toFixed(1)}%)</p>
                                 <p className="text-xl font-black text-emerald-300">¥ {result.grossProfit.toFixed(2)}</p>
                              </div>
                           </div>
                        </motion.div>
                     </AnimatePresence>
                  )}
               </div>

               {/* 样例与历史区 */}
               <div className="mt-6 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <History className="w-4 h-4" /> 最近样例/历史核算
                  </h4>
                  <div className="space-y-3">
                     {historyItems.length === 0 && (
                       <div className="text-xs font-bold text-slate-400">暂无历史核算记录</div>
                     )}
                     {historyItems.map(item => (
                       <div key={item.id} onClick={() => applyHistory(item)} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 cursor-pointer transition-colors group">
                           <div className="flex justify-between items-center">
                             <span className="text-xs font-black text-slate-700 group-hover:text-indigo-600 transition-colors">{item.name || `历史记录 #${item.id}`}</span>
                             <span className="text-[10px] text-slate-400 font-bold tracking-wider">{String(item.created_at || '').slice(0, 10)}</span>
                           </div>
                           <div className="text-[10px] text-slate-500 font-bold">方案: {item.costType} | 数量: {item.input?.quote_qty || formData.quote_qty || '-'}</div>
                           <div className="text-xs font-black text-indigo-600">单价: ¥ {Number(item.result?.finalQuote || 0).toFixed(4)}</div>
                       </div>
                     ))}
                  </div>
               </div>

            </div>
         </div>
      </div>
    </div>
  );
}

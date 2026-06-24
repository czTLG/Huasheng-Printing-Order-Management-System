import React, { useState, useEffect, useCallback } from 'react';
import {
  Calculator, RotateCcw, Save, Download, FileText,
  History, Trash2, Pencil, RefreshCw,
  ChevronDown, ChevronUp, Layers, X
} from 'lucide-react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';

const TEMPLATES = [
  { id: 'stand_zipper_bag', name: '自立拉链袋' },
  { id: 'three_side_seal', name: '三边封' },
  { id: 'eight_side_seal', name: '八边封' },
  { id: 'irregular_zipper_bag', name: '自立异形拉链袋' },
  { id: 'back_seal', name: '背封袋' },
  { id: 'side_seal', name: '侧边封袋' },
  { id: 'four_side_seal', name: '四边封袋' },
  { id: 'auto_bag', name: '自动包' },
  { id: 'material_weight', name: '材料重量' },
];

// Material dict matching legacy db.js defaults — prices in yuan/ton
const MAT_DICT: Record<string, { prop: number; price: number }> = {
  'PET': { prop: 1.38, price: 9800 },
  'BOPP': { prop: 0.91, price: 9200 },
  'CPP': { prop: 0.90, price: 9300 },
  'PE': { prop: 0.92, price: 9000 },
  'NY': { prop: 1.14, price: 12500 },
  'AL': { prop: 2.70, price: 18000 },
  'MOPP': { prop: 0.90, price: 11000 },
  'VMCPP': { prop: 1.05, price: 13500 },
  'VMPET': { prop: 1.40, price: 14000 },
  '纸': { prop: 0.80, price: 7600 },
};

// Standard roll lengths matching legacy
const STD_ROLL_LENGTH: Record<string, Record<string, number>> = {
  'BOPP': { '1.9': 6000, '2.5': 6000, '3.0': 5000, '3.5': 4000, '4.0': 3600, '4.5': 3200, '5.0': 2800 },
  'PET': { '1.2': 6000, '2.5': 6000, '4.0': 4000, '5.0': 3600, '6.0': 3200 },
  'NY': { '1.2': 4000, '1.5': 3600, '2.0': 3000, '2.5': 2400, '3.0': 2000 },
  'PE': { '5.0': 4000, '6.0': 3600, '6.5': 3200, '7.0': 2800, '8.0': 2400 },
  'CPP': { '2.5': 4000, '3.0': 3600, '4.0': 3200, '5.0': 2800 },
};

type FormData = {
  cost_template: string;
  ba_chang: string;   // 高/长 (cm, or m for material_weight)
  ba_kuang: string;   // 宽 (cm, or m for material_weight)
  ba_ce: string;      // 侧边 (cm, only back_seal/side_seal/four_side_seal)
  ba_di: string;      // 底 (cm)
  ir_has_bottom: '0' | '1';  // 异形袋有底

  // Material layers — exactly 4 rows
  mat: [string, string, string, string];       // material name
  thick: [string, string, string, string];     // thickness (C)
  prop: [string, string, string, string];      // density
  price: [string, string, string, string];     // unit price (yuan/ton)

  // Fee fields
  jgf: string;       // 每平方加工费 (yuan/m²)
  zxyf: string;      // 运费 (yuan/ton, default 600)
  sh: string;        // 损耗 (%, default 10)
  lr: string;        // 利润 (%)
  lldj: string;      // 拉链单价 (yuan/m)
  ba_zdf: string;    // 拉链总费用

  // Auto_bag only
  fqfy: string;      // 分切费用
  yf: string;        // 运费(自动包专用)
  zt: string;        // 纸筒
  btzt: string;      // 边条纸箱
  roll_w: string;    // 卷宽(cm)
  roll_l: string;    // 卷长(m)
};

const DEFAULT_FORM: FormData = {
  cost_template: 'stand_zipper_bag',
  ba_chang: '', ba_kuang: '', ba_ce: '', ba_di: '',
  ir_has_bottom: '0',
  mat: ['', '', '', ''],
  thick: ['', '', '', ''],
  prop: ['', '', '', ''],
  price: ['', '', '', ''],
  jgf: '', zxyf: '600', sh: '10', lr: '',
  lldj: '', ba_zdf: '',
  fqfy: '400', yf: '600', zt: '0', btzt: '0',
  roll_w: '17', roll_l: '1000',
};

export default function Cost() {
  const [form, setForm] = useState<FormData>({ ...DEFAULT_FORM, mat: [...DEFAULT_FORM.mat] as any, thick: [...DEFAULT_FORM.thick] as any, prop: [...DEFAULT_FORM.prop] as any, price: [...DEFAULT_FORM.price] as any });
  const [result, setResult] = useState<any>(null);
  const [trace, setTrace] = useState<{ steps?: any[]; formulaProfile?: string } | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Case & history management
  const [caseItems, setCaseItems] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [caseName, setCaseName] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [renameCaseId, setRenameCaseId] = useState('');
  const [renameCaseName, setRenameCaseName] = useState('');
  const [showRename, setShowRename] = useState(false);

  // Add material / standard roll panels
  const [showAddMat, setShowAddMat] = useState(false);
  const [newMatCode, setNewMatCode] = useState('');
  const [newMatProp, setNewMatProp] = useState('');
  const [newMatPrice, setNewMatPrice] = useState('');
  const [showAddRoll, setShowAddRoll] = useState(false);
  const [stdRollMat, setStdRollMat] = useState('');
  const [stdRollThick, setStdRollThick] = useState('');
  const [stdRollLen, setStdRollLen] = useState('');
  const [extraMatDict, setExtraMatDict] = useState<Record<string, { prop: number; price: number }>>({});

  const materialDict = { ...MAT_DICT, ...extraMatDict };

  const costType = form.cost_template;
  const isMaterialWeight = costType === 'material_weight';
  const isAutoBag = costType === 'auto_bag';
  const isThreeSide = costType === 'three_side_seal';
  const isEightSide = costType === 'eight_side_seal';
  const isIrregular = costType === 'irregular_zipper_bag';
  // Field visibility matching legacy applyCostTemplate() exactly
  const showChangKuang = !isAutoBag;  // auto_bag hides chang/kuang
  const showBaCe = ['back_seal', 'side_seal', 'four_side_seal'].includes(costType);
  // diCard visible for all except: three_side_seal (forced 0), auto_bag (hidden), material_weight (hidden)
  const showBaDi = !['three_side_seal', 'auto_bag', 'material_weight'].includes(costType);
  const showIrBottom = isIrregular;
  const baDiDisabled = isIrregular && form.ir_has_bottom === '0';  // disabled when no bottom
  const showLldj = !isAutoBag && !isMaterialWeight;
  const showZdf = showLldj;
  // lldj required only for stand_zipper_bag and irregular_zipper_bag (legacy requiredByType)
  const lldjRequired = costType === 'stand_zipper_bag' || costType === 'irregular_zipper_bag';
  const showJgf = !isMaterialWeight;
  const showZxyf = !isAutoBag && !isMaterialWeight;
  const showShLr = !isMaterialWeight;
  const showAutoExtra = isAutoBag;

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 2500); };

  // === Load resources ===
  const loadResources = useCallback(async () => {
    try {
      const [cases, history] = await Promise.all([
        mockService.getCostSnapshots('case'),
        mockService.getCostSnapshots('history'),
      ]);
      setCaseItems(Array.isArray(cases) ? cases : []);
      setHistoryItems(Array.isArray(history) ? history : []);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    }
  }, []);

  useEffect(() => { loadResources(); }, [loadResources]);

  // === Field-level history hints ===
  const HINT_FIELDS = ['ba_chang', 'ba_kuang', 'ba_ce', 'ba_di', 'lldj', 'ba_zdf', 'jgf', 'zxyf', 'sh', 'lr', 'fqfy', 'yf', 'zt', 'btzt', 'roll_w', 'roll_l'];
  const fieldHints = React.useMemo(() => {
    const hints: Record<string, { value: string; time: string; finalQuote: string; costType: string }[]> = {};
    HINT_FIELDS.forEach(k => { hints[k] = []; });
    // Walk history in reverse so we get newest-first naturally, then reverse at end
    [...historyItems].reverse().forEach((item: any) => {
      const input = item.input || {};
      const time = item.created_at || '';
      const finalQuote = item.result?.finalQuote != null ? `¥${Number(item.result.finalQuote).toFixed(2)}` : '';
      const costType = item.costType || '';
      HINT_FIELDS.forEach(k => {
        const v = input[k];
        if (v != null && v !== '' && v !== 0 && v !== '0') {
          const str = String(v);
          if (!hints[k].find(h => h.value === str)) {
            hints[k].push({ value: str, time, finalQuote, costType });
          }
        }
      });
      // per-layer thick hints handled via material table auto-fill, not here
    });
    // Keep only most recent 8 per field
    HINT_FIELDS.forEach(k => { hints[k] = hints[k].slice(0, 8); });
    return hints;
  }, [historyItems]);

  // === Form helpers ===
  const setF = (key: keyof FormData, val: any) => setForm(prev => ({ ...prev, [key]: val }));
  const setArr = (key: 'mat' | 'thick' | 'prop' | 'price', idx: number, val: string) => {
    setForm(prev => { const arr = [...prev[key]] as FormData[typeof key]; arr[idx] = val; return { ...prev, [key]: arr }; });
  };

  // Material change handler — auto-fill density & price from dict
  const onMatChange = (idx: number, val: string) => {
    setArr('mat', idx, val);
    if (val && materialDict[val]) {
      const info = materialDict[val];
      setForm(prev => {
        const prop = [...prev.prop] as FormData['prop']; const price = [...prev.price] as FormData['price'];
        prop[idx] = String(info.prop);
        price[idx] = String(info.price);
        return { ...prev, prop, price };
      });
      // auto_bag: auto-fill standard roll length
      if (isAutoBag) {
        const thickVal = form.thick[idx];
        if (thickVal) {
          const rollLen = STD_ROLL_LENGTH[val]?.[String(thickVal)];
          if (rollLen) setF('roll_l', String(rollLen));
        }
      }
    }
  };

  // === Build payload — exactly matching legacy collectCostInput() ===
  const buildPayload = () => {
    const t = costType;
    const ba_di_raw = Number(form.ba_di || 0);
    const ba_di = t === 'three_side_seal' ? 0 : ba_di_raw;
    const ba_ce_input = Number(form.ba_ce || 0);
    const ba_ce = ['back_seal', 'side_seal', 'four_side_seal'].includes(t)
      ? ba_ce_input
      : (t === 'eight_side_seal' ? ba_di : 0);
    const thick = [0, 1, 2, 3].map(i => Number(form.thick[i] || 0));
    const rawPrice = [0, 1, 2, 3].map(i => Number(form.price[i] || 0));
    const proportion = [0, 1, 2, 3].map(i => Number(form.prop[i] || 0));

    return {
      costType: t,
      input: {
        ba_chang: Number(form.ba_chang || 0),
        ba_kuang: Number(form.ba_kuang || 0),
        ba_ce,
        ba_di,
        irregular_has_bottom: Number(form.ir_has_bottom || 0),
        thick,
        price: rawPrice,
        proportion,
        jgf: Number(form.jgf || 0),
        zxyf: Number(form.zxyf || 0),
        sh: (Number(form.sh || 0) / 100),
        lr: (Number(form.lr || 0) / 100),
        lldj: Number(form.lldj || 0),
        ba_zdf: Number(form.ba_zdf || 0),
        z_mian_2: 0, z_mian_3: 0, z_mian_4: 0,
        chang: Number(form.ba_chang || 0),
        kuang: Number(form.ba_kuang || 0),
        t1: thick[0], t2: thick[1], t3: thick[2], t4: thick[3],
        p1: proportion[0], p2: proportion[1], p3: proportion[2], p4: proportion[3],
        pr1: rawPrice[0], pr2: rawPrice[1], pr3: rawPrice[2], pr4: rawPrice[3],
        mat1: form.mat[0], mat2: form.mat[1], mat3: form.mat[2], mat4: form.mat[3],
        fqfy: Number(form.fqfy || 0),
        yf: Number(form.yf || 0),
        zt: Number(form.zt || 0),
        btzt: Number(form.btzt || 0),
        roll_w: Number(form.roll_w || 0),
        roll_l: Number(form.roll_l || 0),
      }
    };
  };

  // Apply saved snapshot to form
  const applyInput = (item: any) => {
    if (!item?.input) return;
    const i = item.input;
    if (item.costType) setF('cost_template', item.costType);
    setF('ba_chang', String(i.ba_chang ?? ''));
    setF('ba_kuang', String(i.ba_kuang ?? ''));
    setF('ba_ce', String(i.ba_ce ?? ''));
    setF('ba_di', String(i.ba_di ?? ''));
    setF('ir_has_bottom', String(i.irregular_has_bottom ?? '0'));
    const thick = Array.isArray(i.thick) ? i.thick : [i.t1, i.t2, i.t3, i.t4];
    const prop = Array.isArray(i.proportion) ? i.proportion : [i.p1, i.p2, i.p3, i.p4];
    const price = Array.isArray(i.price) ? i.price : [i.pr1, i.pr2, i.pr3, i.pr4];
    const mat = [i.mat1, i.mat2, i.mat3, i.mat4];
    setForm(prev => ({
      ...prev,
      cost_template: item.costType || prev.cost_template,
      ba_chang: String(i.ba_chang ?? ''), ba_kuang: String(i.ba_kuang ?? ''),
      ba_ce: String(i.ba_ce ?? ''), ba_di: String(i.ba_di ?? ''),
      ir_has_bottom: String(i.irregular_has_bottom ?? '0'),
      thick: thick.map((v: any) => String(v ?? '')), prop: prop.map((v: any) => String(v ?? '')), price: price.map((v: any) => String(v ?? '')),
      mat: mat.map((v: any) => String(v ?? '')),
      jgf: String(i.jgf ?? ''), zxyf: String(i.zxyf ?? '600'), sh: String(Math.round((i.sh ?? 0) * 100)), lr: String(Math.round((i.lr ?? 0) * 100)),
      lldj: String(i.lldj ?? ''), ba_zdf: String(i.ba_zdf ?? ''),
      fqfy: String(i.fqfy ?? '400'), yf: String(i.yf ?? '600'), zt: String(i.zt ?? '0'), btzt: String(i.btzt ?? '0'),
      roll_w: String(i.roll_w ?? '17'), roll_l: String(i.roll_l ?? '1000'),
    } as any));
  };

  // === Calculate ===
  const calculate = async () => {
    setIsCalculating(true);
    setError('');
    try {
      const payload = buildPayload();
      const response = await mockService.calculateCost(payload.costType, payload.input, true);
      setResult(response?.result || null);
      setTrace(response?.trace || null);
      // Auto-save history then refresh list
      mockService.saveCostSnapshot({
        kind: 'history',
        costType: payload.costType,
        input: payload.input,
        result: response?.result,
      }).then(() => loadResources()).catch(() => {});
    } catch (err: any) {
      setError(err?.message || '计算失败');
      setResult(null);
    }
    setIsCalculating(false);
  };

  // === Demo fill ===
  const fillDemo = () => {
    const t = costType;
    setF('ba_chang', '20'); setF('ba_kuang', '12');
    if (showBaDi) setF('ba_di', '5'); else setF('ba_di', '0');
    setF('ba_ce', showBaCe ? '10' : '0');
    setF('ir_has_bottom', '0');
    setF('thick', ['60', '15', '12', '0']);
    setF('prop', ['0.92', '1.14', '1.38', '']);
    setF('price', ['9000', '12500', '9800', '']);
    setF('mat', ['PE', 'NY', 'PET', '']);
    if (showJgf) setF('jgf', '18');
    if (showZxyf) setF('zxyf', '600');
    if (showShLr) { setF('sh', '10'); setF('lr', '12'); }
    if (showLldj) setF('lldj', '2.2'); else setF('lldj', '');
    setF('ba_zdf', '');
    if (isAutoBag) {
      setF('ba_chang', ''); setF('ba_kuang', '');
      setF('fqfy', '400'); setF('yf', '600'); setF('zt', '0'); setF('btzt', '0');
      setF('roll_w', '32'); setF('roll_l', '6000');
      setF('thick', ['19', '50', '', '']); setF('prop', ['0.91', '0.92', '', '']);
      setF('price', ['9200', '9000', '', '']); setF('mat', ['BOPP', 'PE', '', '']);
    }
  };

  // === Case management ===
  const saveCase = async () => {
    if (!caseName.trim()) { setError('请输入样例名称'); return; }
    const payload = buildPayload();
    await mockService.saveCostSnapshot({ kind: 'case', name: caseName.trim(), costType: payload.costType, input: payload.input });
    setCaseName('');
    await loadResources();
    showSuccess('样例已保存');
  };
  const loadCase = async () => {
    if (!selectedCaseId) return;
    const item = caseItems.find((c: any) => String(c.id) === selectedCaseId);
    if (item) applyInput(item);
  };
  const deleteCase = async () => {
    if (!selectedCaseId) return;
    if (!confirm('确认删除此样例？')) return;
    await mockService.deleteCostSnapshot(selectedCaseId);
    setSelectedCaseId('');
    await loadResources();
    showSuccess('样例已删除');
  };
  const renameCase = async () => {
    if (!renameCaseId || !renameCaseName.trim()) return;
    await mockService.renameCostSnapshot(renameCaseId, renameCaseName.trim());
    setShowRename(false); setRenameCaseId(''); setRenameCaseName('');
    await loadResources();
    showSuccess('样例已重命名');
  };

  // === History management ===
  const loadHistory = async () => {
    if (!selectedHistoryId) return;
    const item = historyItems.find((c: any) => String(c.id) === selectedHistoryId);
    if (item) applyInput(item);
  };
  const deleteHistory = async () => {
    if (!selectedHistoryId) return;
    if (!confirm('确认删除此历史记录？')) return;
    await mockService.deleteCostSnapshot(selectedHistoryId);
    setSelectedHistoryId('');
    await loadResources();
    showSuccess('历史记录已删除');
  };

  // === Add material ===
  const addMaterial = () => {
    if (!newMatCode.trim()) return;
    const prop = Number(newMatProp || 0);
    const pr = Number(newMatPrice || 0);
    if (!prop || !pr) { setError('请填写新材料的比重和单价'); return; }
    setExtraMatDict(prev => ({ ...prev, [newMatCode.trim()]: { prop, price: pr } }));
    setShowAddMat(false); setNewMatCode(''); setNewMatProp(''); setNewMatPrice('');
    showSuccess(`已添加材料: ${newMatCode.trim()}`);
  };

  // === Add standard roll ===
  const addStdRoll = () => {
    const mat = stdRollMat.trim();
    const thick = stdRollThick.trim();
    const len = Number(stdRollLen || 0);
    if (!mat || !thick || !len) { setError('请填写材料名、厚度和标准卷长度'); return; }
    if (!STD_ROLL_LENGTH[mat]) STD_ROLL_LENGTH[mat] = {};
    STD_ROLL_LENGTH[mat][thick] = len;
    setShowAddRoll(false); setStdRollMat(''); setStdRollThick(''); setStdRollLen('');
    showSuccess(`已添加标准卷: ${mat} ${thick}C → ${len}m`);
  };

  // === Export ===
  const exportCost = async (format: 'pdf' | 'xls') => {
    const payload = buildPayload();
    const blob = await mockService.exportCost(format, { costType: payload.costType, input: payload.input, result: result || {} });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cost.${format}`; a.click();
    URL.revokeObjectURL(url);
  };

  const sendEmail = async () => {
    const to = prompt('收件人邮箱:');
    if (!to) return;
    const payload = buildPayload();
    await mockService.sendCostEmail({ costType: payload.costType, input: payload.input, result: result || {}, to });
    showSuccess('邮件已发送');
  };

  // === Auto-summary display values ===
  const thickValues = [0, 1, 2, 3].map(i => Number(form.thick[i] || 0)).filter(v => v > 0);
  const thickSum = thickValues.reduce((a, b) => a + b, 0);
  const thickSummary = thickValues.length > 0 ? `${thickValues.join(' + ')} = ${thickSum}` : '—';
  const propSummary = [0, 1, 2, 3].map(i => form.prop[i]).filter(Boolean).join(', ') || '—';
  const priceSummary = [0, 1, 2, 3].map(i => form.price[i]).filter(Boolean).join(', ') || '—';

  // === Render ===
  return (
    <div className="max-w-[1400px] mx-auto p-1 sm:p-3 md:p-6 space-y-1.5 md:space-y-2.5 bg-slate-50 min-h-screen">

      {/* Success/Error toasts */}
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold">{successMsg}</div>
      )}
      {error && (
        <div className="fixed top-4 right-4 z-50 bg-rose-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-white/80 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* === Top bar: Template selector === */}
      <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-slate-200">
        <label className="text-[10px] font-black text-slate-500 tracking-wider block mb-1.5">核算模板</label>
        <select
          value={costType}
          onChange={e => setF('cost_template', e.target.value)}
          className="w-full h-8 md:h-9 px-2 sm:px-2.5 text-[12px] sm:text-[13px] font-bold bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
        >
          {TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {TEMPLATES.map(t => (
            <button key={t.id}
              onClick={() => setF('cost_template', t.id)}
              className={cn(
                "px-2 py-1 text-[10px] sm:text-[11px] font-bold rounded-md border transition-colors",
                costType === t.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
              )}
            >{t.name}</button>
          ))}
        </div>
        {/* Guide text matching legacy costGuide */}
        <GuideText costType={costType} />
      </div>

      {/* === ① Bag dimensions === */}
      {showChangKuang && (
      <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-slate-200">
        <h4 className="text-[12px] sm:text-[13px] font-black text-slate-700 mb-1">① 手填参数区 — 袋子尺寸</h4>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-1.5 md:gap-2">
          <Field label={isMaterialWeight ? '高/长（米）' : '高/长'} tip={isMaterialWeight ? '示例：0.20（m）' : '示例：20（cm）'} tipAsPlaceholder value={form.ba_chang} onChange={e => setF('ba_chang', e.target.value)} list="hint_ba_chang" />
          <Field label={isMaterialWeight ? '宽（米）' : '宽'} tip={isMaterialWeight ? '示例：0.12（m）' : '示例：12（cm）'} tipAsPlaceholder value={form.ba_kuang} onChange={e => setF('ba_kuang', e.target.value)} list="hint_ba_kuang" />
          {showBaCe ? (
            <Field label="侧边" tip="示例：10（cm）" tipAsPlaceholder value={form.ba_ce} onChange={e => setF('ba_ce', e.target.value)} list="hint_ba_ce" />
          ) : (
            <div className="hidden" />
          )}
          {showBaDi ? (
            <Field label="底" tip={baDiDisabled ? '已禁用（无底模式）' : '示例：5（cm）'} tipAsPlaceholder value={form.ba_di} onChange={e => setF('ba_di', e.target.value)} disabled={baDiDisabled} list="hint_ba_di" />
          ) : (
            <div className="hidden" />
          )}
          {showIrBottom && (
            <div className="border border-slate-200 bg-slate-50 rounded-lg sm:rounded-xl p-2 sm:p-3 flex flex-col gap-1 sm:gap-1.5">
              <b className="text-[11px] sm:text-[12px] font-black text-slate-700">异形袋有底?</b>
              <select value={form.ir_has_bottom} onChange={e => setF('ir_has_bottom', e.target.value as '0' | '1')}
                className="h-8 sm:h-[34px] px-2 text-[13px] font-bold bg-white border border-slate-200 rounded-lg outline-none">
                <option value="0">无底（当前默认）</option>
                <option value="1">有底（展开长额外+1.5）</option>
              </select>
            </div>
          )}
        </div>
      </div>
      )}

      {/* === ② Material layers table === */}
      <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] sm:text-[13px] font-black text-slate-700">② 材料层</h4>
          <div className="flex gap-2">
            <button onClick={() => setShowAddMat(!showAddMat)}
              className="px-2 py-1 text-[10px] sm:text-[11px] font-bold rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >添加材料</button>
            <button onClick={() => setShowAddRoll(!showAddRoll)}
              className="px-2 py-1 text-[10px] sm:text-[11px] font-bold rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >添加标准卷</button>
          </div>
        </div>

        {/* Add material panel */}
        {showAddMat && (
          <div className="flex flex-wrap items-end gap-2 mb-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
            <MiniField label="材料名" value={newMatCode} onChange={setNewMatCode} placeholder="如：EVOH" />
            <MiniField label="比重" value={newMatProp} onChange={setNewMatProp} placeholder="如：1.18" />
            <MiniField label="单价(元/吨)" value={newMatPrice} onChange={setNewMatPrice} placeholder="如：16800" />
            <button onClick={addMaterial}
              className="px-3 py-2 text-[11px] font-bold rounded-md bg-teal-600 text-white hover:bg-teal-700 h-9"
            >确认添加</button>
          </div>
        )}

        {/* Add standard roll panel */}
        {showAddRoll && (
          <div className="flex flex-wrap items-end gap-2 mb-3 p-3 bg-teal-50 border border-teal-200 rounded-lg">
            <MiniField label="材料名" value={stdRollMat} onChange={setStdRollMat} placeholder="如：BOPP" />
            <MiniField label="厚度(C)" value={stdRollThick} onChange={setStdRollThick} placeholder="如：1.9" />
            <MiniField label="标准卷长(米)" value={stdRollLen} onChange={setStdRollLen} placeholder="如：6000" />
            <button onClick={addStdRoll}
              className="px-3 py-2 text-[11px] font-bold rounded-md bg-teal-600 text-white hover:bg-teal-700 h-9"
            >确认添加</button>
          </div>
        )}

        {/* Material table */}
        <div className="overflow-x-auto -mx-3 md:mx-0">
          <table className="w-full border-collapse text-[9px] sm:text-[10px] md:text-[12px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 text-left font-black text-slate-600 whitespace-nowrap">层数</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 text-left font-black text-slate-600">材料名称</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 text-left font-black text-slate-600">厚度(C)</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 text-left font-black text-slate-600">比重</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 text-left font-black text-slate-600">单价(元/kg)</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map(idx => (
                <tr key={idx} className={idx >= 2 ? 'opacity-75' : ''}>
                  <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 font-bold text-slate-500 whitespace-nowrap">
                    {idx === 0 ? '第一层' : idx === 1 ? '第二层' : idx === 2 ? '第三层' : '第四层'}
                  </td>
                  <td className="border border-slate-300 px-0.5 sm:px-1 py-0.5 md:py-0.5">
                    <input
                      value={form.mat[idx]}
                      onChange={e => onMatChange(idx, e.target.value)}
                      list="matHints"
                      placeholder="输入或选择"
                      className="w-full h-6 md:h-7 text-[10px] md:text-[12px] font-bold border border-slate-200 rounded px-1 outline-none focus:border-indigo-400 bg-white"
                    />
                  </td>
                  <td className="border border-slate-300 px-0.5 sm:px-1 py-0.5 md:py-0.5">
                    <input type="number" value={form.thick[idx]} onChange={e => setArr('thick', idx, e.target.value)}
                      placeholder="厚度" className="w-full h-6 md:h-7 text-[10px] md:text-[12px] font-bold border border-slate-200 rounded px-1 outline-none focus:border-indigo-400 bg-white" />
                  </td>
                  <td className="border border-slate-300 px-0.5 sm:px-1 py-0.5 md:py-0.5">
                    <input type="number" value={form.prop[idx]} onChange={e => setArr('prop', idx, e.target.value)}
                      placeholder="比重" className="w-full h-6 md:h-7 text-[10px] md:text-[12px] font-bold border border-slate-200 rounded px-1 outline-none focus:border-indigo-400 bg-white" />
                  </td>
                  <td className="border border-slate-300 px-0.5 sm:px-1 py-0.5 md:py-0.5">
                    <input type="number" value={form.price[idx]} onChange={e => setArr('price', idx, e.target.value)}
                      placeholder="单价" className="w-full h-6 md:h-7 text-[10px] md:text-[12px] font-bold border border-slate-200 rounded px-1 outline-none focus:border-indigo-400 bg-white" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Material datalist & quick picks */}
        <datalist id="matHints">
          {Object.keys(materialDict).map(code => (
            <option key={code} value={code} />
          ))}
        </datalist>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {Object.entries(materialDict).map(([code, info]) => (
            <button key={code}
              onClick={() => {
                // Fill the next empty layer row
                const idx = [0, 1, 2, 3].find(i => !form.mat[i]) ?? 0;
                setArr('mat', idx, code);
                setArr('prop', idx, String(info.prop));
                setArr('price', idx, String(info.price));
              }}
              className="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded border border-slate-200 bg-white text-slate-600 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
            >{code}</button>
          ))}
        </div>
      </div>

      {/* === ③ Fee fields === */}
      <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-slate-200">
        <h4 className="text-[12px] sm:text-[13px] font-black text-slate-700 mb-1">③ 费用项</h4>

        {/* Auto-summary (read-only) — always visible, matching legacy */}
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1 mb-1.5">
            <div className="border border-slate-200 bg-slate-100 rounded-lg sm:rounded-xl p-1.5 sm:p-2">
              <b className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-wider">厚度C（自动汇总）</b>
              <div className="text-[11px] sm:text-[12px] font-extrabold text-slate-700 mt-0.5">{thickSummary}</div>
            </div>
            <div className="border border-slate-200 bg-slate-100 rounded-lg sm:rounded-xl p-1.5 sm:p-2">
              <b className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-wider">单价（自动汇总）</b>
              <div className="text-[11px] sm:text-[12px] font-extrabold text-slate-700 mt-0.5 truncate">{priceSummary}</div>
            </div>
            <div className="border border-slate-200 bg-slate-100 rounded-lg sm:rounded-xl p-1.5 sm:p-2">
              <b className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-wider">比重（自动汇总）</b>
              <div className="text-[11px] sm:text-[12px] font-extrabold text-slate-700 mt-0.5 truncate">{propSummary}</div>
            </div>
          </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-0.5 sm:gap-1">
          {showJgf && <Field label="每平方加工费" tip="单位：元/平方" value={form.jgf} onChange={e => setF('jgf', e.target.value)} placeholder="如：18" list="hint_jgf" />}
          {showZxyf && <Field label="运费" tip="单位：元/吨（默认600）" value={form.zxyf} onChange={e => setF('zxyf', e.target.value)} list="hint_zxyf" />}
          {showShLr && <Field label="损耗" tip="按百分比：10 表示 10%" value={form.sh} onChange={e => setF('sh', e.target.value)} list="hint_sh" />}
          {showShLr && <Field label="利润" tip="按百分比：12 表示 12%" value={form.lr} onChange={e => setF('lr', e.target.value)} list="hint_lr" />}
          {showLldj && <Field label="拉链单价 *" tip="单位：元/米（拉链袋必填）" value={form.lldj} onChange={e => setF('lldj', e.target.value)} required list="hint_lldj" />}
          {showZdf && <Field label="拉链总费用" tip="优先于拉链单价，可空" value={form.ba_zdf} onChange={e => setF('ba_zdf', e.target.value)} list="hint_ba_zdf" />}
        </div>

        {/* Auto_bag extra fields */}
        {showAutoExtra && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-0.5 sm:gap-1 mt-1.5 pt-1.5 border-t border-slate-200">
            <Field label="分切费用" tip="自动包专用，元/吨" value={form.fqfy} onChange={e => setF('fqfy', e.target.value)} list="hint_fqfy" />
            <Field label="运费(自动包)" tip="自动包专用，元/吨" value={form.yf} onChange={e => setF('yf', e.target.value)} list="hint_yf" />
            <Field label="纸筒" tip="自动包专用，元/吨" value={form.zt} onChange={e => setF('zt', e.target.value)} list="hint_zt" />
            <Field label="边条纸箱" tip="自动包专用，元/吨" value={form.btzt} onChange={e => setF('btzt', e.target.value)} list="hint_btzt" />
            <Field label="卷宽(厘米)" tip="用于每卷指标" value={form.roll_w} onChange={e => setF('roll_w', e.target.value)} list="hint_roll_w" />
            <Field label="卷长(米)" tip="用于每卷指标" value={form.roll_l} onChange={e => setF('roll_l', e.target.value)} list="hint_roll_l" />
          </div>
        )}
      </div>

      {/* === ④ Actions === */}
      <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
        {/* Calculate + Demo */}
        <div className="flex flex-wrap gap-2">
          <button onClick={calculate} disabled={isCalculating}
            className="px-3 py-2 bg-indigo-600 text-white text-[12px] sm:text-[13px] font-bold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            <Calculator className="w-4 h-4" />
            {isCalculating ? '计算中...' : '开始计算'}
          </button>
          <button onClick={fillDemo}
            className="px-3 py-2 border border-slate-200 bg-white text-slate-700 text-[12px] sm:text-[13px] font-bold rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
            填充示例
          </button>
          {result && (
            <>
              <button onClick={() => exportCost('xls')}
                className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />导出Excel
              </button>
              <button onClick={() => exportCost('pdf')}
                className="px-4 py-2.5 border border-slate-200 bg-white text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />导出PDF
              </button>
              <button onClick={sendEmail}
                className="px-4 py-2.5 bg-purple-600 text-white text-sm font-bold rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                发送邮件
              </button>
            </>
          )}
        </div>

        {/* Case management */}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="text-[11px] font-black text-slate-500 tracking-wider">样例管理</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={caseName} onChange={e => setCaseName(e.target.value)} placeholder="样例名称"
              className="h-9 px-3 text-[13px] font-bold border border-slate-200 rounded-lg outline-none focus:border-indigo-400 w-48" />
            <button onClick={saveCase}
              className="px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold rounded-md hover:bg-emerald-700 transition-colors"
            ><Save className="w-3.5 h-3.5 inline mr-1" />保存样例</button>
            <select value={selectedCaseId} onChange={e => setSelectedCaseId(e.target.value)}
              className="h-9 px-2 text-[13px] font-bold border border-slate-200 rounded-lg outline-none bg-white max-w-[160px]">
              <option value="">选择样例</option>
              {caseItems.map((c: any) => (
                <option key={c.id} value={String(c.id)}>{c.name || `样例#${c.id}`}</option>
              ))}
            </select>
            <button onClick={loadCase}
              className="px-3 py-1.5 bg-slate-600 text-white text-[11px] font-bold rounded-md hover:bg-slate-700 transition-colors"
            >加载</button>
            <button onClick={deleteCase}
              className="px-3 py-1.5 bg-rose-600 text-white text-[11px] font-bold rounded-md hover:bg-rose-700 transition-colors"
            ><Trash2 className="w-3.5 h-3.5 inline mr-1" />删除</button>
            {!showRename ? (
              <button onClick={() => { const c = caseItems.find((x: any) => String(x.id) === selectedCaseId); if (c) { setRenameCaseId(String(c.id)); setRenameCaseName(c.name || ''); setShowRename(true); } }}
                className="px-3 py-1.5 border border-slate-200 bg-white text-slate-600 text-[11px] font-bold rounded-md hover:bg-slate-50 transition-colors"
              ><Pencil className="w-3.5 h-3.5 inline mr-1" />重命名</button>
            ) : (
              <div className="flex items-center gap-1">
                <input value={renameCaseName} onChange={e => setRenameCaseName(e.target.value)}
                  className="h-9 px-2 text-[13px] font-bold border border-slate-200 rounded-lg outline-none w-40" />
                <button onClick={renameCase}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold rounded-md">确认</button>
                <button onClick={() => setShowRename(false)}
                  className="px-3 py-1.5 border border-slate-200 text-[11px] font-bold rounded-md">取消</button>
              </div>
            )}
            <button onClick={loadResources}
              className="px-3 py-1.5 border border-slate-200 bg-white text-slate-600 text-[11px] font-bold rounded-md hover:bg-slate-50 transition-colors"
            ><RefreshCw className="w-3.5 h-3.5 inline mr-1" />刷新</button>
          </div>
        </div>

        {/* History management */}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="text-[11px] font-black text-slate-500 tracking-wider">历史记录</div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedHistoryId} onChange={e => setSelectedHistoryId(e.target.value)}
              className="h-9 px-2 text-[13px] font-bold border border-slate-200 rounded-lg outline-none bg-white max-w-[200px]">
              <option value="">选择历史</option>
              {historyItems.map((c: any) => (
                <option key={c.id} value={String(c.id)}>
                  {new Date(c.created_at || '').toLocaleString('zh-CN', { hour12: false })} — {TEMPLATES.find(t => t.id === c.costType)?.name || c.costType || ''} — {c.result?.finalQuote != null ? `¥${Number(c.result.finalQuote).toFixed(2)}` : '未计算'}
                </option>
              ))}
            </select>
            <button onClick={loadHistory}
              className="px-3 py-1.5 bg-slate-600 text-white text-[11px] font-bold rounded-md hover:bg-slate-700 transition-colors"
            ><History className="w-3.5 h-3.5 inline mr-1" />加载</button>
            <button onClick={deleteHistory}
              className="px-3 py-1.5 bg-rose-600 text-white text-[11px] font-bold rounded-md hover:bg-rose-700 transition-colors"
            ><Trash2 className="w-3.5 h-3.5 inline mr-1" />删除</button>
          </div>
        </div>
      </div>

      {/* === ⑤ Result === */}
      {result && (
        <div className="bg-white p-1.5 sm:p-3 md:p-4 rounded-xl shadow-sm border border-emerald-200 space-y-2">
          <h4 className="text-[12px] sm:text-[13px] font-black text-emerald-700 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />计算结果
          </h4>

          {isMaterialWeight ? (
            <MaterialWeightResult result={result} trace={trace} showTrace={showTrace} setShowTrace={setShowTrace}
              mat={form.mat} price={form.price} thick={form.thick} costType={costType} input={buildPayload().input} />
          ) : (
            <StandardResult result={result} trace={trace} showTrace={showTrace} setShowTrace={setShowTrace}
              mat={form.mat} costType={costType} input={buildPayload().input} thick={form.thick} />
          )}
        </div>
      )}

      {/* Field history hints (datalists) */}
      {HINT_FIELDS.map(fk => (
        <datalist key={fk} id={`hint_${fk}`}>
          {fieldHints[fk]?.map((h, i) => (
            <option key={i} value={h.value}>
              {h.value}{h.finalQuote ? ` — ${h.finalQuote}` : ''} ({new Date(h.time).toLocaleDateString()})
            </option>
          ))}
        </datalist>
      ))}
    </div>
  );
}

// === Sub-components ===

function GuideText({ costType }: { costType: string }) {
  const guides: Record<string, string> = {
    stand_zipper_bag: '自立拉链袋模板（正面口径）：只需要包长/包宽/包底，不需要侧边；并按层递增长度计算材料重量（第1层原长，第2层+0.5，第3层+1.0，第4层+1.5）。',
    three_side_seal: '三边封袋模板（按自立拉链无底）：按自立拉链袋口径计算，但不使用包底；系统自动将包底按0参与计算。',
    eight_side_seal: '八边封模板：手填包长/包宽/底（侧面=底，已合并输入）、每层厚度/比重/单价、加工费/运费/损耗/利润、拉链费(可选)。自动计算展开长宽面积、每层重量成本、总成本、最终报价。',
    irregular_zipper_bag: '自立拉链异形袋模板（Excel口径）：输入包长/包宽/包底，不需要侧边；可选"有底/无底"：无底按当前公式，有底在展开长度基础上额外+1.5。',
    back_seal: '背封袋模板（新口径）：侧边参与核算，不使用底；制袋织带费按"高/长"计算。z_chang=(宽+侧)×2+2+1.5。',
    side_seal: '侧边封袋模板（新口径）：侧边参与核算，不使用底；制袋织带费按"高/长"计算。z_chang=(宽+侧)×2+2+1.5。',
    four_side_seal: '四边封袋模板（新口径）：侧边参与核算，不使用底；z_chang=(宽+侧)×2+1.5。',
    auto_bag: '自动包成本模板：不使用高/宽/底/侧边；核心链路：折合厚度→材料比例→材料成本→每吨平方数→加工费→分切/运费/纸筒/边条纸箱→损耗→利润；并输出每卷指标。',
    material_weight: '材料重量核算模板：输入高/长(米)、宽(米)、四层厚度、四层比重；不需要底、侧边，也不涉及加工费/运费/损耗/利润。若填写材料单价（元/kg），系统会同步计算材料金额；卷出袋数仅按第一层材料+厚度匹配标准卷长。',
  };
  const text = guides[costType] || '';
  if (!text) return null;
  return (
    <div className="mt-1.5 text-[9px] sm:text-[10px] text-slate-500 leading-relaxed border-t border-slate-100 pt-1.5">{text}</div>
  );
}

function Field({ label, tip, value, onChange, required, placeholder, disabled, list, tipAsPlaceholder }: {
  label: string; tip?: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string; disabled?: boolean; list?: string; tipAsPlaceholder?: boolean;
}) {
  return (
    <div className="border border-slate-200 bg-slate-50 rounded-lg sm:rounded-xl p-1 sm:p-2 flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <b className="text-[10px] sm:text-[11px] font-black text-slate-700">{label}</b>
        {required && <span className="text-rose-500 text-[8px] sm:text-[9px]">*</span>}
      </div>
      {!tipAsPlaceholder && tip && <span className="text-[8px] sm:text-[9px] text-slate-400 leading-tight">{tip}</span>}
      <input type="number" value={value} onChange={onChange} placeholder={tipAsPlaceholder ? (tip || placeholder || '0') : (placeholder || '0')} disabled={disabled} list={list}
        className="w-full h-7 sm:h-8 px-1.5 sm:px-2.5 text-[12px] sm:text-[13px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-400 placeholder:text-slate-300" />
    </div>
  );
}

function MiniField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-24 h-7 px-1.5 text-[11px] font-bold border border-slate-200 rounded outline-none focus:border-indigo-400" />
    </div>
  );
}

function fmt(v: any, d = 4) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : String(v);
}

// Material weight result
function MaterialWeightResult({ result, trace, showTrace, setShowTrace, mat, price, thick, costType, input }: any) {
  const w = result?.layerWeightKg || [];
  const p = input?.price || [];
  const layerAmount = [0, 1, 2, 3].map((i: number) => Number(w[i] || 0) * Number(p[i] || 0));
  const totalAmount = layerAmount.reduce((a: number, b: number) => a + b, 0);
  const { stdRollLen, theoryBags, netBags, basisKey } = calcStdRollBagCount(costType, input, mat[0] || '', thick[0] || '', result);
  const basisLabels: Record<string, string> = { ba_chang: 'ba_chang(长)', z_kuang: 'z_kuang(展开宽)', ba_kuang: 'ba_kuang(宽)' };
  const basisLabel = basisLabels[basisKey || ''] || 'ba_kuang(宽)';

  return (
    <>
      <table className="w-full border-collapse text-[9px] sm:text-[10px] md:text-[12px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">层数</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">材料重量(kg)</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 hidden sm:table-cell">重量占比</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">材料单价(元/kg)</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">材料金额(元)</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3].map((i: number) => {
            const totalW = w.reduce((a: number, b: any) => a + Number(b || 0), 0);
            const wpct = totalW > 0 ? Math.round(Number(w[i] || 0) / totalW * 100) : 0;
            return (
            <tr key={i}>
              <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 font-bold">第{i + 1}层</td>
              <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1">{fmt(w[i], 6)}</td>
              <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 hidden sm:table-cell">{totalW > 0 ? wpct + '%' : '-'}</td>
              <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1">{fmt(p[i], 6)}</td>
              <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1">{fmt(layerAmount[i], 6)}</td>
            </tr>
          )})}
        </tbody>
      </table>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
        <Stat label="总重量(kg)" value={fmt(result?.totalWeightKg, 6)} />
        <Stat label="总重量(g)" value={fmt(result?.totalWeightG, 6)} />
        <Stat label="总厚度(C)" value={fmt(result?.totalThickness, 4)} />
        <Stat label="总材料金额(元)" value={fmt(totalAmount, 4)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
        <Stat label="标准卷长(米)" value={stdRollLen == null ? '-' : fmt(stdRollLen, 2)} />
        <Stat label={`理论出袋数(${basisLabel})`} value={theoryBags == null ? '-' : fmt(theoryBags, 2)} />
        <Stat label="折损后出袋数(93%)" value={netBags == null ? '-' : fmt(netBags, 2)} />
        <Stat label="说明" value="仅按第一层材料+厚度" />
      </div>

      {/* Compare with result */}
      {trace?.compareWithResult && (
        <pre className="whitespace-pre-wrap break-all mt-2 bg-slate-50 border border-slate-200 p-2 rounded-lg text-[10px] text-slate-500">
          {JSON.stringify(trace.compareWithResult, null, 2)}
        </pre>
      )}

      <TraceSection trace={trace} show={showTrace} toggle={() => setShowTrace(!showTrace)} />
    </>
  );
}

// Standard bag result
function StandardResult({ result, trace, showTrace, setShowTrace, mat, costType, input, thick }: any) {
  const lw = result?.layerWeightTon || result?.layerWeightKg || [];
  const lc = result?.layerCost || [];
  const isAutoBag = costType === 'auto_bag';
  const isEightSide = costType === 'eight_side_seal';

  const { stdRollLen, theoryBags, netBags, basisKey } = calcStdRollBagCount(costType, input, mat[0] || '', thick[0] || '', result);
  const basisLabels: Record<string, string> = { ba_chang: 'ba_chang(长)', z_kuang: 'z_kuang(展开宽)', ba_kuang: 'ba_kuang(宽)' };
  const basisLabel = basisLabels[basisKey || ''] || 'ba_kuang(宽)';

  // Cost share: material / process / loss
  const mCost = Number(result?.materialCost || result?.totalMaterialCost || 0);
  const pCost = Number(result?.processCost || result?.processingCost || result?.jgfCost || 0);
  const lCost = Number(result?.lossCost || result?.lossAmount || 0);
  const sumCost = Math.max(1, mCost + pCost + lCost);
  const mp = Math.round(mCost / sumCost * 100);
  const pp = Math.round(pCost / sumCost * 100);
  const lp = Math.max(0, 100 - mp - pp);

  // Filter trace for auto_bag
  const autoTraceKeys = ['thick','proportion','proth','allproRaw','allpro','ratio','dun','clcb','sqmPerTon','alljgf','baseCost','costBeforeProfit','finalQuote','rollAreaM2','pricePerSqm','rollPrice','rollWeightKg'];
  const traceSteps = isAutoBag ? (trace?.steps || []).filter((s: any) => autoTraceKeys.includes(String(s.key || ''))) : (trace?.steps || []);
  const filteredTrace = { ...trace, steps: traceSteps };

  return (
    <>
      {/* Metrics top row */}
      {isAutoBag ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
          <Stat label="折合厚度(自动)" value={fmt(result?.allpro, 6)} />
          <Stat label="每吨平方数(自动)" value={fmt(result?.sqmPerTon || result?.mdpb1, 8)} />
          <Stat label="每吨加工费(自动)" value={fmt(result?.alljgf, 8)} />
          <Stat label="总材料成本(自动)" value={fmt(result?.materialCost, 8)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
          <Stat label="展开长度(自动)" value={fmt(result?.z_chang, 6)} />
          <Stat label="展开宽度(自动)" value={fmt(result?.z_kuang, 6)} />
          <Stat label="产品面积(自动)" value={fmt(result?.z_mian, 8)} />
          <Stat label="总厚度(自动)" value={fmt(result?.totalThickness, 6)} />
        </div>
      )}

      {/* Layer cost table */}
      <table className="w-full border-collapse text-[9px] sm:text-[10px] md:text-[12px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">层数</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">材料</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 hidden sm:table-cell">重量(吨)</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5">成本(元)</th>
            <th className="border border-slate-300 px-1 sm:px-2 py-1 md:py-1.5 hidden sm:table-cell">重量占比</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3].map((i: number) => {
            const totalWeight = lw.reduce((a: number, b: any) => a + Number(b || 0), 0);
            const wpct = totalWeight > 0 ? Math.round(Number(lw[i] || 0) / totalWeight * 100) : 0;
            return (lw[i] || lc[i]) ? (
              <tr key={i}>
                <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 font-bold">第{i + 1}层</td>
                <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1">{mat[i] || '-'}</td>
                <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 hidden sm:table-cell">{fmt(lw[i], 8)}</td>
                <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1">{fmt(lc[i], 4)}</td>
                <td className="border border-slate-300 px-1 sm:px-2 py-0.5 md:py-1 hidden sm:table-cell">{totalWeight > 0 ? wpct + '%' : '-'}</td>
              </tr>
            ) : null;
          })}
        </tbody>
      </table>

      {/* Main cost stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 sm:gap-1.5">
        <Stat label="材料成本" value={fmt(result?.materialCost, 2)} />
        <Stat label="加工成本" value={fmt(result?.processCost, 2)} />
        <Stat label="运费分摊" value={fmt(result?.freightCost, 2)} />
        <Stat label="损耗金额" value={fmt(lCost, 2)} />
        <Stat label="总成本" value={fmt(result?.totalCost, 2)} />
        <Stat label="最终报价" value={fmt(result?.finalQuote, 2)} />
      </div>

      {/* Total dun / unit cost row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-1.5">
        <Stat label="总吨位/总重量(自动)" value={fmt(result?.all_dun || result?.totalWeightKg, 8)} />
        <Stat label="成本(自动)" value={fmt(result?.totalCost || result?.costBeforeProfit, 8)} />
        <div className="border-2 border-red-300 bg-red-50 rounded-md sm:rounded-lg p-1.5 sm:p-2">
          <div className="text-[8px] sm:text-[9px] font-bold text-red-600 uppercase tracking-wider">最终报价(自动)</div>
          <div className="text-[16px] sm:text-[18px] font-extrabold text-red-700 mt-0.5">{fmt(result?.finalQuote, 8)}</div>
        </div>
        <Stat label="每吨成本/单位成本(自动)" value={fmt(result?.unitCost, 8)} />
      </div>

      {/* Cost share bar */}
      <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-2 sm:p-2.5">
        <b className="text-[9px] sm:text-[10px] font-black text-slate-700">关键成本占比（材料/工费/损耗）</b>
        <div className="mt-1.5 h-2.5 sm:h-3 rounded-full overflow-hidden bg-slate-200 flex">
          <div style={{ width: `${mp}%`, background: '#2563eb' }} />
          <div style={{ width: `${pp}%`, background: '#16a34a' }} />
          <div style={{ width: `${lp}%`, background: '#f59e0b' }} />
        </div>
        <div className="text-[8px] sm:text-[9px] text-slate-500 mt-1">材料 {mp}% ｜ 工费 {pp}% ｜ 损耗 {lp}%</div>
      </div>

      {/* Standard roll info (non-auto_bag) */}
      {!isAutoBag && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
          <Stat label="第一层标准卷长(米)" value={stdRollLen == null ? '-' : fmt(stdRollLen, 2)} />
          <Stat label={`理论出袋数(${basisLabel})`} value={theoryBags == null ? '-' : fmt(theoryBags, 2)} />
          <Stat label="折损后出袋数(93%)" value={netBags == null ? '-' : fmt(netBags, 2)} />
          <Stat label="说明" value="仅按第一层材料+厚度" />
        </div>
      )}

      {/* Eight side seal side flow */}
      {isEightSide && (
        <div className="border border-amber-300 bg-amber-50/50 rounded-lg p-2 sm:p-2.5">
          <b className="text-[9px] sm:text-[10px] font-black text-amber-700">八边封 · 侧边成本流程（独立展示）</b>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-1.5 mt-1.5">
            <Stat label="侧边展开长" value={fmt(result?.side_chang, 4)} />
            <Stat label="侧边展开宽" value={fmt(result?.side_kuang, 4)} />
            <Stat label="侧边面积" value={fmt(result?.side_mian, 4)} />
            <Stat label="侧边吨位分摊" value={fmt(result?.sideFreightCost, 4)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mt-2">
            <Stat label="侧边材料成本" value={fmt(result?.sideMaterialCost, 4)} />
            <Stat label="侧边加工成本" value={fmt(result?.sideProcessCost, 4)} />
            <Stat label="侧边成本(含损耗前后)" value={fmt(result?.sideCost, 4)} />
            <Stat label="侧边报价" value={fmt(result?.sideQuote, 4)} />
          </div>
          <div className="text-[8px] sm:text-[9px] text-slate-500 mt-1.5">
            总报价 = 正面报价 {fmt(result?.frontQuote, 2)} + 侧边报价 {fmt(result?.sideQuote, 2)} = {fmt(result?.finalQuote, 2)}
          </div>
        </div>
      )}

      {/* Auto bag extended metrics */}
      {isAutoBag && (
        <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-2 sm:p-2.5">
          <b className="text-[9px] sm:text-[10px] font-black text-emerald-700">自动包关键指标（对齐核算表）</b>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-1.5 mt-1.5">
            <Stat label="折合厚度" value={fmt(result?.allpro, 6)} />
            <Stat label="每吨平方数" value={fmt(result?.sqmPerTon || result?.mdpb1, 8)} />
            <Stat label="分切费用" value={fmt(result?.fqfy, 4)} />
            <Stat label="纸筒 / 边条纸箱" value={`${fmt(result?.zt, 4)} / ${fmt(result?.btzt, 4)}`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mt-2">
            <Stat label="每卷平方数" value={fmt(result?.rollAreaM2, 4)} />
            <Stat label="每平方价格" value={fmt(result?.pricePerSqm, 4)} />
            <Stat label="每卷价格" value={fmt(result?.rollPrice, 2)} />
            <Stat label="每卷重量(kg)" value={fmt(result?.rollWeightKg, 2)} />
          </div>
        </div>
      )}

      {/* Compare with result (non-auto_bag) */}
      {!isAutoBag && trace?.compareWithResult && (
        <pre className="whitespace-pre-wrap break-all mt-2 bg-slate-50 border border-slate-200 p-2 rounded-lg text-[10px] text-slate-500">
          {JSON.stringify(trace.compareWithResult, null, 2)}
        </pre>
      )}

      <TraceSection trace={filteredTrace} show={showTrace} toggle={() => setShowTrace(!showTrace)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 bg-slate-50 rounded-md sm:rounded-lg p-1 sm:p-2">
      <div className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-[11px] sm:text-[13px] font-extrabold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

function TraceSection({ trace, show, toggle }: { trace: any; show: boolean; toggle: () => void }) {
  const steps = trace?.steps || [];
  if (!steps.length) return null;
  const displaySteps = steps;
  return (
    <div>
      <button onClick={toggle}
        className="flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
      >
        {show ? <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
        运算过程追踪 ({displaySteps.length} 步)
      </button>
      {show && (
        <div className="mt-1.5 overflow-x-auto">
          {trace?.formulaProfile && (
            <div className="text-[9px] text-slate-400 mb-1.5">公式模板：{trace.formulaProfile}（用于审计与复核）</div>
          )}
          <table className="w-full border-collapse text-[9px] sm:text-[10px] md:text-[11px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-1 sm:px-2 py-1 text-left">序号</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 text-left">变量</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 text-left">公式</th>
                <th className="border border-slate-300 px-1 sm:px-2 py-1 text-left">计算值</th>
              </tr>
            </thead>
            <tbody>
              {displaySteps.map((s: any, idx: number) => (
                <tr key={idx}>
                  <td className="border border-slate-300 px-1 sm:px-2 py-0.5">{idx + 1}</td>
                  <td className="border border-slate-300 px-1 sm:px-2 py-0.5 font-bold">{s.key || ''}</td>
                  <td className="border border-slate-300 px-1 sm:px-2 py-0.5 text-slate-500">{s.formula || ''}</td>
                  <td className="border border-slate-300 px-1 sm:px-2 py-0.5 break-all">{JSON.stringify(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Standard roll bag count — matches legacy calcStdRollBagCount
function calcStdRollBagCount(costType: string, input: any, layer1Mat: string, layer1Thick: string, result: any) {
  const thickKey = String(Number(layer1Thick || 0));
  const rollLen = STD_ROLL_LENGTH[layer1Mat]?.[thickKey] ?? null;
  if (rollLen == null) return { stdRollLen: null, theoryBags: null, netBags: null, basisKey: null };

  let bagDimMeters = 0;
  let basisKey = '';
  const t = costType;

  if (t === 'back_seal' || t === 'side_seal' || t === 'four_side_seal') {
    // use ba_chang (长)
    basisKey = 'ba_chang';
    bagDimMeters = Number(input?.ba_chang || 0) / 100;
  } else {
    // use z_kuang (展开宽) or ba_kuang
    const kuang = Number(input?.ba_kuang || 0);
    if (t === 'eight_side_seal' || t === 'irregular_zipper_bag') {
      basisKey = 'z_kuang';
      bagDimMeters = result?.z_kuang ? Number(result.z_kuang) / 100 : kuang / 100;
    } else {
      basisKey = 'ba_kuang';
      bagDimMeters = kuang / 100;
    }
  }

  if (!bagDimMeters || bagDimMeters <= 0) return { stdRollLen: rollLen, theoryBags: null, netBags: null, basisKey };

  const theoryBags = rollLen / bagDimMeters;
  const netBags = theoryBags * 0.93;
  return { stdRollLen: rollLen, theoryBags, netBags, basisKey };
}

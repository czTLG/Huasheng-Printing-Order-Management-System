import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Calculator,
  CheckCircle2,
  FileText,
  FlaskConical,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Table2,
  UserRound,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';

type LayerForm = [string, string, string, string];

type CostingForm = {
  thick: LayerForm;
  proportion: LayerForm;
  price: LayerForm;
  jgf: string;
  zxyf: string;
  yf: string;
  fqfy: string;
  lldj: string;
  ba_zdf: string;
  sh: string;
  lr: string;
};

type ReviewForm = {
  father_note: string;
  father_correction_note: string;
  approved_unit_price: string;
  approved_total_price: string;
  changed_fields: string;
};

const FERRENO_SAMPLE = `Ferreno Chocolate Industry L.L.C, UAE.
Item No.1 flat bottom pouch / 3D pouch for chocolate hazelnut product.
Filling weight 500g.
Size 165mm W x 245mm H x 40+40mm gusset.
Material 12mic PET + 100mic transparent LDPE + matt varnish.
Zipper shown in artwork.
Artwork will be provided.
Quantity 25000 pcs x 4 variants total 100000 pcs.
Incoterms EXW.
Destination UAE.`;

const DEFAULT_FORM: CostingForm = {
  thick: ['', '', '', ''],
  proportion: ['', '', '', ''],
  price: ['', '', '', ''],
  jgf: '',
  zxyf: '600',
  yf: '600',
  fqfy: '400',
  lldj: '',
  ba_zdf: '',
  sh: '10',
  lr: '12',
};

const DEFAULT_REVIEW: ReviewForm = {
  father_note: '',
  father_correction_note: '',
  approved_unit_price: '',
  approved_total_price: '',
  changed_fields: '',
};

const FORM_FIELDS: Array<{ key: keyof CostingForm; label: string; hint: string }> = [
  { key: 'jgf', label: '每平方加工费', hint: '元/平方' },
  { key: 'zxyf', label: '运费', hint: '元/吨' },
  { key: 'yf', label: '运费(自动包)', hint: '自动包专用，元/吨' },
  { key: 'fqfy', label: '分切费用', hint: '自动包专用，元/吨' },
  { key: 'lldj', label: '拉链单价', hint: '元/米' },
  { key: 'ba_zdf', label: '拉链总费用', hint: '优先于拉链单价，可空' },
  { key: 'sh', label: '损耗', hint: '10 表示 10%' },
  { key: 'lr', label: '利润', hint: '12 表示 12%' },
];

const LAYER_LABELS = ['厚度(C)', '比重', '单价(元/kg)'];

export default function ForeignCostingAssistant({ onBack }: { onBack?: () => void } = {}) {
  const service = mockService as any;

  const [orderText, setOrderText] = useState('');
  const [parsed, setParsed] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [form, setForm] = useState<CostingForm>({ ...DEFAULT_FORM, thick: [...DEFAULT_FORM.thick] as LayerForm, proportion: [...DEFAULT_FORM.proportion] as LayerForm, price: [...DEFAULT_FORM.price] as LayerForm });
  const [reviewForm, setReviewForm] = useState<ReviewForm>({ ...DEFAULT_REVIEW });
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const statusText = safeText(draft?.status || parsed?.status || 'internal_pre_quote');
  const customerOrderInfo = toObject(parsed?.customer_order_info || draft?.customer_order_info || parsed?.customerOrderInfo || draft?.customerOrderInfo || {});
  const aiInterpretation = toObject(parsed?.ai_inferred || parsed?.ai_interpretation || draft?.ai_inferred || draft?.ai_interpretation || {});
  const missingFields = toList(parsed?.missing_fields || draft?.missing_fields || parsed?.missingFields || draft?.missingFields);
  const riskFlags = toList(parsed?.risk_flags || draft?.risk_flags || parsed?.riskFlags || draft?.riskFlags);
  const materialWarnings = normalizeWarnings(parsed?.material_mapping_warnings || draft?.material_mapping_warnings || parsed?.materialMappingWarnings || draft?.materialMappingWarnings);
  const helperWarnings = toList(parsed?.warnings || draft?.warnings);
  const calculationRows = useMemo(() => normalizeCalculationRows(draft?.calculation_table || draft?.calculationTable || parsed?.calculation_table || parsed?.calculationTable, form, parsed, draft), [draft, parsed, form]);
  const quoteInputPreview = toObject(draft?.quote_input || draft?.quoteInput || parsed?.quote_input || parsed?.quoteInput || {});
  const quoteResult = toObject(draft?.quote_result || draft?.quoteResult || parsed?.quote_result || parsed?.quoteResult || {});
  const fatherReviewPanel = toObject(draft?.father_review_panel || draft?.fatherReviewPanel || parsed?.father_review_panel || parsed?.fatherReviewPanel || {});
  const confidence = safeText(parsed?.confidence || draft?.confidence || aiInterpretation.confidence || 'medium');
  const suggestedCostType = safeText(parsed?.suggested_cost_type || draft?.suggested_cost_type || aiInterpretation.suggested_cost_type || '-');
  const overallWarnings = [...materialWarnings, ...helperWarnings].filter(Boolean);

  const applyDraftToForm = (source: any) => {
    const q = toObject(source?.quote_input || source?.quoteInput || {});
    const thick = normalizeLayerInput(q.thick || q.layers?.map((item: any) => item?.thick ?? item?.thickness ?? item?.thickness_c) || q.thickness || q.layer_thickness);
    const proportion = normalizeLayerInput(q.proportion || q.proportions || q.prop || q.density);
    const price = normalizeLayerInput(q.price || q.prices || q.unit_price || q.unitPrice);
    setForm({
      thick,
      proportion,
      price,
      jgf: safeText(q.jgf ?? source?.jgf ?? source?.jgf_value ?? ''),
      zxyf: safeText(q.zxyf ?? source?.zxyf ?? source?.freight ?? '600'),
      yf: safeText(q.yf ?? source?.yf ?? '600'),
      fqfy: safeText(q.fqfy ?? source?.fqfy ?? '400'),
      lldj: safeText(q.lldj ?? source?.lldj ?? ''),
      ba_zdf: safeText(q.ba_zdf ?? source?.ba_zdf ?? ''),
      sh: safeText(q.sh ?? source?.sh ?? '10'),
      lr: safeText(q.lr ?? source?.lr ?? '12'),
    });
  };

  const primeReviewForm = (source: any) => {
    const panel = toObject(source?.father_review_panel || source?.fatherReviewPanel || {});
    const result = toObject(source?.quote_result || source?.quoteResult || {});
    setReviewForm(prev => ({
      father_note: safeText(panel.father_note ?? panel.fatherNote ?? prev.father_note),
      father_correction_note: safeText(panel.father_correction_note ?? panel.fatherCorrectionNote ?? prev.father_correction_note),
      approved_unit_price: safeText(panel.approved_unit_price ?? panel.approvedUnitPrice ?? result.finalQuote ?? result.final_quote ?? prev.approved_unit_price),
      approved_total_price: safeText(panel.approved_total_price ?? panel.approvedTotalPrice ?? result.finalQuote ?? result.final_quote ?? prev.approved_total_price),
      changed_fields: safeText(panel.changed_fields ?? panel.changedFields ?? prev.changed_fields),
    }));
  };

  const applyAssistantResponse = (parsedPayload: any, draftPayload?: any) => {
    setParsed(parsedPayload);
    if (draftPayload) {
      setDraft(draftPayload);
      applyDraftToForm(draftPayload);
      primeReviewForm(draftPayload);
    } else {
      primeReviewForm(parsedPayload);
    }
  };

  const handleParse = async () => {
    if (!orderText.trim()) {
      setError('内部订单原文为空，无法生成预核价。');
      return;
    }
    setIsParsing(true);
    setError('');
    setSuccess('');
    try {
      const parseFn = service.parseForeignCosting;
      const draftFn = service.createForeignCostingDraft;
      if (typeof parseFn !== 'function' || typeof draftFn !== 'function') {
        throw new Error('内部服务未就绪：缺少 parseForeignCosting / createForeignCostingDraft。');
      }
      const parsedResp = unwrapResponse(await parseFn({ text: orderText }));
      if (!parsedResp || typeof parsedResp !== 'object') {
        throw new Error('内部解析服务返回了无效数据。');
      }
      const draftResp = unwrapResponse(await draftFn({
        text: orderText,
        parsed_spec: parsedResp.parsed_spec || parsedResp.parsedSpec || parsedResp,
        parsed: parsedResp,
        quote_input: buildQuoteInput(form),
        internal_only: true,
      }));
      if (!draftResp || typeof draftResp !== 'object') {
        throw new Error('内部预核价服务返回了无效数据。');
      }
      applyAssistantResponse(parsedResp, draftResp);
      setSuccess('内部预核价已生成，待陈湧杰复核。');
    } catch (err: any) {
      setDraft(null);
      setReview(null);
      setError(err?.message || '内部预核价生成失败。');
    } finally {
      setIsParsing(false);
    }
  };

  const handleRecalculate = async () => {
    if (!orderText.trim()) {
      setError('请先输入或填充客户订单原文。');
      return;
    }
    setIsParsing(true);
    setError('');
    setSuccess('');
    try {
      const parseFn = service.parseForeignCosting;
      const draftFn = service.createForeignCostingDraft;
      if (typeof draftFn !== 'function') {
        throw new Error('内部服务未就绪：缺少 createForeignCostingDraft。');
      }
      const parsedResp = parsed && typeof parsed === 'object' ? parsed : (typeof parseFn === 'function' ? unwrapResponse(await parseFn({ text: orderText })) : null);
      if (!parsedResp || typeof parsedResp !== 'object') {
        throw new Error('内部解析结果缺失，无法重新预核价。');
      }
      const draftResp = unwrapResponse(await draftFn({
        text: orderText,
        parsed_spec: parsedResp.parsed_spec || parsedResp.parsedSpec || parsedResp,
        parsed: parsedResp,
        quote_input: buildQuoteInput(form),
        draft_id: draft?.id || draft?.draft_id,
        internal_only: true,
      }));
      if (!draftResp || typeof draftResp !== 'object') {
        throw new Error('内部预核价服务返回了无效数据。');
      }
      applyAssistantResponse(parsedResp, draftResp);
      setSuccess('内部预核价已刷新，待陈湧杰复核。');
    } catch (err: any) {
      setError(err?.message || '内部重新预核价失败。');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSaveReview = async () => {
    if (!draft) {
      setError('请先生成内部预核价，再保存复核。');
      return;
    }
    setIsSaving(true);
    setError('');
    setSuccess('');
    try {
      const saveFn = service.saveForeignCostingReview;
      if (typeof saveFn !== 'function') {
        throw new Error('内部服务未就绪：缺少 saveForeignCostingReview。');
      }
      const changedFields = parseChangedFields(reviewForm.changed_fields);
      const resp = unwrapResponse(await saveFn({
        draft_id: draft.id || draft.draft_id,
        reviewed_input: buildQuoteInput(form),
        reviewed_result: quoteResult,
        father_note: reviewForm.father_note,
        father_correction_note: reviewForm.father_correction_note,
        approved_unit_price: parseNumberOrNull(reviewForm.approved_unit_price),
        approved_total_price: parseNumberOrNull(reviewForm.approved_total_price),
        changed_fields: changedFields,
        internal_only: true,
      }));
      if (!resp || typeof resp !== 'object') {
        throw new Error('复核保存失败：内部服务返回了无效数据。');
      }
      setReview(resp);
      setSuccess('内部复核已保存。');
    } catch (err: any) {
      setError(err?.message || '保存内部复核失败。');
    } finally {
      setIsSaving(false);
    }
  };

  const fillFerreno = () => {
    setOrderText(FERRENO_SAMPLE);
    setError('');
    setSuccess('');
  };

  return (
    <div className="max-w-[1400px] mx-auto p-1 sm:p-3 md:p-6 space-y-2 bg-slate-50 min-h-screen">
      <div className="bg-white border border-slate-200 rounded-xl p-3 md:p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-indigo-600" />
              <h3 className="text-[15px] font-black text-slate-900">外贸成本复核智能核价助手</h3>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-black">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">内部预核价</span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">待陈湧杰复核</span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200">不可直接对客户报价</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50"
              >
                返回传统核价
              </button>
            )}
            <button
              type="button"
              onClick={fillFerreno}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Ferreno 测试填充
            </button>
            <button
              type="button"
              onClick={handleRecalculate}
              disabled={isParsing}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-indigo-600 text-white text-[12px] font-bold hover:bg-indigo-700 disabled:opacity-60"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isParsing && "animate-spin")} />
              重新预核价
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{success}</div>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 md:p-4 space-y-3">
          <SectionTitle icon={<UserRound className="w-4 h-4" />} title="1. 客户订单信息" />
          <textarea
            value={orderText}
            onChange={e => setOrderText(e.target.value)}
            placeholder="粘贴客户原始询价、邮件、WhatsApp 或 CRM 备注。"
            className="w-full min-h-[140px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleParse}
              disabled={isParsing || !orderText.trim()}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-800 disabled:opacity-60"
            >
              <Search className="w-3.5 h-3.5" />
              {isParsing ? '处理中...' : '解析并生成内部预核价'}
            </button>
          </div>
          <ValueGrid items={pickEntries(customerOrderInfo, [
            'customer_name',
            'destination_country',
            'trade_term',
            'incoterms',
            'quantity_total',
            'quantity_per_variant',
            'variants',
            'size',
            'product_name',
            'customer_name_display',
          ])} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 md:p-4 space-y-3">
          <SectionTitle icon={<Brain className="w-4 h-4" />} title="2. AI 解释" />
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <MiniBadge label="建议袋型" value={suggestedCostType} tone="slate" />
            <MiniBadge label="置信度" value={confidence} tone={confidenceTone(confidence)} />
            <MiniBadge label="状态" value={statusText} tone="indigo" />
          </div>

          {overallWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center gap-2 text-[12px] font-black text-amber-800">
                <ShieldAlert className="w-4 h-4" />
                低置信度映射 / 内部风险提示
              </div>
              <ul className="mt-2 space-y-1 text-[12px] text-amber-900">
                {overallWarnings.map((item, idx) => (
                  <li key={`${item}-${idx}`} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <InfoPanel title="客户提供" icon={<FileText className="w-4 h-4" />} data={toObject(parsed?.customer_provided || parsed?.customerProvided || draft?.customer_provided || draft?.customerProvided || {})} />
            <InfoPanel title="AI 推断" icon={<Brain className="w-4 h-4" />} data={aiInterpretation} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[12px]">
            <InfoStat label="缺失字段" value={missingFields.length ? missingFields.join(' / ') : '—'} />
            <InfoStat label="风险标记" value={riskFlags.length ? riskFlags.join(' / ') : '—'} />
            <InfoStat label="材料映射" value={materialWarnings.length ? `${materialWarnings.length} 条需复核` : '无明显告警'} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 md:p-4 space-y-3">
          <SectionTitle icon={<Calculator className="w-4 h-4" />} title="3. 核价表单" />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-700">
            当前状态：<span className="text-slate-900">{statusText}</span> · <span className="text-rose-700">内部预核价 / 待陈湧杰复核 / 不可直接对客户报价</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px] md:text-[12px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">层数</th>
                  {LAYER_LABELS.map(label => (
                    <th key={label} className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3].map(idx => (
                  <tr key={idx}>
                    <td className="border border-slate-200 px-2 py-1 font-bold text-slate-700">第{idx + 1}层</td>
                    <td className="border border-slate-200 px-1 py-1">
                      <FieldInput value={form.thick[idx]} onChange={value => setLayerForm('thick', idx, value)} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <FieldInput value={form.proportion[idx]} onChange={value => setLayerForm('proportion', idx, value)} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <FieldInput value={form.price[idx]} onChange={value => setLayerForm('price', idx, value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {FORM_FIELDS.map(field => (
              <div key={String(field.key)} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black text-slate-700">{field.label}</div>
                  <div className="text-[10px] font-bold text-slate-400">{field.hint}</div>
                </div>
                <input
                  value={form[field.key]}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  inputMode="decimal"
                  className="mt-1 w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px]">
            <InfoStat label="quote_input 预览" value={previewText(quoteInputPreview)} />
            <InfoStat label="quote_result 预览" value={previewText(quoteResult)} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 md:p-4 space-y-3">
          <SectionTitle icon={<Table2 className="w-4 h-4" />} title="4. 计算表" />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-700">
            结果始终限定为 <span className="text-rose-700">内部预核价 / 待陈湧杰复核 / 不可直接对客户报价</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px] md:text-[12px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">section</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">label</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">field_key</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">formula</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">input_value</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">calculated_value</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">note</th>
                  <th className="border border-slate-200 px-2 py-1 text-left font-black text-slate-600">editable</th>
                </tr>
              </thead>
              <tbody>
                {calculationRows.length > 0 ? calculationRows.map((row, idx) => (
                  <tr key={`${row.field_key}-${idx}`}>
                    <td className="border border-slate-200 px-2 py-1">{row.section}</td>
                    <td className="border border-slate-200 px-2 py-1 font-bold text-slate-800">{row.label}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.field_key}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.formula}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.input_value}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.calculated_value}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.note}</td>
                    <td className="border border-slate-200 px-2 py-1">{row.editable}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="border border-slate-200 px-3 py-4 text-center text-slate-500">等待内部预核价结果。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 md:p-4 space-y-3">
          <SectionTitle icon={<Save className="w-4 h-4" />} title="5. 陈湧杰复核" />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-700">
            仅用于内部复核与留痕，不生成客户报价。
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="space-y-2">
              <LabeledTextarea
                label="father_note"
                value={reviewForm.father_note}
                onChange={value => setReviewForm(prev => ({ ...prev, father_note: value }))}
                placeholder="内部复核备注"
              />
              <LabeledTextarea
                label="father_correction_note"
                value={reviewForm.father_correction_note}
                onChange={value => setReviewForm(prev => ({ ...prev, father_correction_note: value }))}
                placeholder="修正说明"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
              <LabeledInput
                label="approved_unit_price"
                value={reviewForm.approved_unit_price}
                onChange={value => setReviewForm(prev => ({ ...prev, approved_unit_price: value }))}
                placeholder="审核后单价"
              />
              <LabeledInput
                label="approved_total_price"
                value={reviewForm.approved_total_price}
                onChange={value => setReviewForm(prev => ({ ...prev, approved_total_price: value }))}
                placeholder="审核后总价"
              />
              <div className="sm:col-span-2">
                <LabeledTextarea
                  label="changed_fields"
                  value={reviewForm.changed_fields}
                  onChange={value => setReviewForm(prev => ({ ...prev, changed_fields: value }))}
                  placeholder='例如：{"jgf":"18","lr":"12"}'
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRecalculate}
              disabled={isParsing}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isParsing && "animate-spin")} />
              重新预核价
            </button>
            <button
              type="button"
              onClick={handleSaveReview}
              disabled={isSaving || !draft}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? '保存中...' : '保存复核'}
            </button>
          </div>

          {review && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800">
              <div className="font-black">复核保存结果</div>
              <div className="mt-1 break-words">{previewText(review)}</div>
            </div>
          )}
          {fatherReviewPanel && Object.keys(fatherReviewPanel).length > 0 && (
            <InfoPanel title="father_review_panel 预览" icon={<ShieldAlert className="w-4 h-4" />} data={fatherReviewPanel} />
          )}
        </section>
      </div>
    </div>
  );

  function setLayerForm(key: keyof Pick<CostingForm, 'thick' | 'proportion' | 'price'>, idx: number, value: string) {
    setForm(prev => {
      const next = [...prev[key]] as LayerForm;
      next[idx] = value;
      return { ...prev, [key]: next };
    });
  }
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-100 text-slate-700 border border-slate-200">{icon}</span>
      <h4 className="text-[13px] font-black text-slate-800">{title}</h4>
    </div>
  );
}

function ValueGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  if (!items.length) return <div className="text-[12px] text-slate-500">等待解析结果。</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{item.label}</div>
          <div className="mt-0.5 text-[13px] font-bold text-slate-900 break-words">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function InfoPanel({ title, icon, data }: { title: string; icon: React.ReactNode; data: Record<string, any> }) {
  const entries = pickEntries(data, Object.keys(data || {}).slice(0, 8));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-[12px] font-black text-slate-800">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200">{icon}</span>
        {title}
      </div>
      <div className="mt-2 space-y-1.5">
        {entries.length ? entries.map(item => (
          <div key={item.label} className="flex items-start justify-between gap-3 rounded-md bg-white border border-slate-200 px-2 py-1.5">
            <div className="text-[11px] font-bold text-slate-500">{item.label}</div>
            <div className="text-[12px] font-bold text-slate-900 text-right break-words">{item.value}</div>
          </div>
        )) : <div className="text-[12px] text-slate-500">—</div>}
      </div>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-[12px] font-bold text-slate-900 break-words">{value || '—'}</div>
    </div>
  );
}

function FieldInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      inputMode="decimal"
      className="w-full h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
    />
  );
}

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="text-[11px] font-black text-slate-700">{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}

function LabeledTextarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="text-[11px] font-black text-slate-700">{label}</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full min-h-[90px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y"
      />
    </div>
  );
}

function MiniBadge({ label, value, tone }: { label: string; value: string; tone: 'indigo' | 'amber' | 'emerald' | 'slate' }) {
  const toneClasses: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md border", toneClasses[tone])}>
      <span className="text-slate-400">{label}</span>
      <span>{value || '—'}</span>
    </span>
  );
}

function confidenceTone(confidence: string): 'indigo' | 'amber' | 'emerald' | 'slate' {
  const value = String(confidence || '').toLowerCase();
  if (value.includes('high') || value.includes('高')) return 'emerald';
  if (value.includes('medium') || value.includes('中')) return 'amber';
  if (value.includes('low') || value.includes('低')) return 'indigo';
  return 'slate';
}

function safeText(value: any, fallback = '') {
  const text = stringifyDisplay(value);
  return text === '—' ? fallback : text;
}

function toObject(value: any): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function toList(value: any): string[] {
  if (Array.isArray(value)) return value.map(item => safeText(item, '')).filter(Boolean);
  if (value == null || value === '') return [];
  return [safeText(value, '')].filter(Boolean);
}

function normalizeWarnings(value: any): string[] {
  if (!Array.isArray(value)) return toList(value);
  return value.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const confidence = safeText(item.confidence || item.level || '');
      const name = safeText(item.raw_name || item.rawName || item.material || item.name || item.normalized_material || item.normalizedMaterial || '');
      const normalized = safeText(item.normalized_material || item.normalizedMaterial || '');
      const note = safeText(item.note || item.message || '');
      return [confidence ? `置信度 ${confidence}` : '', name, normalized && normalized !== name ? `→ ${normalized}` : '', note].filter(Boolean).join(' ');
    }
    return safeText(item, '');
  }).filter(Boolean);
}

function normalizeLayerInput(value: any): LayerForm {
  const base: LayerForm = ['', '', '', ''];
  if (Array.isArray(value)) {
    return [0, 1, 2, 3].map(idx => safeText(value[idx], '')) as LayerForm;
  }
  if (value && typeof value === 'object') {
    return [0, 1, 2, 3].map(idx => safeText(
      value[idx] ?? value[String(idx)] ?? value[`layer${idx + 1}`] ?? value[`layer_${idx + 1}`] ?? value[`v${idx + 1}`] ?? value[`row${idx + 1}`],
      ''
    )) as LayerForm;
  }
  return base;
}

function normalizeCalculationRows(table: any, form: CostingForm, parsed: any, draft: any) {
  if (Array.isArray(table) && table.length) {
    return table.map((row: any) => ({
      section: safeText(row.section || row.group || row.category || '—', '—'),
      label: safeText(row.label || row.name || row.field_label || row.fieldLabel || '—', '—'),
      field_key: safeText(row.field_key || row.fieldKey || row.key || row.variable || '—', '—'),
      formula: safeText(row.formula || row.calculation || row.rule || '—', '—'),
      input_value: stringifyDisplay(row.input_value ?? row.inputValue ?? row.input ?? row.source ?? '—'),
      calculated_value: stringifyDisplay(row.calculated_value ?? row.calculatedValue ?? row.value ?? row.result ?? '—'),
      note: safeText(row.note || row.comment || row.remark || '—', '—'),
      editable: stringifyDisplay(row.editable ?? row.can_edit ?? row.canEdit ?? '—'),
    }));
  }

  const rows: Array<any> = [];
  [['thick', '厚度(C)'], ['proportion', '比重'], ['price', '单价(元/kg)']].forEach(([key, label]) => {
    [0, 1, 2, 3].forEach(idx => {
      rows.push({
        section: '材料层',
        label: `${label} 第${idx + 1}层`,
        field_key: `${key}[${idx}]`,
        formula: '内部回填',
        input_value: stringifyDisplay(form?.[key as keyof CostingForm]?.[idx] ?? ''),
        calculated_value: stringifyDisplay(form?.[key as keyof CostingForm]?.[idx] ?? ''),
        note: '来自当前表单',
        editable: '是',
      });
    });
  });
  FORM_FIELDS.forEach(field => {
    rows.push({
      section: '费用项',
      label: field.label,
      field_key: String(field.key),
      formula: '内部回填',
      input_value: stringifyDisplay(form[field.key]),
      calculated_value: stringifyDisplay(form[field.key]),
      note: '来自当前表单',
      editable: '是',
    });
  });
  rows.push({
    section: '状态',
    label: 'status',
    field_key: 'status',
    formula: 'internal_pre_quote',
    input_value: stringifyDisplay(parsed?.status || draft?.status || 'internal_pre_quote'),
    calculated_value: stringifyDisplay(parsed?.status || draft?.status || 'internal_pre_quote'),
    note: '内部预核价',
    editable: '否',
  });
  rows.push({
    section: '状态',
    label: 'confidence',
    field_key: 'confidence',
    formula: '内部解释',
    input_value: stringifyDisplay(parsed?.confidence || draft?.confidence || 'medium'),
    calculated_value: stringifyDisplay(parsed?.confidence || draft?.confidence || 'medium'),
    note: '仅用于复核',
    editable: '否',
  });
  return rows;
}

function buildQuoteInput(form: CostingForm) {
  return {
    thick: form.thick.map(v => safeNumber(v)),
    proportion: form.proportion.map(v => safeNumber(v)),
    price: form.price.map(v => safeNumber(v)),
    jgf: safeNumber(form.jgf),
    zxyf: safeNumber(form.zxyf),
    yf: safeNumber(form.yf),
    fqfy: safeNumber(form.fqfy),
    lldj: safeNumber(form.lldj),
    ba_zdf: safeNumber(form.ba_zdf),
    sh: safeNumber(form.sh),
    lr: safeNumber(form.lr),
  };
}

function safeNumber(value: string) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseNumberOrNull(value: string) {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unwrapResponse(value: any) {
  if (!value || typeof value !== 'object') return value;
  if (value.data && typeof value.data === 'object') return value.data;
  if (value.result && typeof value.result === 'object' && !('quote_result' in value)) return value.result;
  return value;
}

function stringifyDisplay(value: any): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    const parts = value.map(item => stringifyDisplay(item)).filter(item => item && item !== '—');
    return parts.length ? parts.join(' / ') : '—';
  }
  if (typeof value === 'object') {
    const preferred = ['display_name', 'displayName', 'name', 'label', 'text', 'value', 'code', 'raw_name', 'normalized_material'];
    for (const key of preferred) {
      const candidate = (value as Record<string, any>)[key];
      if (candidate != null && candidate !== '') return stringifyDisplay(candidate);
    }
    try {
      const text = JSON.stringify(value);
      return text && text !== '{}' ? text : '—';
    } catch {
      return '—';
    }
  }
  return String(value);
}

function previewText(value: any) {
  const text = stringifyDisplay(value);
  if (!text || text === '—') return '—';
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function pickEntries(source: Record<string, any>, preferredKeys: string[]) {
  const safeSource = toObject(source);
  const entries: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  preferredKeys.forEach(key => {
    if (key in safeSource) {
      entries.push({ label: key, value: stringifyDisplay(safeSource[key]) });
      seen.add(key);
    }
  });
  Object.entries(safeSource).forEach(([key, value]) => {
    if (seen.has(key)) return;
    if (entries.length >= 8) return;
    entries.push({ label: key, value: stringifyDisplay(value) });
  });
  return entries;
}

function parseChangedFields(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

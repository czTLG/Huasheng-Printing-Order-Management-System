import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Globe, MessageSquarePlus, Plus, RefreshCcw, Save } from 'lucide-react';
import { mockService } from '../../lib/mockService';
import CrmCustomerResearchNotes from './CrmCustomerResearchNotes';
import CrmQuoteReadinessCard from './CrmQuoteReadinessCard';
import CrmAttachmentGallery from './attachments/CrmAttachmentGallery';
import { CRM_STAGE_OPTIONS, getCrmStageLabel, normalizeCrmStage } from '../../lib/crmStage';

type Props = {
  customerId: number;
  onBack: () => void;
  onOpenInquiry?: (id: number) => void;
  backLabel?: string;
};

const fieldClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[80px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmCustomerDetail({ customerId, onBack, onOpenInquiry, backLabel = '返回客户列表' }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<number | null>(null);
  const [selectedSuggestionPreview, setSelectedSuggestionPreview] = useState<any>(null);
  const [suggestionApplyForm, setSuggestionApplyForm] = useState<any>({ apply_fields: [], allow_create_customer: false, allow_update_customer: true, allow_create_inquiry: false, allow_create_specification: false, allow_create_communication_log: false, apply_priority: false, review_note: '' });
  const [customerForm, setCustomerForm] = useState<any>({});
  const [commForm, setCommForm] = useState({ channel: 'whatsapp', direction: 'inbound', subject: '', raw_content: '' });
  const [inquiryForm, setInquiryForm] = useState({ inquiry_title: '', product_type: '', packaging_type: '', quantity: '', destination_country: '', priority: 'C', next_action: '' });
  const [readinessBusy, setReadinessBusy] = useState(false);

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
        website: detail.customer?.website || '',
        customer_type: detail.customer?.customer_type || '',
        industry: detail.customer?.industry || '',
        main_product: detail.customer?.main_product || '',
        priority: detail.customer?.priority || 'C',
        stage: normalizeCrmStage(detail.customer?.stage || 'new_unprocessed'),
        customer_summary: detail.customer?.customer_summary || detail.customer?.ai_summary || '',
        business_background: detail.customer?.business_background || '',
        priority_reason: detail.customer?.priority_reason || '',
        next_action: detail.customer?.next_action || '',
        risk_notes: detail.customer?.risk_notes || '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [customerId]);

  const updateField = (key: string, value: string) => setCustomerForm((prev: any) => ({ ...prev, [key]: value }));

  const recalculateLatestReadiness = async () => {
    const latestInquiryId = Number(data?.latestInquiry?.id || 0);
    if (!latestInquiryId) return;
    setReadinessBusy(true);
    try {
      await mockService.recalculateCrmInquiryQuoteReadiness(latestInquiryId);
      await load();
    } finally {
      setReadinessBusy(false);
    }
  };

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

  const buildApplyForm = (preview: any) => {
    const fields = Array.isArray(preview?.diff) ? preview.diff.map((item: any) => item.field).filter((field: string) => field !== 'priority') : [];
    const type = preview?.suggestion?.suggestion_type || '';
    return {
      apply_fields: fields,
      allow_create_customer: !!preview?.apply_plan?.will_create_customer,
      allow_update_customer: !!preview?.apply_plan?.will_update_customer,
      allow_create_inquiry: type === 'inquiry' && !!preview?.apply_plan?.will_create_inquiry,
      allow_create_specification: type === 'specification',
      allow_create_communication_log: type === 'communication_log',
      apply_priority: false,
      review_note: ''
    };
  };

  const previewSuggestion = async (id: number) => {
    setSuggestionBusy(true);
    try {
      const preview = await mockService.getCrmImportSuggestionPreview(id);
      setSelectedSuggestionId(id);
      setSelectedSuggestionPreview(preview);
      setSuggestionApplyForm(buildApplyForm(preview));
    } finally {
      setSuggestionBusy(false);
    }
  };

  const openQuoteReadinessSuggestion = async (id: number) => {
    await previewSuggestion(id);
    window.requestAnimationFrame(() => {
      document.getElementById('crm-suggestions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const toggleSuggestionField = (field: string) => {
    setSuggestionApplyForm((prev: any) => ({
      ...prev,
      apply_fields: prev.apply_fields.includes(field)
        ? prev.apply_fields.filter((item: string) => item !== field)
        : [...prev.apply_fields, field]
    }));
  };

  const applySuggestion = async (id: number) => {
    setSuggestionBusy(true);
    try {
      await mockService.applyCrmImportSuggestion(id, suggestionApplyForm);
      setSelectedSuggestionId(null);
      setSelectedSuggestionPreview(null);
      await load();
    } finally {
      setSuggestionBusy(false);
    }
  };

  const updateSuggestionStatus = async (id: number, status: string) => {
    setSuggestionBusy(true);
    try {
      await mockService.updateCrmImportSuggestion(id, { status });
      if (selectedSuggestionId === id) {
        setSelectedSuggestionId(null);
        setSelectedSuggestionPreview(null);
      }
      await load();
    } finally {
      setSuggestionBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-bold text-slate-400">加载客户详情...</div>;
  if (!data?.customer) return <div className="p-8 text-sm font-bold text-slate-400">客户不存在</div>;

  const latest = data.latestInquiry;
  const latestSpecification = data.latestSpecification;
  const latestCommunication = data.latestCommunication;
  const latestResearchNote = data.latestResearchNote;
  const overview = data.overview || {};
  const inquiries = Array.isArray(data.inquiries) ? data.inquiries : [];
  const communications = Array.isArray(data.communications) ? data.communications : [];
  const whatsappMessages = Array.isArray(data.whatsappMessages) ? data.whatsappMessages : [];
  const costingRequests = Array.isArray(data.costingRequests) ? data.costingRequests : [];
  const freightQuotes = Array.isArray(data.freightQuotes) ? data.freightQuotes : [];
  const timelineItems = Array.isArray(data.timelineItems) ? data.timelineItems : [];
  const relatedEmails = Array.isArray(data.relatedEmails) ? data.relatedEmails : [];
  const emailConversations = Array.isArray(data.emailConversations) ? data.emailConversations : [];
  const importSuggestions = Array.isArray(data.importSuggestions) ? data.importSuggestions : [];
  const auditLogs = Array.isArray(data.audit_logs) ? data.audit_logs : [];
  const quoteSuggestions = importSuggestions.filter((item: any) => item.suggestion_type === 'quotation_draft');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> {backLabel}
        </button>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 border border-slate-100 rounded-lg p-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">{data.customer.display_name}</h2>
        <div className="text-xs text-slate-500 mt-1">{[data.customer.country, data.customer.city, data.customer.customer_type, data.customer.industry].filter(Boolean).join(' · ') || '客户基础标签待补充'}</div>
              </div>
              <div className="flex gap-2">
                <span className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{data.customer.priority || 'C'}</span>
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 text-xs font-black">{getCrmStageLabel(data.customer.stage || 'new_unprocessed')}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">最近询盘</div>
                <div className="text-sm font-black text-slate-900 mt-1">{latest?.inquiry_title || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">{latest?.status || '-'} · {latest?.quantity || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">完整度：{latest?.quote_readiness?.status || '未评估'} / 分数 {latest?.quote_readiness?.score ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">最近核价</div>
                <div className="text-sm font-black text-slate-900 mt-1">{overview.latestCosting?.costing_request_code || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">{overview.latestCosting?.status || '暂无'} · 待处理 {overview.pending_costing_count || 0}</div>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">最近物流</div>
                <div className="text-sm font-black text-slate-900 mt-1">{overview.latestFreight?.freight_quote_code || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">{overview.latestFreight?.status || '暂无'} · 总计 {overview.freight_quote_count || 0}</div>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">待确认导入建议</div>
                <div className="text-sm font-black text-slate-900 mt-1">{data.pendingImportSuggestionCount || 0}</div>
                <div className="text-xs text-slate-500 mt-1">最新调研 {latestResearchNote?.title || '未记录'}</div>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">报价资料完整度</div>
                <div className="text-sm font-black text-slate-900 mt-1">{latest?.quote_readiness?.status || '未评估'}</div>
                <div className="text-xs text-slate-500 mt-1">{latest?.quote_readiness?.next_action || '点击下方卡片重新计算'}</div>
                <button disabled={readinessBusy || !latest?.id} onClick={recalculateLatestReadiness} className="mt-2 h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-700 disabled:opacity-60">重新计算</button>
              </div>
            </div>
            {latest?.quote_readiness ? (
              <CrmQuoteReadinessCard
                readiness={latest.quote_readiness}
                onRecalculate={recalculateLatestReadiness}
                onViewSuggestion={openQuoteReadinessSuggestion}
                onReviewSuggestion={openQuoteReadinessSuggestion}
                loading={readinessBusy}
                title="最新询盘报价资料完整度"
              />
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">客户总览</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{data.customer.customer_summary || data.customer.ai_summary || data.customer.business_background || '暂无客户概览摘要'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">当前待处理事项</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{data.customer.next_action || latest?.next_action || '暂无下一步动作'}</div>
                <div className="text-xs text-slate-500 mt-2">下次跟进：{data.customer.next_followup_at || '-'} / 最近联系：{data.customer.last_contact_at || '-'}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-white border border-slate-100 px-2 py-1">待 AI 解读：{data.currentTasks?.messages_pending_ai || 0}</div>
                  <div className="rounded bg-white border border-slate-100 px-2 py-1">待父亲确认：{data.currentTasks?.father_tasks_pending || 0}</div>
                  <div className="rounded bg-white border border-slate-100 px-2 py-1">父亲已回复：{data.currentTasks?.father_tasks_done_pending_sales || 0}</div>
                  <div className="rounded bg-white border border-slate-100 px-2 py-1">报价草稿：{data.currentTasks?.costing_drafts_pending_review || 0}</div>
                </div>
                {data.currentTasks?.latest_father_task ? (
                  <div className="mt-2 rounded bg-indigo-50 border border-indigo-100 px-2 py-1 text-xs text-indigo-800">
                    父亲任务：{data.currentTasks.latest_father_task.question_cn || data.currentTasks.latest_father_task.father_reply_cn || '-'}
                  </div>
                ) : null}
                {data.currentTasks?.latest_costing_draft ? (
                  <div className="mt-2 rounded bg-purple-50 border border-purple-100 px-2 py-1 text-xs text-purple-800">
                    报价助手 draft #{data.currentTasks.latest_costing_draft.id}：{data.currentTasks.latest_costing_draft.status || '-'}
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <div className="text-xs font-bold text-slate-400">核价与物流状态</div>
                <div className="text-sm text-slate-700 mt-1">待核价 {overview.pending_costing_count || 0} / 已完成 {overview.completed_costing_count || 0}</div>
                <div className="text-sm text-slate-700 mt-1">当前物流 {overview.selectedFreight?.freight_quote_code || '未记录'} / {overview.selectedFreight?.total_freight_cost || '未记录'}</div>
                <div className="text-xs text-slate-500 mt-2">有效期：{overview.selectedFreight?.valid_until || '未记录'}</div>
              </div>
            </div>
            {data.customer.risk_notes || latestResearchNote?.risk_flags ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-3 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{data.customer.risk_notes || latestResearchNote?.risk_flags}</span>
              </div>
            ) : null}
          </div>
          <div className="border border-slate-100 rounded-lg p-4 space-y-3">
            <div className="text-sm font-black text-slate-900">联系信息</div>
            <div className="text-sm text-slate-600">联系人：{data.customer.contact_person || data.customer.contact || '未记录'}</div>
            <div className="text-sm text-slate-600">Email：{data.customer.email || '未记录'}</div>
            <div className="text-sm text-slate-600">WhatsApp：{data.customer.whatsapp || '未记录'}</div>
            <div className="text-sm text-slate-600 flex items-center gap-2"><Globe className="w-4 h-4 text-slate-400" />{data.customer.website || latestResearchNote?.website || '未记录'}</div>
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              <div>来源：{data.customer.source_channel || '-'}</div>
              <div>负责人：{data.customer.owner_id || '-'}</div>
              <div>最后更新：{data.customer.updated_at || '-'}</div>
              <div>WhatsApp：{whatsappMessages.length} / 核价：{costingRequests.length} / 物流：{freightQuotes.length}</div>
            </div>
            {latestCommunication ? (
              <div className="pt-2 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-400">最近沟通摘要</div>
              <div className="text-sm text-slate-700 mt-1">{latestCommunication.ai_summary || latestCommunication.subject || latestCommunication.raw_content || '未记录'}</div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">客户时间线</h2>
          <div className="text-xs text-slate-500">WhatsApp / Gmail / 报价 / 跟进 / 物流</div>
        </div>
        {timelineItems.length === 0 ? (
          <div className="text-sm text-slate-400">暂无时间线记录</div>
        ) : (
          <div className="space-y-3">
            {timelineItems.slice(0, 40).map((item: any, index: number) => (
              <div key={`${item.source_type || item.kind || 'item'}-${item.source_id || index}-${item.at || index}`} className={`rounded-lg border px-4 py-3 ${item.kind === 'whatsapp' ? 'border-emerald-100 bg-emerald-50/50' : item.kind === 'email' ? 'border-indigo-100 bg-indigo-50/50' : item.kind === 'quotation' ? 'border-amber-100 bg-amber-50/50' : item.kind === 'freight' ? 'border-sky-100 bg-sky-50/50' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-slate-900">{item.title || '记录'}</div>
                  <div className="text-xs font-bold text-slate-500">{item.at || '-'}</div>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-black">
                  <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">{item.kind || 'event'}</span>
                  {item.note ? <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">{item.note}</span> : null}
                  {item.highlight ? <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">待分析</span> : null}
                </div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap mt-2">{item.summary || '-'}</div>
                {Array.isArray(item.attachments) && item.attachments.length > 0 ? (
                  <div className="mt-3">
                    <CrmAttachmentGallery
                      attachments={item.attachments}
                      compact
                      maxVisible={4}
                      onJumpToMessage={(id) => {
                        window.history.pushState({}, '', `/crm/messages/${id}`);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">客户档案字段</h2>
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
          <input className={fieldClass} value={customerForm.website} onChange={e => updateField('website', e.target.value)} placeholder="网站" />
          <input className={fieldClass} value={customerForm.customer_type} onChange={e => updateField('customer_type', e.target.value)} placeholder="客户类型" />
          <input className={fieldClass} value={customerForm.industry} onChange={e => updateField('industry', e.target.value)} placeholder="行业" />
          <input className={fieldClass} value={customerForm.main_product} onChange={e => updateField('main_product', e.target.value)} placeholder="主营产品" />
          <select className={fieldClass} value={customerForm.priority} onChange={e => updateField('priority', e.target.value)}>
            <option value="A">A 重点</option>
            <option value="B">B 潜力</option>
            <option value="C">C 普通</option>
            <option value="D">D 暂缓</option>
          </select>
          <select className={fieldClass} value={customerForm.stage} onChange={e => updateField('stage', normalizeCrmStage(e.target.value))}>
            {CRM_STAGE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea className={areaClass} value={customerForm.customer_summary} onChange={e => updateField('customer_summary', e.target.value)} placeholder="客户摘要 / 调研摘要" />
          <textarea className={areaClass} value={customerForm.business_background} onChange={e => updateField('business_background', e.target.value)} placeholder="业务背景" />
          <textarea className={areaClass} value={customerForm.priority_reason} onChange={e => updateField('priority_reason', e.target.value)} placeholder="优先级原因" />
          <textarea className={areaClass} value={customerForm.next_action} onChange={e => updateField('next_action', e.target.value)} placeholder="下一步动作" />
          <textarea className={areaClass} value={customerForm.risk_notes} onChange={e => updateField('risk_notes', e.target.value)} placeholder="风险备注" />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-black text-slate-800 mb-3">最近一单询盘</h3>
        {latest ? (
          <button onClick={() => onOpenInquiry?.(Number(latest.id))} className="w-full text-left rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 hover:border-indigo-300 space-y-1">
            <div className="text-sm font-black text-indigo-900">{latest.inquiry_title}</div>
            <div className="text-xs font-bold text-indigo-600">{latest.status} · {latest.priority} · {latest.quantity || '-'}</div>
            <div className="text-xs text-indigo-700">{latestSpecification ? `${latestSpecification.bag_type || latestSpecification.film_type || latestSpecification.product_type || '未记录'} · ${latestSpecification.material_structure_text || '未记录'}` : '暂无当前规格'}</div>
          </button>
        ) : <div className="text-sm text-slate-400">暂无询盘</div>}
      </section>

      <CrmCustomerResearchNotes customerId={customerId} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-indigo-600" /> 沟通记录</h3>
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
                <div className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{item.ai_summary || item.raw_content || '-'}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-600" /> 询盘项目</h3>
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
                <div className="text-xs text-slate-500 mt-1">{item.status} · {item.priority} · {item.destination_country || '-'} · {item.trade_term_requested || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">报价资料：{item.quote_readiness?.status || '未评估'} · 分数 {item.quote_readiness?.score ?? 0} · {item.quote_readiness?.next_action || '-'}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section id="crm-suggestions" className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">邮件线程</h3>
        {emailConversations.length === 0 ? (
          <div className="text-sm text-slate-400">暂无邮件线程</div>
        ) : emailConversations.map((item: any) => (
          <div key={`${item.conversation_key}-${item.latest_at}`} className="border border-slate-100 rounded-lg p-3">
            <div className="flex justify-between gap-3 text-xs text-slate-400">
              <span>{item.latest_from_name || item.latest_from_email || '-'} · {item.latest_direction || '-'}</span>
              <span>{item.latest_at || '-'}</span>
            </div>
            <div className="text-sm font-bold text-slate-800 mt-1">{item.latest_subject || '(无主题)'}</div>
            <div className="text-xs text-slate-500 mt-1">线程 {item.conversation_key || '未分组'} · {item.message_count || 0} 封</div>
            <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{item.latest_preview || '未记录'}</div>
          </div>
        ))}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">关联邮件</h3>
        {relatedEmails.length === 0 ? (
          <div className="text-sm text-slate-400">暂无关联邮件</div>
        ) : relatedEmails.map((item: any) => (
          <div key={item.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex justify-between gap-3 text-xs text-slate-400">
              <span>{item.from_name || item.from_email || '-'} · {item.direction || '-'}</span>
              <span>{item.received_at || '-'}</span>
            </div>
            <div className="text-sm font-bold text-slate-800 mt-1">{item.subject || '(无主题)'}</div>
            <div className="text-xs text-slate-500 mt-1">处理状态：{item.processing_status || 'new'}</div>
            <div className="text-xs text-slate-500 mt-1">线程：{item.conversation_key || '未分组'} · 报价 {Number(item.quote_detected || 0) ? '是' : '否'} · 询盘 {Number(item.inquiry_detected || 0) ? '是' : '否'}</div>
            <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{item.preview || '未记录'}</div>
          </div>
        ))}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">待确认建议</h3>
        {importSuggestions.length === 0 ? (
          <div className="text-sm text-slate-400">暂无待确认建议</div>
        ) : importSuggestions.slice(0, 12).map((item: any) => (
          <div key={item.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex justify-between gap-3 text-xs text-slate-400">
              <span>{item.suggestion_type}</span>
              <span>{item.status || 'pending'} · {item.confidence || '-'}</span>
            </div>
            <div className="text-sm text-slate-700 mt-1">{item.summary || '未记录'}</div>
            <div className="text-xs text-slate-500 mt-1">来源邮件：{item.source_email_subject || '未记录'}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button disabled={suggestionBusy} onClick={() => previewSuggestion(Number(item.id))} className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-60">预览应用</button>
              <button disabled={suggestionBusy} onClick={() => updateSuggestionStatus(Number(item.id), 'rejected')} className="h-8 px-3 rounded-lg border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700 disabled:opacity-60">拒绝</button>
              <button disabled={suggestionBusy} onClick={() => updateSuggestionStatus(Number(item.id), 'ignored')} className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 disabled:opacity-60">忽略</button>
            </div>
            {selectedSuggestionId === Number(item.id) && selectedSuggestionPreview ? (
              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-3">
                {(selectedSuggestionPreview.warnings || []).length > 0 && (
                  <div className="text-xs text-amber-800">{selectedSuggestionPreview.warnings.join(' | ')}</div>
                )}
                <div className="space-y-2">
                  {(selectedSuggestionPreview.diff || []).map((diff: any) => (
                    <label key={diff.field} className="flex items-start gap-2 rounded-lg border border-white/80 bg-white px-3 py-2 text-xs">
                      <input type="checkbox" checked={suggestionApplyForm.apply_fields.includes(diff.field)} onChange={() => toggleSuggestionField(diff.field)} className="mt-0.5" />
                      <div>
                        <div className="font-bold text-slate-800">{diff.field} · {diff.action}</div>
                        <div className="text-slate-500">当前：{String(diff.current_value || '未记录')}</div>
                        <div className="text-indigo-700">建议：{String(diff.suggested_value || '未记录')}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.allow_create_customer} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, allow_create_customer: e.target.checked }))} />允许创建客户</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.allow_update_customer} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, allow_update_customer: e.target.checked }))} />允许更新客户</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.allow_create_inquiry} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, allow_create_inquiry: e.target.checked }))} />允许创建询盘</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.allow_create_specification} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, allow_create_specification: e.target.checked }))} />允许创建规格</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.allow_create_communication_log} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, allow_create_communication_log: e.target.checked }))} />允许创建沟通记录</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!suggestionApplyForm.apply_priority} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, apply_priority: e.target.checked, apply_fields: e.target.checked ? Array.from(new Set([...prev.apply_fields, 'priority'])) : prev.apply_fields.filter((field: string) => field !== 'priority') }))} />允许应用优先级</label>
                </div>
                <textarea className={`${areaClass} w-full`} value={suggestionApplyForm.review_note} onChange={e => setSuggestionApplyForm((prev: any) => ({ ...prev, review_note: e.target.value }))} placeholder="review note" />
                <button disabled={suggestionBusy} onClick={() => applySuggestion(Number(item.id))} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black disabled:opacity-60">确认入库</button>
              </div>
            ) : null}
          </div>
        ))}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">报价线索</h3>
        {quoteSuggestions.length === 0 ? (
          <div className="text-sm text-slate-400">暂无报价线索</div>
        ) : quoteSuggestions.map((item: any) => {
          let extracted: any = {};
          try { extracted = JSON.parse(item.extracted_json || '{}'); } catch {}
          return (
            <div key={item.id} className="border border-indigo-100 rounded-lg bg-indigo-50 p-3">
              <div className="flex justify-between gap-3 text-xs text-indigo-600">
                <span>{extracted.trade_term || '未识别条款'} · {extracted.quote_currency || '-'} · {item.confidence || '-'}</span>
                <span>{item.status || 'pending'}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2 text-sm text-indigo-900">
                <div>单价：{extracted.unit_price || extracted.exw_price || extracted.fob_price || extracted.cif_price || '-'}</div>
                <div>总价：{extracted.total_amount || '-'}</div>
                <div>数量：{extracted.quantity || '-'}</div>
                <div>付款：{extracted.payment_terms || '-'}</div>
                <div>交期：{extracted.lead_time || '-'}</div>
                <div>来源邮件：{item.source_email_subject || '-'}</div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-800">CRM 修改日志</h3>
        {auditLogs.length === 0 ? (
          <div className="text-sm text-slate-400">暂无 CRM 修改日志</div>
        ) : auditLogs.slice(0, 8).map((log: any) => (
          <div key={log.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex justify-between gap-3 text-xs text-slate-400">
              <span>{log.action}</span>
              <span>{log.created_at}</span>
            </div>
            <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{log.detail || '-'}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

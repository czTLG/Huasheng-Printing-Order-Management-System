import React from 'react';
import { RefreshCcw, ShieldAlert, Sparkles } from 'lucide-react';

type Readiness = {
  status?: string;
  color?: string;
  score?: number;
  missing_required_fields?: string[];
  missing_optional_fields?: string[];
  warnings?: string[];
  next_action?: string;
  mode?: string;
  pending_ai_candidates?: PendingAiCandidate[];
  field_candidate_map?: Record<string, AiFieldCandidate[]>;
  has_pending_specification_suggestion?: boolean;
  suggested_apply_actions?: SuggestedApplyAction[];
};

type AiFieldCandidate = {
  suggestion_id?: number;
  value?: any;
  confidence?: string;
  source_type?: string;
  source_id?: number | null;
  email_ai_analysis_run_id?: number | null;
  matched_customer_id?: number | null;
  matched_inquiry_id?: number | null;
  created_at?: string | null;
  evidence_summary?: string;
};

type PendingAiCandidate = {
  suggestion_id?: number;
  suggestion_type?: string;
  confidence?: string;
  summary?: string;
  source_type?: string;
  source_id?: number | null;
  email_ai_analysis_run_id?: number | null;
  matched_customer_id?: number | null;
  matched_inquiry_id?: number | null;
  candidate_fields?: Record<string, any>;
  evidence_summary?: string;
  created_at?: string | null;
};

type SuggestedApplyAction = {
  action_type?: string;
  suggestion_id?: number;
  label?: string;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  ready: { label: '可报价', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: '部分完整', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  blocked: { label: '资料不足', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  need_customer_info: { label: '待补客户资料', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  technical_check: { label: '技术确认', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  boss_check: { label: '老板确认', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const FIELD_LABELS: Record<string, string> = {
  product_mode: '袋型/卷膜类型',
  bag_type: '袋型',
  film_usage_or_product_type: '产品/膜用途',
  size: '尺寸',
  roll_width: '卷宽',
  repeat_length: '重复长度',
  quantity: '数量',
  destination_country: '目的国',
  trade_term_requested: '贸易条款',
  material_structure_text: '材料结构',
  thickness_total: '厚度',
  printing_colors: '印刷颜色',
  surface_finish: '表面处理',
  product_content: '产品内容',
  filling_weight: '装料重量',
  artwork_status: '设计稿',
  core_id: '芯径',
  max_roll_diameter: '最大卷径',
  packing_machine_type: '包装机型',
  roll_length: '卷长',
  zipper_required: '拉链',
  spout_required: '吸嘴',
  valve_required: '阀门',
  tear_notch_required: '易撕口',
  window_required: '开窗',
  shelf_life_requirement: '保质期',
  high_barrier_required: '高阻隔',
  retort_required: '蒸煮',
  frozen_required: '冷冻',
  technical_structure: '技术结构',
  technical_notes: '技术备注',
};

function labelForField(field: string) {
  return FIELD_LABELS[field] || field;
}

function chipClass(kind = 'neutral') {
  if (kind === 'required') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (kind === 'warning') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function StatusBadge({ status }: { status?: string }) {
  const meta = STATUS_META[String(status || 'blocked')] || STATUS_META.blocked;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-black ${meta.className}`}>{meta.label}</span>;
}

export default function CrmQuoteReadinessCard({
  readiness,
  onRecalculate,
  onViewSuggestion,
  onReviewSuggestion,
  loading = false,
  title = '报价资料完整度',
}: {
  readiness?: Readiness | null;
  onRecalculate?: () => void;
  onViewSuggestion?: (id: number) => void;
  onReviewSuggestion?: (id: number) => void;
  loading?: boolean;
  title?: string;
}) {
  const data = readiness || null;
  const required = Array.isArray(data?.missing_required_fields) ? (data?.missing_required_fields || []) : [];
  const optional = Array.isArray(data?.missing_optional_fields) ? (data?.missing_optional_fields || []) : [];
  const warnings = Array.isArray(data?.warnings) ? (data?.warnings || []) : [];
  const pendingCandidates = Array.isArray(data?.pending_ai_candidates) ? (data?.pending_ai_candidates || []) : [];
  const fieldCandidateMap = data?.field_candidate_map || {};
  const suggestedActions = Array.isArray(data?.suggested_apply_actions) ? (data?.suggested_apply_actions || []) : [];

  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-400">
        暂无报价资料完整度结果
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-indigo-600" />
            {title}
          </div>
          <div className="text-xs text-slate-500 mt-1">模式：{data.mode || 'unknown'} · 分数：{data.score ?? 0}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} />
          {onRecalculate ? (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={loading}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-700 flex items-center gap-2 disabled:opacity-60"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              重新计算
            </button>
          ) : null}
        </div>
      </div>

      <div className="text-sm text-slate-700 whitespace-pre-wrap">{data.next_action || '可进入核价'}</div>

      {required.length > 0 && (
        <div>
          <div className="text-xs font-black text-rose-700 mb-2">缺失的关键字段</div>
          <div className="flex flex-wrap gap-2">
            {required.map((field) => {
              const candidates = Array.isArray(fieldCandidateMap[field]) ? fieldCandidateMap[field] : [];
              return (
                <span key={field} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${chipClass('required')}`}>
                  {labelForField(field)}
                  {candidates.length > 0 ? ' · AI 已提取候选' : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {optional.length > 0 && (
        <div>
          <div className="text-xs font-black text-amber-700 mb-2">待确认字段</div>
          <div className="flex flex-wrap gap-2">
            {optional.map((field) => <span key={field} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${chipClass('warning')}`}>{labelForField(field)}</span>)}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 space-y-1">
          {warnings.map((warning) => <div key={warning}>· {warning}</div>)}
        </div>
      )}

      {required.some((field) => Array.isArray(fieldCandidateMap[field]) && fieldCandidateMap[field].length > 0) && (
        <div className="space-y-2">
          <div className="text-xs font-black text-indigo-700">AI 候选字段</div>
          {required.map((field) => {
            const candidates = Array.isArray(fieldCandidateMap[field]) ? fieldCandidateMap[field] : [];
            if (!candidates.length) return null;
            return (
              <div key={field} className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
                <div className="text-xs font-black text-indigo-900">{labelForField(field)}</div>
                <div className="space-y-1">
                  {candidates.map((candidate: AiFieldCandidate) => (
                    <div key={`${field}-${candidate.suggestion_id}-${String(candidate.value)}`} className="rounded-md bg-white border border-indigo-100 px-2 py-1 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800">{String(candidate.value || '-')}</span>
                      <span className="text-slate-500">建议 {candidate.confidence || 'low'} · suggestion #{candidate.suggestion_id || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingCandidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-black text-slate-700">待审核 AI 规格建议</div>
          {pendingCandidates.slice(0, 3).map((candidate: PendingAiCandidate) => (
            <div key={candidate.suggestion_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-black text-slate-900">{candidate.summary || 'AI 规格建议'}</span>
                <span className="text-slate-500">{candidate.confidence || 'low'} · #{candidate.suggestion_id || '-'}</span>
              </div>
              <div className="text-xs text-slate-500">{candidate.evidence_summary || '无来源摘要'}</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(candidate.candidate_fields || {}).slice(0, 4).map(([field, value]) => (
                  <span key={`${candidate.suggestion_id}-${field}`} className="rounded-full border border-indigo-100 bg-white px-2 py-0.5 text-xs text-indigo-700">
                    {labelForField(field)}：{String(value || '-')}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {onViewSuggestion ? (
                  <button
                    type="button"
                    onClick={() => candidate.suggestion_id && onViewSuggestion(candidate.suggestion_id)}
                    className="h-8 px-3 rounded-lg border border-indigo-200 bg-white text-xs font-black text-indigo-700"
                  >
                    查看 suggestion
                  </button>
                ) : null}
                {onReviewSuggestion ? (
                  <button
                    type="button"
                    onClick={() => candidate.suggestion_id && onReviewSuggestion(candidate.suggestion_id)}
                    className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-black"
                  >
                    去审核入库
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestedActions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-xs font-black text-slate-700">建议动作</div>
          {suggestedActions.map((action) => (
            <div key={`${action.action_type}-${action.suggestion_id}`} className="text-xs text-slate-600">
              · {action.label || action.action_type || 'review'}
            </div>
          ))}
        </div>
      )}

      {data.status === 'ready' && (
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
          <Sparkles className="w-3.5 h-3.5" />
          资料可进入核价或报价准备
        </div>
      )}
    </div>
  );
}

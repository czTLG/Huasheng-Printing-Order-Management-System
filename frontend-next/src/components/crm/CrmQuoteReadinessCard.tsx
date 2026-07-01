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
  loading = false,
  title = '报价资料完整度',
}: {
  readiness?: Readiness | null;
  onRecalculate?: () => void;
  loading?: boolean;
  title?: string;
}) {
  const data = readiness || null;
  const required = Array.isArray(data?.missing_required_fields) ? (data?.missing_required_fields || []) : [];
  const optional = Array.isArray(data?.missing_optional_fields) ? (data?.missing_optional_fields || []) : [];
  const warnings = Array.isArray(data?.warnings) ? (data?.warnings || []) : [];

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
            {required.map((field) => <span key={field} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${chipClass('required')}`}>{labelForField(field)}</span>)}
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

      {data.status === 'ready' && (
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
          <Sparkles className="w-3.5 h-3.5" />
          资料可进入核价或报价准备
        </div>
      )}
    </div>
  );
}

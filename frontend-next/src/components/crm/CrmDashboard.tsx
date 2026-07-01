import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardList,
  FileSearch,
  Mail,
  MessageSquareText,
  RefreshCcw,
  Star,
  Truck,
  Users,
} from 'lucide-react';
import { mockService } from '../../lib/mockService';
import { getCrmStageLabel } from '../../lib/crmStage';

const emptyText = '未记录';

function text(value: any, fallback = emptyText) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value);
}

function statusClass(value: any) {
  const raw = String(value || '').toLowerCase();
  if (['pending', 'draft', 'requested', 'needs_review'].includes(raw)) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (['in_progress', 'received', 'costing'].includes(raw)) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (['completed', 'selected', 'applied'].includes(raw)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['rejected', 'cancelled', 'expired'].includes(raw)) return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function Pill({ children, value }: { children: React.ReactNode; value?: any }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass(value || children)}`}>{children}</span>;
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-indigo-500" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyState({ label = '暂无数据' }: { label?: string }) {
  return <div className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">{label}</div>;
}

export default function CrmDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const ret = await mockService.getCrmDashboard();
      setData(ret || {});
    } catch (err: any) {
      setError(err?.message || '作战台读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const summary = data?.summary || {};
  const groupedSuggestions = useMemo(() => {
    const rows = Array.isArray(data?.pending_suggestions) ? data.pending_suggestions : [];
    return rows.reduce((acc: Record<string, any[]>, row: any) => {
      const key = row.suggestion_type || 'other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [data]);

  const metrics = [
    { label: '总客户数', value: summary.total_customers, icon: Users },
    { label: '7 天新增客户', value: summary.new_customers_7d, icon: Users },
    { label: 'A 类客户', value: summary.priority_a_customers, icon: Star },
    { label: '待确认建议', value: summary.pending_import_suggestions, icon: Mail },
    { label: '报价线索', value: summary.pending_quotation_drafts, icon: MessageSquareText },
    { label: '待核价', value: summary.pending_costing_requests, icon: FileSearch },
    { label: '待物流', value: summary.pending_freight_quotes, icon: Truck },
    { label: '逾期跟进', value: summary.overdue_followups, icon: AlertTriangle },
    { label: '待回复', value: summary.waiting_reply_customers, icon: Mail },
    { label: '7 天邮件', value: summary.recent_email_count_7d, icon: Mail },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-500" /> 外贸作战台
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-1">每天先看待确认邮件建议、A 类客户跟进、待核价和待物流项目。</p>
        </div>
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2 disabled:opacity-60">
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      <section className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div>
            <div className="text-sm font-black text-indigo-900">今日重点提醒</div>
            <p className="text-sm text-indigo-800 mt-1">今天优先处理：待确认邮件建议、A 类客户跟进、待核价/待物流项目。</p>
          </div>
        </div>
      </section>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm font-bold">{error}</div>}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {metrics.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white border border-slate-200 rounded-lg p-4 min-h-[92px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-500">{item.label}</span>
                <Icon className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-3">{Number(item.value || 0)}</div>
            </div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Section title="今日任务" icon={ClipboardList}>
            {Array.isArray(data?.today_tasks) && data.today_tasks.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3">任务</th>
                      <th className="py-2 pr-3">客户</th>
                      <th className="py-2 pr-3">原因</th>
                      <th className="py-2 pr-3">优先级</th>
                      <th className="py-2 pr-3">动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.today_tasks.map((row: any, index: number) => (
                      <tr key={`${row.task_type}-${row.related_id || index}`} className="border-b border-slate-50 last:border-b-0">
                        <td className="py-3 pr-3 font-bold text-slate-900">
                          <div>{text(row.title)}</div>
                          {row.quote_readiness ? (
                            <div className="mt-1 text-xs text-slate-500">资料：{text(row.quote_readiness.status, 'unknown')} · 分数 {Number(row.quote_readiness.score || 0)}</div>
                          ) : null}
                        </td>
                        <td className="py-3 pr-3 text-slate-600">{text(row.customer_name)}</td>
                        <td className="py-3 pr-3 text-slate-500 max-w-md truncate">{text(row.reason)}</td>
                        <td className="py-3 pr-3"><Pill value={row.priority}>{text(row.priority)}</Pill></td>
                        <td className="py-3 pr-3 text-indigo-600 font-bold">{text(row.action_label)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState label={loading ? '读取中...' : '暂无今日任务'} />}
          </Section>

          <Section title="待确认邮件建议" icon={Mail}>
            {Object.keys(groupedSuggestions).length ? (
              <div className="space-y-3">
                {(Object.entries(groupedSuggestions) as Array<[string, any[]]>).map(([type, rows]) => (
                  <div key={type} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-black text-slate-800">{type}</span>
                      <span className="text-xs font-bold text-slate-400">{rows.length} 条</span>
                    </div>
                    <div className="space-y-2">
                      {rows.slice(0, 5).map((row: any) => (
                        <div key={row.id} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 truncate">{text(row.customer_display_name)} · {text(row.source_email_subject, '无主题')}</div>
                            <div className="text-xs text-slate-500 truncate">{text(row.summary)}</div>
                          </div>
                          <Pill value={row.confidence}>{text(row.confidence, 'pending')}</Pill>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState label="暂无待确认邮件建议" />}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="A 类重点客户" icon={Star}>
            {Array.isArray(data?.priority_customers) && data.priority_customers.length ? (
              <div className="space-y-3">
                {data.priority_customers.map((row: any) => (
                  <div key={row.id} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-black text-slate-900 truncate">{text(row.display_name)}</div>
                      <Pill value={row.stage}>{getCrmStageLabel(row.stage || 'new_unprocessed')}</Pill>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">{text(row.country)} · {text(row.customer_type)} · {getCrmStageLabel(row.stage || 'new_unprocessed')} · {text(row.latest_inquiry_title, '暂无最新询盘')}</div>
                    <div className="text-xs text-slate-600 mt-2">下一步：{text(row.next_action)}</div>
                    <div className="text-xs text-slate-400 mt-1">跟进时间：{text(row.next_followup_at)}</div>
                  </div>
                ))}
              </div>
            ) : <EmptyState label="暂无 A 类重点客户" />}
          </Section>

          <Section title="报价线索" icon={MessageSquareText}>
            {Array.isArray(data?.quotation_drafts) && data.quotation_drafts.length ? (
              <div className="space-y-3">
                {data.quotation_drafts.slice(0, 8).map((row: any) => (
                  <div key={row.id} className="border border-slate-100 rounded-lg p-3">
                    <div className="font-black text-slate-900 truncate">{text(row.customer_display_name)}</div>
                    <div className="text-xs text-slate-500 mt-1 truncate">{text(row.source_email_subject, row.summary || '报价线索')}</div>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                      <div><span className="text-slate-400">条款</span><div className="font-bold text-slate-700">{text(row.trade_term)}</div></div>
                      <div><span className="text-slate-400">单价</span><div className="font-bold text-slate-700">{text(row.unit_price)}</div></div>
                      <div><span className="text-slate-400">数量</span><div className="font-bold text-slate-700">{text(row.quantity)}</div></div>
                      <div><span className="text-slate-400">交期</span><div className="font-bold text-slate-700">{text(row.lead_time)}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState label="暂无待确认报价线索" />}
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="待核价" icon={FileSearch}>
          {Array.isArray(data?.pending_costing) && data.pending_costing.length ? (
            <div className="space-y-2">
              {data.pending_costing.map((row: any) => (
                <div key={row.id} className="flex items-start justify-between gap-3 border-b border-slate-50 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate">{text(row.costing_request_code)} · {text(row.customer_display_name)}</div>
                    <div className="text-xs text-slate-500 truncate">{text(row.inquiry_title)} · {text(row.product_type)} · {text(row.quantity)}</div>
                  </div>
                  <Pill value={row.status}>{text(row.status)}</Pill>
                </div>
              ))}
            </div>
          ) : <EmptyState label="暂无待核价请求" />}
        </Section>

        <Section title="待物流" icon={Truck}>
          {Array.isArray(data?.pending_freight) && data.pending_freight.length ? (
            <div className="space-y-2">
              {data.pending_freight.map((row: any) => (
                <div key={row.id} className="flex items-start justify-between gap-3 border-b border-slate-50 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate">{text(row.freight_quote_code)} · {text(row.customer_display_name)}</div>
                    <div className="text-xs text-slate-500 truncate">{text(row.destination_country)} {text(row.destination_port, '')} · {text(row.forwarder_name)} · {text(row.total_freight_cost)}</div>
                  </div>
                  <Pill value={row.status}>{text(row.status)}</Pill>
                </div>
              ))}
            </div>
          ) : <EmptyState label="暂无待物流费用" />}
        </Section>
      </div>

      <Section title="最近活跃客户" icon={Users}>
        {Array.isArray(data?.recent_active_customers) && data.recent_active_customers.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.recent_active_customers.map((row: any) => (
              <div key={row.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-slate-900 truncate">{text(row.display_name)}</div>
                  <Pill value={row.priority}>{text(row.priority)}</Pill>
                </div>
                <div className="text-xs text-slate-500 mt-2">{text(row.country)} · {getCrmStageLabel(row.stage || 'new_unprocessed')}</div>
                <div className="text-xs text-slate-600 mt-2 truncate">邮件：{text(row.latest_email_subject)}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState label="暂无活跃客户" />}
      </Section>
    </div>
  );
}

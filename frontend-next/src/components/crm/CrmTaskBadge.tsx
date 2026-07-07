import React from 'react';

const classes: Record<string, string> = {
  message_pending_ai: 'bg-amber-100 text-amber-800',
  message_parsed_pending_inquiry: 'bg-indigo-100 text-indigo-800',
  father_task_pending: 'bg-rose-100 text-rose-800',
  father_done_pending_sales: 'bg-emerald-100 text-emerald-800',
  costing_draft_pending_review: 'bg-purple-100 text-purple-800',
  quoted_waiting_customer: 'bg-sky-100 text-sky-800',
  a_customer_updated: 'bg-slate-200 text-slate-800',
};

const labels: Record<string, string> = {
  message_pending_ai: '待 AI 解读',
  message_parsed_pending_inquiry: '待更新询盘',
  father_task_pending: '待父亲确认',
  father_done_pending_sales: '父亲已回复',
  costing_draft_pending_review: '待报价复核',
  quoted_waiting_customer: '已报价待回复',
  a_customer_updated: 'A 类更新',
};

export default function CrmTaskBadge({ type, label }: { type?: string; label?: string }) {
  const key = String(type || '');
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-black ${classes[key] || 'bg-slate-100 text-slate-700'}`}>
      {label || labels[key] || key || '-'}
    </span>
  );
}

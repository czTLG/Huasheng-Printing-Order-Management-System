import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Layers, Printer, Scissors, Truck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { OrderStatus } from '../../types';
import { COMPLETED_LABELS } from './data-resolvers';

export function StatusBadge({ status, completedView }: { status: OrderStatus; completedView?: boolean }) {
  const styles: Record<string, string> = {
    印刷: 'bg-blue-100 text-blue-700 border-blue-200 shadow-blue-100/50',
    复膜: 'bg-purple-100 text-purple-700 border-purple-200 shadow-purple-100/50',
    制袋: 'bg-indigo-100 text-indigo-700 border-indigo-200 shadow-indigo-100/50',
    发货: 'bg-orange-100 text-orange-700 border-orange-200 shadow-orange-100/50',
    完成: 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-emerald-100/50',
    全部: 'bg-slate-100 text-slate-700 border-slate-200 shadow-slate-100/50',
  };
  const icons: Record<string, React.ElementType> = {
    印刷: Printer,
    复膜: Layers,
    制袋: Scissors,
    发货: Truck,
    完成: CheckCircle2,
  };
  const Icon = icons[status] || Clock;
  const label = completedView ? (COMPLETED_LABELS[status] || status) : status;
  return (
    <span className={cn('px-2 py-1 rounded-md border text-[12px] md:text-[13px] font-bold flex items-center gap-1 w-fit uppercase tracking-widest shadow-sm', styles[status] || styles.全部)}>
      <Icon className="w-2.5 h-2.5 md:w-3 md:h-3" />
      {label}
    </span>
  );
}

export function MissingTag({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-[12px] font-black px-1.5 py-0.5 rounded leading-none shrink-0">
      <AlertTriangle className="w-2.5 h-2.5" /> {text}
    </span>
  );
}

export function DataItem({ label, value, font, bold, color, highlight }: any) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest mb-0.5 truncate">{label}</span>
      <span className={cn('text-[12px] md:text-xs leading-tight break-words', font === 'mono' ? 'font-mono' : 'font-bold', bold ? 'font-black text-slate-900' : 'text-slate-700', color === 'indigo' ? 'text-indigo-600' : color === 'rose' ? 'text-rose-600' : '', highlight ? 'px-1 md:px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 inline-block w-fit' : '')}>{value}</span>
    </div>
  );
}

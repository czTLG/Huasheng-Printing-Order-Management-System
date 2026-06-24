import React from 'react';
import { Clock, History as HistoryIcon, Info, RotateCcw, X, CheckCircle2, HardDrive } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { Order } from '../../types';

export function OrderHistoryModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const logs = order.operation_logs || [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-xl overflow-hidden flex flex-col border border-slate-200">
        <div className="px-4 py-3 md:px-5 md:py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 sticky top-0 z-10">
          <div>
            <h3 className="font-black text-slate-900 text-[13px] md:text-base flex items-center gap-1.5 md:gap-2">
              <HistoryIcon className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" />
              生产追溯记录
            </h3>
            <p className="text-[11px] md:text-[12px] font-bold text-slate-500 tracking-widest uppercase mt-0.5 ml-6">单号: {order.work_no}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors">
            <X className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar flex-1 bg-white">
          {logs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-bold text-sm">
              <HistoryIcon className="w-10 h-10 mx-auto mb-3 opacity-20" />
              暂无操作记录
            </div>
          ) : (
            <div className="relative border-l-2 border-indigo-100 ml-3 md:ml-4 space-y-6 md:space-y-8 pb-4">
              {logs.map((log: any, idx: number) => {
                const isRollback = log.is_rolled_back || log.type === 'ROLLBACK' || log.detail?.includes('回退');
                const isComplete = log.type === 'COMPLETE';
                const Icon = isRollback ? RotateCcw : isComplete ? CheckCircle2 : Info;
                const iconColor = isRollback ? 'text-rose-500 bg-rose-50 border-rose-200' : isComplete ? 'text-emerald-500 bg-emerald-50 border-emerald-200' : 'text-blue-500 bg-blue-50 border-blue-200';

                return (
                  <div key={idx} className="relative pl-6 md:pl-8 group">
                    <div className={cn('absolute -left-[13px] md:-left-[15px] top-0 w-6 h-6 md:w-7 md:h-7 rounded-full border-2 flex items-center justify-center shadow-sm transition-transform group-hover:scale-110', iconColor)}>
                      <Icon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </div>

                    <div className={cn('p-3 md:p-4 rounded-xl border', isRollback ? 'bg-rose-50/30 border-rose-100' : 'bg-slate-50/50 border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all')}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between mb-2 gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                          <span className={cn('text-xs md:text-sm font-black whitespace-nowrap', isRollback ? 'text-rose-700' : 'text-slate-800')}>
                            {log.operator || log.operator_name || log.operated_by || '系统操作'}
                          </span>
                          <span className="text-[12px] md:text-xs font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-sm">{log.type}</span>
                        </div>
                        <span className="text-[12px] md:text-[13px] font-bold text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="mt-2 text-[13px] md:text-sm font-medium text-slate-600 leading-relaxed md:leading-relaxed">
                        {log.detail}
                      </div>

                      {isComplete && log.source && (
                        <div className="mt-3 text-[12px] md:text-xs font-bold text-emerald-700 flex flex-wrap gap-2 md:gap-3 bg-emerald-50/50 p-2 md:p-2.5 rounded-lg">
                          <span className="flex items-center gap-1"><HardDrive className="w-3 h-3 md:w-3.5 md:h-3.5 opacity-70" /> 来源: {log.source}</span>
                          {log.qty && <span className="flex items-center gap-1"><HistoryIcon className="w-3 h-3 md:w-3.5 md:h-3.5 opacity-70" /> 数量: {log.qty} {log.unit}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

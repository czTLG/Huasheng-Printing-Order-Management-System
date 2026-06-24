import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  History as HistoryIcon,
  Layers,
  RotateCcw,
  Settings
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Order } from '../../types';
import {
  calculateStayDays,
  getCustomerName,
  getProductName,
  getQty,
  getRoller,
  getSpec,
  getStatusAction,
  isAbnormal
} from './data-resolvers';
import { StatusBadge } from './order-display';

type Props = {
  order: Order;
  activeStatusLabel: string;
  cardMode: 'full' | 'standard' | 'compact';
  isCollapsed: boolean;
  onToggleExpand: () => void;
  onLongPressStart: () => void;
  onLongPressEnd: () => void;
  onToggleSubscribe: () => void;
  onOpenHistory: () => void;
  onOpenDetail: () => void;
  onOpenProcess: () => void;
  onOpenRollback: () => void;
};

export function OrderCard(props: Props) {
  const {
    order,
    activeStatusLabel,
    cardMode,
    isCollapsed,
    onToggleExpand,
    onLongPressStart,
    onLongPressEnd,
    onToggleSubscribe,
    onOpenHistory,
    onOpenDetail,
    onOpenProcess,
    onOpenRollback
  } = props;

  const abnormalData = isAbnormal(order);
  const stayDays = calculateStayDays(order);
  const isOverdue = stayDays >= 3;
  const productName = getProductName(order);
  const customerName = getCustomerName(order);
  const spec = getSpec(order);
  const qty = getQty(order);
  const roller = getRoller(order);
  const statusAction = getStatusAction(order.status);
  const summary = order.work_order_summary;
  const bagType = order.bag_type || summary?.bagType;
  const printMold = order.wo_print_mold || summary?.printMold;
  const missingFields = [];

  if (!productName || productName === '未定义品名') missingFields.push('品名');
  if (!spec || spec === '--') missingFields.push('规格');
  if (order.status === '印刷') {
    if (!summary?.printMold && !order.wo_print_mold) missingFields.push('印刷膜');
    if (!summary?.printFilmSize && !order.wo_print_film_size) missingFields.push('印膜尺寸');
    if (!summary?.quantity && !order.wo_print_qty && !summary?.printQty) missingFields.push('印刷数量');
    if (!roller || roller === '标准') missingFields.push('压辊');
  } else if (order.status === '复膜') {
    if (!summary?.printMold && !order.wo_print_mold) missingFields.push('印膜材料');
    if (!summary?.printFilmSize && !order.wo_print_film_size) missingFields.push('印膜尺寸');
    if (!summary?.printFilmQty && !order.wo_print_film_qty) missingFields.push('印膜数量');
  } else if (order.status === '制袋' && !bagType) {
    missingFields.push('袋型');
  }

  return (
    <div
      onPointerDown={onLongPressStart}
      onPointerUp={onLongPressEnd}
      onPointerLeave={onLongPressEnd}
      className={cn(
        'bg-white border shadow-sm hover:shadow-md transition-all flex flex-col group relative overflow-hidden',
        order.priority ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-slate-200',
        cardMode === 'compact' ? 'p-2.5 md:p-3 rounded-xl' : 'p-3 md:p-5 rounded-2xl',
        isCollapsed && 'pb-2.5 md:pb-3'
      )}
    >
      {order.priority ? (
        <div className="absolute top-0 right-0 w-8 h-8 bg-indigo-500 flex items-center justify-center rounded-bl-xl shadow-sm z-10 pointer-events-none">
          <Bookmark className="w-3.5 h-3.5 text-white fill-current" />
        </div>
      ) : null}

      <div className={cn('flex items-start justify-between', !isCollapsed && 'mb-3 md:mb-4')}>
        <div className="flex-1 min-w-0 pr-1 md:pr-2">
          <div className="flex flex-wrap items-center gap-1 mb-1.5 md:mb-2">
            {order.urgency === 1 && <span className="bg-red-600 text-white text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded shadow-sm animate-pulse shrink-0 uppercase tracking-widest">加急</span>}
            {isOverdue && <span className="bg-rose-100 text-rose-700 border border-rose-200 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded shrink-0">滞留: {stayDays}天</span>}
            {abnormalData && <span className="bg-amber-100 border border-amber-200 text-amber-700 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded flex items-center gap-1 shrink-0"><AlertTriangle className="w-2.5 h-2.5" /> 核对</span>}
            {missingFields.map(field => (
              <span key={field} className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-black px-1 md:px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">
                缺{field}
              </span>
            ))}
            {order.my_subscribed === 1 && cardMode !== 'compact' && (
              <span className="bg-blue-50 text-blue-600 border border-blue-100 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                <Bookmark className="w-2 h-2 md:w-2.5 md:h-2.5 fill-current" /> 订阅
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 md:gap-2">
            <button onClick={onToggleExpand} className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-md p-1 md:p-0.5 transition-colors">
              {isCollapsed ? <ChevronDown className="w-4 h-4 md:w-4 md:h-4" /> : <ChevronUp className="w-4 h-4 md:w-4 md:h-4" />}
            </button>
            <h3 className={cn('font-black text-slate-900 truncate tracking-tight flex-1', cardMode === 'compact' ? 'text-xs md:text-sm' : 'text-[15px] md:text-lg')} title={productName}>
              {productName}
            </h3>
          </div>

          {customerName && productName !== customerName && (
            <p className={cn('text-[11px] md:text-[13px] text-slate-500 font-bold mt-0.5 md:mt-1 uppercase tracking-wide ml-6 md:ml-7', isCollapsed && 'hidden sm:block')}>
              客户：{customerName}
            </p>
          )}

          {cardMode !== 'compact' && (
            <div className="ml-6 md:ml-7 mt-1 md:mt-1.5 flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-0.5 md:gap-y-1">
              {order.status === '印刷' && (
                <>
                  <span className="text-[12px] font-bold text-slate-500">印膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺</span>}</span>
                  <span className="text-[12px] font-bold text-slate-500">尺寸: {(order.wo_print_film_size || summary?.printFilmSize) ? <span className="text-slate-800">{order.wo_print_film_size || summary?.printFilmSize}</span> : <span className="text-amber-600">缺</span>}</span>
                  <span className="text-[12px] font-bold text-slate-500">印膜数量: {(order.wo_print_qty || summary?.quantity || summary?.printQty) ? <span className="text-slate-800">{order.wo_print_qty || summary?.quantity || summary?.printQty}</span> : <span className="text-amber-600">缺</span>}</span>
                  <span className="text-[12px] font-bold text-slate-500">压辊: {roller ? <span className="text-slate-800">{roller}</span> : <span className="text-amber-600">缺</span>}</span>
                  {(order.wo_ink_requirement || summary?.inkRequirement) && <span className="text-[12px] font-bold text-slate-500 flex-shrink-0">油墨:<span className="text-slate-800 ml-1">{order.wo_ink_requirement || summary?.inkRequirement}</span></span>}
                </>
              )}
              {order.status === '复膜' && (
                <>
                  {(summary?.filmType || order.wo_film_type) && <span className="text-[12px] font-bold text-slate-500 flex-shrink-0">工艺: <span className="text-slate-800">{summary?.filmType || order.wo_film_type}</span></span>}
                  <span className="text-[12px] font-bold text-slate-500">印膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺</span>}</span>
                  {(order.layer1_material || summary?.layer1?.material) && <span className="text-[12px] font-bold text-slate-500">一层: <span className="text-slate-800">{order.layer1_material || summary?.layer1?.material}</span></span>}
                  {(order.layer2_material || summary?.layer2?.material) && <span className="text-[12px] font-bold text-slate-500">二层: <span className="text-slate-800">{order.layer2_material || summary?.layer2?.material}</span></span>}
                  {(order.layer3_material || summary?.layer3?.material) && <span className="text-[12px] font-bold text-slate-500">三层: <span className="text-slate-800">{order.layer3_material || summary?.layer3?.material}</span></span>}
                  <span className="text-[12px] font-bold text-slate-500">尺寸: {(order.wo_print_film_size || summary?.printFilmSize) ? <span className="text-slate-800">{order.wo_print_film_size || summary?.printFilmSize}</span> : <span className="text-amber-600">缺</span>}</span>
                  <span className="text-[12px] font-bold text-slate-500">数量: {(order.wo_print_film_qty || summary?.printFilmQty) ? <span className="text-slate-800">{order.wo_print_film_qty || summary?.printFilmQty}{order.wo_print_film_unit || summary?.printFilmUnit || 'kg'}</span> : <span className="text-amber-600">缺</span>}</span>
                  {(order.wo_ink_requirement || summary?.inkRequirement) && <span className="text-[12px] font-bold text-slate-500 flex-shrink-0">油墨:<span className="text-slate-800 ml-1">{order.wo_ink_requirement || summary?.inkRequirement}</span></span>}
                </>
              )}
              {(order.status === '制袋' || order.status === '发货' || order.status === '完成') && (() => {
                const processName = order.status === '发货' ? '制袋' : order.status === '制袋' ? '复膜' : '发货';
                const prevCompletedLog = order.operation_logs?.find(log => log.type === 'COMPLETE' && !log.is_rolled_back && log.detail === `${processName}工序已提交完成`);
                return (
                  <>
                    {prevCompletedLog?.qty && <span className="text-[12px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded leading-none flex items-center shrink-0">[{processName}]完成: {prevCompletedLog.qty}{prevCompletedLog.unit || ''}</span>}
                    <span className="text-[12px] font-bold text-slate-500">规格: {spec ? <span className="text-slate-800">{spec}</span> : <span className="text-amber-600">缺</span>}</span>
                    <span className="text-[12px] font-bold text-slate-500">袋形: {bagType ? <span className="text-slate-800">{bagType}</span> : <span className="text-amber-600">缺</span>}</span>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5 md:gap-2">
          <StatusBadge status={order.status} completedView={activeStatusLabel === '今日更新'} />
          {order.order_image_thumb_url && cardMode !== 'compact' && !isCollapsed && (
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg border border-slate-100 overflow-hidden shadow-inner bg-slate-50 flex items-center justify-center p-0.5">
              <img src={order.order_image_thumb_url} referrerPolicy="no-referrer" alt="thumb" className="w-full h-full object-cover rounded-[3px]" />
            </div>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className={cn('grid gap-y-1.5 md:gap-y-3 gap-x-2 md:gap-x-4 mb-2.5 md:mb-4 bg-slate-50/50 p-2 md:p-4 rounded-lg md:rounded-2xl border border-slate-100/50', cardMode === 'compact' ? 'grid-cols-2 p-1.5 mb-1.5' : 'grid-cols-2 md:grid-cols-4')}>
            <div className="flex flex-col">
              <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1"><Layers className="w-2.5 h-2.5 hidden sm:block" /> 成品/基材</span>
              <span className={cn('font-black text-slate-800 truncate', cardMode === 'compact' ? 'text-[13px] md:text-xs' : 'text-xs md:text-sm')}>{bagType || order.wo_print_mold || summary?.printMold || '--'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1"><ArrowRight className={cn('w-2.5 h-2.5 hidden sm:block', cardMode === 'compact' ? 'rotate-90' : '')} /> 规格/尺寸</span>
              <span className={cn('font-black text-slate-800 font-mono tracking-tight text-xs', cardMode === 'compact' ? 'md:text-xs' : 'md:text-sm')}>{spec} {abnormalData && !spec && <span className="text-rose-500 ml-1">?</span>}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1"><FileText className="w-2.5 h-2.5 hidden sm:block" /> 计划数量</span>
              <span className={cn('font-black text-indigo-600 font-mono tracking-tighter text-xs md:text-sm', cardMode === 'compact' ? '' : 'md:text-base')}>{qty ? Number(qty).toLocaleString() : '--'} <span className="text-[11px] md:text-[12px] font-bold text-slate-400">{order.unit || 'PCS'}</span></span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1"><Settings className="w-2.5 h-2.5 hidden sm:block" /> 机型要求</span>
              <span className="text-[12px] md:text-xs font-black text-slate-700 bg-white border border-slate-200 px-1.5 md:px-2 py-0 md:py-0.5 rounded shadow-sm w-fit">{roller}</span>
            </div>
          </div>

          {cardMode !== 'compact' && (
            <div className="space-y-2 md:space-y-3 mb-4 md:mb-5 px-1">
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="flex flex-col bg-slate-50 p-1.5 md:p-2 rounded-lg md:rounded-xl border border-slate-100">
                  <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1">油墨要求</span>
                  <div className="flex gap-1 flex-wrap">
                    {(summary?.inkRequirement || order.wo_ink_requirement || '里印').split('/').map((ink: string) => (
                      <span key={ink} className="text-[11px] md:text-[12px] font-bold bg-white text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded leading-none">{ink}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col bg-slate-50 p-1.5 md:p-2 rounded-lg md:rounded-xl border border-slate-100">
                  <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1">交货/外协</span>
                  <div className="flex flex-col gap-0.5">
                    {(summary?.deliveryDate || order.delivery_date) && <span className="text-[11px] md:text-[12px] font-bold text-rose-600 leading-none">交: {summary?.deliveryDate || order.delivery_date}</span>}
                    <span className="text-[11px] md:text-[12px] font-bold text-slate-500 truncate leading-none">{summary?.outsource === '是' || order.wo_outsource ? '⚠️ 包含外加工' : '厂内全制程'}</span>
                  </div>
                </div>
              </div>
              <div className="bg-amber-50/50 border border-amber-100 p-2 md:p-2.5 rounded-lg md:rounded-xl border-dashed">
                <span className="text-[10px] md:text-[11px] text-amber-600 font-black uppercase tracking-widest block mb-0.5 md:mb-1">工艺备注/反馈</span>
                <p className="text-[13px] md:text-xs font-medium text-amber-800 leading-relaxed italic line-clamp-2">
                  {summary?.remark || order.remark || (typeof order.work_order_summary === 'string' ? order.work_order_summary : '无特别备注说明')}
                </p>
              </div>
            </div>
          )}

          <div className={cn('mt-auto pt-2.5 md:pt-4 border-t border-slate-100 flex items-center justify-between gap-2', cardMode === 'compact' ? 'pt-2' : '')}>
            <div className="flex items-center gap-1 md:gap-1.5">
              {statusAction.canRollback && (
                <button onClick={onOpenRollback} className="h-7 md:h-9 px-2 md:px-3 bg-white border border-slate-200 rounded-lg md:rounded-xl text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-all flex items-center justify-center shadow-sm gap-1 md:gap-2" title={statusAction.rollbackLabel}>
                  <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="text-[12px] md:text-[13px] font-bold">{statusAction.rollbackLabel}</span>
                </button>
              )}
              <button
                onClick={onToggleSubscribe}
                className={cn('w-7 h-7 md:w-9 md:h-9 rounded-lg md:rounded-xl border transition-all flex items-center justify-center shadow-sm', order.my_subscribed === 1 ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50')}
                title={order.my_subscribed === 1 ? '取消订阅' : '订阅生产看板'}
              >
                <BookmarkPlus className={cn('w-3.5 h-3.5 md:w-4 md:h-4', order.my_subscribed === 1 && 'fill-current')} />
              </button>
            </div>

            <div className="flex items-center gap-1.5 md:gap-2">
              <button onClick={onOpenHistory} className="px-2.5 md:px-3 h-7 md:h-9 bg-white border border-slate-200 rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-1.5 md:gap-2 shadow-sm">
                <HistoryIcon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                追溯
              </button>
              <button onClick={onOpenDetail} className="px-2.5 md:px-3 h-7 md:h-9 bg-white border border-slate-200 rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-1.5 md:gap-2 shadow-sm">
                <Eye className="w-3 h-3 md:w-3.5 md:h-3.5" />
                详情
              </button>
              {statusAction.label && (
                <button onClick={onOpenProcess} className="px-3 md:px-4 h-7 md:h-9 bg-slate-900 text-white rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest flex items-center gap-1.5 md:gap-2 hover:bg-slate-800 shadow-md shadow-slate-200 active:scale-[0.98] transition-all">
                  <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-emerald-400" />
                  {statusAction.label}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { 
  Search, Plus, MoreVertical, ChevronLeft, ChevronRight,
  Clock, Printer, Truck, CheckCircle2, AlertTriangle, History as HistoryIcon,
  Layers, Scissors, RotateCcw, X, Eye, Bookmark, BookmarkPlus, ArrowRight, Camera, AlertCircle,
  Trash2, FileText, Settings, Info, Package as PackageIcon, HardDrive, ShieldAlert,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { Order, OrderStatus } from '../types';
import { OrderCard } from './orders/OrderCard';
import { OrdersListToolbar } from './orders/OrdersListToolbar';
import { calculateStayDays, COMPLETED_LABELS, getCustomerName, getProductName, getQty, getRoller, getSpec, isAbnormal } from './orders/data-resolvers';
import { DataItem, MissingTag, StatusBadge } from './orders/order-display';
import { OrderDetailDrawer } from './orders/order-detail';
import { OrderHistoryModal } from './orders/order-history-modal';

export default function Orders() {
  const [activeStatus, setActiveStatus] = useState<OrderStatus>(() => {
    const saved = localStorage.getItem('orders.activeStatus');
    return (['印刷','复膜','制袋','发货','完成','全部','今日更新'].includes(saved || '')) ? saved as OrderStatus : '全部';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [cardMode, setCardMode] = useState<'full' | 'standard' | 'compact'>('standard');
  const [showFilters, setShowFilters] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<any>(null);
  
  // Filters
  const [rollerFilter, setRollerFilter] = useState('全部压辊');
  const [isUrgentOnly, setIsUrgentOnly] = useState(false);
  const [stayMinDays, setStayMinDays] = useState<number>(0);
  const [orderDayMode, setOrderDayMode] = useState<'all' | 'today' | '3days'>('all');
  const [orderDataMode, setOrderDataMode] = useState<'all' | 'abnormal'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'start_time'>(() => {
    const saved = localStorage.getItem('orders.sortBy');
    return saved === 'start_time' || saved === 'default' ? saved : 'start_time';
  });
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>(() => {
    const saved = localStorage.getItem('orders.sortOrder');
    return saved === 'asc' || saved === 'desc' ? saved : 'asc';
  });

  const [orders, setOrders] = useState<Order[]>([]);
  const [summaryStats, setSummaryStats] = useState<{ total: number; urgentCount: number; avgStayDays: number; stageCounts: Record<string, number> }>({
    total: 0,
    urgentCount: 0,
    avgStayDays: 0,
    stageCounts: {},
  });
  const [todayStageCompletions, setTodayStageCompletions] = useState<Record<string, number>>({});
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalOrders, setTotalOrders] = useState(0);
  
  // Modals
  const [processOrder, setProcessOrder] = useState<Order | null>(null);
  const [rollbackOrder, setRollbackOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [editOrder, setEditOrder] = useState<{order: Order, type: 'info' | 'alignment'} | null>(null);
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentUser = mockService.getUser();
  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'manager';

  const getUpdatedFrom = () => {
    if (orderDayMode === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (orderDayMode === '3days') {
      const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
    return '';
  };

  const loadOrders = async () => {
    setIsLoadingOrders(true);
    const query = searchQuery.trim();
    let updatedFrom = getUpdatedFrom();
    let serverStatus: string | undefined = (activeStatus === '全部' || activeStatus === '今日更新') ? undefined : activeStatus;
    const roller = rollerFilter !== '全部压辊' ? rollerFilter : undefined;
    const abnormal = orderDataMode === 'abnormal' ? true : undefined;
    const urgentOnly = isUrgentOnly ? true : undefined;
    const stayDaysFilter = stayMinDays > 0 ? stayMinDays : undefined;

    if (activeStatus === '今日更新') {
      if (!updatedFrom) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        updatedFrom = d.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    try {
      const [paged, summary] = await Promise.all([
        mockService.getOrdersPage({
          q: query || undefined,
          page,
          pageSize,
          sortBy: activeStatus === '今日更新' ? 'today_stage' : (sortBy === 'start_time' ? 'start_time' : undefined),
          sortOrder,
          status: serverStatus,
          updatedFrom: updatedFrom || undefined,
          roller,
          urgentOnly,
          stayMinDays: stayDaysFilter,
          abnormal,
        }),
        mockService.getOrderSummary({
          q: query || undefined,
          status: serverStatus,
          updatedFrom: updatedFrom || undefined,
          roller,
          urgentOnly,
          stayMinDays: stayDaysFilter,
          abnormal,
        }),
      ]);
      setOrders(paged.rows);
      setTotalOrders(paged.total);
      setSummaryStats(summary);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '订单加载失败' } }));
    }
    setIsLoadingOrders(false);

    mockService.getTodayStageCompletions().then(stageCompleted => {
      setTodayStageCompletions(stageCompleted);
    }).catch(() => {
      setTodayStageCompletions({});
    });
  };

  useEffect(() => {
    setOrders([]);
    localStorage.setItem('orders.activeStatus', activeStatus);
    localStorage.setItem('orders.sortBy', sortBy);
    localStorage.setItem('orders.sortOrder', sortOrder);
    loadOrders();
  }, [activeStatus, searchQuery, page, sortBy, sortOrder, orderDayMode, rollerFilter, isUrgentOnly, stayMinDays, orderDataMode]);

  useEffect(() => {
    setPage(1);
  }, [activeStatus, searchQuery, orderDayMode, sortBy, sortOrder, rollerFilter, isUrgentOnly, stayMinDays, orderDataMode]);

  // Listen for global search from header
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.query) {
        setSearchQuery(detail.query);
        setActiveStatus('全部');
        setPage(1);
      }
    };
    window.addEventListener('global-search', handler);
    return () => window.removeEventListener('global-search', handler);
  }, []);

  const openOrderDetail = async (order: Order) => {
    setDetailOrder(order);
    try {
      const detail = await mockService.getOrderDetail(order.id);
      setDetailOrder(detail);
    } catch (_) {}
  };

  const openOrderHistory = async (order: Order) => {
    setHistoryOrder(order);
    try {
      const detail = await mockService.getOrderDetail(order.id);
      setHistoryOrder(detail);
    } catch (_) {}
  };

  const filteredOrders = orders;

  const toggleSubscribe = async (orderId: number, currentStat: number | undefined) => {
    const nextSubscribed = currentStat === 1 ? 0 : 1;
    await mockService.toggleSubscribe(orderId, nextSubscribed === 1);
    setOrders(prev => prev.map(order => order.id === orderId ? { ...order, my_subscribed: nextSubscribed } : order));
    setDetailOrder(prev => prev && prev.id === orderId ? { ...prev, my_subscribed: nextSubscribed } : prev);
    setHistoryOrder(prev => prev && prev.id === orderId ? { ...prev, my_subscribed: nextSubscribed } : prev);
    await loadOrders();
  };

  const togglePriority = async (order: Order) => {
    const newPriority = order.priority ? 0 : Date.now();
    await mockService.updatePriority(order.id, newPriority);
    await loadOrders();
  };

  return (
    <div className="space-y-1.5 md:space-y-4">
      <OrdersListToolbar
        activeStatus={activeStatus}
        setActiveStatus={setActiveStatus}
        cardMode={cardMode}
        setCardMode={setCardMode}
        filteredCount={filteredOrders.length}
        expandedCount={expandedOrders.size}
        hasOrders={filteredOrders.length > 0}
        expandAll={() => setExpandedOrders(new Set(filteredOrders.map(o => o.id)))}
        collapseAll={() => setExpandedOrders(new Set())}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        summaryStats={summaryStats}
        todayStageCompletions={todayStageCompletions}
        rollerFilter={rollerFilter}
        setRollerFilter={setRollerFilter}
        isUrgentOnly={isUrgentOnly}
        setIsUrgentOnly={setIsUrgentOnly}
        stayMinDays={stayMinDays}
        setStayMinDays={setStayMinDays}
        orderDayMode={orderDayMode}
        setOrderDayMode={setOrderDayMode}
        orderDataMode={orderDataMode}
        setOrderDataMode={setOrderDataMode}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
      />

      {isLoadingOrders ? (
        <div className="px-1 md:px-2">
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2 md:gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 md:p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-16 h-6 bg-slate-200 rounded-md" />
                  <div className="w-20 h-5 bg-slate-200 rounded-md ml-auto" />
                </div>
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                  <div className="h-4 bg-slate-200 rounded w-2/3" />
                </div>
                <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                  <div className="h-8 bg-slate-200 rounded-lg flex-1" />
                  <div className="h-8 bg-slate-200 rounded-lg flex-1" />
                  <div className="h-8 bg-slate-200 rounded-lg flex-1" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="px-1 md:px-2">
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2 md:gap-3">
          {filteredOrders.map(order => {
             return (
               <OrderCard
                 key={order.id}
                 order={order}
                 activeStatusLabel={activeStatus}
                 cardMode={cardMode}
                 isCollapsed={!expandedOrders.has(order.id)}
                 onToggleExpand={() => toggleExpand(order.id)}
                 onLongPressStart={() => {
                   const timer = setTimeout(() => togglePriority(order), 600);
                   setLongPressTimer(timer);
                 }}
                 onLongPressEnd={() => {
                   if (longPressTimer) clearTimeout(longPressTimer);
                 }}
                 onToggleSubscribe={() => toggleSubscribe(order.id, order.my_subscribed)}
                 onOpenHistory={() => openOrderHistory(order)}
                 onOpenDetail={() => openOrderDetail(order)}
                 onOpenProcess={() => setProcessOrder(order)}
                 onOpenRollback={() => setRollbackOrder(order)}
               />
             );
          })}
        </div>
        {!isLoadingOrders && filteredOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Search className="w-12 h-12 text-slate-200 mb-4" />
            <h3 className="text-lg font-bold text-slate-600 mb-1">暂无匹配订单</h3>
            <p className="text-sm font-medium">
              {searchQuery ? `未搜索到包含"${searchQuery}"的订单` : '当前工序下暂无订单'}
            </p>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3 px-1">
          <p className="text-[13px] md:text-xs font-bold text-slate-500">
            当前页显示 {filteredOrders.length} 条，累计 {totalOrders} 条
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 h-8 border border-slate-200 bg-white rounded-lg text-[13px] font-bold text-slate-700 disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-[13px] font-bold text-slate-500">第 {page} 页</span>
            <button
              disabled={page * pageSize >= totalOrders}
              onClick={() => setPage(p => p + 1)}
              className="px-3 h-8 border border-slate-200 bg-white rounded-lg text-[13px] font-bold text-slate-700 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Process Modal */}
      <AnimatePresence>
         {processOrder && <ProcessModal order={processOrder} onClose={() => setProcessOrder(null)} onDone={loadOrders} />}
      </AnimatePresence>
      
      {/* Rollback Modal */}
      <AnimatePresence>
         {rollbackOrder && <RollbackModal order={rollbackOrder} onClose={() => setRollbackOrder(null)} onDone={loadOrders} />}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
         {editOrder && (
           <EditModal 
             order={editOrder.order} 
             type={editOrder.type} 
             onClose={() => setEditOrder(null)}
             onDone={loadOrders}
           />
         )}
      </AnimatePresence>
      
      {/* History Modal */}
      <AnimatePresence>
         {historyOrder && (
           <OrderHistoryModal 
             order={historyOrder} 
             onClose={() => setHistoryOrder(null)} 
           />
         )}
      </AnimatePresence>

      {/* Detail Drawer */}
      <AnimatePresence>
         {detailOrder && <OrderDetailDrawer order={detailOrder} onClose={() => setDetailOrder(null)} canEdit={canEdit} setEditOrder={setEditOrder} setRollbackOrder={setRollbackOrder} currentUser={currentUser} completedView={activeStatus === '今日更新'} />}
      </AnimatePresence>
    </div>
  );
}

// Subcomponents

function ProcessModal({ order, onClose, onDone }: { order: Order, onClose: () => void, onDone: () => Promise<void> | void }) {
  const [source, setSource] = useState('');
  const [qty, setQty] = useState('');
  const [remark, setRemark] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unit = order.status === '印刷' || order.status === '复膜' ? '米' : order.status === '制袋' ? '袋' : '单';

  const sourceOptions: Record<string, string[]> = {
    '印刷': ['1号机', '2号机', '3号机', '源天外加工1', '郭林外加工2', '外加工下园3'],
    '复膜': ['干复 1 号', '干复 2 号', '无溶 1 号', '无溶 2 号', '外加工'],
    '制袋': [
      '厂内1 号', '厂内 2 号', '厂内 3 号', '厂内 4 号', '厂内 5 号', 
      '厂内 6 号', '厂内 7 号', '厂内 8 号', '厂内 9 号', 
      '桥头制袋 10 号', '元华制袋 11 号', '崇衍制袋 12 号', 
      '源天制袋 13 号', '老尾 14 号', '俊明制袋 15 号', '陈湧钿分切'
    ],
    '发货': ['发货口1', '发货口2', '外发']
  };

  const currentOptions = sourceOptions[order.status as string] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!source) {
      setError('请选择来源/机台');
      return;
    }
    if (!qty || Number(qty) <= 0) {
      setError('完成数量必须大于 0');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await mockService.nextProcess(order.id, { 
        source, 
        qty: Number(qty), 
        unit,
        remark 
      });
      await onDone();
      onClose();
    } catch (err: any) {
      setError(err.message || '后端处理失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 md:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="relative bg-white w-full max-w-sm rounded-xl md:rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div className="px-3 md:px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-emerald-50">
           <h3 className="font-bold text-emerald-900 text-[13px] md:text-base flex items-center gap-1.5 md:gap-2">
             <CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-600" />
             {order.status}完成登记
           </h3>
           <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-4 h-4 md:w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-3.5 md:p-5 space-y-3 md:space-y-4">
           {error && (
             <div className="bg-red-50 text-red-600 text-[12px] md:text-[13px] font-bold p-2 md:p-2.5 rounded-lg border border-red-100 flex items-center gap-1.5 md:gap-2">
               <AlertTriangle className="w-3 h-3 md:w-3.5 md:h-3.5" /> {error}
             </div>
           )}

           <div>
             <label className="block text-[11px] md:text-xs font-bold text-slate-700 mb-1.5 md:mb-2 uppercase tracking-wide">来源 source <span className="text-red-500">*</span></label>
             <select 
               required 
               value={source} 
               onChange={e => setSource(e.target.value)}
               className="w-full h-9 md:h-10 border border-slate-200 rounded-lg md:rounded-xl px-2 md:px-3 text-[13px] md:text-sm font-bold focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none bg-white"
             >
               <option value="">请选择机台/外协来源</option>
               {currentOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
             </select>
           </div>
           <div className="flex gap-2 md:gap-3">
             <div className="flex-1">
               <label className="block text-[11px] md:text-xs font-bold text-slate-700 mb-1.5 md:mb-2 uppercase tracking-wide">完成数量 qty <span className="text-red-500">*</span></label>
               <input 
                 required 
                 type="number" 
                 min="0.01" 
                 step="0.01"
                 value={qty} 
                 onChange={e => setQty(e.target.value)} 
                 placeholder="大于 0"
                 className="w-full h-9 md:h-10 border border-slate-200 rounded-lg md:rounded-xl px-2 md:px-3 text-[13px] md:text-sm font-bold focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none" 
               />
             </div>
             <div className="w-20 md:w-24">
               <label className="block text-[11px] md:text-xs font-bold text-slate-700 mb-1.5 md:mb-2 uppercase tracking-wide">单位 unit</label>
               <div className="w-full h-9 md:h-10 border border-slate-100 bg-slate-50 rounded-lg md:rounded-xl flex items-center px-2 md:px-3 text-[13px] md:text-sm font-black text-slate-500 italic">
                 {unit}
               </div>
             </div>
           </div>
           <div>
             <label className="block text-[11px] md:text-xs font-bold text-slate-700 mb-1.5 md:mb-2 uppercase tracking-wide">备注 remark</label>
             <textarea 
               value={remark} 
               onChange={e => setRemark(e.target.value)} 
               placeholder="可选填生产注意事项"
               className="w-full h-16 md:h-20 border border-slate-200 rounded-lg md:rounded-xl p-2.5 md:p-3 text-xs md:text-sm font-medium focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none resize-none" 
             />
           </div>
           <div className="pt-2 md:pt-3 flex gap-2">
             <button type="button" onClick={onClose} className="flex-1 h-9 md:h-11 border border-slate-200 text-slate-600 rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold hover:bg-slate-50 transition-all">
               取消
             </button>
             <button 
               type="submit" 
               disabled={isSubmitting}
               className={cn(
                 "flex-[2] h-9 md:h-11 bg-slate-900 text-white rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 md:gap-2",
                 isSubmitting ? "opacity-70 cursor-not-allowed" : "hover:bg-slate-800"
               )}
             >
               {isSubmitting ? "正在提交流转..." : "确认完成"}
             </button>
           </div>
        </form>
      </motion.div>
    </div>
  );
}

function RollbackModal({ order, onClose, onDone }: { order: Order, onClose: () => void, onDone: () => Promise<void> | void }) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rollbackTargets: Record<string, string> = {
    '复膜': '印刷',
    '制袋': '复膜',
    '发货': '制袋',
    '完成': '制袋'
  };
  const target = rollbackTargets[order.status as string];

  const handleRollback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await mockService.rollbackProcess(order.id, reason);
      await onDone();
      onClose();
    } catch (err: any) {
      setError(err.message || '回退失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="relative bg-white w-full max-w-sm rounded-xl md:rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div className="px-3 md:px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-rose-50">
           <h3 className="font-bold text-rose-900 text-[13px] md:text-base flex items-center gap-1.5 md:gap-2">
             <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4 text-rose-600" />
             工序完成回退
           </h3>
           <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-4 h-4 md:w-4" /></button>
        </div>
        <form onSubmit={handleRollback} className="p-3.5 md:p-5 space-y-3 md:space-y-4">
           {error && (
             <div className="bg-rose-50 text-rose-600 text-[12px] md:text-[13px] font-bold p-2 md:p-2.5 rounded-lg border border-rose-100 flex items-center gap-1.5 md:gap-2">
               <AlertTriangle className="w-3 h-3 md:w-3.5 md:h-3.5" /> {error}
             </div>
           )}
           <p className="text-[13px] md:text-sm font-medium text-slate-600 leading-relaxed">
             确认回退「<span className="font-bold text-rose-600">{target}</span>」完成登记吗？订单状态将重新回到{target}环节。
           </p>

           <div>
             <label className="block text-[11px] md:text-xs font-bold text-slate-700 mb-1.5 md:mb-2 uppercase tracking-wide">回退原因 rollbackReason</label>
             <textarea 
               value={reason} 
               onChange={e => setReason(e.target.value)} 
               placeholder="例如：误点完成，或数据录入错误"
               className="w-full h-16 md:h-20 border border-slate-200 rounded-lg md:rounded-xl p-2.5 md:p-3 text-xs md:text-sm font-medium focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none resize-none" 
             />
           </div>

           <div className="pt-2 md:pt-3 flex gap-2">
             <button type="button" onClick={onClose} className="flex-1 h-9 md:h-11 border border-slate-200 text-slate-600 rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold hover:bg-slate-50 transition-all">
               考虑一下
             </button>
             <button 
               type="submit" 
               disabled={isSubmitting}
               className={cn(
                 "flex-[2] h-9 md:h-11 bg-rose-600 text-white rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 md:gap-2",
                 isSubmitting ? "opacity-70 cursor-not-allowed" : "hover:bg-rose-700 shadow-rose-200"
               )}
             >
               {isSubmitting ? "回退执行中..." : "确回执行回退"}
             </button>
           </div>
        </form>
      </motion.div>
    </div>
  );
}

function EditModal({ order, type, onClose, onDone }: { order: Order, type: 'info' | 'alignment', onClose: () => void, onDone: () => Promise<void> | void }) {
  const [formData, setFormData] = useState<any>(() => {
    if (type === 'info') {
      return {
        customer_name: order.customer_name,
        bag_type: order.bag_type,
        status: order.status,
        urgency: order.urgency,
        order_qty: order.order_qty,
        order_spec: order.order_spec,
        assigned_print_worker: order.assigned_print_worker || '',
        assigned_lamination_worker: order.assigned_lamination_worker || '',
        assigned_bagging_worker: order.assigned_bagging_worker || '',
        assigned_shipping_worker: order.assigned_shipping_worker || '',
        use_case: order.use_case || '',
      };
    } else {
      const summary = typeof order.work_order_summary === 'object' ? order.work_order_summary : undefined;
      // Alignment fields from order details
      return {
        productName: getProductName(order),
        bagType: order.bag_type || summary?.bagType || '',
        spec: getSpec(order),
        quantity: getQty(order),
        deliveryDate: order.delivery_date || summary?.deliveryDate || '',
        roller: getRoller(order),
        printQty: order.wo_print_qty || summary?.printQty || '',
        printMold: order.wo_print_mold || summary?.printMold || '',
        printFilmSize: order.wo_print_film_size || summary?.printFilmSize || '',
        printFilmQty: order.wo_print_film_qty || summary?.printFilmQty || '',
        printFilmUnit: order.wo_print_film_unit || summary?.printFilmUnit || order.unit || '米',
        printShift: order.wo_print_shift || '',
        refColor: order.wo_ref_color || summary?.refColor || '',
        inkRequirement: order.wo_ink_requirement || summary?.inkRequirement || '',
        filmType: order.wo_film_type || summary?.filmType || '',
        filmNote: order.wo_film_note || summary?.filmNote || '',
        layer1: order.layer1_material || summary?.layer1?.material || '',
        l1Size: order.layer1_size || summary?.layer1?.size || '',
        l1Weight: order.layer1_weight || summary?.layer1?.weight || '',
        layer2: order.layer2_material || summary?.layer2?.material || '',
        l2Size: order.layer2_size || summary?.layer2?.size || '',
        l2Weight: order.layer2_weight || summary?.layer2?.weight || '',
        layer3: order.layer3_material || summary?.layer3?.material || '',
        l3Size: order.layer3_size || summary?.layer3?.size || '',
        l3Weight: order.layer3_weight || summary?.layer3?.weight || '',
        layer4: order.layer4_material || summary?.layer4?.material || '',
        l4Size: order.layer4_size || summary?.layer4?.size || '',
        l4Weight: order.layer4_weight || summary?.layer4?.weight || '',
        outsource: order.wo_outsource || '否',
        zipPos: order.bagging_info?.zipper_pos || '',
        tearPos: order.bagging_info?.tear_pos || '',
        holePos: order.bagging_info?.hole_pos || '',
        holes: '', // Placeholder
        edges: order.bagging_info?.edge_seal || '',
        edgeCm: order.bagging_info?.edge_seal_val || '',
        packType: order.packing_info?.type || '',
        boxSpec: order.packing_info?.spec || '',
        actualQty: order.packing_info?.actual_qty || '',
        packerSign: order.packing_info?.packer || '',
        otherReq: '', // Placeholder
        remark: order.remark || ''
      };
    }
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const getMissingFields = () => {
    const missing = [];
    if (type === 'info') {
      if (!formData.customer_name) missing.push('客户名');
      if (!formData.bag_type) missing.push('袋型');
      if (!formData.order_qty) missing.push('数量');
      if (!formData.order_spec) missing.push('规格');
    } else {
      if (!formData.productName) missing.push('品名');
      if (!formData.bagType) missing.push('袋型');
      if (!formData.spec) missing.push('规格');
      if (!formData.quantity) missing.push('开单数量');
      if (!formData.roller) missing.push('压辊');
      if (!formData.printMold) missing.push('印膜');
      if (!formData.printFilmSize) missing.push('印膜尺寸');
      if (!formData.printFilmQty) missing.push('印膜数量');
    }
    return missing;
  };

  const missing = getMissingFields();

  const handleSave = async () => {
    if (missing.length > 0 && !showConfirm) {
      setShowConfirm(true);
      return;
    }

    setIsSubmitting(true);
    try {
      if (type === 'info') {
        await mockService.updateOrderFull(order.id, formData);
      } else {
        const mappedData = {
          productName: formData.productName,
          bagType: formData.bagType,
          spec: formData.spec,
          quantity: formData.quantity,
          deliveryDate: formData.deliveryDate,
          roller: formData.roller,
          remark: formData.remark,
          printMold: formData.printMold,
          printFilmSize: formData.printFilmSize,
          printFilmQty: formData.printFilmQty,
          printFilmUnit: formData.printFilmUnit,
          printShift: formData.printShift,
          refColor: formData.refColor,
          inkRequirement: formData.inkRequirement,
          filmType: formData.filmType,
          filmNote: formData.filmNote,
          layer1: formData.layer1,
          l1Size: formData.l1Size,
          l1Weight: formData.l1Weight,
          layer2: formData.layer2,
          l2Size: formData.l2Size,
          l2Weight: formData.l2Weight,
          layer3: formData.layer3,
          l3Size: formData.l3Size,
          l3Weight: formData.l3Weight,
          outsource: formData.outsource,
          printQty: formData.printQty,
        };
        await mockService.updateWorkOrderFull(order.id, mappedData);
      }
      await onDone();
      onClose();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: '保存失败' } }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-200">
        <div className="px-4 py-3 md:px-6 md:py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
           <div>
             <h3 className="font-black text-slate-900 text-[13px] md:text-lg uppercase tracking-tight">
               {type === 'info' ? '核心单据信息修正' : '生产工单字段对齐'}
             </h3>
             <p className="text-[11px] md:text-[12px] font-bold text-slate-400 mt-0.5 tracking-widest uppercase">工单号: {order.work_no}</p>
           </div>
           <button onClick={onClose} className="w-7 h-7 md:w-10 md:h-10 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shadow-sm">
             <X className="w-4 h-4 md:w-5 md:h-5" />
           </button>
        </div>

        <div className="p-3 md:p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50/50">
           {missing.length > 0 && (
             <div className="mb-3 md:mb-5 bg-red-50 border border-red-100 p-2.5 md:p-3 rounded-lg md:rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-3">
                <div className="flex items-center gap-2 md:gap-3">
                   <div className="w-6 h-6 md:w-8 md:h-8 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                     <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 text-red-600" />
                   </div>
                   <div>
                      <h5 className="text-[12px] md:text-xs font-black text-red-700 uppercase">关键字段缺失检测</h5>
                      <p className="text-[11px] md:text-[13px] text-red-600 font-bold mt-0.5">缺失项目: {missing.join('、')}</p>
                   </div>
                </div>
                <button 
                  onClick={() => {
                    const firstMissing = document.querySelector('[data-missing="true"]');
                    firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    (firstMissing as any)?.focus();
                  }}
                  className="px-2.5 py-1 md:px-3 md:py-1.5 bg-white border border-red-200 text-red-700 text-[11px] md:text-[12px] font-black rounded-lg hover:bg-red-50 transition-all uppercase tracking-widest"
                >
                  定位缺失项
                </button>
             </div>
           )}

           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 md:gap-x-6 gap-y-3 md:gap-y-4">
              {type === 'info' ? (
                <>
                  <div className="col-span-1 md:col-span-2 space-y-3 md:space-y-4">
                     <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <Field label="客户名" value={formData.customer_name} required missing={!formData.customer_name} onChange={v => setFormData({...formData, customer_name: v})} />
                        <Field label="数量" type="number" value={formData.order_qty} required missing={!formData.order_qty} onChange={v => setFormData({...formData, order_qty: v})} />
                     </div>
                     <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <Field label="规格" value={formData.order_spec} required missing={!formData.order_spec} onChange={v => setFormData({...formData, order_spec: v})} />
                        <div className="flex flex-col">
                           <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2">袋型 bag_type</label>
                           <input 
                             value={formData.bag_type} required
                             data-missing={!formData.bag_type}
                             onChange={e => setFormData({...formData, bag_type: e.target.value})}
                             className={cn(
                               "h-9 md:h-11 border rounded-lg md:rounded-xl px-3 md:px-4 text-xs md:text-sm font-bold transition-all outline-none",
                               !formData.bag_type ? "border-red-200 bg-red-50/30 ring-1 ring-red-100" : "border-slate-200 focus:border-slate-900 bg-white"
                             )}
                           />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <div className="flex flex-col">
                           <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2">状态 status</label>
                           <select 
                             value={formData.status} 
                             onChange={e => setFormData({...formData, status: e.target.value})}
                             className="h-9 md:h-11 border border-slate-200 rounded-lg md:rounded-xl px-2 md:px-3 text-[13px] md:text-sm font-bold bg-white outline-none"
                           >
                             {['印刷', '复膜', '制袋', '发货', '完成'].map(s => <option key={s} value={s}>{s}</option>)}
                           </select>
                        </div>
                        <div className="flex flex-col">
                           <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2">紧急程度 urgency</label>
                           <select 
                             value={formData.urgency} 
                             onChange={e => setFormData({...formData, urgency: Number(e.target.value)})}
                             className="h-9 md:h-11 border border-slate-200 rounded-lg md:rounded-xl px-2 md:px-3 text-[13px] md:text-sm font-bold bg-white outline-none"
                           >
                             <option value={0}>普通</option>
                             <option value={1}>加急 (红)</option>
                           </select>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <Field label="印刷机台" value={formData.assigned_print_worker} onChange={v => setFormData({...formData, assigned_print_worker: v})} />
                        <Field label="覆膜机台" value={formData.assigned_lamination_worker} onChange={v => setFormData({...formData, assigned_lamination_worker: v})} />
                     </div>
                     <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <Field label="制袋岗位" value={formData.assigned_bagging_worker} onChange={v => setFormData({...formData, assigned_bagging_worker: v})} />
                        <Field label="发货岗位" value={formData.assigned_shipping_worker} onChange={v => setFormData({...formData, assigned_shipping_worker: v})} />
                     </div>
                     <div className="flex flex-col">
                        <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2">业务备注 / 用途 use_case</label>
                        <textarea 
                          value={formData.use_case} 
                          onChange={e => setFormData({...formData, use_case: e.target.value})}
                          className="h-16 md:h-20 p-2.5 md:p-3 border border-slate-200 rounded-xl text-xs md:text-sm font-medium bg-white outline-none resize-none"
                        />
                     </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Alignment fields (huge list) - grouped appropriately */}
                  <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-3 md:gap-4 border-b border-slate-100 pb-3 md:pb-5">
                    <Field label="品名" value={formData.productName} required missing={!formData.productName} onChange={v => setFormData({...formData, productName: v})} />
                    <Field label="交期" type="date" value={formData.deliveryDate} onChange={v => setFormData({...formData, deliveryDate: v})} />
                    <Field label="规格" value={formData.spec} required missing={!formData.spec} onChange={v => setFormData({...formData, spec: v})} />
                    <Field label="压辊" value={formData.roller} required missing={!formData.roller} onChange={v => setFormData({...formData, roller: v})} />
                  </div>
                  <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-3 md:gap-4 bg-blue-50/30 p-2.5 md:p-4 rounded-xl md:rounded-2xl border border-blue-100/50">
                    <Field label="印膜材质" value={formData.printMold} required missing={!formData.printMold} onChange={v => setFormData({...formData, printMold: v})} />
                    <Field label="印膜尺寸" value={formData.printFilmSize} required missing={!formData.printFilmSize} onChange={v => setFormData({...formData, printFilmSize: v})} />
                    <Field label="印膜数量" value={formData.printFilmQty} required missing={!formData.printFilmQty} onChange={v => setFormData({...formData, printFilmQty: v})} />
                    <Field label="单价/米" value={formData.printShift} onChange={v => setFormData({...formData, printShift: v})} />
                    <div className="col-span-2">
                       <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2 block">油墨要求</label>
                       <div className="flex flex-wrap gap-2">
                         {['里印', '表印', '哑油', '水煮', '蒸煮', '铝层保护', '防滑'].map(ink => {
                            const isSelected = (formData.inkRequirement || '').includes(ink);
                            return (
                               <button 
                                 key={ink}
                                 type="button" 
                                 onClick={() => {
                                    const currentInks = (formData.inkRequirement || '').split('/').filter(Boolean);
                                    if (isSelected) {
                                       setFormData({...formData, inkRequirement: currentInks.filter((i: string) => i !== ink).join('/')});
                                    } else {
                                       setFormData({...formData, inkRequirement: [...currentInks, ink].join('/')});
                                    }
                                 }}
                                 className={cn(
                                   "px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-[12px] md:text-xs font-bold transition-all border",
                                   isSelected ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-blue-300"
                                 )}
                               >
                                 {ink}
                               </button>
                            );
                         })}
                       </div>
                    </div>
                    <Field label="参考色" value={formData.refColor} onChange={v => setFormData({...formData, refColor: v})} />
                  </div>
                  <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-3 md:gap-4 bg-purple-50/30 p-2.5 md:p-4 rounded-xl md:rounded-2xl border border-purple-100/50">
                    <Field label="第一层材质" value={formData.layer1} onChange={v => setFormData({...formData, layer1: v})} />
                    <Field label="第一层规格" value={formData.l1Size} onChange={v => setFormData({...formData, l1Size: v})} />
                    <Field label="第二层材质" value={formData.layer2} onChange={v => setFormData({...formData, layer2: v})} />
                    <Field label="第二层规格" value={formData.l2Size} onChange={v => setFormData({...formData, l2Size: v})} />
                    <div className="col-span-2">
                       <label className="flex items-center gap-2 cursor-pointer text-[12px] md:text-xs font-bold text-slate-700">
                          <input type="checkbox" checked={formData.outsource === '是'} onChange={e => setFormData({...formData, outsource: e.target.checked ? '是' : '否'})} className="rounded border-slate-300 w-3 h-3 md:w-4 md:h-4" />
                          是否外加工 outsource
                       </label>
                    </div>
                  </div>
                  {/* ... more fields as needed but simplified for display */}
                </>
              )}
           </div>
        </div>

        <div className="p-3 md:p-5 bg-white border-t border-slate-100 flex flex-col gap-2 md:gap-3">
           {showConfirm && (
             <div className="bg-amber-50 border border-amber-200 p-2 md:p-3 rounded-lg md:rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 md:gap-0 mb-1.5 md:mb-2">
                <p className="text-[11px] md:text-[13px] font-bold text-amber-800 uppercase tracking-tight">确认以此状态强制更新吗？</p>
                <div className="flex gap-2 w-full sm:w-auto">
                   <button onClick={() => setShowConfirm(false)} className="flex-1 sm:flex-none px-2.5 md:px-3 py-1.5 bg-white border border-amber-300 text-amber-700 text-[11px] md:text-[12px] font-black rounded-lg">检查</button>
                   <button onClick={() => { setShowConfirm(false); handleSave(); }} className="flex-[2] sm:flex-none px-2.5 md:px-3 py-1.5 bg-amber-600 text-white text-[11px] md:text-[12px] font-black rounded-lg shadow-sm">强制保存</button>
                </div>
             </div>
           )}
           <div className="flex gap-2 md:gap-3">
             <button onClick={onClose} className="flex-1 h-9 md:h-11 border border-slate-200 text-slate-600 rounded-lg md:rounded-xl text-[13px] md:text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-all">
               放弃
             </button>
             <button 
               onClick={handleSave}
               disabled={isSubmitting}
               className={cn(
                 "flex-[2] h-9 md:h-11 bg-slate-900 text-white rounded-lg md:rounded-xl text-[13px] md:text-sm font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-1.5 md:gap-2 transition-all",
                 isSubmitting ? "opacity-70 cursor-not-allowed" : "hover:bg-slate-800 active:scale-[0.98]"
               )}
             >
               {isSubmitting ? "保存中..." : "保存对齐数据"}
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, value, onChange, required, type = 'text', missing }: { label: string, value: any, onChange: (v: any) => void, required?: boolean, type?: string, missing?: boolean }) {
  return (
    <div className="flex flex-col">
       <label className="text-[11px] md:text-[12px] font-black text-slate-500 uppercase mb-1.5 md:mb-2">{label} {required && <span className="text-red-500">*</span>}</label>
       <input 
         type={type} 
         value={value} 
         onChange={e => onChange(e.target.value)}
         data-missing={missing}
         className={cn(
           "h-9 md:h-11 border rounded-lg md:rounded-xl px-3 md:px-4 text-xs md:text-sm font-bold transition-all outline-none",
           missing ? "border-red-200 bg-red-50/30 ring-1 ring-red-100" : "border-slate-200 focus:border-slate-900 bg-white"
         )}
       />
    </div>
  );
}

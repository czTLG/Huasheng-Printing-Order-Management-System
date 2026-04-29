import React, { useState, useEffect } from 'react';
import { 
  RefreshCcw,
  CheckCircle2,
  Zap,
  Printer,
  Wind,
  ShoppingBag,
  Truck,
  Monitor,
  Maximize2, Minimize2,
  Filter,
  Search,
  Clock,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { Order, OrderStatus } from '../types';

const STAGES: { label: OrderStatus; icon: any; color: string; bg: string; text: string; headerColor: string; headerBg: string }[] = [
  { label: '印刷', icon: Printer, color: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-600', headerColor: 'text-blue-700', headerBg: 'bg-blue-100/50' },
  { label: '复膜', icon: Wind, color: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-600', headerColor: 'text-purple-700', headerBg: 'bg-purple-100/50' },
  { label: '制袋', icon: ShoppingBag, color: 'bg-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-600', headerColor: 'text-indigo-700', headerBg: 'bg-indigo-100/50' },
  { label: '发货', icon: Truck, color: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-600', headerColor: 'text-orange-700', headerBg: 'bg-orange-100/50' },
  { label: '完成', icon: CheckCircle2, color: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-600', headerColor: 'text-emerald-700', headerBg: 'bg-emerald-100/50' },
];

export default function Board() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDark, setIsDark] = useState(true); // Shop floor dashboards look better dark default
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [orders, setOrders] = useState<Order[]>([]);

  const loadOrders = async () => {
    try {
      const rows = await mockService.getOrders();
      setOrders(rows);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '生产看板加载失败' } }));
    }
  };

  useEffect(() => {
     loadOrders();
     if (!isAutoRefresh) return;
     const interval = setInterval(() => {
        loadOrders();
     }, 10000);
     return () => clearInterval(interval);
  }, [isAutoRefresh]);

  const filteredOrders = orders.filter(o => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        o.customer_name?.toLowerCase().includes(q) || 
        o.product_name?.toLowerCase().includes(q) ||
        o.order_spec?.toLowerCase().includes(q) ||
        o.work_no?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  useEffect(() => {
    if (!isAutoRefresh) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 10;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isAutoRefresh]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        containerRef.current?.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  return (
    <div ref={containerRef} className={cn(
      "h-full flex flex-col overflow-hidden transition-colors duration-500",
      isDark ? "bg-slate-900" : "bg-[#f4f4f5]",
      isFullscreen ? (isDark ? "p-4" : "p-4 bg-slate-100") : "pb-4"
    )}>
      {/* Header Panel */}
      <div className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4 px-4 py-3 shrink-0 rounded-2xl mx-0 md:mx-2 mt-2 mb-4",
        isDark ? "bg-slate-800" : "bg-white shadow-sm border border-slate-200"
      )}>
        <div>
           <h1 className={cn("text-xl md:text-2xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-slate-900")}>
             车间生产实时看板
             <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded shadow-sm uppercase tracking-widest hidden md:inline-block">Shop Floor Live</span>
             {isFullscreen && (
               <span className="text-[10px] font-black bg-rose-500 text-white px-2 py-0.5 rounded shadow-sm uppercase tracking-widest animate-pulse">TV MODE ON</span>
             )}
           </h1>
           <p className={cn("text-[10px] md:text-xs font-bold mt-1 uppercase tracking-widest", isDark ? "text-slate-400" : "text-slate-500")}>
             [{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}] Live Production Flow Monitoring
           </p>
        </div>

        {/* Real-time Factory KPIs */}
        <div className="hidden xl:flex items-center gap-6 mr-8">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-500 flex items-center justify-center shrink-0 border border-orange-500/30">
                 <Zap className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex flex-col">
                 <span className={cn("text-[10px] font-black uppercase tracking-widest", isDark ? "text-slate-400" : "text-slate-500")}>加急任务</span>
                 <span className={cn("text-xl font-black leading-none", isDark ? "text-orange-400" : "text-orange-600")}>
                    {orders.filter(o => o.urgency > 0).length}
                 </span>
              </div>
           </div>
           <div className="w-px h-8 bg-slate-700/50"></div>
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-500/30">
                 <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                 <span className={cn("text-[10px] font-black uppercase tracking-widest", isDark ? "text-slate-400" : "text-slate-500")}>今日完工</span>
                 <span className={cn("text-xl font-black leading-none", isDark ? "text-emerald-400" : "text-emerald-600")}>
                    {orders.filter(o => o.status === '完成').length}
                 </span>
              </div>
           </div>
           <div className="w-px h-8 bg-slate-700/50"></div>
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-500 flex items-center justify-center shrink-0 border border-blue-500/30">
                 <Monitor className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                 <span className={cn("text-[10px] font-black uppercase tracking-widest", isDark ? "text-slate-400" : "text-slate-500")}>在制流转</span>
                 <span className={cn("text-xl font-black leading-none", isDark ? "text-blue-400" : "text-blue-600")}>
                    {orders.filter(o => o.status !== '完成').length}
                 </span>
              </div>
           </div>
        </div>

        <div className="flex items-center gap-3">
           <div className="relative hidden md:block">
              <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4", isDark ? "text-slate-500" : "text-slate-400")} />
              <input 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索制令号 / 品名..." 
                className={cn(
                  "w-64 h-10 pl-9 pr-4 rounded-xl text-xs font-bold outline-none transition-all", 
                  isDark ? "bg-slate-900 text-white border-slate-700 border focus:border-indigo-500" : "bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:border-indigo-400"
                )}
              />
           </div>

           <button 
             onClick={() => setIsDark(!isDark)}
             className={cn("px-4 h-10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border", 
               isDark ? "bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-700" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
             )}
           >
             {isDark ? '浅色模式' : '深色模式'}
           </button>

           <div className={cn("flex rounded-xl overflow-hidden h-10 border", isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white")}>
              <button 
                onClick={() => setIsAutoRefresh(!isAutoRefresh)} 
                className={cn(
                  "px-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest border-r transition-colors", 
                  isDark ? "border-slate-700" : "border-slate-100",
                  isAutoRefresh ? "text-indigo-500" : (isDark ? "text-slate-500 hover:bg-slate-800" : "text-slate-400 hover:bg-slate-50")
                )}>
                 <RefreshCcw className={cn("w-3.5 h-3.5", isAutoRefresh && "animate-spin-slow")} />
                 {isAutoRefresh ? `${countdown}S` : '已停止'}
              </button>
              <button onClick={toggleFullscreen} className={cn("px-4 flex items-center gap-2 transition-colors text-xs font-black tracking-widest", isDark ? "text-slate-400 hover:text-white" : "text-slate-400 hover:text-slate-900")}>
                 {isFullscreen ? <><Minimize2 className="w-3.5 h-3.5" /> 缩小</> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
           </div>
        </div>
      </div>

      {/* Kanban Board Layout */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar px-2 pb-2">
         <div className="flex h-full gap-4 min-w-max pb-2">
            {STAGES.map(stage => {
               const stageOrders = filteredOrders.filter(o => o.status === stage.label);
               return (
                 <div key={stage.label} className={cn(
                   "flex flex-col w-[320px] rounded-2xl border shrink-0 overflow-hidden",
                   isDark ? "bg-slate-800/80 border-slate-700 shadow-lg" : "bg-slate-100/50 border-slate-200/60 shadow-sm"
                 )}>
                    {/* Column Header */}
                    <div className={cn("px-4 py-3 border-b flex flex-col gap-1 shrink-0", isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white shadow-sm z-10")}>
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <div className={cn("p-1.5 rounded-lg", stage.bg, stage.text, isDark && "bg-opacity-10")}>
                               <stage.icon className="w-4 h-4" />
                            </div>
                            <h2 className={cn("font-black tracking-wider text-sm", isDark ? "text-slate-200" : "text-slate-800")}>{stage.label}</h2>
                         </div>
                         <div className={cn("px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest", 
                           stageOrders.length > 0 ? (isDark ? "bg-slate-700 text-white" : "bg-slate-900 text-white") : (isDark ? "bg-slate-700 text-slate-400" : "bg-slate-200 text-slate-500")
                         )}>
                            {stageOrders.length}
                         </div>
                       </div>
                       <div className="w-full h-1 mt-2.5 rounded-full overflow-hidden bg-slate-200/50" style={{ opacity: isDark ? 0.2 : 1 }}>
                         <div className={cn("h-full", stage.color)} style={{ width: stageOrders.length > 0 ? '100%' : '0%', transition: 'width 0.5s' }} />
                       </div>
                    </div>

                    {/* Column Body / Cards */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 custom-scrollbar">
                       <AnimatePresence>
                         {stageOrders.map(order => {
                            const isUrgent = order.urgency > 0;
                            const qty = order.order_qty || order.work_order_summary?.quantity || 0;
                            return (
                              <motion.div
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                key={order.id}
                                className={cn(
                                  "rounded-xl border flex flex-col gap-2 relative overflow-hidden transition-all",
                                  isFullscreen ? "p-4 md:p-5" : "p-3 md:p-3.5",
                                  isDark ? "bg-slate-800 border-slate-700 shadow-2xl" : "bg-white border-slate-200 shadow-sm",
                                  isUrgent && (isDark ? "border-red-500/50 bg-red-950/20" : "border-red-300 bg-red-50/50")
                                )}
                              >
                                {isUrgent && <div className="absolute top-0 right-0 w-8 h-8 md:w-10 md:h-10 rounded-bl-2xl bg-red-500 flex items-center justify-center shrink-0 z-0"><Zap className="w-4 h-4 md:w-5 md:h-5 text-white fill-current animate-pulse" /></div>}
                                
                                <div className="flex justify-between items-start z-10 relative">
                                  <div className="flex flex-col">
                                    <span className={cn("font-black font-mono px-1.5 py-0.5 rounded max-w-fit mb-1 tracking-widest", isFullscreen ? "text-xs" : "text-[10px]", isDark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-600")}>
                                      {order.work_no}
                                    </span>
                                    <span className={cn("font-bold line-clamp-2 leading-snug pr-8", isFullscreen ? "text-sm md:text-base" : "text-xs", isDark ? "text-slate-100" : "text-slate-800")} title={order.product_name}>
                                      {order.product_name || <span className="text-red-400 text-[10px]">缺品名</span>}
                                    </span>
                                  </div>
                                </div>

                                <div className={cn("font-black mt-0.5 tracking-tight", isFullscreen ? "text-xs" : "text-[10px]", isDark ? "text-slate-400" : "text-slate-500")}>
                                   <span className="opacity-70 uppercase">客户: </span> {order.customer_name}
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-1">
                                   <div className={cn("rounded-lg p-1.5 flex flex-col", isDark ? "bg-slate-900" : "bg-slate-50")}>
                                      <span className={cn("uppercase tracking-widest font-black opacity-60", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "text-slate-400" : "text-slate-500")}>规格尺寸</span>
                                      <span className={cn("font-black font-mono truncate", isFullscreen ? "text-xs md:text-sm" : "text-[10px] md:text-[11px]", isDark ? "text-slate-200" : "text-slate-700")} title={order.order_spec}>{order.order_spec || '--'}</span>
                                   </div>
                                   <div className={cn("rounded-lg p-1.5 flex flex-col", isDark ? "bg-slate-900" : "bg-slate-50")}>
                                      <span className={cn("uppercase tracking-widest font-black opacity-60", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "text-slate-400" : "text-slate-500")}>排产数量</span>
                                      <span className={cn("font-black font-mono", isFullscreen ? "text-xs md:text-sm" : "text-[10px] md:text-[11px]", stage.text)}>{Number(qty).toLocaleString()} {order.unit || ''}</span>
                                   </div>
                                </div>

                                {/* Contextual Footer Info based on stage */}
                                <div className={cn("mt-1 pt-2 border-t flex items-center justify-between gap-2 overflow-hidden", isDark ? "border-slate-700/50" : "border-slate-100")}>
                                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                                    {stage.label === '印刷' && (
                                      <>
                                        {(order.roller || order.work_order_summary?.roller) && <span className={cn("font-black px-1.5 py-0.5 rounded truncate", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-600")}>压辊: {order.roller || order.work_order_summary?.roller}</span>}
                                        {order.wo_print_mold && <span className={cn("font-black px-1.5 py-0.5 rounded truncate max-w-[100px]", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "bg-indigo-900/30 text-indigo-300" : "bg-indigo-50 text-indigo-600")}>{order.wo_print_mold}</span>}
                                      </>
                                    )}
                                    {stage.label === '复膜' && (
                                      <>
                                         <span className={cn("font-black px-1.5 py-0.5 rounded truncate", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "bg-purple-900/30 text-purple-300" : "bg-purple-50 text-purple-600")}>{order.wo_film_type || order.work_order_summary?.filmType || '常规复膜'}</span>
                                      </>
                                    )}
                                    {stage.label === '制袋' && (
                                      <>
                                         <span className={cn("font-black px-1.5 py-0.5 rounded truncate max-w-full", isFullscreen ? "text-[10px]" : "text-[9px]", isDark ? "bg-slate-700 text-slate-300" : "bg-amber-50 text-amber-700")}>{order.bag_type || order.work_order_summary?.bagType || '缺失袋型'}</span>
                                      </>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center gap-1 font-bold shrink-0 opacity-60" style={{ fontSize: isFullscreen ? '10px' : '9px', color: isDark ? '#94a3b8' : '#94a3b8' }}>
                                    <Clock className="w-3 h-3" />
                                    {new Date(order.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                              </motion.div>
                            )
                         })}
                       </AnimatePresence>
                       
                       {stageOrders.length === 0 && (
                          <div className={cn("flex flex-col items-center justify-center py-12 text-center", isDark ? "text-slate-600" : "text-slate-400")}>
                            <div className="w-12 h-12 rounded-full border-2 border-dashed border-current/20 flex items-center justify-center mb-3">
                               <stage.icon className="w-5 h-5 opacity-40" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-80">暂无队列数据</span>
                          </div>
                       )}
                    </div>
                 </div>
               )
            })}
         </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { 
  Search, Filter, Plus, MoreVertical, ChevronLeft, ChevronRight,
  Clock, Printer, Truck, CheckCircle2, AlertTriangle, History as HistoryIcon,
  Layers, Scissors, RotateCcw, X, Eye, Bookmark, BookmarkPlus, ArrowRight, Camera, AlertCircle,
  Trash2, FileText, Settings, Info, Package as PackageIcon, HardDrive, ShieldAlert,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { Order, OrderStatus } from '../types';

const StatusBadge = ({ status }: { status: import('../types').OrderStatus }) => {
  const styles: Record<string, string> = {
    '印刷': 'bg-blue-100 text-blue-700 border-blue-200 shadow-blue-100/50',
    '复膜': 'bg-purple-100 text-purple-700 border-purple-200 shadow-purple-100/50',
    '制袋': 'bg-indigo-100 text-indigo-700 border-indigo-200 shadow-indigo-100/50',
    '发货': 'bg-orange-100 text-orange-700 border-orange-200 shadow-orange-100/50',
    '完成': 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-emerald-100/50',
    '全部': 'bg-slate-100 text-slate-700 border-slate-200 shadow-slate-100/50',
  };

  const icons: Record<string, any> = {
    '印刷': Printer,
    '复膜': Layers,
    '制袋': Scissors,
    '发货': Truck,
    '完成': CheckCircle2,
  };

  const Icon = icons[status] || Clock;

  return (
    <span className={cn("px-2 py-1 rounded-md border text-[12px] md:text-[13px] font-bold flex items-center gap-1 w-fit uppercase tracking-widest shadow-sm", styles[status] || styles['全部'])}>
      <Icon className="w-2.5 h-2.5 md:w-3 md:h-3" />
      {status}
    </span>
  );
};

// Data Resolvers based on requirements
const getProductName = (order: Order) => {
  if (order.work_order_summary && typeof order.work_order_summary === 'object' && order.work_order_summary.productName) {
    return order.work_order_summary.productName;
  }
  if (order.use_case) {
    const match = order.use_case.match(/(?:品名|用途)[:：]\s*([^；;\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  if (order.legacy_data?.name) {
    return String(order.legacy_data.name).trim();
  }
  if (order.legacy_data?.old_product) {
    return String(order.legacy_data.old_product).trim();
  }
  if (order.product_name) {
    return order.product_name;
  }
  const customerName = String(order.customer_name_display || order.customer_name || '').trim();
  if (customerName && !/^备注[:：]/.test(customerName)) {
    return customerName;
  }
  return '';
};

const getCustomerName = (order: Order) => {
  if (order.is_legacy_imported) {
    return order.customer_name_display || order.work_order_summary?.customerName || order.legacy_data?.old_customer || '';
  }
  return order.customer_name_display || order.work_order_summary?.customerName || order.customer_name;
};

const getSpec = (order: Order) => {
  if (order.work_order_summary && typeof order.work_order_summary === 'object' && order.work_order_summary.spec) {
    return order.work_order_summary.spec;
  }
  if (order.use_case) {
    const match = order.use_case.match(/规格：([^；;]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return order.order_spec || '';
};

const getQty = (order: Order) => {
  if (order.work_order_summary && typeof order.work_order_summary === 'object') {
    return order.work_order_summary.quantity || order.order_qty || 0;
  }
  return order.order_qty || 0;
};

const getRoller = (order: Order) => {
  if (order.work_order_summary && typeof order.work_order_summary === 'object') {
    const summaryRoller = String(order.work_order_summary.roller || '').trim();
    if (summaryRoller) return summaryRoller;
  }
  if (order.roller) {
    return String(order.roller).trim();
  }
  if (order.use_case) {
    const match = order.use_case.match(/(?:滚筒|压辊)[:：]\s*([^；;\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  if (order.legacy_data?.roller) {
    return String(order.legacy_data.roller).trim();
  }
  return '';
};

const calculateStayDays = (order: Order) => {
  const startTime = new Date(order.start_time || order.created_at).getTime();
  if (isNaN(startTime)) return 0;
  const now = Date.now();
  const diff = now - startTime;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const isAbnormal = (order: Order) => {
  const name = getProductName(order);
  const spec = getSpec(order);
  const qty = getQty(order);
  const summary = order.work_order_summary;
  
  const conditions = [
    !name || name === '未定义品名',
    name?.startsWith('备注：'),
    !spec || spec === '--',
    !qty,
    order.status === '印刷' && !summary?.printMold && !order.wo_print_mold,
    order.status === '印刷' && !summary?.printFilmSize && !order.wo_print_film_size,
    order.status === '印刷' && !summary?.quantity && !order.wo_print_qty
  ];
  
  return conditions.some(c => c);
};

const getStatusAction = (status: OrderStatus) => {
  switch (status) {
    case '印刷': return { label: '完成印刷', next: '复膜', canRollback: false };
    case '复膜': return { label: '完成覆膜', next: '制袋', canRollback: true, rollbackLabel: '回退印刷' };
    case '制袋': return { label: '完成制袋', next: '发货', canRollback: true, rollbackLabel: '回退覆膜' };
    case '发货': return { label: '完成发货', next: '完成', canRollback: true, rollbackLabel: '回退制袋' };
    case '完成': return { label: null, next: null, canRollback: true, rollbackLabel: '回退制袋' };
    default: return { label: null, next: null, canRollback: false };
  }
};

const MissingTag = ({ text }: { text: string }) => (
  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-[12px] font-black px-1.5 py-0.5 rounded leading-none shrink-0">
    <AlertTriangle className="w-2.5 h-2.5" /> {text}
  </span>
);

function ProcessModule({ 
  title, 
  icon: Icon, 
  color, 
  status, 
  orderStatus, 
  isCompleted, 
  children,
  collapsedContent 
}: { 
  title: string, 
  icon: any, 
  color: string, 
  status: OrderStatus, 
  orderStatus: OrderStatus,
  isCompleted?: boolean,
  children: React.ReactNode,
  collapsedContent: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isActive = orderStatus === status;
  
  const colors: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-200",
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-200"
  };

  return (
    <div className={cn(
      "border rounded-xl md:rounded-2xl overflow-hidden transition-all duration-300",
      isActive ? "ring-1 md:ring-2 ring-blue-500/20 border-blue-200" : "border-slate-100",
      isCompleted ? "bg-emerald-50/5 text-slate-500" : "bg-white"
    )}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between p-3 md:p-4 text-left transition-colors",
          isActive ? "bg-blue-50/50" : isOpen ? "bg-slate-50" : "hover:bg-slate-50"
        )}
      >
        <div className="flex items-center gap-2.5 md:gap-3">
          <div className={cn("w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl flex items-center justify-center shrink-0 border shadow-sm", isCompleted ? "bg-emerald-50 text-emerald-600 border-emerald-100" : colors[color] || colors.blue)}>
            {isCompleted ? <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5" /> : <Icon className="w-4 h-4 md:w-5 md:h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="text-[13px] md:text-sm font-black text-slate-900 uppercase tracking-tight">{title}</span>
              {isActive && <span className="px-1.5 py-0.5 bg-blue-500 text-white text-[11px] font-black rounded shadow-sm animate-pulse">正在进行</span>}
              {isCompleted && <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-[11px] font-black rounded shadow-sm">已完成</span>}
            </div>
            {!isOpen && <div className="mt-0.5 md:mt-1 flex flex-wrap gap-1.5 md:gap-2 leading-tight">{collapsedContent}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronUp className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />}
        </div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: 'auto', opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3.5 md:p-5 border-t border-slate-100 space-y-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PrintingModule({ order }: { order: Order }) {
  const summary = order.work_order_summary;
  const pName = getProductName(order);
  const printMold = order.wo_print_mold || summary?.printMold;
  const printFilmSize = order.wo_print_film_size || summary?.printFilmSize;
  const roller = getRoller(order);
  const printQty = order.wo_print_qty || summary?.quantity || summary?.printQty;
  
  const isCompleted = ['复膜', '制袋', '发货', '完成'].includes(order.status);
  
  const collapsed = (
    <>
      <span className="text-[12px] font-bold text-slate-500">印刷膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺印刷膜</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">尺寸/厚度: {printFilmSize ? <span className="text-slate-800">{printFilmSize}</span> : <span className="text-amber-600">缺印膜尺寸</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">米数: {printQty ? <span className="text-slate-800">{printQty} 米</span> : <span className="text-amber-600">缺印刷米数</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">压辊: {roller ? <span className="text-slate-800">{roller}</span> : <span className="text-amber-600">缺压辊</span>}</span>
      {(order.wo_ink_requirement || summary?.inkRequirement) && <span className="text-[12px] font-bold text-slate-500">油墨: <span className="text-slate-800">{order.wo_ink_requirement || summary?.inkRequirement}</span></span>}
    </>
  );

  return (
    <ProcessModule title="印刷工序" icon={Printer} color="blue" status="印刷" orderStatus={order.status} isCompleted={isCompleted} collapsedContent={collapsed}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-3 md:gap-y-4">
        {pName ? <DataItem label="品名" value={pName} bold /> : <MissingTag text="缺品名" />}
        {printMold ? <DataItem label="印刷膜" value={printMold} /> : <MissingTag text="缺印刷膜" />}
        {printFilmSize ? <DataItem label="印刷膜尺寸" value={printFilmSize} font="mono" /> : <MissingTag text="缺印膜尺寸" />}
        <DataItem label="印刷厚度" value={order.wo_print_film_thickness || summary?.printFilmThickness || '-'} />
        {printQty ? <DataItem label="印刷数量" value={`${printQty} 米`} bold color="indigo" /> : <MissingTag text="缺印刷米数" />}
        {roller ? <DataItem label="压辊" value={roller} font="mono" /> : <MissingTag text="缺压辊" />}
        <DataItem label="参考色" value={summary?.refColor || '--'} highlight />
        <DataItem label="油墨要求" value={order.wo_ink_requirement || summary?.inkRequirement || '常规'} highlight />
        <div className="col-span-2 md:col-span-3">
          <DataItem label="工艺备注/特殊说明" value={summary?.printProcessNote || summary?.otherReq || summary?.orderNote || '--'} />
        </div>
      </div>
    </ProcessModule>
  );
}

function LaminationModule({ order }: { order: Order }) {
  const summary = order.work_order_summary;
  const pName = getProductName(order);
  const printMold = order.wo_print_mold || summary?.printMold;
  const printFilmSize = order.wo_print_film_size || summary?.printFilmSize;
  const printFilmQty = order.wo_print_film_qty || summary?.printFilmQty;
  const printFilmUnit = order.wo_print_film_unit || summary?.printFilmUnit || 'kg';
  
  const isCompleted = ['制袋', '发货', '完成'].includes(order.status);

  const collapsed = (
    <>
      {(summary?.filmType || order.wo_film_type) && <span className="text-[12px] font-bold text-slate-500">工艺: <span className="text-slate-800">{summary?.filmType || order.wo_film_type}</span></span>}
      <span className="text-[12px] font-bold text-slate-500">印膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺印膜</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">尺寸: {printFilmSize ? <span className="text-slate-800">{printFilmSize}</span> : <span className="text-amber-600">缺印膜尺寸</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">数量: {printFilmQty ? <span className="text-slate-800">{printFilmQty}{printFilmUnit}</span> : <span className="text-amber-600">缺数量</span>}</span>
      {(order.wo_ink_requirement || summary?.inkRequirement) && <span className="text-[12px] font-bold text-slate-500 break-words whitespace-normal break-all">油墨: <span className="text-slate-800">{order.wo_ink_requirement || summary?.inkRequirement}</span></span>}
    </>
  );

  return (
    <ProcessModule title="覆膜工序" icon={Layers} color="purple" status="复膜" orderStatus={order.status} isCompleted={isCompleted} collapsedContent={collapsed}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-3 md:gap-y-4">
        {summary?.filmType ? <DataItem label="工艺要求" value={summary.filmType} highlight /> : <DataItem label="工艺要求" value="未填写" highlight />}
        {printMold ? <DataItem label="印刷膜" value={printMold} /> : <MissingTag text="缺印刷膜" />}
        <div className="col-span-2 md:col-span-3">
          <DataItem label="覆膜要求备注" value={summary?.filmNote || summary?.otherReq || summary?.orderNote || '--'} />
        </div>
        
        <div className="col-span-2 md:col-span-3 mt-1 md:mt-2">
          <h5 className="text-[11px] md:text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 flex items-center gap-2">
            <span className="w-1 h-2.5 md:h-3 bg-purple-500 rounded-full"></span> 覆膜层结构表
          </h5>
          <div className="bg-slate-50/50 rounded-xl border border-slate-100 overflow-x-auto">
            <table className="w-full text-left text-[12px] md:text-[13px] border-collapse min-w-[360px]">
              <thead className="bg-slate-100/50 text-slate-500 uppercase">
                <tr>
                  <th className="py-1 md:py-2 pl-3 md:pl-4 font-black">层级</th>
                  <th className="py-1 md:py-2 font-black">材质</th>
                  <th className="py-1 md:py-2 font-black">尺寸</th>
                  <th className="py-1 md:py-2 font-black">厚度</th>
                  <th className="py-1 md:py-2 pr-3 md:pr-4 font-black">数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-white text-slate-600 transition-colors">
                  <td className="py-1.5 md:py-2.5 pl-3 md:pl-4 font-bold text-indigo-600 whitespace-nowrap">印刷膜(第一层)</td>
                  <td className="py-1.5 md:py-2.5 font-bold">{printMold || '--'}</td>
                  <td className="py-1.5 md:py-2.5 font-mono">{printFilmSize || '--'}</td>
                  <td className="py-1.5 md:py-2.5">-</td>
                  <td className="py-1.5 md:py-2.5 pr-3 md:pr-4">{printFilmQty ? `${printFilmQty}${printFilmUnit}` : '--'}</td>
                </tr>
                {[1, 2, 3, 4].map(i => {
                  const summaryLayer = summary?.laminationLayers?.[i - 1] || (summary as any)?.[`layer${i}`];
                  const material = (order as any)[`layer${i}_material`] || summaryLayer?.material;
                  const size = (order as any)[`layer${i}_size`] || summaryLayer?.size;
                  const weight = (order as any)[`layer${i}_weight`] || summaryLayer?.weight;
                  
                  if (!material && !size) return null;
                  return (
                    <tr key={i} className="hover:bg-white text-slate-600 transition-colors">
                      <td className="py-1.5 md:py-2.5 pl-3 md:pl-4 font-bold text-slate-400 whitespace-nowrap">复合第{i}层</td>
                      <td className="py-1.5 md:py-2.5 font-bold text-slate-800">{material || '--'}</td>
                      <td className="py-1.5 md:py-2.5 font-mono">{size || '--'}</td>
                      <td className="py-1.5 md:py-2.5">-</td>
                      <td className="py-1.5 md:py-2.5 pr-3 md:pr-4">{weight || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProcessModule>
  );
}

function BaggingModule({ order }: { order: Order }) {
  const summary = order.work_order_summary;
  const pName = getProductName(order);
  const spec = getSpec(order);
  const bagType = order.bag_type || summary?.bagType;
  
  const isCompleted = order.status === '发货' || order.status === '完成';

  const collapsed = (
    <>
      <span className="text-[12px] font-bold text-slate-500">规格: {spec ? <span className="text-slate-800">{spec}</span> : <span className="text-amber-600">缺规格</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">袋形: {bagType ? <span className="text-slate-800">{bagType}</span> : <span className="text-amber-600">缺袋形</span>}</span>
    </>
  );

  return (
    <ProcessModule title="制袋工序" icon={Scissors} color="indigo" status="制袋" orderStatus={order.status} isCompleted={isCompleted} collapsedContent={collapsed}>
      <div className="space-y-4 md:space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-3 md:gap-y-4">
          {pName ? <DataItem label="品名" value={pName} bold /> : <MissingTag text="缺品名" />}
          {spec ? <DataItem label="尺寸" value={spec} bold font="mono" /> : <MissingTag text="缺尺寸" />}
          {bagType ? <DataItem label="袋形" value={bagType} highlight /> : <MissingTag text="缺袋形" />}
        </div>
        
        <div className="p-3 md:p-4 bg-slate-50 rounded-xl md:rounded-2xl border border-slate-100">
          <h5 className="text-[11px] md:text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3">制袋要求</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <DataItem label="撕口" value={summary?.tearType || '未填写'} />
            <DataItem label="拉链" value={summary?.zipperType || '未填写'} />
            <DataItem label="挂孔" value={summary?.holeType || summary?.holeCount || '未填写'} />
            <DataItem label="封边" value={summary?.bagEdgeType ? `${summary.bagEdgeType} (${summary.bagSpec || ''})` : '未填写'} />
            <div className="col-span-2 md:col-span-4">
              <DataItem label="其它特殊要求" value={summary?.otherReq || '--'} />
            </div>
          </div>
        </div>

        <div className="p-3 md:p-4 bg-slate-50 rounded-xl md:rounded-2xl border border-slate-100 flex flex-col gap-3 md:gap-4">
          <div>
             <h5 className="text-[11px] md:text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3">制袋交付信息</h5>
             <div className="grid grid-cols-2 gap-3 md:gap-4">
               {summary?.deliveryDate ? <DataItem label="交货日期" value={summary.deliveryDate} color="rose" /> : <DataItem label="交货日期" value="未设置" color="slate" />}
               <DataItem label="外加工" value={summary?.outsource === '是' ? '⚡️ 包含外加工作业' : '否'} />
             </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
             <h5 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-3">制袋信息</h5>
             <div className="grid grid-cols-2 gap-4">
               <DataItem label="装箱类型" value={summary?.packType || '--'} />
               <DataItem label="装箱规格" value={summary?.boxSpec || '--'} />
               <DataItem label="实际成品数量" value={summary?.actualQty || '--'} bold color="indigo" />
               <DataItem label="装箱人签名" value={summary?.packerSign || '--'} />
             </div>
          </div>
        </div>
        
        <div className="col-span-2">
          <DataItem label="备注" value={summary?.orderNote || '--'} />
        </div>
      </div>
    </ProcessModule>
  );
}

export default function Orders() {
  const [activeStatus, setActiveStatus] = useState<OrderStatus>(() => {
    const saved = localStorage.getItem('orders.activeStatus');
    return (['印刷','复膜','制袋','发货','完成','全部'].includes(saved || '')) ? saved as OrderStatus : '全部';
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
  const [sortBy, setSortBy] = useState<'default' | 'start_time'>('default');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const [orders, setOrders] = useState<Order[]>([]);
  const [summaryOrders, setSummaryOrders] = useState<Order[]>([]);
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
    const updatedFrom = getUpdatedFrom();
    const serverStatus = activeStatus === '全部' ? undefined : activeStatus;

    // Step 1: Load current page orders first (highest priority)
    try {
      const paged = await mockService.getOrdersPage({
        q: query || undefined,
        page,
        pageSize,
        sortBy: sortBy === 'start_time' ? 'start_time' : undefined,
        sortOrder,
        status: serverStatus,
        updatedFrom: updatedFrom || undefined,
      });
      setOrders(paged.rows);
      setTotalOrders(paged.total);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '订单加载失败' } }));
    }
    setIsLoadingOrders(false);

    // Step 2: Background-load summary + stage completions (lower priority, non-blocking)
    mockService.getOrders().then(allRows => {
      setSummaryOrders(allRows);
    }).catch(() => {});

    mockService.getTodayStageCompletions().then(stageCompleted => {
      setTodayStageCompletions(stageCompleted);
    }).catch(() => {
      setTodayStageCompletions({});
    });
  };

  useEffect(() => {
    setOrders([]);
    localStorage.setItem('orders.activeStatus', activeStatus);
    loadOrders();
  }, [activeStatus, searchQuery, page, sortBy, sortOrder, orderDayMode]);

  useEffect(() => {
    setPage(1);
  }, [activeStatus, searchQuery, orderDayMode, sortBy, sortOrder]);

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

  const filteredOrders = orders.filter(order => {
    if (rollerFilter !== '全部压辊' && getRoller(order) !== rollerFilter) return false;
    if (isUrgentOnly && order.urgency <= 0) return false;
    
    const stayDays = calculateStayDays(order);
    if (stayMinDays > 0 && stayDays < stayMinDays) return false;
    
    if (orderDataMode === 'abnormal' && !isAbnormal(order)) return false;
    
    return true;
  }).sort((a, b) => {
    // Urgent orders first across all tabs
    if ((b.urgency || 0) !== (a.urgency || 0)) {
      return (b.urgency || 0) - (a.urgency || 0);
    }

    // Push completed orders to the bottom in "全部" view
    if (activeStatus === '全部') {
      if (a.status === '完成' && b.status !== '完成') return 1;
      if (b.status === '完成' && a.status !== '完成') return -1;
    }

    if (sortBy === 'start_time') {
      const tA = new Date(a.start_time || a.created_at).getTime();
      const tB = new Date(b.start_time || b.created_at).getTime();
      return sortOrder === 'desc' ? tB - tA : tA - tB;
    }
    return b.id - a.id;
  });

  const toggleSubscribe = async (orderId: number, currentStat: number | undefined) => {
    await mockService.toggleSubscribe(orderId, !currentStat);
    await loadOrders();
  };

  const togglePriority = async (order: Order) => {
    const newPriority = order.priority ? 0 : Date.now();
    await mockService.updatePriority(order.id, newPriority);
    await loadOrders();
  };

  const tabs: OrderStatus[] = ['印刷', '复膜', '制袋', '发货', '完成', '全部'];

  // Calculate process stats
  const showStats = activeStatus !== '全部' && activeStatus !== '完成';
  const summaryFilteredOrders = summaryOrders.filter(order => {
    if (activeStatus !== '全部' && order.status !== activeStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!`${getCustomerName(order)} ${getProductName(order)} ${order.bag_type || ''} ${getSpec(order)} ${getRoller(order)} ${order.remark || ''}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (rollerFilter !== '全部压辊' && getRoller(order) !== rollerFilter) return false;
    if (isUrgentOnly && order.urgency <= 0) return false;
    const stayDays = calculateStayDays(order);
    if (stayMinDays > 0 && stayDays < stayMinDays) return false;
    if (orderDataMode === 'abnormal' && !isAbnormal(order)) return false;
    const updatedFrom = getUpdatedFrom();
    if (updatedFrom) {
      const ts = Date.parse(String(order.updated_at || order.created_at || '').replace(' ', 'T'));
      const limit = Date.parse(updatedFrom.replace(' ', 'T'));
      if (Number.isFinite(ts) && Number.isFinite(limit) && ts < limit) return false;
    }
    return true;
  });

  const processPendingCount = summaryFilteredOrders.length;
  const processUrgentCount = summaryFilteredOrders.filter(o => o.urgency === 1).length;
  const processAvgStayDays = processPendingCount > 0 
    ? (summaryFilteredOrders.reduce((sum, o) => sum + calculateStayDays(o), 0) / processPendingCount).toFixed(1) 
    : '0.0';
    
  // orders that completed this stage today (from order_stage_logs)
  const processCompletedCount = todayStageCompletions[activeStatus] || 0;

  return (
    <div className="space-y-1.5 md:space-y-4">
      {/* Top Header Control Area */}
      <div className="flex items-center justify-between px-1 md:px-2 gap-2 mt-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2 truncate">
            订单中心
          </h1>
          <p className="text-slate-500 mt-0.5 font-medium text-[11px] md:text-xs truncate">管理所有生产流转订单</p>
        </div>
        <div className="flex gap-1 md:gap-2 shrink-0">
           <button 
             onClick={() => {
               if (expandedOrders.size === 0 && filteredOrders.length > 0) {
                 setExpandedOrders(new Set(filteredOrders.map(o => o.id)));
               } else {
                 setExpandedOrders(new Set());
               }
             }}
             className="px-2 md:px-4 h-8 md:h-10 border border-slate-200 bg-white rounded-lg md:rounded-xl text-[13px] md:text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all flex items-center gap-1"
           >
              {expandedOrders.size === 0 && filteredOrders.length > 0 ? "全部展开" : "全部收起"}
           </button>
           <button 
             onClick={() => setCardMode(prev => prev === 'compact' ? 'standard' : prev === 'standard' ? 'full' : 'compact')}
             className="px-2 md:px-4 h-8 md:h-10 border border-slate-200 bg-white rounded-lg md:rounded-xl text-[13px] md:text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all flex items-center gap-1"
           >
              {cardMode === 'compact' ? "紧凑模式" : cardMode === 'standard' ? "标准模式" : "完整显示"}
           </button>
        </div>
      </div>

      {/* Quick Filters - Status */}
      {!cardMode.includes('compact') && (
        <div className="flex flex-col xl:flex-row xl:items-center justify-between px-1 md:px-2 gap-2">
          {/* Scrollable Tabs Wrapper */}
          <div className="w-full xl:w-auto overflow-x-auto no-scrollbar pb-1.5 max-w-[100vw]">
            <div className="flex flex-nowrap w-max gap-1 p-1 pl-1 bg-white md:bg-transparent md:border-0 rounded-lg md:rounded-none border border-slate-200">
              {tabs.map((tab) => (
                <button
                  key={`tab-${tab}`}
                  onClick={() => setActiveStatus(tab)}
                  className={cn(
                    "px-3 md:px-4 py-1.5 md:py-2 rounded-md md:rounded-lg text-[13px] md:text-sm font-bold transition-all whitespace-nowrap shrink-0 block",
                    activeStatus === tab 
                      ? "bg-slate-900 text-white shadow-sm" 
                      : "text-slate-500 hover:text-slate-900 md:hover:bg-slate-50 bg-transparent md:bg-white md:border md:border-slate-200 md:shadow-sm"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex flex-nowrap xl:flex-wrap items-center gap-1.5 md:gap-2 w-full xl:w-auto -mt-1 md:mt-0">
            <div className="relative flex-1 md:w-64 shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="搜索(客户/袋型/备注/规格)..." 
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.trim() !== '') {
                    setActiveStatus('全部');
                  }
                }}
                className="w-full bg-white border border-slate-200 rounded-lg md:rounded-xl h-8 md:h-10 pl-8 md:pl-9 pr-3 text-[13px] md:text-sm font-medium focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all outline-none md:shadow-sm"
              />
            </div>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                 "h-8 md:h-10 px-3 md:px-4 border rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold transition-all flex items-center gap-1.5 md:gap-2 shrink-0 md:shadow-sm",
                 showFilters ? "bg-slate-100 border-slate-300 text-slate-900" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <Filter className="w-3 h-3 md:w-3.5 md:h-3.5" />
              <span className="hidden md:inline">{showFilters ? '收起' : '详细筛选'}</span>
              <span className="md:hidden">{showFilters ? '收起' : '筛选'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Process Stats Bar */}
      {showStats && (
         <div className="mx-1 md:mx-2 mt-1 mb-2 px-3 py-2 bg-indigo-50 border border-indigo-100/50 rounded-lg flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] md:text-sm shadow-sm transition-all">
            <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">筛选结果:</span><span className="font-extrabold text-indigo-900">{processPendingCount} 单未完成</span></div>
            <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
            <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">其中加急:</span><span className="font-black text-rose-600 drop-shadow-sm">{processUrgentCount} 单</span></div>
            <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
            <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">平均滞留:</span><span className="font-extrabold text-amber-600">{processAvgStayDays} 天</span></div>
            <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
            <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">当天完成:</span><span className="font-extrabold text-emerald-600">{processCompletedCount} 单</span></div>
         </div>
      )}

      {/* Advanced Filter Panel */}
      <AnimatePresence>
         {showFilters && (
            <motion.div 
               initial={{ opacity: 0, height: 0 }}
               animate={{ opacity: 1, height: 'auto' }}
               exit={{ opacity: 0, height: 0 }}
               className="overflow-hidden"
            >
              <div className="mx-1 md:mx-2 mt-2 bg-white border border-slate-200 rounded-xl md:rounded-2xl p-2.5 md:p-4 shadow-sm">
                 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-4">
                    {/* Urgency */}
                    <label className="flex items-center gap-2 text-[13px] md:text-xs font-bold text-slate-700 cursor-pointer col-span-1 border md:border-none p-2 md:p-0 rounded-lg">
                      <input type="checkbox" checked={isUrgentOnly} onChange={e => setIsUrgentOnly(e.target.checked)} className="rounded border-slate-300 w-3 h-3 md:w-3.5 md:h-3.5 text-indigo-600 focus:ring-indigo-600" />
                      仅看加急
                    </label>
                    {/* Abnormal */}
                    <label className="flex items-center gap-2 text-[13px] md:text-xs font-bold text-slate-700 cursor-pointer col-span-1 border md:border-none p-2 md:p-0 rounded-lg">
                      <input type="checkbox" checked={orderDataMode === 'abnormal'} onChange={e => setOrderDataMode(e.target.checked ? 'abnormal' : 'all')} className="rounded border-slate-300 w-3 h-3 md:w-3.5 md:h-3.5 text-red-500 focus:ring-red-500" />
                      仅异常数据
                    </label>

                    <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                      <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">压辊要求</span>
                      <select 
                        value={rollerFilter} onChange={(e) => setRollerFilter(e.target.value)}
                        className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none"
                      >
                        <option value="全部压辊">全部压辊</option>
                        <option value="55">55 机型</option>
                        <option value="65">65 机型</option>
                        <option value="70">70 机型</option>
                        <option value="75">75 机型</option>
                        <option value="80">80 机型</option>
                        <option value="80+">80+ 机型</option>
                        <option value="90">90 机型</option>
                        <option value="105">105 机型</option>
                      </select>
                    </div>

                    <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                      <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">建单时间</span>
                      <select 
                        value={orderDayMode} onChange={(e) => setOrderDayMode(e.target.value as any)}
                        className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none"
                      >
                        <option value="all">全部开单时间</option>
                        <option value="today">仅今天新单</option>
                        <option value="3days">近3天新单</option>
                      </select>
                    </div>

                    <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                      <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">排序依据</span>
                      <div className="flex bg-slate-50 border border-slate-200 rounded-lg overflow-hidden h-8 md:h-9">
                        <select 
                          value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                          className="flex-1 bg-transparent px-2 text-[13px] md:text-xs font-medium outline-none border-r border-slate-200"
                        >
                          <option value="default">默认排序</option>
                          <option value="start_time">按开单时间</option>
                        </select>
                        <button 
                          onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                          className="px-2 text-slate-500 hover:text-slate-900 font-bold text-[11px] md:text-[12px]"
                        >
                          {sortOrder === 'desc' ? '降序' : '升序'}
                        </button>
                      </div>
                    </div>

                    <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                       <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">停留时间</span>
                      <select 
                        value={stayMinDays} onChange={(e) => setStayMinDays(Number(e.target.value))}
                        className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none"
                      >
                        <option value="0">全部停留时间</option>
                        <option value="1">大于 1 天</option>
                        <option value="3">大于等于 3 天</option>
                      </select>
                    </div>
                 </div>
              </div>
            </motion.div>
         )}
      </AnimatePresence>

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
             const abNormalData = isAbnormal(order);
             const stayDays = calculateStayDays(order);
             const isOverdue = stayDays >= 3;
             const pName = getProductName(order);
             const cName = getCustomerName(order);
             const spec = getSpec(order);
             const qty = getQty(order);
             const roller = getRoller(order);
             const statusAction = getStatusAction(order.status);
             const isCollapsed = !expandedOrders.has(order.id);
             
             const summary = order.work_order_summary;
             const bagType = order.bag_type || summary?.bagType;
             const printMold = order.wo_print_mold || summary?.printMold;

             const missingFields = [];
             if (!pName || pName === '未定义品名') missingFields.push('品名');
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
             } else if (order.status === '制袋') {
               if (!bagType) missingFields.push('袋型');
             }
             
             return (
               <div 
                 key={order.id} 
                 onPointerDown={(e) => {
                   const timer = setTimeout(() => togglePriority(order), 600);
                   setLongPressTimer(timer);
                 }}
                 onPointerUp={() => { if (longPressTimer) clearTimeout(longPressTimer); }}
                 onPointerLeave={() => { if (longPressTimer) clearTimeout(longPressTimer); }}
                 className={cn(
                   "bg-white border shadow-sm hover:shadow-md transition-all flex flex-col group relative overflow-hidden",
                   order.priority ? "border-indigo-400 ring-1 ring-indigo-100" : "border-slate-200",
                   cardMode === 'compact' ? "p-2.5 md:p-3 rounded-xl" : "p-3 md:p-5 rounded-2xl",
                   isCollapsed && "pb-2.5 md:pb-3"
                 )}
               >
                 {order.priority ? (
                   <div className="absolute top-0 right-0 w-8 h-8 bg-indigo-500 flex items-center justify-center rounded-bl-xl shadow-sm z-10 pointer-events-none">
                      <Bookmark className="w-3.5 h-3.5 text-white fill-current" />
                   </div>
                 ) : null}
                 {/* 第一层级：必须最醒目 (First Tier) */}
                <div className={cn("flex items-start justify-between", !isCollapsed && "mb-3 md:mb-4")}>
                  <div className="flex-1 min-w-0 pr-1 md:pr-2">
                    <div className="flex flex-wrap items-center gap-1 mb-1.5 md:mb-2">
                      {order.urgency === 1 && (
                        <span className="bg-red-600 text-white text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded shadow-sm animate-pulse shrink-0 uppercase tracking-widest">
                          加急
                        </span>
                      )}
                      {isOverdue && (
                        <span className="bg-rose-100 text-rose-700 border border-rose-200 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded shrink-0">
                          滞留: {stayDays}天
                        </span>
                      )}
                      {abNormalData && (
                        <span className="bg-amber-100 border border-amber-200 text-amber-700 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                          <AlertTriangle className="w-2.5 h-2.5" /> 核对
                        </span>
                      )}
                      {missingFields.map(f => (
                        <span key={f} className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-black px-1 md:px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">
                          缺{f}
                        </span>
                      ))}
                      {order.my_subscribed === 1 && cardMode !== 'compact' && (
                        <span className="bg-blue-50 text-blue-600 border border-blue-100 text-[11px] md:text-[12px] font-black px-1.5 md:px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                          <Bookmark className="w-2 h-2 md:w-2.5 md:h-2.5 fill-current" /> 订阅
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2">
                        <button 
                            onClick={(e) => toggleExpand(order.id, e)} 
                            className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-md p-1 md:p-0.5 transition-colors"
                        >
                           {isCollapsed ? <ChevronDown className="w-4 h-4 md:w-4 md:h-4" /> : <ChevronUp className="w-4 h-4 md:w-4 md:h-4" />}
                        </button>
                        <h3 className={cn("font-black text-slate-900 truncate tracking-tight flex-1", cardMode === 'compact' ? "text-xs md:text-sm" : "text-[15px] md:text-lg")} title={pName}>
                          {pName}
                        </h3>
                    </div>
                    {cName && pName !== cName && (
                      <p className={cn("text-[11px] md:text-[13px] text-slate-500 font-bold mt-0.5 md:mt-1 uppercase tracking-wide ml-6 md:ml-7", isCollapsed && "hidden sm:block")}>客户：{cName}</p>
                    )}
                    
                    {/* Outer Card Contextual Second Line (Always visible except in compact mode) */}
                    {cardMode !== 'compact' && (
                      <div className="ml-6 md:ml-7 mt-1 md:mt-1.5 flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-0.5 md:gap-y-1">
                        {order.status === '印刷' && (
                          <>
                            <span className="text-[12px] font-bold text-slate-500">印膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺</span>}</span>
                            <span className="text-[12px] font-bold text-slate-500">尺寸: {(order.wo_print_film_size || summary?.printFilmSize) ? <span className="text-slate-800">{order.wo_print_film_size || summary?.printFilmSize}</span> : <span className="text-amber-600">缺</span>}</span>
                            <span className="text-[12px] font-bold text-slate-500">米数: {(order.wo_print_qty || summary?.quantity || summary?.printQty) ? <span className="text-slate-800">{order.wo_print_qty || summary?.quantity || summary?.printQty}</span> : <span className="text-amber-600">缺</span>}</span>
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
                           const prevCompletedLog = order.operation_logs?.find(l => l.type === 'COMPLETE' && !l.is_rolled_back && l.detail === `${processName}工序已提交完成`);
                           return (
                             <>
                               {prevCompletedLog?.qty && (
                                 <span className="text-[12px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded leading-none flex items-center shrink-0">
                                   [{processName}]完成: {prevCompletedLog.qty}{prevCompletedLog.unit || ''}
                                 </span>
                               )}
                               <span className="text-[12px] font-bold text-slate-500">规格: {spec ? <span className="text-slate-800">{spec}</span> : <span className="text-amber-600">缺</span>}</span>
                               <span className="text-[12px] font-bold text-slate-500">袋形: {bagType ? <span className="text-slate-800">{bagType}</span> : <span className="text-amber-600">缺</span>}</span>
                             </>
                           );
                        })()}
                      </div>
                    )}
                  </div>
                   <div className="shrink-0 flex flex-col items-end gap-1.5 md:gap-2">
                     <StatusBadge status={order.status} />
                     {order.order_image_thumb_url && cardMode !== 'compact' && !isCollapsed && (
                       <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg border border-slate-100 overflow-hidden shadow-inner bg-slate-50 flex items-center justify-center p-0.5">
                          <img src={order.order_image_thumb_url} referrerPolicy="no-referrer" alt="thumb" className="w-full h-full object-cover rounded-[3px]" />
                       </div>
                     )}
                   </div>
                 </div>

                 {!isCollapsed && (
                   <>
                     {/* 第二层级：生产关键参数区 (Second Tier) */}
                     <div className={cn(
                       "grid gap-y-1.5 md:gap-y-3 gap-x-2 md:gap-x-4 mb-2.5 md:mb-4 bg-slate-50/50 p-2 md:p-4 rounded-lg md:rounded-2xl border border-slate-100/50",
                       cardMode === 'compact' ? "grid-cols-2 p-1.5 mb-1.5" : "grid-cols-2 md:grid-cols-4"
                     )}>
                        <div className="flex flex-col">
                           <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1">
                             <Layers className="w-2.5 h-2.5 hidden sm:block" /> 成品/基材
                           </span>
                           <span className={cn("font-black text-slate-800 truncate", cardMode === 'compact' ? "text-[13px] md:text-xs" : "text-xs md:text-sm")}>{bagType || order.wo_print_mold || summary?.printMold || '--'}</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1">
                             <ArrowRight className={cn("w-2.5 h-2.5 hidden sm:block", cardMode === 'compact' ? "rotate-90" : "")} /> 规格/尺寸
                           </span>
                           <span className={cn("font-black text-slate-800 font-mono tracking-tight text-xs", cardMode === 'compact' ? "md:text-xs" : "md:text-sm")}>
                             {spec} {isAbnormal(order) && !spec && <span className="text-rose-500 ml-1">?</span>}
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1">
                             <FileText className="w-2.5 h-2.5 hidden sm:block" /> 计划数量
                           </span>
                           <span className={cn("font-black text-indigo-600 font-mono tracking-tighter text-xs md:text-sm", cardMode === 'compact' ? "" : "md:text-base")}>
                             {qty ? Number(qty).toLocaleString() : '--'} <span className="text-[11px] md:text-[12px] font-bold text-slate-400">{order.unit || 'PCS'}</span>
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[10px] md:text-[11px] text-slate-400 font-black uppercase tracking-widest mb-1 md:mb-1.5 flex items-center gap-1">
                             <Settings className="w-2.5 h-2.5 hidden sm:block" /> 机型要求
                           </span>
                           <span className="text-[12px] md:text-xs font-black text-slate-700 bg-white border border-slate-200 px-1.5 md:px-2 py-0 md:py-0.5 rounded shadow-sm w-fit">{roller}</span>
                        </div>
                     </div>

                     {/* 第三层级：辅助信息与备注 (Third Tier) */}
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

                     {/* Action Bar (Buttons) */}
                     <div className={cn(
                       "mt-auto pt-2.5 md:pt-4 border-t border-slate-100 flex items-center justify-between gap-2",
                       cardMode === 'compact' ? "pt-2" : ""
                     )}>
                        <div className="flex items-center gap-1 md:gap-1.5">
                          {statusAction.canRollback && (
                            <button 
                              onClick={() => setRollbackOrder(order)} 
                              className="h-7 md:h-9 px-2 md:px-3 bg-white border border-slate-200 rounded-lg md:rounded-xl text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-all flex items-center justify-center shadow-sm gap-1 md:gap-2"
                              title={statusAction.rollbackLabel}
                            >
                              <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
                              <span className="text-[12px] md:text-[13px] font-bold">{statusAction.rollbackLabel}</span>
                            </button>
                          )}
                          <button 
                            onClick={() => toggleSubscribe(order.id, order.my_subscribed)}
                            className={cn(
                              "w-7 h-7 md:w-9 md:h-9 rounded-lg md:rounded-xl border transition-all flex items-center justify-center shadow-sm",
                              order.my_subscribed === 1 
                                ? "bg-blue-50 border-blue-200 text-blue-600" 
                                : "bg-white border-slate-200 text-slate-400 hover:bg-slate-50"
                            )}
                            title={order.my_subscribed === 1 ? "取消订阅" : "订阅生产看板"}
                          >
                             <BookmarkPlus className={cn("w-3.5 h-3.5 md:w-4 md:h-4", order.my_subscribed === 1 && "fill-current")} />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-1.5 md:gap-2">
                          <button 
                            onClick={() => openOrderHistory(order)} 
                            className="px-2.5 md:px-3 h-7 md:h-9 bg-white border border-slate-200 rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-1.5 md:gap-2 shadow-sm"
                          >
                             <HistoryIcon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                             追溯
                          </button>
                          <button 
                            onClick={() => openOrderDetail(order)} 
                            className="px-2.5 md:px-3 h-7 md:h-9 bg-white border border-slate-200 rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-1.5 md:gap-2 shadow-sm"
                          >
                             <Eye className="w-3 h-3 md:w-3.5 md:h-3.5" />
                             详情
                          </button>
                          {statusAction.label && (
                            <button 
                              onClick={() => setProcessOrder(order)}
                              className="px-3 md:px-4 h-7 md:h-9 bg-slate-900 text-white rounded-lg md:rounded-xl text-[12px] md:text-[13px] font-black uppercase tracking-widest flex items-center gap-1.5 md:gap-2 hover:bg-slate-800 shadow-md shadow-slate-200 active:scale-[0.98] transition-all"
                            >
                              <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-emerald-400" />
                              {statusAction.label}
                            </button>
                          )}
                        </div>
                     </div>
                   </>
                 )}
               </div>
             )
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
           <HistoryModal 
             order={historyOrder} 
             onClose={() => setHistoryOrder(null)} 
           />
         )}
      </AnimatePresence>

      {/* Detail Drawer */}
      <AnimatePresence>
         {detailOrder && <DetailDrawer order={detailOrder} onClose={() => setDetailOrder(null)} canEdit={canEdit} setEditOrder={setEditOrder} setRollbackOrder={setRollbackOrder} currentUser={currentUser} />}
      </AnimatePresence>
    </div>
  );
}

// Subcomponents

function HistoryModal({ order, onClose }: { order: Order, onClose: () => void }) {
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
                    <div className={cn("absolute -left-[13px] md:-left-[15px] top-0 w-6 h-6 md:w-7 md:h-7 rounded-full border-2 flex items-center justify-center shadow-sm transition-transform group-hover:scale-110", iconColor)}>
                      <Icon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </div>
                    
                    <div className={cn(
                      "p-3 md:p-4 rounded-xl border",
                      isRollback ? "bg-rose-50/30 border-rose-100" : "bg-slate-50/50 border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all"
                    )}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between mb-2 gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                           <span className={cn("text-xs md:text-sm font-black whitespace-nowrap", isRollback ? "text-rose-700" : "text-slate-800")}>
                             {log.operator_name || '系统操作'}
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
                           {log.qty && <span className="flex items-center gap-1"><PackageIcon className="w-3 h-3 md:w-3.5 md:h-3.5 opacity-70" /> 数量: {log.qty} {log.unit}</span>}
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

function DetailDrawer({ order, onClose, canEdit, setEditOrder, setRollbackOrder, currentUser }: { order: Order, onClose: () => void, canEdit: boolean, setEditOrder: any, setRollbackOrder: any, currentUser: any }) {
  const [activeTab, setActiveTab] = useState<'info' | 'logs'>('info');
  const [isLegacyOpen, setIsLegacyOpen] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [viewingFullImage, setViewingFullImage] = useState<string | null>(null);
  const [, setRefreshTick] = useState(0);

  const abnormal = isAbnormal(order);
  const pName = getProductName(order);
  const cName = getCustomerName(order);
  const spec = getSpec(order);
  const qty = getQty(order);

  const handleApplyUrl = async () => {
    if (!imageUrlInput) return;
    await mockService.updateImage(order.id, imageUrlInput);
    setImageUrlInput('');
    const detail = await mockService.getOrderDetail(order.id);
    Object.assign(order, detail);
    setRefreshTick(v => v + 1);
  };

  const handleUploadClick = () => {
     setIsUploading(true);
     setTimeout(async () => {
        await mockService.updateImage(order.id, `https://picsum.photos/seed/${Math.random()}/1000/1000`);
        const detail = await mockService.getOrderDetail(order.id);
        Object.assign(order, detail);
        setRefreshTick(v => v + 1);
        setIsUploading(false);
     }, 1000);
  };

  const handleDeleteImage = async () => {
     if (confirm('确认删除工单附图吗？')) {
        await mockService.deleteImage(order.id);
        const detail = await mockService.getOrderDetail(order.id);
        Object.assign(order, detail);
        setRefreshTick(v => v + 1);
     }
  };

  const handleDeleteOrder = async () => {
     if (confirm('危险：确认永久删除该订单？此操作不可撤销。')) {
       try {
         await mockService.deleteOrder(order.id);
         onClose();
         // Force parent to reload by triggering the callback
         if (typeof window !== 'undefined') {
           window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '订单已永久删除' } }));
         }
       } catch (err: any) {
         window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '删除失败' } }));
       }
     }
  };
  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
         
         <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-2.5 md:pb-4 border-b border-slate-100 flex items-start justify-between bg-white">
            <div className="min-w-0 pr-4">
               <div className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2">
                 <StatusBadge status={order.status} />
                 <span className="text-[11px] md:text-[12px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-1.5 md:px-2 py-0.5 rounded border border-slate-100">ORD-{order.id}</span>
                 {order.urgency === 1 && <span className="bg-red-500 text-white text-[10px] md:text-[11px] font-black px-1 md:px-1.5 py-0.5 rounded uppercase tracking-tighter">URGENT</span>}
               </div>
               <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight leading-tight line-clamp-2">{pName}</h2>
               <div className="flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-1 mt-1 md:mt-1.5">
                  {cName && cName !== pName && (
                    <span className="text-[13px] md:text-xs font-bold text-slate-500 flex items-center gap-1"><Eye className="w-2.5 h-2.5 md:w-3 md:h-3"/> 客户: {cName}</span>
                  )}
                  <span className="text-[13px] md:text-xs font-bold text-slate-400 flex items-center gap-1"><Clock className="w-2.5 h-2.5 md:w-3 md:h-3"/> {order.updated_at.substring(0,16).replace('T',' ')}</span>
               </div>
               {order.recent_change_diff && (
                 <div className="mt-1.5 md:mt-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg">
                   <span className="text-[12px] md:text-[13px] font-medium text-amber-800">{order.recent_change_diff}</span>
                 </div>
               )}
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
               <button onClick={onClose} className="w-7 h-7 md:w-9 md:h-9 rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors">
                  <X className="w-4 h-4 md:w-5 md:h-5" />
               </button>
            </div>
         </div>

         <div className="px-3 md:px-6 py-2 md:py-3 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-0">
            <div className="flex bg-white rounded-full border border-slate-200 shadow-sm overflow-hidden p-0.5 w-max">
               <button onClick={() => setActiveTab('info')} className={cn("px-3 md:px-4 py-1.5 rounded-full text-[13px] md:text-xs font-black transition-all uppercase tracking-tighter", activeTab === 'info' ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-900")}>生产档案</button>
               <button onClick={() => setActiveTab('logs')} className={cn("px-3 md:px-4 py-1.5 rounded-full text-[13px] md:text-xs font-black transition-all uppercase tracking-tighter", activeTab === 'logs' ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-900")}>流转日志</button>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
               {canEdit && (
                  <div className="flex bg-white rounded-lg md:rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-x divide-slate-100 ml-auto md:ml-0">
                     <button onClick={() => setEditOrder({ order, type: 'info' })} className="px-2.5 md:px-4 h-8 md:h-9 text-[12px] md:text-[13px] font-black text-indigo-600 hover:bg-slate-50 flex items-center gap-1 md:gap-1.5 uppercase tracking-tighter shadow-sm"><Settings className="w-3 h-3 md:w-3.5 md:h-3.5"/> 修正</button>
                     <button onClick={() => setEditOrder({ order, type: 'alignment' })} className="px-2.5 md:px-4 h-8 md:h-9 text-[12px] md:text-[13px] font-black text-emerald-600 hover:bg-slate-50 flex items-center gap-1 md:gap-1.5 uppercase tracking-tighter shadow-sm"><Info className="w-3 h-3 md:w-3.5 md:h-3.5"/> 对齐</button>
                  </div>
               )}
               <button onClick={() => setRollbackOrder(order)} className="w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl border border-rose-200 bg-white text-rose-500 shadow-sm flex items-center justify-center hover:bg-rose-50 transition-colors"><RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar p-2 md:p-4 space-y-2 md:space-y-4 bg-white">
            {activeTab === 'info' ? (
              <>
                {abnormal && (
                   <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3 shadow-sm shadow-amber-100/50">
                      <div className="w-8 h-8 md:w-10 md:h-10 bg-amber-100 rounded-lg md:rounded-xl flex items-center justify-center shrink-0 border border-amber-200"><AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-amber-600" /></div>
                      <div className="flex-1 min-w-0">
                         <h4 className="text-[13px] md:text-sm font-black text-amber-900 uppercase">数据合规待核对</h4>
                         <p className="text-[13px] font-medium text-amber-700 mt-0.5 md:mt-1 leading-normal md:leading-relaxed">检测到档案字段未对齐，建议补齐以确保报表准确。</p>
                      </div>
                   </div>
                )}

                <DetailSection title="订单基础背景" icon={FileText} color="slate">
                   <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 md:gap-y-4 gap-x-3 md:gap-x-6">
                      <DataItem label="工单编码" value={order.work_no} font="mono" />
                      <DataItem label="业务单号" value={order.work_order_summary?.workNo || '手工建单'} />
                      <DataItem label="袋型" value={order.bag_type || order.work_order_summary?.bagType || '--'} highlight />
                      <DataItem label="规格" value={spec} bold font="mono" />
                      <DataItem label="基础数量" value={`${Number(qty).toLocaleString()} ${order.unit || 'PCS'}`} bold color="indigo" />
                      <DataItem label="交货日期" value={order.work_order_summary?.deliveryDate || '--'} color="rose" />
                   </div>
                   {(order.assigned_print_worker || order.assigned_lamination_worker || order.assigned_bagging_worker || order.assigned_shipping_worker) && (
                     <div className="mt-3 pt-3 border-t border-slate-100">
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                         {order.assigned_print_worker && <DataItem label="印刷机台" value={order.assigned_print_worker} />}
                         {order.assigned_lamination_worker && <DataItem label="覆膜机台" value={order.assigned_lamination_worker} />}
                         {order.assigned_bagging_worker && <DataItem label="制袋岗位" value={order.assigned_bagging_worker} />}
                         {order.assigned_shipping_worker && <DataItem label="发货岗位" value={order.assigned_shipping_worker} />}
                       </div>
                     </div>
                   )}
                   {order.remark && (
                     <div className="mt-3 pt-3 border-t border-slate-100">
                       <DataItem label="备注" value={order.remark} />
                     </div>
                   )}
                </DetailSection>

                <PrintingModule order={order} />
                <LaminationModule order={order} />
                <BaggingModule order={order} />

                <DetailSection title="工单附图" icon={Camera} color="rose">
                   <div className="space-y-4">
                      {order.order_image_url ? (
                        <div className="relative group rounded-2xl overflow-hidden border p-1 bg-slate-50">
                           <img src={order.order_image_thumb_url || order.order_image_url} alt="Bag Ref" className="w-full h-auto rounded-xl cursor-pointer" onClick={() => setViewingFullImage(order.order_image_url || null)} />
                           <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setViewingFullImage(order.order_image_url || null)} className="w-8 h-8 rounded-lg bg-white/90 shadow-sm flex items-center justify-center"><Search className="w-4 h-4"/></button>
                              {order.image_can_delete && <button onClick={handleDeleteImage} className="w-8 h-8 rounded-lg bg-rose-500 shadow-sm flex items-center justify-center text-white"><Trash2 className="w-4 h-4"/></button>}
                           </div>
                        </div>
                      ) : (
                        <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl bg-slate-50/50 gap-2">
                           <Camera className="w-8 h-8 text-slate-300" />
                           {canEdit && <button onClick={handleUploadClick} disabled={isUploading} className="text-[12px] font-black text-indigo-600 uppercase border-b border-indigo-200">{isUploading ? '正在上传...' : '上传图片'}</button>}
                        </div>
                      )}
                      {canEdit && (
                        <div className="flex gap-2">
                          <input type="text" placeholder="粘贴 URL..." value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} className="flex-1 h-9 bg-slate-50 border border-slate-200 rounded-lg px-3 text-[13px] outline-none" />
                          <button onClick={handleApplyUrl} className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-black uppercase tracking-widest shadow-sm">粘贴同步</button>
                        </div>
                      )}
                   </div>
                </DetailSection>

                {order.is_legacy_imported && (
                   <section>
                      <button onClick={() => setIsLegacyOpen(!isLegacyOpen)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 rounded-xl border hover:bg-slate-200 transition-colors">
                         <span className="text-xs font-black text-slate-700 flex items-center gap-2"><HardDrive className="w-3.5 h-3.5"/> 历史导入字段详细</span>
                         <Plus className={cn("w-4 h-4 transition-transform", isLegacyOpen && "rotate-45")} />
                      </button>
                      <AnimatePresence>
                         {isLegacyOpen && (
                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                               <div className="p-4 bg-slate-50 border-x border-b rounded-b-xl grid grid-cols-2 gap-4">
                                  {Object.entries(order.legacy_data || {}).map(([key, val]) => (
                                     <div key={key}>
                                        <span className="block text-[12px] font-black text-slate-400 uppercase tracking-tighter">{key}</span>
                                        <span className="text-xs font-bold text-slate-700">{String(val)}</span>
                                     </div>
                                  ))}
                               </div>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </section>
                )}

                {currentUser?.role === 'super_admin' && (
                  <DetailSection title="危险管理" icon={ShieldAlert} color="red">
                     <div className="p-4 border border-rose-200 rounded-2xl bg-rose-50/30 flex items-center justify-between">
                        <span className="text-xs font-black text-rose-900 uppercase">删除此订单档案</span>
                        <button onClick={handleDeleteOrder} className="h-9 px-4 bg-rose-600 text-white rounded-xl text-[12px] font-black uppercase shadow-sm">立即删除</button>
                     </div>
                  </DetailSection>
                )}
              </>
            ) : (
              <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-slate-200 ml-2">
                 {order.operation_logs?.map((log, i) => (
                    <div key={i} className="relative pl-8">
                       <span className={cn("absolute left-0 top-1 w-[22px] h-[22px] rounded-full border-4 border-white shadow-md flex items-center justify-center -translate-x-[2px] z-10", log.type === 'COMPLETE' ? 'bg-emerald-500' : log.type === 'ROLLBACK' ? 'bg-rose-500' : 'bg-slate-400')} />
                       <div className={cn("bg-white border rounded-xl md:rounded-2xl p-3 md:p-4 shadow-sm transition-all", log.is_rolled_back && "opacity-60 grayscale bg-slate-50")}>
                          <div className="flex justify-between items-center mb-1.5 md:mb-2">
                             <div className="flex items-center gap-1.5 md:gap-2">
                                <span className={cn("text-[10px] md:text-[11px] font-black px-1.5 md:px-2 py-0.5 rounded uppercase tracking-tighter", log.type === 'COMPLETE' ? 'bg-emerald-100 text-emerald-700' : log.type === 'ROLLBACK' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}>{log.type}</span>
                                {log.is_rolled_back && <span className="text-[11px] md:text-[12px] font-black text-red-500 uppercase flex items-center gap-1 shrink-0"><ShieldAlert className="w-2.5 h-2.5 md:w-3 md:h-3"/> 已回退</span>}
                             </div>
                             <span className="text-[11px] md:text-[12px] font-bold text-slate-400 font-mono italic">{log.time.substring(5,16).replace('T', ' ')}</span>
                          </div>
                          <p className="text-[13px] md:text-xs font-black text-slate-900 mb-0.5 md:mb-1">{log.operator}</p>
                          <p className="text-[13px] md:text-xs text-slate-600 font-medium leading-relaxed">{log.detail}</p>
                          {(log.source || log.qty) && (
                             <div className="mt-2 md:mt-3 pt-2 md:pt-3 border-t flex flex-wrap gap-3 md:gap-4">
                                {log.source && <div><span className="block text-[10px] md:text-[11px] text-slate-400 uppercase">来源机台</span><span className="text-[12px] md:text-[13px] font-bold text-slate-700">{log.source}</span></div>}
                                {log.qty && <div><span className="block text-[10px] md:text-[11px] text-slate-400 uppercase">完成数量</span><span className="text-[12px] md:text-[13px] font-black text-indigo-600">{log.qty} {log.unit}</span></div>}
                             </div>
                          )}
                          {log.reason && (
                             <div className="mt-2 md:mt-3 bg-rose-50 p-1.5 md:p-2 rounded-lg border border-rose-100">
                                <span className="text-[10px] md:text-[11px] font-black text-rose-600 uppercase block mb-0.5 md:mb-1">回退原因</span>
                                <p className="text-[12px] md:text-[13px] font-bold text-rose-800">{log.reason}</p>
                             </div>
                          )}
                       </div>
                    </div>
                 ))}
                 {!order.operation_logs?.length && <div className="p-20 text-center text-slate-300 text-sm font-bold uppercase tracking-widest">NO LOGS FOUND</div>}
              </div>
            )}
         </div>
         <AnimatePresence>
            {viewingFullImage && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-slate-900/90 flex items-center justify-center p-8 backdrop-blur-md" onClick={() => setViewingFullImage(null)}>
                 <button className="absolute top-8 right-8 text-white"><X className="w-8 h-8"/></button>
                 <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} src={viewingFullImage} className="max-w-full max-h-full rounded-2xl shadow-2xl border-4 border-white/10" />
              </motion.div>
            )}
         </AnimatePresence>
      </motion.div>
    </div>
  );
}

function DetailSection({ title, icon: Icon, color, children }: any) {
  const colors: any = { slate: "text-slate-900 bg-slate-100", blue: "text-blue-600 bg-blue-50", purple: "text-purple-600 bg-purple-50", indigo: "text-indigo-600 bg-indigo-50", rose: "text-rose-600 bg-rose-50", amber: "text-amber-600 bg-amber-50", red: "text-red-600 bg-red-50" };
  return (
    <section>
       <h4 className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-3">
          <div className={cn("w-5 h-5 md:w-7 md:h-7 rounded-sm md:rounded-lg flex items-center justify-center shrink-0", colors[color])}><Icon className="w-3 h-3 md:w-4 md:h-4" /></div>
          <span className="text-[11px] md:text-[13px] font-black uppercase tracking-widest text-slate-900">{title}</span>
       </h4>
       {children}
    </section>
  );
}

function DataItem({ label, value, font, bold, color, highlight }: any) {
   return (
      <div className="flex flex-col min-w-0">
         <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest mb-0.5 truncate">{label}</span>
         <span className={cn("text-[12px] md:text-xs leading-tight break-words", font === 'mono' ? "font-mono" : "font-bold", bold ? "font-black text-slate-900" : "text-slate-700", color === 'indigo' ? "text-indigo-600" : color === 'rose' ? "text-rose-600" : "", highlight ? "px-1 md:px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 inline-block w-fit" : "")}>{value}</span>
      </div>
   );
}

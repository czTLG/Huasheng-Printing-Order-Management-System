import React, { useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  HardDrive,
  Info,
  Layers,
  Package as PackageIcon,
  Plus,
  Printer,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Truck,
  X
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { mockService } from '../../lib/mockService';
import { Order, OrderStatus } from '../../types';
import { calculateStayDays, getCustomerName, getProductName, getQty, getRoller, getSpec, isAbnormal } from './data-resolvers';
import { DataItem, MissingTag, StatusBadge } from './order-display';

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
  title: string;
  icon: any;
  color: string;
  status: OrderStatus;
  orderStatus: OrderStatus;
  isCompleted?: boolean;
  children: React.ReactNode;
  collapsedContent: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isActive = orderStatus === status;
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 border-blue-200',
    purple: 'text-purple-600 bg-purple-50 border-purple-200',
    indigo: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-200'
  };

  return (
    <div className={cn('border rounded-xl md:rounded-2xl overflow-hidden transition-all duration-300', isActive ? 'ring-1 md:ring-2 ring-blue-500/20 border-blue-200' : 'border-slate-100', isCompleted ? 'bg-emerald-50/5 text-slate-500' : 'bg-white')}>
      <button onClick={() => setIsOpen(!isOpen)} className={cn('w-full flex items-center justify-between p-3 md:p-4 text-left transition-colors', isActive ? 'bg-blue-50/50' : isOpen ? 'bg-slate-50' : 'hover:bg-slate-50')}>
        <div className="flex items-center gap-2.5 md:gap-3">
          <div className={cn('w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl flex items-center justify-center shrink-0 border shadow-sm', isCompleted ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : colors[color] || colors.blue)}>
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
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-3.5 md:p-5 border-t border-slate-100 space-y-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PrintingModule({ order }: { order: Order }) {
  const summary = order.work_order_summary;
  const productName = getProductName(order);
  const printMold = order.wo_print_mold || summary?.printMold;
  const printFilmSize = order.wo_print_film_size || summary?.printFilmSize;
  const roller = getRoller(order);
  const printQty = order.wo_print_qty || summary?.quantity || summary?.printQty;
  const isCompleted = ['复膜', '制袋', '发货', '完成'].includes(order.status);
  const collapsed = (
    <>
      <span className="text-[12px] font-bold text-slate-500">印刷膜: {printMold ? <span className="text-slate-800">{printMold}</span> : <span className="text-amber-600">缺印刷膜</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">尺寸/厚度: {printFilmSize ? <span className="text-slate-800">{printFilmSize}</span> : <span className="text-amber-600">缺印膜尺寸</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">印膜数量: {printQty ? <span className="text-slate-800">{printQty} 米</span> : <span className="text-amber-600">缺印膜数量</span>}</span>
      <span className="text-[12px] font-bold text-slate-500">压辊: {roller ? <span className="text-slate-800">{roller}</span> : <span className="text-amber-600">缺压辊</span>}</span>
      {(order.wo_ink_requirement || summary?.inkRequirement) && <span className="text-[12px] font-bold text-slate-500">油墨: <span className="text-slate-800">{order.wo_ink_requirement || summary?.inkRequirement}</span></span>}
    </>
  );
  return (
    <ProcessModule title="印刷工序" icon={Printer} color="blue" status="印刷" orderStatus={order.status} isCompleted={isCompleted} collapsedContent={collapsed}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-3 md:gap-y-4">
        {productName ? <DataItem label="品名" value={productName} bold /> : <MissingTag text="缺品名" />}
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
  const productName = getProductName(order);
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
          {productName ? <DataItem label="品名" value={productName} bold /> : <MissingTag text="缺品名" />}
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

function DetailSection({ title, icon: Icon, color, children }: any) {
  const colors: any = { slate: 'text-slate-900 bg-slate-100', blue: 'text-blue-600 bg-blue-50', purple: 'text-purple-600 bg-purple-50', indigo: 'text-indigo-600 bg-indigo-50', rose: 'text-rose-600 bg-rose-50', amber: 'text-amber-600 bg-amber-50', red: 'text-red-600 bg-red-50' };
  return (
    <section>
      <h4 className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-3">
        <div className={cn('w-5 h-5 md:w-7 md:h-7 rounded-sm md:rounded-lg flex items-center justify-center shrink-0', colors[color])}><Icon className="w-3 h-3 md:w-4 md:h-4" /></div>
        <span className="text-[11px] md:text-[13px] font-black uppercase tracking-widest text-slate-900">{title}</span>
      </h4>
      {children}
    </section>
  );
}

type EditTarget = { order: Order; type: 'info' | 'alignment' } | null;

export function OrderDetailDrawer({
  order,
  onClose,
  canEdit,
  setEditOrder,
  setRollbackOrder,
  currentUser,
  completedView
}: {
  order: Order;
  onClose: () => void;
  canEdit: boolean;
  setEditOrder: (value: EditTarget) => void;
  setRollbackOrder: (value: Order | null) => void;
  currentUser: any;
  completedView?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'info' | 'logs'>('info');
  const [isLegacyOpen, setIsLegacyOpen] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [viewingFullImage, setViewingFullImage] = useState<string | null>(null);
  const [, setRefreshTick] = useState(0);

  const abnormal = isAbnormal(order);
  const productName = getProductName(order);
  const customerName = getCustomerName(order);
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
              <StatusBadge status={order.status} completedView={completedView} />
              <span className="text-[11px] md:text-[12px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-1.5 md:px-2 py-0.5 rounded border border-slate-100">ORD-{order.id}</span>
              {order.urgency === 1 && <span className="bg-red-500 text-white text-[10px] md:text-[11px] font-black px-1 md:px-1.5 py-0.5 rounded uppercase tracking-tighter">URGENT</span>}
            </div>
            <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight leading-tight line-clamp-2">{productName}</h2>
            <div className="flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-1 mt-1 md:mt-1.5">
              {customerName && customerName !== productName && <span className="text-[13px] md:text-xs font-bold text-slate-500 flex items-center gap-1"><Eye className="w-2.5 h-2.5 md:w-3 md:h-3" /> 客户: {customerName}</span>}
              <span className="text-[13px] md:text-xs font-bold text-slate-400 flex items-center gap-1"><Clock className="w-2.5 h-2.5 md:w-3 md:h-3" /> {order.updated_at.substring(0, 16).replace('T', ' ')}</span>
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
            <button onClick={() => setActiveTab('info')} className={cn('px-3 md:px-4 py-1.5 rounded-full text-[13px] md:text-xs font-black transition-all uppercase tracking-tighter', activeTab === 'info' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>生产档案</button>
            <button onClick={() => setActiveTab('logs')} className={cn('px-3 md:px-4 py-1.5 rounded-full text-[13px] md:text-xs font-black transition-all uppercase tracking-tighter', activeTab === 'logs' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>流转日志</button>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            {canEdit && (
              <div className="flex bg-white rounded-lg md:rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-x divide-slate-100 ml-auto md:ml-0">
                <button onClick={() => setEditOrder({ order, type: 'info' })} className="px-2.5 md:px-4 h-8 md:h-9 text-[12px] md:text-[13px] font-black text-indigo-600 hover:bg-slate-50 flex items-center gap-1 md:gap-1.5 uppercase tracking-tighter shadow-sm"><Settings className="w-3 h-3 md:w-3.5 md:h-3.5" /> 修正</button>
                <button onClick={() => setEditOrder({ order, type: 'alignment' })} className="px-2.5 md:px-4 h-8 md:h-9 text-[12px] md:text-[13px] font-black text-emerald-600 hover:bg-slate-50 flex items-center gap-1 md:gap-1.5 uppercase tracking-tighter shadow-sm"><Info className="w-3 h-3 md:w-3.5 md:h-3.5" /> 对齐</button>
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
                        <button onClick={() => setViewingFullImage(order.order_image_url || null)} className="w-8 h-8 rounded-lg bg-white/90 shadow-sm flex items-center justify-center"><Search className="w-4 h-4" /></button>
                        {order.image_can_delete && <button onClick={handleDeleteImage} className="w-8 h-8 rounded-lg bg-rose-500 shadow-sm flex items-center justify-center text-white"><Trash2 className="w-4 h-4" /></button>}
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
                    <span className="text-xs font-black text-slate-700 flex items-center gap-2"><HardDrive className="w-3.5 h-3.5" /> 历史导入字段详细</span>
                    <Plus className={cn('w-4 h-4 transition-transform', isLegacyOpen && 'rotate-45')} />
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
                  <span className={cn('absolute left-0 top-1 w-[22px] h-[22px] rounded-full border-4 border-white shadow-md flex items-center justify-center -translate-x-[2px] z-10', log.type === 'COMPLETE' ? 'bg-emerald-500' : log.type === 'ROLLBACK' ? 'bg-rose-500' : 'bg-slate-400')} />
                  <div className={cn('bg-white border rounded-xl md:rounded-2xl p-3 md:p-4 shadow-sm transition-all', log.is_rolled_back && 'opacity-60 grayscale bg-slate-50')}>
                    <div className="flex justify-between items-center mb-1.5 md:mb-2">
                      <div className="flex items-center gap-1.5 md:gap-2">
                        <span className={cn('text-[10px] md:text-[11px] font-black px-1.5 md:px-2 py-0.5 rounded uppercase tracking-tighter', log.type === 'COMPLETE' ? 'bg-emerald-100 text-emerald-700' : log.type === 'ROLLBACK' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}>{log.type}</span>
                        {log.is_rolled_back && <span className="text-[11px] md:text-[12px] font-black text-red-500 uppercase flex items-center gap-1 shrink-0"><ShieldAlert className="w-2.5 h-2.5 md:w-3 md:h-3" /> 已回退</span>}
                      </div>
                      <span className="text-[11px] md:text-[12px] font-bold text-slate-400 font-mono italic">{log.time.substring(5, 16).replace('T', ' ')}</span>
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
              <button className="absolute top-8 right-8 text-white"><X className="w-8 h-8" /></button>
              <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} src={viewingFullImage} className="max-w-full max-h-full rounded-2xl shadow-2xl border-4 border-white/10" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

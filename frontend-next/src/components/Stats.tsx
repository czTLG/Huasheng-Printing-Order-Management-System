import React, { useState, useEffect } from 'react';
import {
  BarChart3, PieChart as PieChartIcon, TrendingUp, AlertTriangle,
  Users, Package, CheckCircle2, Clock, DollarSign,
  Download, RefreshCcw, Calendar, Filter, Activity, FileWarning
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';

const COLORS: Record<string, string> = {
  '印刷': '#3b82f6', '复膜': '#8b5cf6', '制袋': '#f59e0b',
  '发货': '#f97316', '完成': '#10b981', '未指定': '#94a3b8'
};

const TABS = [
  { id: 'overview', label: '总览看板' },
  { id: 'order', label: '订单分析' },
  { id: 'customer', label: '客户分析' },
  { id: 'production', label: '生产分析' },
  { id: 'cost', label: '成本与利润' },
  { id: 'abnormal', label: '异常与逾期' },
  { id: 'salesman', label: '业务员分析' },
];

export default function Stats() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<any>({});
  const [statusBreakdown, setStatusBreakdown] = useState<any[]>([]);
  const [stuckOrders, setStuckOrders] = useState<any[]>([]);
  const [orderTrend, setOrderTrend] = useState<any[]>([]);
  const [stageFlow, setStageFlow] = useState<any[]>([]);
  const [customerRank, setCustomerRank] = useState<any[]>([]);
  const [bagTypeDist, setBagTypeDist] = useState<any[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [dashboard, trend, flow, custRank, bagDist] = await Promise.all([
        mockService.getStatsDashboard().catch(() => null),
        mockService.getStatsTrend(30).catch(() => null),
        mockService.getStatsStageFlow(14).catch(() => null),
        mockService.getStatsCustomerRank(5).catch(() => null),
        mockService.getStatsBagtypeDist().catch(() => null),
      ]);

      if (dashboard) {
        setKpi(dashboard.kpi || {});
        setStatusBreakdown(dashboard.statusBreakdown || []);
        setStuckOrders(dashboard.stuckOrders || []);
      }
      if (trend) setOrderTrend(trend);
      if (flow) setStageFlow(flow);
      if (custRank) setCustomerRank(custRank);
      if (bagDist) setBagTypeDist(bagDist);
    } catch (err) {
      console.warn('Stats load error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Custom Tooltip for charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl">
          <p className="text-slate-300 text-xs font-bold mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
             <p key={index} className="text-xs font-black flex items-center gap-2" style={{ color: entry.color }}>
               {entry.name}: {entry.value}
             </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const KpiCard = ({ icon: Icon, title, value, unit, colorClass }: any) => (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3 group hover:border-indigo-200 transition-colors cursor-pointer">
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{title}</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-black text-slate-900">{value}</span>
            {unit && <span className="text-xs font-bold text-slate-400">{unit}</span>}
          </div>
        </div>
        <div className={cn("p-2 rounded-xl", colorClass)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-[100px]">
      {/* 顶部筛选条 */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-4 md:px-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 max-w-[1600px] mx-auto">
           <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
                 <BarChart3 className="w-6 h-6 text-indigo-600" /> 统计分析
              </h1>
              <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

              <div className="flex flex-wrap items-center gap-3">
                 <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 px-3 h-9 text-xs font-bold text-slate-600">
                    <Calendar className="w-4 h-4 mr-2 text-slate-400" /> 实时数据
                 </div>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <button onClick={fetchAll} className="px-4 h-9 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 flex items-center gap-2 hover:bg-slate-50 transition-colors">
                <RefreshCcw className="w-4 h-4" /> 刷新
              </button>
              <button onClick={() => window.print()} className="px-4 h-9 bg-indigo-600 text-white rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95">
                <Download className="w-4 h-4" /> 导出报表
              </button>
           </div>
        </div>

        {/* 二级页签 */}
        <div className="flex items-center gap-6 mt-6 max-w-[1600px] mx-auto overflow-x-auto no-scrollbar mask-gradient-right">
           {TABS.map(tab => (
              <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={cn(
                    "text-sm font-black pb-3 border-b-2 whitespace-nowrap transition-colors",
                    activeTab === tab.id
                      ? "text-indigo-600 border-indigo-600"
                      : "text-slate-400 border-transparent hover:text-slate-600 hover:border-slate-300"
                 )}
              >
                 {tab.label}
              </button>
           ))}
        </div>
      </div>

      <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">

         {/* KPI 区 */}
         <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard title="订单总数" value={kpi.total ?? '-'} unit="笔" icon={Package} colorClass="bg-blue-100 text-blue-600" />
            <KpiCard title="订单总量" value={kpi.totalQty ? (kpi.totalQty / 10000).toFixed(1) : '-'} unit="万个" icon={PieChartIcon} colorClass="bg-indigo-100 text-indigo-600" />
            <KpiCard title="进行中" value={kpi.inProgress ?? '-'} unit="笔" icon={Clock} colorClass="bg-orange-100 text-orange-600" />
            <KpiCard title="本月完成" value={kpi.doneMonth ?? '-'} unit="笔" icon={CheckCircle2} colorClass="bg-emerald-100 text-emerald-600" />
            <KpiCard title="加急订单" value={kpi.urgent ?? '-'} unit="笔" icon={Activity} colorClass="bg-rose-100 text-rose-600" />
            <KpiCard title="活跃客户" value={kpi.customerCount ?? '-'} unit="家" icon={Users} colorClass="bg-purple-100 text-purple-600" />
         </div>

         {loading ? (
           <div className="flex items-center justify-center py-20">
             <div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
             <span className="ml-3 text-sm font-bold text-slate-500">加载统计数据...</span>
           </div>
         ) : (
         <>
         {activeTab === 'overview' && (
            <div className="space-y-6">
               {/* 总览趋势图区 */}
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <TrendingUp className="w-5 h-5 text-indigo-500" /> 订单数与完成量趋势图 (30天)
                  </h3>
                  <div className="h-[300px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={orderTrend.length > 0 ? orderTrend : []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                           <defs>
                             <linearGradient id="colorO" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
                               <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                             </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                           <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} dy={10} minTickGap={20} />
                           <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                           <Tooltip content={<CustomTooltip />} />
                           <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, paddingTop: 20 }} />
                           <Area type="monotone" dataKey="orderCount" name="新增订单数" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorO)" />
                           <Bar dataKey="completedCount" name="已完成数" fill="#10b981" radius={[4, 4, 0, 0]} barSize={12} />
                           <Line type="monotone" dataKey="urgentCount" name="加急数" stroke="#ef4444" strokeWidth={2} dot={{r: 2}} />
                        </ComposedChart>
                     </ResponsiveContainer>
                  </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 状态分布 */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                     <h3 className="text-sm font-black text-slate-800 mb-6">订单状态分布</h3>
                     <div className="flex-1 min-h-[250px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                           <PieChart>
                              <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                                 {statusBreakdown.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={entry.color || COLORS[entry.name] || '#94a3b8'} />)}
                              </Pie>
                              <Tooltip content={<CustomTooltip />} />
                              <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: 11, fontWeight: 700}}/>
                           </PieChart>
                        </ResponsiveContainer>
                     </div>
                  </div>

                  {/* 异常警示 */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                     <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                        <FileWarning className="w-5 h-5 text-rose-500" /> 滞留超3天订单 ({stuckOrders.length})
                     </h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-left">
                           <thead>
                              <tr className="border-b border-slate-200">
                                 <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-400">客户/规格</th>
                                 <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-400">目前阶段</th>
                                 <th className="py-3 px-2 text-[10px] font-black uppercase text-slate-400">滞留天数</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                              {stuckOrders.slice(0, 8).map((order: any, i: number) => (
                                 <tr key={i} className="hover:bg-slate-50 transition-colors">
                                    <td className="py-3 px-2">
                                       <div className="text-xs font-bold text-slate-800">{order.customer_name}</div>
                                       <div className="text-[10px] text-slate-500 mt-0.5">{order.spec || '--'}</div>
                                    </td>
                                    <td className="py-3 px-2">
                                       <span className="px-2 py-1 bg-rose-50 text-rose-600 rounded-md text-[10px] font-bold">{order.status}</span>
                                    </td>
                                    <td className="py-3 px-2">
                                       <span className="text-sm font-black text-rose-600">{order.stay_days} <span className="text-[10px] text-slate-400">天</span></span>
                                    </td>
                                 </tr>
                              ))}
                              {stuckOrders.length === 0 && (
                                <tr><td colSpan={3} className="py-10 text-center text-slate-400 text-sm font-bold">暂无滞留订单</td></tr>
                              )}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            </div>
         )}

         {activeTab === 'production' && (
            <div className="space-y-6">
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <Activity className="w-5 h-5 text-indigo-500" /> 工序完成趋势图 (近14天)
                  </h3>
                  <div className="h-[350px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stageFlow.length > 0 ? stageFlow : []} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                           <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} dy={10} />
                           <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                           <Tooltip content={<CustomTooltip />} />
                           <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, paddingTop: 20 }} />
                           <Bar dataKey="印刷In" name="印刷完成次数" fill="#93c5fd" />
                           <Bar dataKey="复膜In" name="复膜完成次数" fill="#c4b5fd" />
                           <Bar dataKey="制袋In" name="制袋完成次数" fill="#fcd34d" />
                           <Bar dataKey="发货In" name="发货完成次数" fill="#fdba74" />
                        </BarChart>
                     </ResponsiveContainer>
                  </div>
               </div>
            </div>
         )}

         {activeTab === 'cost' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <DollarSign className="w-5 h-5 text-emerald-500" /> 客户下单量排行 Top 5
                  </h3>
                  <div className="h-[280px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={customerRank} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                           <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                           <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                           <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 'bold', fill: '#334155'}} />
                           <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} content={<CustomTooltip />} />
                           <Bar dataKey="orderCount" name="订单数(笔)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                     </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <Package className="w-5 h-5 text-indigo-500" /> 袋型占比分布
                  </h3>
                  <div className="h-[280px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                           <Pie data={bagTypeDist} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={2} dataKey="count">
                              {bagTypeDist.map((_: any, i: number) => (
                                <Cell key={i} fill={['#3b82f6','#6366f1','#0ea5e9','#f59e0b','#8b5cf6','#10b981','#f97316','#ef4444','#ec4899','#14b8a6','#84cc16','#eab308','#a855f7','#06b6d4','#78716c'][i % 15]} />
                              ))}
                           </Pie>
                           <Tooltip content={<CustomTooltip />} />
                           <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: 11, fontWeight: 700}}/>
                        </PieChart>
                     </ResponsiveContainer>
                  </div>
                </div>
            </div>
         )}

         {activeTab === 'order' && (
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <Package className="w-5 h-5 text-indigo-500" /> 袋型占比分布
                  </h3>
                  <div className="h-[300px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bagTypeDist} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                           <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} dy={10} />
                           <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                           <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} content={<CustomTooltip />} />
                           <Bar dataKey="count" name="订单数" fill="#818cf8" radius={[4, 4, 0, 0]} barSize={32} />
                        </BarChart>
                     </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                     <Users className="w-5 h-5 text-orange-500" /> 客户下单量排行 Top 5
                  </h3>
                  <div className="h-[300px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={customerRank} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                           <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                           <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                           <YAxis dataKey="name" type="category" width={90} axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 'bold', fill: '#334155'}} />
                           <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} content={<CustomTooltip />} />
                           <Bar dataKey="orderCount" name="订单数(笔)" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                     </ResponsiveContainer>
                  </div>
                </div>
             </div>
         )}

        {activeTab === 'customer' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-500" /> 客户下单排行
                </h3>
                <div className="h-[400px] w-full">
                  {customerRank.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={customerRank} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}} />
                        <YAxis dataKey="name" type="category" width={120} axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 'bold', fill: '#334155'}} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="orderCount" name="订单数(笔)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm font-bold">暂无客户数据</div>
                  )}
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4">袋型偏好分布</h3>
                <div className="h-[300px] w-full">
                  {bagTypeDist.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={bagTypeDist} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="count" label={({name, percent}: any) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                          {bagTypeDist.map((_: any, i: number) => (
                            <Cell key={i} fill={['#3b82f6','#6366f1','#0ea5e9','#f59e0b','#8b5cf6','#10b981','#f97316','#ef4444','#ec4899','#14b8a6','#84cc16','#eab308','#a855f7','#06b6d4','#78716c'][i % 15]} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm font-bold">暂无数据</div>
                  )}
                </div>
              </div>
            </div>
        )}

        {activeTab === 'abnormal' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                  <FileWarning className="w-5 h-5 text-rose-500" /> 滞留超 3 天订单
                </h3>
                {stuckOrders.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                          <th className="py-3 px-3">客户/规格</th>
                          <th className="py-3 px-3">当前工序</th>
                          <th className="py-3 px-3">滞留天数</th>
                          <th className="py-3 px-3">最后更新</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stuckOrders.map((order: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-3 px-3">
                              <div className="text-[13px] font-bold text-slate-800">{order.customer_name}</div>
                              <div className="text-[11px] text-slate-500">{order.spec || '--'}</div>
                            </td>
                            <td className="py-3 px-3">
                              <span className="px-2 py-1 bg-rose-50 text-rose-600 rounded-md text-[10px] font-bold">{order.status}</span>
                            </td>
                            <td className="py-3 px-3 text-sm font-black text-rose-600">{order.stay_days} <span className="text-[10px] text-slate-400">天</span></td>
                            <td className="py-3 px-3 text-[12px] text-slate-400 font-mono">
                              {order.updated_at ? String(order.updated_at).slice(0, 10) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-400 text-sm font-bold">暂无滞留订单</div>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6">
                <div className="flex items-start gap-4">
                  <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-black text-amber-800">逾期预警说明</h4>
                    <p className="text-xs font-medium text-amber-700 mt-2 leading-relaxed">
                      系统将各工序停留超过 3 天的订单标记为"滞留"。若您需要调整预警阈值或查看更详细的滞留分析报告，请联系系统管理员。
                    </p>
                  </div>
                </div>
              </div>
            </div>
        )}

        {activeTab === 'salesman' && (
            <div className="flex flex-col items-center justify-center p-16 text-slate-400 bg-white rounded-3xl border border-slate-100 min-h-[350px]">
               <BarChart3 className="w-16 h-16 text-slate-200 mb-4" />
               <h2 className="text-xl font-bold text-slate-700 mb-2">业务员分析</h2>
               <p className="text-sm font-medium text-center max-w-md">
                 按业务员维度的订单量、销售额统计需要后端额外支持。
                 当前后端暂无此数据接口，待后续迭代接入。
               </p>
            </div>
        )}
         </>
         )}
      </div>
    </div>
  );
}

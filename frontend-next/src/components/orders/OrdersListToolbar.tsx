import React from 'react';
import { Filter, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { OrderStatus } from '../../types';
import { COMPLETED_LABELS } from './data-resolvers';

type SummaryStats = { total: number; urgentCount: number; avgStayDays: number; stageCounts: Record<string, number> };

type Props = {
  activeStatus: OrderStatus;
  setActiveStatus: (value: OrderStatus) => void;
  cardMode: 'full' | 'standard' | 'compact';
  setCardMode: React.Dispatch<React.SetStateAction<'full' | 'standard' | 'compact'>>;
  filteredCount: number;
  expandedCount: number;
  hasOrders: boolean;
  expandAll: () => void;
  collapseAll: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  showFilters: boolean;
  setShowFilters: (value: boolean) => void;
  summaryStats: SummaryStats;
  todayStageCompletions: Record<string, number>;
  rollerFilter: string;
  setRollerFilter: (value: string) => void;
  isUrgentOnly: boolean;
  setIsUrgentOnly: (value: boolean) => void;
  stayMinDays: number;
  setStayMinDays: (value: number) => void;
  orderDayMode: 'all' | 'today' | '3days';
  setOrderDayMode: (value: 'all' | 'today' | '3days') => void;
  orderDataMode: 'all' | 'abnormal';
  setOrderDataMode: (value: 'all' | 'abnormal') => void;
  sortBy: 'default' | 'start_time';
  setSortBy: (value: 'default' | 'start_time') => void;
  sortOrder: 'desc' | 'asc';
  setSortOrder: React.Dispatch<React.SetStateAction<'desc' | 'asc'>>;
};

const tabs: OrderStatus[] = ['印刷', '复膜', '制袋', '发货', '完成', '全部', '今日更新'];

export function OrdersListToolbar(props: Props) {
  const {
    activeStatus,
    setActiveStatus,
    cardMode,
    setCardMode,
    filteredCount,
    expandedCount,
    hasOrders,
    expandAll,
    collapseAll,
    searchQuery,
    setSearchQuery,
    showFilters,
    setShowFilters,
    summaryStats,
    todayStageCompletions,
    rollerFilter,
    setRollerFilter,
    isUrgentOnly,
    setIsUrgentOnly,
    stayMinDays,
    setStayMinDays,
    orderDayMode,
    setOrderDayMode,
    orderDataMode,
    setOrderDataMode,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder
  } = props;

  const showStats = activeStatus !== '全部' && activeStatus !== '完成';
  const processCompletedCount = todayStageCompletions[activeStatus] || 0;

  return (
    <>
      <div className="flex items-center justify-between px-1 md:px-2 gap-2 mt-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2 truncate">订单中心</h1>
          <p className="text-slate-500 mt-0.5 font-medium text-[11px] md:text-xs truncate">管理所有生产流转订单</p>
        </div>
        <div className="flex gap-1 md:gap-2 shrink-0">
          <button
            onClick={() => {
              if (expandedCount === 0 && hasOrders) expandAll();
              else collapseAll();
            }}
            className="px-2 md:px-4 h-8 md:h-10 border border-slate-200 bg-white rounded-lg md:rounded-xl text-[13px] md:text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all flex items-center gap-1"
          >
            {expandedCount === 0 && hasOrders ? '全部展开' : '全部收起'}
          </button>
          <button
            onClick={() => setCardMode(prev => prev === 'compact' ? 'standard' : prev === 'standard' ? 'full' : 'compact')}
            className="px-2 md:px-4 h-8 md:h-10 border border-slate-200 bg-white rounded-lg md:rounded-xl text-[13px] md:text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all flex items-center gap-1"
          >
            {cardMode === 'compact' ? '紧凑模式' : cardMode === 'standard' ? '标准模式' : '完整显示'}
          </button>
        </div>
      </div>

      {!cardMode.includes('compact') && (
        <div className="flex flex-col xl:flex-row xl:items-center justify-between px-1 md:px-2 gap-2">
          <div className="w-full xl:w-auto overflow-x-auto no-scrollbar pb-1.5 max-w-[100vw]">
            <div className="flex flex-nowrap w-max gap-1 p-1 pl-1 bg-white md:bg-transparent md:border-0 rounded-lg md:rounded-none border border-slate-200">
              {tabs.map((tab) => (
                <button
                  key={`tab-${tab}`}
                  onClick={() => setActiveStatus(tab)}
                  className={cn(
                    'px-3 md:px-4 py-1.5 md:py-2 rounded-md md:rounded-lg text-[13px] md:text-sm font-bold transition-all whitespace-nowrap shrink-0 block',
                    activeStatus === tab
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 md:hover:bg-slate-50 bg-transparent md:bg-white md:border md:border-slate-200 md:shadow-sm'
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
                  if (e.target.value.trim() !== '') setActiveStatus('全部');
                }}
                className="w-full bg-white border border-slate-200 rounded-lg md:rounded-xl h-8 md:h-10 pl-8 md:pl-9 pr-3 text-[13px] md:text-sm font-medium focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all outline-none md:shadow-sm"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'h-8 md:h-10 px-3 md:px-4 border rounded-lg md:rounded-xl text-[13px] md:text-sm font-bold transition-all flex items-center gap-1.5 md:gap-2 shrink-0 md:shadow-sm',
                showFilters ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              )}
            >
              <Filter className="w-3 h-3 md:w-3.5 md:h-3.5" />
              <span className="hidden md:inline">{showFilters ? '收起' : '详细筛选'}</span>
              <span className="md:hidden">{showFilters ? '收起' : '筛选'}</span>
            </button>
          </div>
        </div>
      )}

      {showStats && activeStatus === '今日更新' ? (
        <div className="mx-1 md:mx-2 mt-1 mb-2 px-3 py-2 bg-emerald-50 border border-emerald-100/50 rounded-lg flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] md:text-sm shadow-sm transition-all">
          <span className="text-slate-500 font-bold tracking-tight">今日更新分布:</span>
          {(['印刷', '复膜', '制袋', '发货', '完成'] as const).map(stage => {
            const stageColors: Record<string, string> = {
              印刷: 'text-blue-700', 复膜: 'text-purple-700', 制袋: 'text-indigo-700', 发货: 'text-orange-700', 完成: 'text-emerald-700'
            };
            return (
              <React.Fragment key={stage}>
                <div className="w-px h-3.5 bg-emerald-200/50 hidden sm:block"></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-bold tracking-tight">{COMPLETED_LABELS[stage] || stage}:</span>
                  <span className={`font-extrabold ${stageColors[stage]}`}>{summaryStats.stageCounts[stage] ?? '-'}<span className="text-slate-400 font-bold ml-0.5">单</span></span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      ) : showStats ? (
        <div className="mx-1 md:mx-2 mt-1 mb-2 px-3 py-2 bg-indigo-50 border border-indigo-100/50 rounded-lg flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] md:text-sm shadow-sm transition-all">
          <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">筛选结果:</span><span className="font-extrabold text-indigo-900">{summaryStats.total} 单未完成</span></div>
          <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
          <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">其中加急:</span><span className="font-black text-rose-600 drop-shadow-sm">{summaryStats.urgentCount} 单</span></div>
          <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
          <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">平均滞留:</span><span className="font-extrabold text-amber-600">{summaryStats.total > 0 ? summaryStats.avgStayDays.toFixed(1) : '0.0'} 天</span></div>
          <div className="w-px h-3.5 bg-indigo-200/50 hidden sm:block"></div>
          <div className="flex items-center gap-1.5"><span className="text-slate-500 font-bold tracking-tight">当天完成:</span><span className="font-extrabold text-emerald-600">{processCompletedCount} 单</span></div>
        </div>
      ) : null}

      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mx-1 md:mx-2 mt-2 bg-white border border-slate-200 rounded-xl md:rounded-2xl p-2.5 md:p-4 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-4">
                <label className="flex items-center gap-2 text-[13px] md:text-xs font-bold text-slate-700 cursor-pointer col-span-1 border md:border-none p-2 md:p-0 rounded-lg">
                  <input type="checkbox" checked={isUrgentOnly} onChange={e => setIsUrgentOnly(e.target.checked)} className="rounded border-slate-300 w-3 h-3 md:w-3.5 md:h-3.5 text-indigo-600 focus:ring-indigo-600" />
                  仅看加急
                </label>
                <label className="flex items-center gap-2 text-[13px] md:text-xs font-bold text-slate-700 cursor-pointer col-span-1 border md:border-none p-2 md:p-0 rounded-lg">
                  <input type="checkbox" checked={orderDataMode === 'abnormal'} onChange={e => setOrderDataMode(e.target.checked ? 'abnormal' : 'all')} className="rounded border-slate-300 w-3 h-3 md:w-3.5 md:h-3.5 text-red-500 focus:ring-red-500" />
                  仅异常数据
                </label>
                <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                  <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">压辊要求</span>
                  <select value={rollerFilter} onChange={(e) => setRollerFilter(e.target.value)} className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none">
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
                  <select value={orderDayMode} onChange={(e) => setOrderDayMode(e.target.value as 'all' | 'today' | '3days')} className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none">
                    <option value="all">全部开单时间</option>
                    <option value="today">仅今天新单</option>
                    <option value="3days">近3天新单</option>
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                  <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">排序依据</span>
                  <div className="flex bg-slate-50 border border-slate-200 rounded-lg overflow-hidden h-8 md:h-9">
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'default' | 'start_time')} className="flex-1 bg-transparent px-2 text-[13px] md:text-xs font-medium outline-none border-r border-slate-200">
                      <option value="default">默认排序</option>
                      <option value="start_time">按开单时间</option>
                    </select>
                    <button onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')} className="px-2 text-slate-500 hover:text-slate-900 font-bold text-[11px] md:text-[12px]">
                      {sortOrder === 'desc' ? '降序' : '升序'}
                    </button>
                  </div>
                </div>
                <div className="col-span-2 md:col-span-1 flex flex-col justify-end">
                  <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1 md:hidden">停留时间</span>
                  <select value={stayMinDays} onChange={(e) => setStayMinDays(Number(e.target.value))} className="w-full h-8 md:h-9 bg-slate-50 border border-slate-200 rounded-lg px-2 text-[13px] md:text-xs font-medium outline-none">
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
    </>
  );
}

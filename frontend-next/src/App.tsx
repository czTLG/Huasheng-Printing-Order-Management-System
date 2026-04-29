import React, { useState, useEffect } from 'react';
import { 
  Package, 
  ClipboardList, 
  BarChart3, 
  MessageSquare,
  Search,
  Bell,
  Menu,
  ChevronRight,
  LogOut,
  HelpCircle,
  Activity,
  Shield,
  ShieldAlert,
  X,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Orders from './components/Orders';
import WorkOrders from './components/WorkOrders';
import Board from './components/Board';
import Cost from './components/Cost';
import Admin from './components/Admin';
import Stats from './components/Stats';
import { mockService } from './lib/mockService';
import { User } from './types';

import Login from './components/Login';

type Tab = 'orders' | 'workorders' | 'board' | 'cost' | 'stats' | 'admin';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [notifications, setNotifications] = useState<{ id: string, type: 'error' | 'success' | 'warning' | 'info', message: string, code?: number }[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const cached = mockService.getUser();
    if (cached?.username && getVisibleModules(cached).length > 0) {
      setUser(cached);
      if (cached.role.startsWith('worker')) setActiveTab('board');
      else if (cached.role === 'ai_sales') setActiveTab('workorders');
    }
    mockService.loadCurrentUser()
      .then(fresh => {
        if (!fresh?.username) return;
        setUser(fresh);
        if (fresh.role.startsWith('worker')) setActiveTab('board');
        else if (fresh.role === 'ai_sales') setActiveTab('workorders');
      })
      .catch(() => {});
  }, []);

  const addNotification = (message: string, type: 'error' | 'success' | 'warning' | 'info' = 'info', code?: number) => {
    const id = Math.random().toString(36).substring(7);
    setNotifications(prev => [...prev, { id, message, type, code }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  useEffect(() => {
    const handleNotification = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        addNotification(detail.message, detail.type, detail.code);
        
        // Handle specific logic like 401 redirect
        if (detail.code === 401) {
          setTimeout(() => {
            setUser(null);
            addNotification('您的会话已由系统强制注销。', 'warning');
          }, 2000);
        }
      }
    };

    window.addEventListener('app-notification', handleNotification);
    return () => window.removeEventListener('app-notification', handleNotification);
  }, []);

  // ⌘+K / Ctrl+K shortcut to focus global search; ESC to close help
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search-input') as HTMLInputElement;
        if (input) { input.focus(); input.select(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHelp]);

  // Remove the automatic mockService.getUser() effect, 
  // users should manually login for this demonstration.
  
  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    
    // Redirect based on role if needed
    if (loggedInUser.role.startsWith('worker')) {
       setActiveTab('board');
    } else if (loggedInUser.role === 'ai_sales') {
       setActiveTab('workorders');
    } else {
       setActiveTab('orders');
    }
  };

  const handleLogout = () => {
    mockService.logout();
    setUser(null);
  };

  const navItems = [
    { id: 'orders', label: '订单中心', icon: Package, requiredModule: 'orders' },
    { id: 'workorders', label: '开单管理', icon: ClipboardList, requiredModule: 'workorder' },
    { id: 'board', label: '生产看板', icon: Activity, requiredModule: 'board' },
    { id: 'cost', label: '成本核算', icon: BarChart3, requiredModule: 'cost' },
    { id: 'stats', label: '统计分析', icon: BarChart3, requiredModule: 'stats' },
    { id: 'admin', label: '系统管理', icon: Shield, requiredModule: 'admin' },
  ];

  function getVisibleModules(currentUser: User | null) {
    if (!currentUser) return [] as string[];
    if (currentUser.role === 'super_admin' || currentUser.permissions?.all) {
      return ['orders', 'workorder', 'board', 'cost', 'stats', 'admin'];
    }
    const modules = currentUser.permissions?.modules || {};
    const allowed = Object.keys(modules).filter(k => modules[k]);
    if (mockService.canUseCost()) allowed.push('cost');
    if (currentUser.role === 'super_admin' || ['chenyongjie', 'gavin'].includes(currentUser.username)) {
      allowed.push('admin');
    }
    return [...new Set(allowed)];
  }

  const visibleModules = getVisibleModules(user);
  const visibleNavItems = navItems.filter(item => visibleModules.includes(item.requiredModule));

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'orders': return <Orders />;
      case 'workorders': return <WorkOrders />;
      case 'board': return <Board />;
      case 'cost': return <Cost />;
      case 'stats': return <Stats />;
      case 'admin': return <Admin />;
      default: return <Orders />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isSidebarCollapsed ? 80 : 240
        }}
        className={cn(
          "fixed md:relative left-0 top-0 h-full bg-white border-r border-slate-200 z-50 flex flex-col shrink-0 transition-transform duration-300 md:translate-x-0",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-50 shrink-0">
          {!isSidebarCollapsed && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 pl-2 font-display font-black text-lg tracking-tight text-indigo-600"
            >
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center transition-transform">
                <Package className="text-white w-5 h-5" />
              </div>
              <span className="truncate">华胜订单管理系统</span>
            </motion.div>
          )}
          {isSidebarCollapsed && (
            <div className="mx-auto w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
               <Package className="text-white w-6 h-6" />
            </div>
          )}
          
          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="hidden md:flex p-2 text-slate-300 hover:text-indigo-600 transition-colors hover:bg-indigo-50 rounded-lg"
            title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <ChevronRight className={cn("w-5 h-5 transition-transform duration-300", !isSidebarCollapsed && "rotate-180")} />
          </button>

          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-slate-600">
             <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as Tab);
                  setIsMobileMenuOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all group overflow-hidden",
                  isActive ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 font-medium",
                  isSidebarCollapsed && "justify-center px-0 h-12"
                )}
                title={item.label}
              >
                <div className={cn("p-1.5 rounded-lg transition-colors", isActive ? "bg-indigo-200/50" : "bg-slate-100 group-hover:bg-slate-200")}>
                  <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-indigo-600" : "text-slate-500")} />
                </div>
                {!isSidebarCollapsed && <span className="truncate text-sm">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 shrink-0">
          <div className={cn("flex items-center gap-3", isSidebarCollapsed ? "justify-center" : "px-2 py-2")}>
            <div className="w-9 h-9 rounded-full bg-slate-200 border-2 border-white shadow-sm overflow-hidden shrink-0">
               <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'admin'}&backgroundColor=e2e8f0`} alt="avatar" />
            </div>
            {!isSidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate text-slate-900">{user?.full_name || '系统管理员'}</p>
                <p className="text-[10px] text-slate-400 truncate uppercase font-black tracking-widest">{user?.role || 'Admin'}</p>
              </div>
            )}
            {!isSidebarCollapsed && (
              <button onClick={handleLogout} title="退出登录" className="shrink-0 flex items-center justify-center p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative z-0">
        {/* Header */}
        <header className="h-12 md:h-14 bg-white/90 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-3 md:px-6 shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-2 md:gap-4 flex-1">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="relative group max-w-sm w-full hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input
                type="text"
                id="global-search-input"
                placeholder="搜索订单、客户、批次号..."
                className="w-full bg-slate-50 border-none rounded-lg h-8 md:h-9 pl-8 pr-3 text-xs font-medium focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400 text-slate-700 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setActiveTab('orders');
                      window.dispatchEvent(new CustomEvent('global-search', { detail: { query: val } }));
                    }
                  }
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-3 shrink-0">
             <div className="relative">
                <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all" title="查看通知">
                   <Bell className="w-4 h-4 md:w-4.5 md:h-4.5" />
                   {notifications.length > 0 && (
                     <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-indigo-500 rounded-full border border-white"></span>
                   )}
                </button>
                {showNotifications && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                    <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-widest">系统通知</span>
                        <span className="text-[10px] font-bold text-slate-400">{notifications.length} 条</span>
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="px-4 py-8 text-center text-slate-400 text-xs font-medium">暂无通知</div>
                        ) : (
                          notifications.map(n => (
                            <div key={n.id} className={cn(
                              "px-4 py-3 border-b border-slate-50 last:border-0 flex items-start gap-3",
                              n.type === 'error' ? "bg-red-50/50" : n.type === 'success' ? "bg-emerald-50/50" : n.type === 'warning' ? "bg-amber-50/50" : ""
                            )}>
                              <div className={cn(
                                "w-6 h-6 rounded-lg shrink-0 flex items-center justify-center mt-0.5",
                                n.type === 'error' ? "bg-red-100 text-red-500" :
                                n.type === 'success' ? "bg-emerald-100 text-emerald-500" :
                                n.type === 'warning' ? "bg-amber-100 text-amber-500" :
                                "bg-indigo-100 text-indigo-500"
                              )}>
                                {n.type === 'error' ? <ShieldAlert className="w-3 h-3" /> :
                                 n.type === 'success' ? <CheckCircle2 className="w-3 h-3" /> :
                                 <Bell className="w-3 h-3" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-700 leading-relaxed">{n.message}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5 font-medium uppercase tracking-wider">{n.code ? `Error ${n.code}` : n.type}</p>
                              </div>
                              <button onClick={() => setNotifications(prev => prev.filter(nn => nn.id !== n.id))} className="text-slate-300 hover:text-slate-500 shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      {notifications.length > 0 && (
                        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
                          <button onClick={() => setNotifications([])} className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest">
                            清空全部
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
             </div>
             <button onClick={() => setShowHelp(true)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all hidden sm:block" title="系统帮助">
                <HelpCircle className="w-4 h-4" />
             </button>
             <div className="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block" />
             <div className="flex items-center">
                <span className="text-[9px] md:text-[10px] font-bold px-1.5 py-0.5 md:px-2 md:py-1 rounded bg-green-50 text-green-700 border border-green-200 flex items-center gap-1 whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5" />
                  <span className="hidden sm:inline">系统运行正常</span>
                  <span className="sm:hidden">正常</span>
                </span>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 py-4 md:px-4 md:py-6 lg:p-8 custom-scrollbar bg-slate-50/50">
           <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full max-w-[1600px] mx-auto"
              >
                {renderContent()}
              </motion.div>
           </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="h-10 md:h-12 border-t border-slate-100 flex items-center justify-between px-4 md:px-8 text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white shrink-0">
          <p className="truncate">© 2026 华胜订单管理系统 V2.4</p>
          <div className="hidden sm:flex items-center gap-6">
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div> SERVER STATUS: ONLINE</span>
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> DATABASE CONNECTED</span>
            <span>UPTIME: 99.98%</span>
          </div>
        </footer>

        {/* Help Dialog */}
        {showHelp && (
          <>
            <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={() => setShowHelp(false)} />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] max-w-[90vw] bg-white rounded-2xl border border-slate-200 shadow-2xl z-[9999] overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-600" /> 帮助与快捷键
                </h2>
                <button onClick={() => setShowHelp(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">键盘快捷键</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">全局搜索</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono text-slate-500">⌘K / Ctrl+K</kbd>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">系统版本</h3>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>华胜订单管理系统 v2.4</p>
                    <p>前端构建: Vite + React + TypeScript</p>
                    <p>数据接口: Express + SQLite</p>
                  </div>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">功能模块</h3>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p><span className="font-bold">订单中心</span> — 订单搜索 / 分页 / 状态流转</p>
                    <p><span className="font-bold">开单管理</span> — 工单创建 / 排产 / PDF导出</p>
                    <p><span className="font-bold">生产看板</span> — 实时工序流转 TV模式</p>
                    <p><span className="font-bold">成本核算</span> — 材料成本快速估价</p>
                    <p><span className="font-bold">统计分析</span> — 趋势 / 客户排名 / 袋型分布</p>
                    <p><span className="font-bold">系统管理</span> — 用户 / 角色 / 日志 / 打包</p>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 italic border-t border-slate-100 pt-3">
                  点击弹窗外或按 ESC 关闭
                </div>
              </div>
            </div>
          </>
        )}

        {/* Global Notifications Toast Overlay */}
        <div className="fixed bottom-12 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
           <AnimatePresence>
              {notifications.map((n) => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: 50, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  className={cn(
                    "pointer-events-auto p-4 rounded-2xl shadow-2xl border flex items-start gap-3 min-w-[320px] max-w-md",
                    n.type === 'error' ? "bg-red-900 border-red-500/50 text-white" :
                    n.type === 'success' ? "bg-emerald-900 border-emerald-500/50 text-white" :
                    n.type === 'warning' ? "bg-amber-900 border-amber-500/50 text-white" :
                    "bg-slate-900 border-slate-700 text-white"
                  )}
                >
                   <div className={cn(
                     "w-10 h-10 rounded-xl shrink-0 flex items-center justify-center",
                     n.type === 'error' ? "bg-red-500/20 text-red-400" :
                     n.type === 'success' ? "bg-emerald-500/20 text-emerald-400" :
                     n.type === 'warning' ? "bg-amber-500/20 text-amber-400" :
                     "bg-indigo-500/20 text-indigo-400"
                   )}>
                      {n.type === 'error' ? <ShieldAlert className="w-6 h-6" /> : 
                       n.type === 'success' ? <CheckCircle2 className="w-6 h-6" /> :
                       <Bell className="w-6 h-6" />}
                   </div>
                   <div className="flex-1 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
                           {n.code ? `HTTP System Error ${n.code}` : n.type === 'error' ? 'System Failure' : 'System Notification'}
                        </span>
                        <button 
                          onClick={() => setNotifications(prev => prev.filter(nn => nn.id !== n.id))}
                          className="text-white/40 hover:text-white transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-sm font-bold mt-1 text-white/95 leading-relaxed">{n.message}</p>
                   </div>
                </motion.div>
              ))}
           </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default App;

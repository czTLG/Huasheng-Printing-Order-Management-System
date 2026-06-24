import React, { useState, useEffect } from 'react';
import {
  Users, Shield, Key, Menu as MenuIcon, Settings, Book,
  Clock, Package, FileText, CheckCircle2, XCircle, ChevronRight,
  Search, Download, RefreshCcw, UserPlus, AlertCircle, Trash2, Edit, X
} from 'lucide-react';
import { cn } from '../lib/utils';
import { mockService } from '../lib/mockService';
import { MODULE_KEYS, defaultPermissionsByRole, normalizePermissions } from '../lib/permissions';

const TABS = [
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'roles', label: '角色管理', icon: Shield },
  { id: 'permissions', label: '权限管理', icon: Key },
  { id: 'menus', label: '菜单管理', icon: MenuIcon },
  { id: 'config', label: '系统配置', icon: Settings },
  { id: 'dictionary', label: '数据字典', icon: Book },
  { id: 'logs', label: '操作日志', icon: Clock },
  { id: 'package', label: '系统打包', icon: Package },
  { id: 'exportInfo', label: '导入导出说明', icon: FileText },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员', manager: '生产经理',
  ai_sales: '业务员', worker: '通用工人',
  worker_print: '印刷工人', worker_film: '复膜工人',
  worker_bag: '制袋工人', worker_ship: '发货工人',
};

export default function Admin() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [pkgConfig, setPkgConfig] = useState<any>(null);
  const [pkgBuilding, setPkgBuilding] = useState(false);
  const [pkgMsg, setPkgMsg] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [showUserModal, setShowUserModal] = useState<'new' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', fullName: '', role: 'ai_sales' });
  const [modulePerms, setModulePerms] = useState<Record<string, boolean>>({});

  const ALL_MODULES: { key: string; label: string }[] = [
    { key: 'orders', label: '订单中心' },
    { key: 'workorder', label: '开单管理' },
    { key: 'board', label: '生产看板' },
    { key: 'cost', label: '成本核算' },
    { key: 'stats', label: '统计分析' },
    { key: 'admin', label: '系统管理' },
  ];

  const getDefaultRoleModules = (role: string) => {
    const normalized = normalizePermissions(role, defaultPermissionsByRole(role));
    const modules = normalized.modules || {};
    const out: Record<string, boolean> = {};
    MODULE_KEYS.forEach((key) => {
      out[key] = !!modules[key];
    });
    return out;
  };

  const filteredUsers = users.filter(u => {
    if (userRoleFilter && u.role !== userRoleFilter) return false;
    if (userSearchQuery) {
      const q = userSearchQuery.toLowerCase();
      if (!u.username?.toLowerCase().includes(q) && !(u.full_name || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  useEffect(() => {
    if (activeTab === 'users') {
      setLoading(true);
      mockService.getUsers()
        .then((data: any) => {
          setUsers(Array.isArray(data) ? data : []);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (activeTab === 'logs') {
      setLogsLoading(true);
      mockService.getAuditLogs()
        .then((data: any) => {
          setAuditLogs(Array.isArray(data) ? data : []);
        })
        .catch(() => {})
        .finally(() => setLogsLoading(false));
    } else if (activeTab === 'config' || activeTab === 'package') {
      mockService.getPackageConfig().then(setPkgConfig).catch(() => {});
    }
  }, [activeTab]);

  const renderUsers = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <input type="text" value={userSearchQuery} onChange={e => setUserSearchQuery(e.target.value)} placeholder="搜账号/姓名" className="h-9 px-3 border border-slate-200 rounded-xl text-[13px] bg-white outline-none w-64" />
          <select value={userRoleFilter} onChange={e => setUserRoleFilter(e.target.value)} className="h-9 px-3 border border-slate-200 rounded-xl text-[13px] bg-white outline-none">
            <option value="">全部角色</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => document.querySelector<HTMLInputElement>('input[placeholder="搜账号/姓名"]')?.focus()} className="h-9 px-4 bg-slate-900 text-white rounded-xl text-[13px] font-bold">搜索</button>
        </div>
        <button onClick={() => { setEditingUser(null); setUserForm({ username: '', password: '', fullName: '', role: 'ai_sales' }); setModulePerms({ ...getDefaultRoleModules('ai_sales') }); setShowUserModal('new'); }} className="h-9 px-4 bg-indigo-600 text-white rounded-xl text-[13px] font-bold flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> 新增用户
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                <th className="py-3 px-4">登录账号 / 姓名</th>
                <th className="py-3 px-4">角色</th>
                <th className="py-3 px-4">状态</th>
                <th className="py-3 px-4">创建时间</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-sm font-bold">加载中...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-sm font-bold">暂无用户数据</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400 text-sm font-bold">
                  <Search className="w-4 h-4 inline-block mr-2" />无匹配用户
                </td></tr>
              ) : filteredUsers.map((u: any) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="text-[13px] font-bold text-slate-900">{u.username}</div>
                    <div className="text-[11px] font-medium text-slate-400 mt-0.5">{u.full_name || '-'}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 border border-slate-200 bg-white rounded-md text-[10px] font-bold text-indigo-600">{ROLE_LABELS[u.role] || u.role}</span>
                  </td>
                  <td className="py-3 px-4">
                    {u.status === 'active' ? (
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded flex items-center gap-1 w-fit text-[11px] font-bold"><CheckCircle2 className="w-3 h-3" />启用</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded flex items-center gap-1 w-fit text-[11px] font-bold"><XCircle className="w-3 h-3" />停用</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[12px] text-slate-500">{u.created_at ? u.created_at.substring(0, 10) : '-'}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                       <button
                         title="模拟此用户"
                         onClick={() => {
                           window.dispatchEvent(new CustomEvent('app-impersonate', {
                             detail: {
                               user: {
                                 id: u.id,
                                 username: u.username,
                                 full_name: u.full_name || u.username,
                                 role: u.role,
                                 status: 'active',
                                 permissions: {
                                   all: !!u.permissions?.all,
                                   modules: { ...(u.permissions?.modules || {}) }
                                 }
                               }
                             }
                           }));
                         }}
                         className="p-1.5 text-amber-600 hover:bg-amber-50 rounded"
                       >
                         <Users className="w-4 h-4" />
                       </button>
                       <button onClick={() => {
                         const modules = u.permissions?.modules || {};
                         const hasModules = Object.keys(modules).length > 0;
                         setEditingUser(u);
                         setUserForm({ username: u.username, password: '', fullName: u.full_name || '', role: u.role || 'ai_sales' });
                         setModulePerms(hasModules ? { ...modules } : { ...getDefaultRoleModules(u.role || 'ai_sales') });
                         setShowUserModal('edit');
                       }} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"><Edit className="w-4 h-4" /></button>
                       <button onClick={async () => {
                         if (!confirm(`确认删除用户 ${u.username}？`)) return;
                         try {
                           await mockService.deleteUser(u.id);
                           window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: `用户 ${u.username} 已删除` } }));
                           const data = await mockService.getUsers();
                           setUsers(Array.isArray(data) ? data : []);
                         } catch (err: any) {
                           window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '删除失败' } }));
                         }
                       }} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Modal (New / Edit) */}
      {showUserModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={() => setShowUserModal(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] bg-white rounded-2xl border border-slate-200 shadow-2xl z-[9999] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-800">{showUserModal === 'new' ? '新增用户' : '编辑用户'}</h2>
              <button onClick={() => setShowUserModal(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black text-slate-500 uppercase">登录账号</label>
                <input value={userForm.username} onChange={e => setUserForm(f => ({...f, username: e.target.value}))} disabled={showUserModal === 'edit'} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none focus:border-indigo-500" />
              </div>
              {showUserModal === 'new' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-black text-slate-500 uppercase">密码</label>
                  <input type="password" value={userForm.password} onChange={e => setUserForm(f => ({...f, password: e.target.value}))} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none focus:border-indigo-500" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black text-slate-500 uppercase">姓名</label>
                <input value={userForm.fullName} onChange={e => setUserForm(f => ({...f, fullName: e.target.value}))} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none focus:border-indigo-500" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black text-slate-500 uppercase">角色</label>
                <select value={userForm.role} onChange={e => {
                  const newRole = e.target.value;
                  setUserForm(f => ({...f, role: newRole}));
                  // when role changes, re-apply role default modules (unless user already had custom modules)
                  const modules = editingUser?.permissions?.modules || {};
                  const hasModules = Object.keys(modules).length > 0;
                  if (!hasModules || showUserModal === 'new') {
                    setModulePerms({ ...getDefaultRoleModules(newRole) });
                  }
                }} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none focus:border-indigo-500">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-black text-slate-500 uppercase">模块权限</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_MODULES.map(m => (
                    <label key={m.key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={!!modulePerms[m.key]}
                        onChange={e => setModulePerms(p => ({...p, [m.key]: e.target.checked}))}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="text-[13px] font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowUserModal(null)} className="h-10 px-4 border border-slate-200 rounded-xl text-sm font-bold text-slate-600">取消</button>
              <button disabled={modalLoading} onClick={async () => {
                setModalLoading(true);
                try {
                  if (showUserModal === 'new') {
                    if (!userForm.username || !userForm.password || !userForm.fullName) {
                      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'warning', message: '请填写完整信息' } }));
                      setModalLoading(false); return;
                    }
                    await mockService.registerUser(userForm.username, userForm.password, userForm.fullName);
                    window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '用户已创建，等待审批' } }));
                  } else if (editingUser) {
                    await mockService.updateUserPermissions(editingUser.id, { role: userForm.role, permissions: { modules: modulePerms } });
                    window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '用户角色和权限已更新' } }));
                  }
                  setShowUserModal(null);
                  const data = await mockService.getUsers();
                  setUsers(Array.isArray(data) ? data : []);
                } catch (err: any) {
                  window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: err?.message || '操作失败' } }));
                }
                setModalLoading(false);
              }} className="h-10 px-4 bg-indigo-600 text-white rounded-xl text-sm font-black disabled:opacity-60">
                {modalLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderRoles = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h3 className="text-sm font-black text-slate-800">角色定义</h3>
          <p className="text-xs text-slate-500 mt-1">控制每个角色可见的菜单、操作权限及数据范围。</p>
        </div>
        <button onClick={() => window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'info', message: '角色由后端系统定义，请通过用户管理分配角色' } }))} className="h-9 px-4 bg-indigo-600 text-white rounded-xl text-[13px] font-bold">新增角色</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(ROLE_LABELS).map(([code, label]) => (
          <div key={code} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-200 transition-colors">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h4 className="text-[14px] font-bold text-slate-900">{label}</h4>
                  <p className="text-[10px] font-black uppercase text-slate-400">{code}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <div className="text-[12px] font-bold text-slate-500">关联用户: {users.filter(u => u.role === code).length} 人</div>
              <button onClick={() => {
                const count = users.filter(u => u.role === code).length;
                if (count === 0) {
                  window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'info', message: `暂无"${label}"角色的用户，请在用户管理中分配` } }));
                } else {
                  setUserRoleFilter(code);
                  setActiveTab('users');
                }
              }} className="text-[12px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center">配置权限 <ChevronRight className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-sm font-black text-slate-800 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-600"/> 系统操作日志</div>
          <span className="text-[11px] font-bold text-slate-400">最近 200 条</span>
        </div>
        {logsLoading ? (
          <div className="p-12 text-center text-slate-400 text-sm font-bold">加载中...</div>
        ) : auditLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm font-medium">
            暂无操作日志记录
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-4">时间</th>
                  <th className="py-3 px-4">用户</th>
                  <th className="py-3 px-4">操作</th>
                  <th className="py-3 px-4">详情</th>
                  <th className="py-3 px-4">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log: any, i: number) => (
                  <tr key={log.id || i} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 text-[12px] text-slate-500 whitespace-nowrap font-mono">
                      {String(log.created_at || '').slice(0, 19)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-[13px] font-bold text-slate-800">{log.username || log.user || '-'}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold">
                        {log.action || log.event_type || '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[12px] text-slate-600 max-w-[300px] truncate">
                      {log.detail || log.description || '-'}
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-400 font-mono">
                      {log.ip || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const [configForm, setConfigForm] = useState<{ companyName: string; announcement: string; profitRate: number; overdueDays: number }>(() => {
    try {
      const saved = localStorage.getItem('admin.config');
      return saved ? JSON.parse(saved) : { companyName: '星耀包装科技有限公司', announcement: '系统的统计数据基于真实订单生成。', profitRate: 8, overdueDays: 2 };
    } catch { return { companyName: '星耀包装科技有限公司', announcement: '系统的统计数据基于真实订单生成。', profitRate: 8, overdueDays: 2 }; }
  });

  const renderConfig = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <h3 className="text-sm font-black text-slate-800 border-b border-slate-100 pb-3">基础配置</h3>
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-black text-slate-500 uppercase">公司名称</label>
            <input value={configForm.companyName} onChange={e => setConfigForm(f => ({...f, companyName: e.target.value}))} className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none focus:border-indigo-500" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-black text-slate-500 uppercase">系统公告</label>
            <textarea value={configForm.announcement} onChange={e => setConfigForm(f => ({...f, announcement: e.target.value}))} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium w-full outline-none focus:border-indigo-500 h-24 resize-none" />
          </div>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <h3 className="text-sm font-black text-slate-800 border-b border-slate-100 pb-3">业务默认配置</h3>
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-black text-slate-500 uppercase">默认利润率 (%)</label>
            <input value={configForm.profitRate} onChange={e => setConfigForm(f => ({...f, profitRate: Number(e.target.value)}))} type="number" className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-black text-slate-500 uppercase">逾期预警天数</label>
            <input value={configForm.overdueDays} onChange={e => setConfigForm(f => ({...f, overdueDays: Number(e.target.value)}))} type="number" className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold w-full outline-none" />
          </div>
          <button onClick={() => {
            localStorage.setItem('admin.config', JSON.stringify(configForm));
            window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'success', message: '系统配置已保存（本地）' } }));
          }} className="h-10 px-6 bg-slate-900 text-white rounded-xl text-[13px] font-bold w-fit mt-2 hover:bg-slate-800 transition-colors">
            保存配置
          </button>
        </div>
      </div>
    </div>
  );

  const renderPlaceholder = (title: string, desc: string) => (
    <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-3xl border border-slate-100 min-h-[400px]">
      <Settings className="w-16 h-16 text-slate-200 mb-4" />
      <h2 className="text-xl font-bold text-slate-700 mb-2">{title}</h2>
      <p className="text-sm font-medium">{desc}</p>
    </div>
  );

  const renderPackage = () => {
    const ver = pkgConfig?.version || 'v1.2.0-rc4';
    const builtAt = pkgConfig?.builtAt || '2026-04-28 02:00:00';
    return (
    <div className="max-w-3xl space-y-6">
      {pkgMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {pkgMsg}
        </div>
      )}
      <div className="bg-indigo-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-500/20 rounded-full blur-[80px] pointer-events-none" />
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
              <Package className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">系统打包发布</h2>
              <p className="text-indigo-200/80 text-[13px] font-medium mt-1">生成前端静态资源包，用于部署更新。</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
               <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest mb-1">当前版本</p>
               <p className="font-mono font-bold">{ver}</p>
            </div>
            <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
               <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest mb-1">最近打包时间</p>
               <p className="font-mono font-bold">{builtAt}</p>
            </div>
          </div>
          <div className="flex gap-4 pt-2">
             <button
               onClick={async () => {
                 setPkgBuilding(true);
                 setPkgMsg('');
                 try {
                   const res = await mockService.buildPackage();
                   setPkgMsg(res?.message || '构建任务已提交');
                   const cfg = await mockService.getPackageConfig();
                   setPkgConfig(cfg);
                 } catch (err: any) {
                   setPkgMsg('构建失败：' + (err?.message || '未知错误'));
                 }
                 setPkgBuilding(false);
               }}
               disabled={pkgBuilding}
               className="px-6 py-3 bg-white text-indigo-900 rounded-xl text-sm font-black shadow-lg hover:bg-slate-50 flex items-center gap-2 disabled:opacity-60"
             >
               {pkgBuilding ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
               {pkgBuilding ? '构建中...' : '构建新包'}
             </button>
          </div>
        </div>
      </div>
    </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-[100px]">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-4 md:px-8 shadow-sm">
        <div className="flex items-center gap-4 max-w-[1600px] mx-auto">
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-600" /> 系统管理
          </h1>
          <div className="h-6 w-px bg-slate-200"></div>
          <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn("text-sm font-black pb-3 border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5",
                  activeTab === tab.id ? "text-indigo-600 border-indigo-600" : "text-slate-400 border-transparent hover:text-slate-600"
                )}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
        {activeTab === 'users' && renderUsers()}
        {activeTab === 'roles' && renderRoles()}
        {activeTab === 'logs' && renderLogs()}
        {activeTab === 'config' && renderConfig()}
        {activeTab === 'package' && renderPackage()}
        {activeTab === 'permissions' && renderPlaceholder('权限管理', '权限管理由后端角色系统控制，通过 allowRoles middleware 配置。当前权限基于用户名白名单 + role 判断，如需调整请联系后端修改 src/middleware/auth.js。')}
        {activeTab === 'menus' && renderPlaceholder('菜单管理', '菜单管理基于后端返回的 permissions.modules 动态控制可见性。前端 Tab 定义在 App.tsx navItems 中，visibleNavItems 根据用户权限过滤。如需调整菜单配置，请联系系统管理员。')}
        {activeTab === 'dictionary' && renderPlaceholder('数据字典', '数据字典（袋型、材质、损耗率等）定义在后端 src/services/quoteEngine.js 及各配置文件中。前端 Cost.tsx 中 MAT_DICT 从后端 /api/cost/material-prices 动态加载。')}
        {activeTab === 'exportInfo' && renderPlaceholder('导入导出说明', '系统支持以下导出格式：PDF 排产单（开单管理）、XLS 成本核算表（成本核算）、WPS.XLS 兼容格式。邮件发送通过后端 SMTP 配置实现，发送日志可在操作日志中查看。')}
      </div>
    </div>
  );
}

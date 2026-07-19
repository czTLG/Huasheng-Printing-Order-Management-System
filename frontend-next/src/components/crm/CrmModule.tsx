import React, { lazy, Suspense, useEffect, useState } from 'react';
import { ClipboardList, FileSearch, LayoutDashboard, Mail, MailCheck, MessageSquare, Package, ShieldAlert, Truck, UserRoundCheck, Users } from 'lucide-react';

const CrmDashboard = lazy(() => import('./CrmDashboard'));
const CrmCustomers = lazy(() => import('./CrmCustomers'));
const CrmInquiries = lazy(() => import('./CrmInquiries'));
const CrmCostingRequests = lazy(() => import('./CrmCostingRequests'));
const CrmFreightQuotes = lazy(() => import('./CrmFreightQuotes'));
const CrmAuditLogs = lazy(() => import('./CrmAuditLogs'));
const CrmCustomerPriority = lazy(() => import('./CrmCustomerPriority'));
const CrmEmailImport = lazy(() => import('./CrmEmailImport'));
const CrmMessages = lazy(() => import('./CrmMessages'));
const CrmMessageDetail = lazy(() => import('./CrmMessageDetail'));
const CrmCustomerDetail = lazy(() => import('./CrmCustomerDetail'));
const CrmInquiryDetail = lazy(() => import('./CrmInquiryDetail'));
const CrmWorkbench = lazy(() => import('./CrmWorkbench'));
const CrmFatherReviewList = lazy(() => import('./CrmFatherReviewList'));
const CrmReplyDraftCenter = lazy(() => import('./CrmReplyDraftCenter'));

type CrmTab = 'dashboard' | 'workbench' | 'customers' | 'inquiries' | 'costing' | 'freight' | 'priority' | 'email' | 'messages' | 'father-review' | 'reply-drafts' | 'audit';

const tabs: Array<{ id: CrmTab; label: string; group: '常用' | '业务' | '管理'; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: '总览', group: '常用', icon: LayoutDashboard },
  { id: 'workbench', label: '工作台', group: '常用', icon: ClipboardList },
  { id: 'messages', label: '消息', group: '常用', icon: MessageSquare },
  { id: 'customers', label: '客户', group: '常用', icon: Users },
  { id: 'inquiries', label: '询盘', group: '业务', icon: ClipboardList },
  { id: 'costing', label: '核价', group: '业务', icon: FileSearch },
  { id: 'freight', label: '物流', group: '业务', icon: Truck },
  { id: 'priority', label: '优先级', group: '管理', icon: Package },
  { id: 'email', label: '邮件导入', group: '管理', icon: Mail },
  { id: 'father-review', label: '确认任务', group: '管理', icon: UserRoundCheck },
  { id: 'reply-drafts', label: '回复草稿', group: '管理', icon: MailCheck },
  { id: 'audit', label: '操作日志', group: '管理', icon: ShieldAlert },
];

type Props = {
  initialTab?: CrmTab;
};

function getPathForTab(tab: CrmTab) {
  return tab === 'dashboard' ? '/crm' : `/crm/${tab}`;
}

function getCrmViewFromPath(pathname: string) {
  const messageDetailMatch = pathname.match(/^\/crm\/messages\/(\d+)\/?$/);
  if (messageDetailMatch) {
    return { tab: 'messages' as CrmTab, messageId: Number(messageDetailMatch[1]), customerId: null, inquiryId: null };
  }
  if (pathname.startsWith('/crm/messages')) {
    return { tab: 'messages' as CrmTab, messageId: null, customerId: null, inquiryId: null };
  }
  const fatherTaskDetailMatch = pathname.match(/^\/crm\/father-review\/(\d+)\/?$/);
  if (fatherTaskDetailMatch) {
    return { tab: 'father-review' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: Number(fatherTaskDetailMatch[1]) };
  }
  if (pathname.startsWith('/crm/father-review')) {
    return { tab: 'father-review' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  if (pathname.startsWith('/crm/reply-drafts')) {
    return { tab: 'reply-drafts' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  if (pathname.startsWith('/crm/workbench')) {
    return { tab: 'workbench' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  const customerDetailMatch = pathname.match(/^\/crm\/customers\/(\d+)\/?$/);
  if (customerDetailMatch) {
    return { tab: 'customers' as CrmTab, messageId: null, customerId: Number(customerDetailMatch[1]), inquiryId: null, fatherTaskId: null };
  }
  if (pathname.startsWith('/crm/customers')) {
    return { tab: 'customers' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  const inquiryDetailMatch = pathname.match(/^\/crm\/inquiries\/(\d+)\/?$/);
  if (inquiryDetailMatch) {
    return { tab: 'inquiries' as CrmTab, messageId: null, customerId: null, inquiryId: Number(inquiryDetailMatch[1]), fatherTaskId: null };
  }
  if (pathname.startsWith('/crm/inquiries')) {
    return { tab: 'inquiries' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  const routeTab = pathname.match(/^\/crm\/([^/]+)\/?$/)?.[1] as CrmTab | undefined;
  if (routeTab && tabs.some(item => item.id === routeTab)) {
    return { tab: routeTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
  }
  return { tab: 'dashboard' as CrmTab, messageId: null, customerId: null, inquiryId: null, fatherTaskId: null };
}

export default function CrmModule({ initialTab = 'dashboard' }: Props) {
  const initialView = getCrmViewFromPath(window.location.pathname);
  const [tab, setTab] = useState<CrmTab>(initialView.tab || initialTab);
  const [messageId, setMessageId] = useState<number | null>(initialView.messageId);
  const [customerId, setCustomerId] = useState<number | null>(initialView.customerId);
  const [inquiryId, setInquiryId] = useState<number | null>(initialView.inquiryId);
  const [fatherTaskId, setFatherTaskId] = useState<number | null>(initialView.fatherTaskId || null);

  useEffect(() => {
    const syncRoute = () => {
      const view = getCrmViewFromPath(window.location.pathname);
      setTab(view.tab);
      setMessageId(view.messageId);
      setCustomerId(view.customerId);
      setInquiryId(view.inquiryId);
      setFatherTaskId(view.fatherTaskId || null);
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    const path = getPathForTab(tab);
    const currentPath = window.location.pathname;
    if (currentPath === path || currentPath.startsWith(`${path}/`)) {
      return;
    }
    if (currentPath !== path) {
      window.history.replaceState({}, '', path);
    }
  }, [tab]);

  const navigateCrm = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    const view = getCrmViewFromPath(path);
    setTab(view.tab);
    setMessageId(view.messageId);
    setCustomerId(view.customerId);
    setInquiryId(view.inquiryId);
    setFatherTaskId(view.fatherTaskId || null);
  };

  const content = (() => {
    if (tab === 'messages' && messageId) {
      return <CrmMessageDetail messageId={messageId} onBack={() => navigateCrm('/crm/messages')} />;
    }
    if (tab === 'customers' && customerId) {
      return (
        <CrmCustomerDetail
          customerId={customerId}
          onBack={() => navigateCrm('/crm/customers')}
          onOpenInquiry={(id) => navigateCrm(`/crm/inquiries/${id}`)}
        />
      );
    }
    if (tab === 'inquiries' && inquiryId) {
      return <CrmInquiryDetail inquiryId={inquiryId} onBack={() => navigateCrm('/crm/inquiries')} />;
    }
    switch (tab) {
      case 'dashboard': return <CrmDashboard />;
      case 'workbench': return <CrmWorkbench onOpenMessage={(id) => navigateCrm(`/crm/messages/${id}`)} onOpenCustomer={(id) => navigateCrm(`/crm/customers/${id}`)} onOpenInquiry={(id) => navigateCrm(`/crm/inquiries/${id}`)} onOpenFatherTask={(id) => navigateCrm(`/crm/father-review/${id}`)} />;
      case 'customers': return <CrmCustomers onOpenCustomer={(id) => navigateCrm(`/crm/customers/${id}`)} onOpenInquiry={(id) => navigateCrm(`/crm/inquiries/${id}`)} />;
      case 'inquiries': return <CrmInquiries onOpenInquiry={(id) => navigateCrm(`/crm/inquiries/${id}`)} />;
      case 'costing': return <CrmCostingRequests />;
      case 'freight': return <CrmFreightQuotes />;
      case 'priority': return <CrmCustomerPriority />;
      case 'email': return <CrmEmailImport />;
      case 'messages': return <CrmMessages onOpenMessage={(id) => navigateCrm(`/crm/messages/${id}`)} />;
      case 'father-review': return <CrmFatherReviewList taskId={fatherTaskId} onOpenMessage={(id) => navigateCrm(`/crm/messages/${id}`)} onOpenCustomer={(id) => navigateCrm(`/crm/customers/${id}`)} onOpenInquiry={(id) => navigateCrm(`/crm/inquiries/${id}`)} />;
      case 'reply-drafts': return <CrmReplyDraftCenter />;
      case 'audit': return <CrmAuditLogs />;
      default: return <CrmDashboard />;
    }
  })();

  const selectTab = (nextTab: CrmTab) => navigateCrm(getPathForTab(nextTab));

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-200 rounded-xl p-3 md:p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-black text-slate-900">CRM 工作中心</h1>
            <p className="hidden md:block text-xs text-slate-500 mt-1">从消息、客户到询盘处理，按日常工作顺序集中操作。</p>
          </div>
          <select aria-label="CRM 功能" value={tab} onChange={event => selectTab(event.target.value as CrmTab)} className="md:hidden h-10 min-w-32 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700">
            {tabs.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-x-5 gap-y-2">
          {(['常用', '业务', '管理'] as const).map(group => (
            <div key={group} className="flex items-center gap-1.5">
              <span className="mr-1 text-[11px] font-bold text-slate-400">{group}</span>
              {tabs.filter(item => item.group === group).map((item) => {
              const Icon = item.icon;
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  className={`h-9 px-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                    active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
              })}
            </div>
          ))}
        </div>
      </section>

      <Suspense fallback={<div className="min-h-48 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-sm font-bold text-slate-400">正在加载...</div>}>
        {content}
      </Suspense>
    </div>
  );
}

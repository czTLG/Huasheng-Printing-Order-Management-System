import React, { useEffect, useState } from 'react';
import { ClipboardList, FileSearch, LayoutDashboard, Mail, MailCheck, MessageSquare, Package, ShieldAlert, Truck, UserRoundCheck, Users } from 'lucide-react';
import CrmDashboard from './CrmDashboard';
import CrmCustomers from './CrmCustomers';
import CrmInquiries from './CrmInquiries';
import CrmCostingRequests from './CrmCostingRequests';
import CrmFreightQuotes from './CrmFreightQuotes';
import CrmAuditLogs from './CrmAuditLogs';
import CrmCustomerPriority from './CrmCustomerPriority';
import CrmEmailImport from './CrmEmailImport';
import CrmMessages from './CrmMessages';
import CrmMessageDetail from './CrmMessageDetail';
import CrmCustomerDetail from './CrmCustomerDetail';
import CrmInquiryDetail from './CrmInquiryDetail';
import CrmWorkbench from './CrmWorkbench';
import CrmFatherReviewList from './CrmFatherReviewList';
import CrmReplyDraftCenter from './CrmReplyDraftCenter';

type CrmTab = 'dashboard' | 'workbench' | 'customers' | 'inquiries' | 'costing' | 'freight' | 'priority' | 'email' | 'messages' | 'father-review' | 'reply-drafts' | 'audit';

const tabs: Array<{ id: CrmTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'CRM 总览', icon: LayoutDashboard },
  { id: 'workbench', label: '外贸作战台', icon: ClipboardList },
  { id: 'customers', label: '客户档案', icon: Users },
  { id: 'priority', label: '客户优先级', icon: Package },
  { id: 'inquiries', label: '询盘项目', icon: ClipboardList },
  { id: 'costing', label: '核价请求', icon: FileSearch },
  { id: 'freight', label: '物流费用', icon: Truck },
  { id: 'email', label: '邮件导入', icon: Mail },
  { id: 'messages', label: '消息中心', icon: MessageSquare },
  { id: 'father-review', label: '父亲确认', icon: UserRoundCheck },
  { id: 'reply-drafts', label: '回复草稿', icon: MailCheck },
  { id: 'audit', label: 'CRM 日志', icon: ShieldAlert },
];

type Props = {
  initialTab?: CrmTab;
};

function getPathForTab(tab: CrmTab) {
  if (tab === 'workbench') return '/crm/workbench';
  if (tab === 'messages') return '/crm/messages';
  if (tab === 'father-review') return '/crm/father-review';
  if (tab === 'reply-drafts') return '/crm/reply-drafts';
  if (tab === 'customers') return '/crm/customers';
  if (tab === 'inquiries') return '/crm/inquiries';
  return '/crm';
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
    if (tab === 'messages' || tab === 'workbench' || tab === 'father-review' || tab === 'reply-drafts' || (tab === 'customers' && currentPath.startsWith('/crm/customers')) || (tab === 'inquiries' && currentPath.startsWith('/crm/inquiries'))) {
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

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">外贸 CRM</h1>
            <p className="text-sm text-slate-500 mt-1">聚合客户档案、询盘、核价、物流和后续报价链路，重点是展示清楚、排序清楚、权限安全。</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-10 gap-2 w-full md:w-auto">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                onClick={() => {
                  if (item.id === 'messages') {
                    navigateCrm('/crm/messages');
                    return;
                  }
                  if (item.id === 'workbench') {
                    navigateCrm('/crm/workbench');
                    return;
                  }
                  if (item.id === 'father-review') {
                    navigateCrm('/crm/father-review');
                    return;
                  }
                  if (item.id === 'reply-drafts') {
                    navigateCrm('/crm/reply-drafts');
                    return;
                  }
                  if (item.id === 'customers') {
                    navigateCrm('/crm/customers');
                    return;
                  }
                  if (item.id === 'inquiries') {
                    navigateCrm('/crm/inquiries');
                    return;
                  }
                  setTab(item.id);
                  if (window.location.pathname.startsWith('/crm') && window.location.pathname !== '/crm') {
                    window.history.replaceState({}, '', '/crm');
                  }
                }}
                  className={`h-10 px-3 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap ${
                    active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {content}
    </div>
  );
}

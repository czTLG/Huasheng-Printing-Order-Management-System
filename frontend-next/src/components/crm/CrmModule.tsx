import React, { useMemo, useState } from 'react';
import { ClipboardList, FileSearch, Mail, Package, ShieldAlert, Truck, Users } from 'lucide-react';
import CrmCustomers from './CrmCustomers';
import CrmInquiries from './CrmInquiries';
import CrmCostingRequests from './CrmCostingRequests';
import CrmFreightQuotes from './CrmFreightQuotes';
import CrmAuditLogs from './CrmAuditLogs';
import CrmCustomerPriority from './CrmCustomerPriority';
import CrmEmailImport from './CrmEmailImport';

type CrmTab = 'customers' | 'inquiries' | 'costing' | 'freight' | 'priority' | 'email' | 'audit';

const tabs: Array<{ id: CrmTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'customers', label: '客户档案', icon: Users },
  { id: 'inquiries', label: '询盘项目', icon: ClipboardList },
  { id: 'costing', label: '核价请求', icon: FileSearch },
  { id: 'freight', label: '物流费用', icon: Truck },
  { id: 'priority', label: '客户优先级', icon: Package },
  { id: 'email', label: '邮件导入', icon: Mail },
  { id: 'audit', label: 'CRM 日志', icon: ShieldAlert },
];

export default function CrmModule() {
  const [tab, setTab] = useState<CrmTab>('customers');

  const content = useMemo(() => {
    switch (tab) {
      case 'customers': return <CrmCustomers />;
      case 'inquiries': return <CrmInquiries />;
      case 'costing': return <CrmCostingRequests />;
      case 'freight': return <CrmFreightQuotes />;
      case 'priority': return <CrmCustomerPriority />;
      case 'email': return <CrmEmailImport />;
      case 'audit': return <CrmAuditLogs />;
      default: return <CrmCustomers />;
    }
  }, [tab]);

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">外贸 CRM</h1>
            <p className="text-sm text-slate-500 mt-1">聚合客户档案、询盘、核价、物流和后续报价链路，重点是展示清楚、排序清楚、权限安全。</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 w-full md:w-auto">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
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

import React, { useEffect, useState } from 'react';
import { FileText, Plus, Save } from 'lucide-react';
import { mockService } from '../../lib/mockService';

type Props = {
  customerId: number;
};

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[84px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmCustomerResearchNotes({ customerId }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    source_type: 'manual',
    title: '',
    research_summary: '',
    customer_type: '',
    industry: '',
    main_products: '',
    website: '',
    risk_flags: '',
    suggested_priority: '',
    suggested_next_action: '',
    raw_input: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await mockService.listCustomerResearchNotes(customerId);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, [customerId]);

  const createNote = async () => {
    if (!form.title && !form.research_summary) return;
    setSaving(true);
    try {
      await mockService.createCustomerResearchNote(customerId, form);
      setForm({
        source_type: 'manual',
        title: '',
        research_summary: '',
        customer_type: '',
        industry: '',
        main_products: '',
        website: '',
        risk_flags: '',
        suggested_priority: '',
        suggested_next_action: '',
        raw_input: '',
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-600" /> 客户调研资料</h3>
          <p className="text-xs text-slate-500 mt-1">只做存储和展示。可记录手工调研、AI/Codex 解析、邮件解析后的结构化摘要。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <select className={inputClass} value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
          <option value="manual">manual</option>
          <option value="ai_parsed">ai_parsed</option>
          <option value="email_parsed">email_parsed</option>
          <option value="codex_parsed">codex_parsed</option>
          <option value="web_research_manual">web_research_manual</option>
        </select>
        <input className={inputClass} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="标题" />
        <input className={inputClass} value={form.customer_type} onChange={e => setForm(f => ({ ...f, customer_type: e.target.value }))} placeholder="客户类型" />
        <input className={inputClass} value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="行业" />
        <input className={inputClass} value={form.main_products} onChange={e => setForm(f => ({ ...f, main_products: e.target.value }))} placeholder="主营产品" />
        <input className={inputClass} value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="网站" />
        <input className={inputClass} value={form.suggested_priority} onChange={e => setForm(f => ({ ...f, suggested_priority: e.target.value }))} placeholder="建议优先级" />
        <input className={inputClass} value={form.suggested_next_action} onChange={e => setForm(f => ({ ...f, suggested_next_action: e.target.value }))} placeholder="建议下一步" />
      </div>
      <textarea className={`${areaClass} w-full`} value={form.research_summary} onChange={e => setForm(f => ({ ...f, research_summary: e.target.value }))} placeholder="调研摘要 / 业务背景 / 匹配判断" />
      <textarea className={`${areaClass} w-full`} value={form.risk_flags} onChange={e => setForm(f => ({ ...f, risk_flags: e.target.value }))} placeholder="风险提示" />
      <details className="rounded-lg border border-slate-100 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">原始输入</summary>
        <textarea className={`${areaClass} w-full mt-3`} value={form.raw_input} onChange={e => setForm(f => ({ ...f, raw_input: e.target.value }))} placeholder="原始邮件、聊天、网页调研文本" />
      </details>
      <button disabled={saving} onClick={createNote} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black flex items-center gap-2 disabled:opacity-60">
        <Plus className="w-4 h-4" /> 新增调研资料
      </button>

      <div className="space-y-3">
        {loading ? (
          <div className="text-sm text-slate-400">加载调研资料...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-400">暂无调研资料</div>
        ) : rows.map((row) => (
          <div key={row.id} className="border border-slate-100 rounded-lg p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900">{row.title || '未命名调研记录'}</div>
                <div className="text-xs text-slate-500 mt-1">{[row.source_type, row.updated_at].filter(Boolean).join(' · ')}</div>
              </div>
              {row.suggested_priority && (
                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-black">{row.suggested_priority}</span>
              )}
            </div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap">{row.research_summary || '-'}</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-slate-500">
              <div><span className="font-bold text-slate-700">客户类型：</span>{row.customer_type || '-'}</div>
              <div><span className="font-bold text-slate-700">行业：</span>{row.industry || '-'}</div>
              <div><span className="font-bold text-slate-700">主营：</span>{row.main_products || '-'}</div>
              <div><span className="font-bold text-slate-700">网站：</span>{row.website || '-'}</div>
            </div>
            {(row.risk_flags || row.suggested_next_action) && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                {row.risk_flags || '-'}{row.suggested_next_action ? ` | 下一步：${row.suggested_next_action}` : ''}
              </div>
            )}
            {row.raw_input ? (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-bold text-slate-700">查看原始输入</summary>
                <div className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3">{row.raw_input}</div>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

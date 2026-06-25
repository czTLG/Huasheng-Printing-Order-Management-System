import React, { useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCcw, Wand2 } from 'lucide-react';
import { mockService } from '../../lib/mockService';

const inputClass = 'h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';
const areaClass = 'min-h-[84px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-indigo-500';

export default function CrmEmailImport() {
  const [configStatus, setConfigStatus] = useState<any>(null);
  const [syncRuns, setSyncRuns] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [applyForm, setApplyForm] = useState<any>({ apply_fields: [], allow_create_customer: false, allow_update_customer: true, allow_create_inquiry: false, allow_create_specification: false, allow_create_communication_log: false, allow_create_quotation: false, apply_priority: false, review_note: '' });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [filters, setFilters] = useState({ keyword: '', direction: '', processing_status: '' });
  const [syncForm, setSyncForm] = useState({ folder: 'INBOX', days: 90, limit: 200 });

  const load = async () => {
    setLoading(true);
    try {
      const [config, runs, emailRows, suggestionRows] = await Promise.all([
        mockService.getCrmEmailConfigStatus().catch((err: any) => err?.message ? { ok: false } : null),
        mockService.listCrmEmailSyncRuns(),
        mockService.listCrmEmailMessages(filters),
        mockService.listCrmImportSuggestions({ source_type: 'email' }),
      ]);
      setConfigStatus((config && typeof config === 'object' ? config : null) || runs?.config_status || emailRows?.config_status || null);
      setSyncRuns(Array.isArray(runs?.rows) ? runs.rows : []);
      setMessages(Array.isArray(emailRows?.rows) ? emailRows.rows : []);
      setSuggestions(Array.isArray(suggestionRows?.rows) ? suggestionRows.rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const ret = await mockService.syncCrmEmail(syncForm);
      setConfigStatus(ret?.config_status || null);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const runSyncWithFolder = async (folder: string) => {
    setSyncing(true);
    try {
      const payload = { ...syncForm, folder };
      setSyncForm(payload);
      const ret = await mockService.syncCrmEmail(payload);
      setConfigStatus(ret?.config_status || null);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const groupedSuggestions = useMemo(() => {
    return suggestions.reduce((acc: Record<string, any[]>, row: any) => {
      const key = row.suggestion_type || 'other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [suggestions]);

  const parseMessage = async (id: number) => {
    setParsing(true);
    try {
      await mockService.parseCrmEmailMessage(id);
      const detail = await mockService.getCrmEmailMessage(id);
      setSelectedMessage(detail);
      await load();
    } finally {
      setParsing(false);
    }
  };

  const parseUnprocessed = async () => {
    setParsing(true);
    try {
      await mockService.parseUnprocessedCrmEmails(50);
      await load();
    } finally {
      setParsing(false);
    }
  };

  const openMessage = async (id: number) => {
    const detail = await mockService.getCrmEmailMessage(id);
    setSelectedMessage(detail);
  };

  const openSuggestion = async (id: number) => {
    const detail = await mockService.getCrmImportSuggestion(id);
    setSelectedSuggestion(detail?.suggestion || null);
    setPreview(null);
  };

  const updateSuggestionStatus = async (id: number, status: string) => {
    await mockService.updateCrmImportSuggestion(id, { status });
    const detail = await mockService.getCrmImportSuggestion(id);
    setSelectedSuggestion(detail?.suggestion || null);
    await load();
  };

  const buildDefaultApplyForm = (detail: any) => {
    const fields = Array.isArray(detail?.diff) ? detail.diff.map((item: any) => item.field) : [];
    const type = detail?.suggestion?.suggestion_type || '';
    return {
      apply_fields: fields.filter((field: string) => field !== 'priority'),
      allow_create_customer: !!detail?.apply_plan?.will_create_customer,
      allow_update_customer: !!detail?.apply_plan?.will_update_customer,
      allow_create_inquiry: type === 'inquiry' && !!detail?.apply_plan?.will_create_inquiry,
      allow_create_specification: type === 'specification',
      allow_create_communication_log: type === 'communication_log',
      allow_create_quotation: false,
      apply_priority: false,
      review_note: ''
    };
  };

  const previewSuggestion = async (id: number) => {
    const detail = await mockService.getCrmImportSuggestionPreview(id);
    setPreview(detail);
    setApplyForm(buildDefaultApplyForm(detail));
  };

  const toggleApplyField = (field: string) => {
    setApplyForm((prev: any) => ({
      ...prev,
      apply_fields: prev.apply_fields.includes(field)
        ? prev.apply_fields.filter((item: string) => item !== field)
        : [...prev.apply_fields, field]
    }));
  };

  const applySuggestion = async () => {
    if (!selectedSuggestion?.id) return;
    setApplying(true);
    try {
      await mockService.applyCrmImportSuggestion(selectedSuggestion.id, applyForm);
      const [detail, nextPreview] = await Promise.all([
        mockService.getCrmImportSuggestion(selectedSuggestion.id),
        mockService.getCrmImportSuggestionPreview(selectedSuggestion.id).catch(() => null)
      ]);
      setSelectedSuggestion(detail?.suggestion || null);
      setPreview(nextPreview);
      await load();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-600" /> 邮件导入 / 待确认</h2>
          <p className="text-xs font-medium text-slate-500 mt-1">IMAP 只读同步、邮件解析建议、待确认导入。不会自动覆盖正式客户资料，也不会发邮件。</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="text-sm font-black text-slate-900">IMAP 配置状态</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 text-sm">
          <div className="rounded-lg border border-slate-100 px-3 py-2">Host：{configStatus?.host || '-'}</div>
          <div className="rounded-lg border border-slate-100 px-3 py-2">Port：{configStatus?.port || '-'}</div>
          <div className="rounded-lg border border-slate-100 px-3 py-2">Secure：{String(configStatus?.secure ?? '-')}</div>
          <div className="rounded-lg border border-slate-100 px-3 py-2">User：{configStatus?.userMasked || '-'}</div>
          <div className="rounded-lg border border-slate-100 px-3 py-2">Password：{configStatus?.passwordConfigured ? 'configured' : 'missing'}</div>
          <div className="rounded-lg border border-slate-100 px-3 py-2">DNS 提示：{Array.isArray(configStatus?.suggestedHosts) ? configStatus.suggestedHosts[0] : '-'}</div>
        </div>
        {!configStatus?.imapConfigured && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-800">
            当前未完成 IMAP 配置：{Array.isArray(configStatus?.missing) ? configStatus.missing.join(', ') : 'unknown'}
          </div>
        )}
        {configStatus?.note && <div className="text-xs text-slate-500">{configStatus.note}</div>}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className={inputClass} value={syncForm.folder} onChange={e => setSyncForm(f => ({ ...f, folder: e.target.value }))} placeholder="folder" />
          <input className={inputClass} type="number" value={syncForm.days} onChange={e => setSyncForm(f => ({ ...f, days: Number(e.target.value || 0) }))} placeholder="days" />
          <input className={inputClass} type="number" value={syncForm.limit} onChange={e => setSyncForm(f => ({ ...f, limit: Number(e.target.value || 0) }))} placeholder="limit" />
          <button disabled={syncing} onClick={() => runSyncWithFolder('INBOX')} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">同步收件箱</button>
          <button disabled={syncing} onClick={() => runSyncWithFolder('Sent')} className="h-9 px-4 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 disabled:opacity-60">同步已发送</button>
        </div>
        <button disabled={syncing} onClick={runSync} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black disabled:opacity-60">自定义 folder 同步</button>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-black text-slate-900">最近同步记录</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">时间</th><th className="px-4 py-3">Folder</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">扫描</th><th className="px-4 py-3">导入</th><th className="px-4 py-3">跳过</th><th className="px-4 py-3">错误</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {syncRuns.slice(0, 10).map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-xs text-slate-500">{row.started_at || row.created_at}<div>{row.finished_at || '-'}</div></td>
                  <td className="px-4 py-3 text-sm text-slate-700">{row.folder || '-'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.status}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.scanned_count || 0}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.inserted_count || 0}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.skipped_count || 0}</td>
                  <td className="px-4 py-3 text-xs text-rose-600">{row.error_message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input className={inputClass} value={filters.keyword} onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))} placeholder="关键词" />
          <select className={inputClass} value={filters.direction} onChange={e => setFilters(f => ({ ...f, direction: e.target.value }))}>
            <option value="">全部方向</option>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
            <option value="internal">internal</option>
            <option value="unknown">unknown</option>
          </select>
          <select className={inputClass} value={filters.processing_status} onChange={e => setFilters(f => ({ ...f, processing_status: e.target.value }))}>
            <option value="">全部处理状态</option>
            <option value="new">new</option>
            <option value="parsed">parsed</option>
          </select>
          <button onClick={load} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black">筛选邮件</button>
          <button disabled={parsing} onClick={parseUnprocessed} className="h-9 px-4 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 flex items-center justify-center gap-2 disabled:opacity-60">
            <Wand2 className="w-4 h-4" /> 批量解析未处理
          </button>
          <button disabled={parsing} onClick={async () => { setParsing(true); try { const rows = await mockService.listCrmEmailMessages({ keyword: 'quote', processing_status: 'new' }); const first = Array.isArray(rows?.rows) ? rows.rows.slice(0, 20) : []; for (const row of first) { await mockService.parseCrmEmailMessage(row.id); } await load(); } finally { setParsing(false); } }} className="h-9 px-4 rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-bold text-indigo-700 disabled:opacity-60">只解析报价邮件</button>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-black text-slate-900">邮件列表</div>
          <div className="max-h-[520px] overflow-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-6 text-sm text-slate-400">加载中...</div>
            ) : messages.length === 0 ? (
              <div className="p-6 text-sm text-slate-400">暂无邮件</div>
            ) : messages.map((row) => (
              <button key={row.id} onClick={() => openMessage(Number(row.id))} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-slate-900 truncate">{row.subject || '(无主题)'}</div>
                  <div className="text-xs text-slate-400">{row.received_at || '-'}</div>
                </div>
                  <div className="text-xs text-slate-500 mt-1">{row.from_name || row.from_email || '-'} · {row.direction} · {row.processing_status}</div>
                  <div className="text-xs text-slate-500 mt-1">客户 {row.matched_customer_name || '-'} · 询盘 {row.matched_inquiry_title || '-'} · 报价 {Number(row.quote_detected || 0) ? '是' : '否'} · 询盘 {Number(row.inquiry_detected || 0) ? '是' : '否'}</div>
                  <div className="text-xs text-slate-400 mt-1 truncate">{row.cleaned_text || '-'}</div>
                </button>
              ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">邮件详情</div>
            {selectedMessage?.message?.id ? (
              <button disabled={parsing} onClick={() => parseMessage(Number(selectedMessage.message.id))} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-black disabled:opacity-60">生成解析建议</button>
            ) : null}
          </div>
          {!selectedMessage?.message ? (
            <div className="text-sm text-slate-400">选择一封邮件查看详情</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-100 px-3 py-2">Subject：{selectedMessage.message.subject || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">From：{selectedMessage.message.from_name || selectedMessage.message.from_email || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">Matched Customer：{selectedMessage.message.matched_customer_name || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">Matched Inquiry：{selectedMessage.message.matched_inquiry_title || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">Thread：{selectedMessage.message.conversation_key || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">报价线索：{Number(selectedMessage.message.quote_detected || 0) ? '是' : '否'}</div>
              </div>
              <textarea readOnly className={`${areaClass} w-full`} value={selectedMessage.message.cleaned_text || selectedMessage.message.text_body || ''} />
              <textarea readOnly className={`${areaClass} w-full`} value={selectedMessage.message.attachments_json || '[]'} />
              {Array.isArray(selectedMessage.thread) && selectedMessage.thread.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-black text-slate-900">邮件线程</div>
                  {selectedMessage.thread.map((item: any) => (
                    <div key={item.id} className="rounded-lg border border-slate-100 px-3 py-2">
                      <div className="flex justify-between gap-3 text-xs text-slate-400">
                        <span>{item.from_name || item.from_email || '-'} · {item.direction || '-'}</span>
                        <span>{item.received_at || '-'}</span>
                      </div>
                      <div className="text-sm font-bold text-slate-800 mt-1">{item.subject || '(无主题)'}</div>
                      <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{item.preview || '-'}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <div className="text-sm font-black text-slate-900">该邮件解析建议</div>
                {(selectedMessage.suggestions || []).length === 0 ? (
                  <div className="text-sm text-slate-400">暂无建议</div>
                ) : selectedMessage.suggestions.map((item: any) => (
                  <button key={item.id} onClick={() => openSuggestion(Number(item.id))} className="block w-full text-left rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">{item.suggestion_type}</div>
                    <div className="text-xs text-slate-500 mt-1">{item.status} · {item.summary || '-'}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-black text-slate-900">待确认建议</div>
          <div className="max-h-[420px] overflow-auto divide-y divide-slate-100">
            {suggestions.length === 0 ? (
              <div className="p-6 text-sm text-slate-400">暂无建议</div>
            ) : Object.entries(groupedSuggestions).map(([group, rows]) => (
              <div key={group}>
                <div className={`px-4 py-2 text-xs font-black ${group === 'quotation_draft' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-600'}`}>{group} ({rows.length})</div>
                {rows.map((row: any) => (
                  <button key={row.id} onClick={() => openSuggestion(Number(row.id))} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black text-slate-900">{row.suggestion_type}</div>
                      <div className="text-xs text-slate-400">{row.status}</div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{row.summary || '-'}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="text-sm font-black text-slate-900">建议详情</div>
          {!selectedSuggestion ? (
            <div className="text-sm text-slate-400">选择一条建议查看</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-100 px-3 py-2">类型：{selectedSuggestion.suggestion_type}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">状态：{selectedSuggestion.status}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">匹配客户：{selectedSuggestion.matched_customer_name || '-'}</div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">匹配询盘：{selectedSuggestion.matched_inquiry_title || '-'}</div>
              </div>
              <textarea readOnly className={`${areaClass} w-full`} value={selectedSuggestion.summary || ''} />
              <textarea readOnly className={`${areaClass} w-full`} value={selectedSuggestion.extracted_json || ''} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => previewSuggestion(Number(selectedSuggestion.id))} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-bold">预览应用</button>
                <button onClick={() => updateSuggestionStatus(Number(selectedSuggestion.id), 'rejected')} className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-bold text-rose-700">拒绝</button>
                <button onClick={() => updateSuggestionStatus(Number(selectedSuggestion.id), 'ignored')} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700">忽略</button>
              </div>
              {preview && Number(preview?.suggestion?.id) === Number(selectedSuggestion.id) ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
                  <div className="text-sm font-black text-slate-900">应用预览</div>
                  {(preview.warnings || []).length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {(preview.warnings || []).join(' | ')}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
                    <div>create customer：{preview.apply_plan?.will_create_customer ? 'yes' : 'no'}</div>
                    <div>update customer：{preview.apply_plan?.will_update_customer ? 'yes' : 'no'}</div>
                    <div>create inquiry：{preview.apply_plan?.will_create_inquiry ? 'yes' : 'no'}</div>
                    <div>create specification：{preview.apply_plan?.will_create_specification ? 'yes' : 'no'}</div>
                    <div>create communication：{preview.apply_plan?.will_create_communication_log ? 'yes' : 'no'}</div>
                    <div>create quotation：{preview.apply_plan?.will_create_quotation ? 'yes' : 'no'}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-black text-slate-700">字段差异</div>
                    {Array.isArray(preview.diff) && preview.diff.length > 0 ? preview.diff.map((item: any) => (
                      <label key={item.field} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <input type="checkbox" checked={applyForm.apply_fields.includes(item.field)} onChange={() => toggleApplyField(item.field)} className="mt-0.5" />
                        <div className="space-y-1">
                          <div className="font-bold text-slate-800">{item.field} · {item.action}</div>
                          <div className="text-slate-500">当前：{String(item.current_value || '未记录')}</div>
                          <div className="text-indigo-700">建议：{String(item.suggested_value || '未记录')}</div>
                        </div>
                      </label>
                    )) : <div className="text-xs text-slate-500">无字段差异。</div>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.allow_create_customer} onChange={e => setApplyForm((prev: any) => ({ ...prev, allow_create_customer: e.target.checked }))} />允许创建客户</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.allow_update_customer} onChange={e => setApplyForm((prev: any) => ({ ...prev, allow_update_customer: e.target.checked }))} />允许更新客户</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.allow_create_inquiry} onChange={e => setApplyForm((prev: any) => ({ ...prev, allow_create_inquiry: e.target.checked }))} />允许创建询盘</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.allow_create_specification} onChange={e => setApplyForm((prev: any) => ({ ...prev, allow_create_specification: e.target.checked }))} />允许创建规格</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.allow_create_communication_log} onChange={e => setApplyForm((prev: any) => ({ ...prev, allow_create_communication_log: e.target.checked }))} />允许创建沟通记录</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!applyForm.apply_priority} onChange={e => setApplyForm((prev: any) => ({ ...prev, apply_priority: e.target.checked, apply_fields: e.target.checked ? Array.from(new Set([...prev.apply_fields, 'priority'])) : prev.apply_fields.filter((field: string) => field !== 'priority') }))} />允许应用优先级</label>
                  </div>
                  <textarea className={`${areaClass} w-full`} value={applyForm.review_note} onChange={e => setApplyForm((prev: any) => ({ ...prev, review_note: e.target.value }))} placeholder="review note" />
                  <button disabled={applying} onClick={applySuggestion} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-black disabled:opacity-60">确认入库</button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {['pending', 'needs_review', 'rejected', 'ignored', 'applied'].map((status) => (
                  <button key={status} onClick={() => updateSuggestionStatus(Number(selectedSuggestion.id), status)} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700">
                    {status}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clipboard, Download, ExternalLink, Image, Loader2, RefreshCw, Send, SkipForward } from 'lucide-react';
import { User } from '../types';

type Task = {
  id: number; platform: string; title: string; body: string; hashtags: string; media_url?: string;
  target_url: string; destination_url: string; recommended_at: string; status: string; source_url: string;
};

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const platformNames: Record<string, string> = {
  pinterest: 'Pinterest', linkedin: 'LinkedIn', facebook: 'Facebook', wechat: '微信公众号', zhihu: '知乎',
  youtube: 'YouTube', medium: 'Medium', baijiahao: '百家号', toutiao: '头条号', sohu: '搜狐号', instagram: 'Instagram', vk: 'VK',
};

export default function StreamDesk({ user }: { user: User }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [strategy, setStrategy] = useState<any>(null);
  const [calendar, setCalendar] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [status, setStatus] = useState('ready');
  const [metrics, setMetrics] = useState({ impressions: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, saves: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('https://gdhspack.com/');
  const current = tasks[0];

  async function load() {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    const [taskData, summaryData, strategyData, calendarData, analyticsData] = await Promise.all([
      api<{ tasks: Task[] }>(`/api/stream-desk/tasks?status=${status}&limit=50`),
      api('/api/stream-desk/summary'), api('/api/stream-desk/strategy'),
      api<{ tasks: any[] }>(`/api/stream-desk/calendar?from=${from}&to=${to}`), api('/api/stream-desk/analytics'),
    ]);
    setTasks(taskData.tasks); setSummary(summaryData); setStrategy(strategyData); setCalendar(calendarData.tasks); setAnalytics(analyticsData);
  }

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [status]);
  const progress = useMemo(() => Object.values(summary?.counts || {}).reduce((sum: number, value: any) => sum + Number(value), 0), [summary]);

  async function act(action: string, detail = '') {
    if (!current) return;
    setBusy(true);
    try {
      await api(`/api/stream-desk/tasks/${current.id}/action`, { method: 'POST', body: JSON.stringify({ action, detail }) });
      if (['published', 'skipped', 'failed'].includes(action)) { setPublicUrl(''); await load(); }
      setMessage(action === 'published' ? '已记录发布，下一稿已就绪。' : '操作已记录。');
    } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value); await act('copied', 'operator copied prepared content');
  }

  async function importPage() {
    setBusy(true);
    try {
      const page: any = await api('/api/stream-desk/inspect', { method: 'POST', body: JSON.stringify({ sourceUrl }) });
      await api('/api/stream-desk/sources', { method: 'POST', body: JSON.stringify({ ...page, language: sourceUrl.includes('/zh/') ? 'zh' : 'en' }) });
      setMessage('官网内容已生成多平台任务。'); await load();
    } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function prepareMedia() {
    if (!current) return;
    setBusy(true);
    try {
      await api(`/api/stream-desk/tasks/${current.id}/media`, { method: 'POST' });
      const response = await fetch(`/api/stream-desk/tasks/${current.id}/media`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
      if (!response.ok) throw new Error('配图下载失败');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await response.blob()); link.download = `huasheng-${current.platform}-${current.id}.jpg`; link.click();
      URL.revokeObjectURL(link.href); setMessage('平台配图已生成并下载。');
    } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function saveMetrics() {
    if (!current) return;
    await api(`/api/stream-desk/tasks/${current.id}/metrics`, { method: 'POST', body: JSON.stringify(metrics) });
    setMessage('绩效快照已保存。'); await load();
  }

  return <div className="space-y-5 pb-10">
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-bold text-indigo-600">PRIVATE PUBLISHING WORKSPACE</p><h1 className="text-2xl font-black text-slate-900">内容发布台</h1><p className="mt-1 text-sm text-slate-500">逐稿发布、记录公开链接，并自动进入下一项。</p></div>
      <div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600"><option value="ready">待发布</option><option value="published">已发布</option><option value="draft_saved">微信草稿</option><option value="all">全部</option></select><button onClick={() => load()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600"><RefreshCw className="h-4 w-4" />刷新</button></div>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[['待发布', summary?.counts?.ready || 0], ['今日完成', summary?.publishedToday || 0], ['全部任务', progress], ['微信草稿', summary?.wechat?.ready ? '已配置' : '手动']].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}
    </div>

    {user.role === 'super_admin' && <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 md:flex-row">
      <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm" aria-label="官网页面 URL" />
      <button disabled={busy} onClick={importPage} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white">从官网生成任务</button>
    </div>}

    {message && <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700">{message}</div>}

    {current ? <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 md:p-6">
        <div className="flex items-center justify-between gap-3"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{platformNames[current.platform] || current.platform}</span><span className="text-xs font-bold text-slate-400">建议 {current.recommended_at}</span></div>
        <h2 className="mt-5 text-xl font-black text-slate-900">{current.title}</h2>
        <div className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-7 text-slate-700">{current.body}</div>
        {current.media_url && <a href={current.media_url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm font-bold text-slate-700"><Image className="h-5 w-5 text-indigo-500" /><span className="truncate">查看并保存配图</span><ExternalLink className="ml-auto h-4 w-4" /></a>}
        {current.media_url && <button disabled={busy} onClick={prepareMedia} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-indigo-200 px-4 text-sm font-bold text-indigo-700"><Download className="h-4 w-4" />生成平台尺寸配图</button>}
        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          <button onClick={() => copy(current.title)} className="h-10 rounded-lg border border-slate-200 text-sm font-bold"><Clipboard className="mr-2 inline h-4 w-4" />标题</button>
          <button onClick={() => copy(current.body)} className="h-10 rounded-lg border border-slate-200 text-sm font-bold"><Clipboard className="mr-2 inline h-4 w-4" />正文</button>
          <button onClick={() => { act('opened', current.destination_url); window.open(current.destination_url, '_blank', 'noopener'); }} className="h-10 rounded-lg bg-slate-900 text-sm font-bold text-white"><ExternalLink className="mr-2 inline h-4 w-4" />打开平台</button>
          <button onClick={() => act('skipped', 'operator skipped')} className="h-10 rounded-lg border border-slate-200 text-sm font-bold text-slate-500"><SkipForward className="mr-2 inline h-4 w-4" />稍后处理</button>
        </div>
        <div className="mt-3 flex gap-2"><input value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} placeholder="粘贴发布后的公开 URL" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm" /><button disabled={busy || !publicUrl} onClick={() => act('published', publicUrl)} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-2 inline h-4 w-4" />完成</>}</button></div>
        {current.status === 'published' && <div className="mt-5 border-t border-slate-100 pt-5"><h3 className="text-sm font-black text-slate-900">7/28 天绩效快照</h3><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">{Object.keys(metrics).map((key) => <label key={key} className="text-[11px] font-bold text-slate-500">{key}<input type="number" min="0" value={(metrics as any)[key]} onChange={(event) => setMetrics({ ...metrics, [key]: Number(event.target.value) })} className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-sm" /></label>)}</div><button onClick={saveMetrics} className="mt-3 h-9 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white">保存快照</button></div>}
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5"><h3 className="font-black text-slate-900">本周内容配比</h3><div className="mt-3 space-y-3">{strategy?.recommendedWeeklyMix?.map((item: any) => <div key={item.pillar}><div className="flex justify-between text-xs font-bold text-slate-600"><span>{item.pillar}</span><span>{item.share}%</span></div><div className="mt-1 h-1.5 bg-slate-100"><div className="h-full bg-indigo-500" style={{ width: `${item.share}%` }} /></div></div>)}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-5"><h3 className="font-black text-slate-900">同行结构观察</h3><div className="mt-3 space-y-4">{strategy?.peers?.map((peer: any) => <div key={peer.name} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0"><a href={peer.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-black text-indigo-700">{peer.name}</a><p className="mt-1 text-xs leading-5 text-slate-500">{peer.lesson}</p></div>)}</div></div>
      </aside>
    </section> : <div className="rounded-lg border border-slate-200 bg-white py-16 text-center"><Send className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-500">当前筛选下没有任务</p></div>}

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,1fr)]">
      <div className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-indigo-600" /><h2 className="font-black text-slate-900">未来 30 天排期</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{calendar.map((item) => <div key={item.id} className="border-l-2 border-indigo-300 bg-slate-50 px-3 py-2"><p className="text-[11px] font-black text-slate-400">{item.recommended_at.slice(0, 16)} · {platformNames[item.platform] || item.platform}</p><p className="mt-1 line-clamp-2 text-xs font-bold text-slate-700">{item.title}</p></div>)}</div></div>
      <div className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-black text-slate-900">发布绩效</h2><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(analytics?.totals || {}).map(([key, value]) => <div key={key} className="bg-slate-50 p-3"><p className="text-[11px] font-bold text-slate-400">{key}</p><p className="text-lg font-black text-slate-900">{Number(value).toLocaleString()}</p></div>)}</div><div className="mt-4 space-y-2">{analytics?.byPlatform?.map((row: any) => <div key={row.platform} className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs"><span className="font-bold text-slate-700">{platformNames[row.platform] || row.platform}</span><span className="text-slate-500">{row.impressions} 展示 · {row.clicks} 点击</span></div>)}</div></div>
    </section>
  </div>;
}

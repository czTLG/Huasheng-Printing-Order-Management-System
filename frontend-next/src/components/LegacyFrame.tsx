import React from 'react';
import { ExternalLink, AlertTriangle } from 'lucide-react';

type Props = {
  title: string;
  tab: 'workorder' | 'cost' | 'stats' | 'admin';
  note: string;
};

export default function LegacyFrame({ title, tab, note }: Props) {
  const src = `/legacy-app.html?ui=classic&embedded=1&main=${encodeURIComponent(tab)}`;

  return (
    <div className="h-full min-h-[calc(100vh-56px)] bg-slate-50 flex flex-col">
      <div className="px-4 py-3 md:px-6 md:py-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">{title}</h1>
          <p className="text-xs md:text-sm text-slate-500 mt-1 leading-6">{note}</p>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-slate-900 text-white text-xs font-black shadow-sm hover:bg-slate-800 w-fit"
        >
          在独立窗口打开
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="mx-4 mt-4 md:mx-6 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-amber-800 text-xs md:text-sm font-medium flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>{note}</div>
      </div>

      <div className="flex-1 p-4 md:p-6">
        <iframe
          title={title}
          src={src}
          className="w-full h-full min-h-[70vh] rounded-3xl border border-slate-200 bg-white shadow-sm"
        />
      </div>
    </div>
  );
}

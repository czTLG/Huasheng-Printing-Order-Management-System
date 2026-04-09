const express = require('express');
const nodemailer = require('nodemailer');
const { execFileSync } = require('child_process');
const { db, now, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');

const router = express.Router();

const STOCK_USERS = new Set(['chenyongjie','gavin']);
const STOCK_MAIL = 'hs2000cyj@163.com';
const EASTMONEY_PROXY_PRIMARY = String(process.env.EASTMONEY_PROXY || '').trim();
const EASTMONEY_PROXY_BACKUP = String(process.env.EASTMONEY_PROXY_BACKUP || '').trim();

const eastmoneyHealth = {
  lastCheckAt: '',
  lastOkAt: '',
  lastError: '',
  consecutiveFails: 0,
  ok: false,
  recent: [] // 1=ok,0=fail
};
function pushEastmoneyHealth(ok, err=''){
  eastmoneyHealth.lastCheckAt = now();
  eastmoneyHealth.ok = !!ok;
  if (ok) {
    eastmoneyHealth.lastOkAt = eastmoneyHealth.lastCheckAt;
    eastmoneyHealth.lastError = '';
    eastmoneyHealth.consecutiveFails = 0;
  } else {
    eastmoneyHealth.lastError = String(err||'');
    eastmoneyHealth.consecutiveFails = Number(eastmoneyHealth.consecutiveFails||0) + 1;
  }
  eastmoneyHealth.recent.push(ok?1:0);
  if (eastmoneyHealth.recent.length > 60) eastmoneyHealth.recent.shift();
}
function getEastmoneyHealth(){
  const n = eastmoneyHealth.recent.length || 1;
  const succ = eastmoneyHealth.recent.reduce((s,x)=>s+Number(x||0),0);
  return { ...eastmoneyHealth, successRate: Number((succ*100/n).toFixed(1)), samples: n };
}
async function probeEastmoney(){
  try{
    const d = await fetchJsonEastmoney('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=1&lmt=6&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
    const kl = d?.data?.klines || [];
    const ok = Array.isArray(kl) && kl.length > 0;
    pushEastmoneyHealth(ok, ok ? '' : 'empty_klines');
    return ok;
  }catch(e){
    pushEastmoneyHealth(false, e?.message||'probe_failed');
    return false;
  }
}

function detectBoard(code=''){
  const c = String(code||'').trim();
  if (!c) return '未知';
  if (c.startsWith('688')) return '科创板';
  if (c.startsWith('300')) return '创业板';
  if (c.startsWith('8') || c.startsWith('4')) return '北交所';
  if (c.startsWith('60')) return '沪主板';
  if (c.startsWith('00') || c.startsWith('001') || c.startsWith('002')) return '深主板';
  return '其他';
}


function shouldTryEastmoneyForKline(){
  try{
    const fails = Number(eastmoneyHealth.consecutiveFails || 0);
    const last = eastmoneyHealth.lastCheckAt ? new Date(eastmoneyHealth.lastCheckAt).getTime() : 0;
    const ageMs = last ? (Date.now() - last) : Number.MAX_SAFE_INTEGER;
    // 连续失败2次且20分钟内，短路东财K线，避免逐只股票超时拖垮分析任务
    if (fails >= 2 && ageMs < 20 * 60 * 1000) return false;
  }catch(_){ }
  return true;
}

function secidByCode(code=''){
  const c = String(code||'').trim();
  if (!c) return '';
  return c.startsWith('6') ? `1.${c}` : `0.${c}`;
}

async function fetchJson(url){
  let lastErr = null;
  for (let i=0;i<2;i++) {
    const ctl = new AbortController();
    const t = setTimeout(()=>ctl.abort(), 6500);
    try{
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`请求失败 ${r.status}`);
      return r.json();
    }catch(e){ clearTimeout(t); lastErr = e; }
  }
  throw (lastErr || new Error('请求失败'));
}

function fetchJsonByCurl(url, proxy=''){
  const args = ['-sS', '--max-time', '7', '-H', 'User-Agent: Mozilla/5.0'];
  if (proxy) args.push('-x', proxy);
  args.push(url);
  const out = execFileSync('curl', args, { encoding:'utf8', timeout:9000 });
  return JSON.parse(String(out||'{}'));
}

async function fetchJsonEastmoney(url){
  try { return await fetchJson(url); } catch(_){ }
  const proxies = [EASTMONEY_PROXY_PRIMARY, EASTMONEY_PROXY_BACKUP].filter(Boolean);
  let lastErr = null;
  for (const p of proxies){
    try { return fetchJsonByCurl(url, p); } catch(e){ lastErr = e; }
  }
  if (proxies.length) throw (lastErr || new Error('eastmoney_proxy_failed'));
  throw new Error('fetch failed');
}

function fetchCandidatesByAkshare(){
  try{
    const py = [
      'import akshare as ak, json',
      'df=ak.stock_zh_a_spot_em()',
      'df=df.head(2500)',
      'rows=[]',
      'for _,r in df.iterrows():',
      ' code=str(r.get("代码","")).zfill(6)',
      ' rows.append({"code":code,"name":str(r.get("名称","")),"price":float(r.get("最新价",0) or 0),"pct":float(r.get("涨跌幅",0) or 0),"turnover":float(r.get("换手率",0) or 0),"volumeRatio":float(r.get("量比",0) or 0),"marketCapYi":float(r.get("总市值",0) or 0)/100000000,"amount":float(r.get("成交额",0) or 0)})',
      'print(json.dumps(rows, ensure_ascii=False))'
    ].join('\n');
    const out = execFileSync('python3',['-c',py],{encoding:'utf8',timeout:18000});
    const arr = JSON.parse(String(out||'[]'));
    return Array.isArray(arr) ? arr.map(x=>({ ...x, board: detectBoard(x.code) })) : [];
  }catch(_){ return []; }
}

async function fetchCandidates(){
  const fields = 'f12,f14,f2,f3,f8,f10,f20,f13,f6';
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=${fields}`;
  try{
    const d = await fetchJsonEastmoney(url);
    const rows = d?.data?.diff || [];
    pushEastmoneyHealth(Array.isArray(rows) && rows.length>0, Array.isArray(rows) && rows.length>0 ? '' : 'empty_diff');
    return rows.map(x => {
      const code = String(x.f12 || '');
      return {
        code,
        name: String(x.f14 || ''),
        board: detectBoard(code),
        price: Number(x.f2 || 0),
        pct: Number(x.f3 || 0),
        turnover: Number(x.f8 || 0),
        volumeRatio: Number(x.f10 || 0),
        marketCapYi: Number(x.f20 || 0) / 100000000,
        amount: Number(x.f6 || 0)
      };
    });
  }catch(e){
    pushEastmoneyHealth(false, e?.message||'fetch_candidates_failed');
    const ak = fetchCandidatesByAkshare();
    if (ak.length) return ak;
    throw new Error('eastmoney+akshare_candidates_failed');
  }
}

async function hasLimitUpIn20Days(code=''){
  const secid = secidByCode(code);
  if (!secid) return null;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=30&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  const d = await fetchJsonEastmoney(url).catch(()=>null);
  const kl = d?.data?.klines || [];
  if (!kl.length) return null;
  const last20 = kl.slice(-20);
  return last20.some(line => {
    const arr = String(line||'').split(',');
    const pct = Number(arr[8] || 0);
    return pct >= 9.8;
  });
}

async function intradayAboveAvg(code=''){
  const secid = secidByCode(code);
  if (!secid) return null;
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&ndays=1&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const d = await fetchJsonEastmoney(url).catch(()=>null);
  const tr = d?.data?.trends || [];
  if (!tr.length) return null;
  return tr.every(line => {
    const arr = String(line||'').split(',');
    const p = Number(arr[1] || 0);
    const avg = Number(arr[2] || 0);
    if (!p || !avg) return true;
    return p >= avg;
  });
}

function inTimeWindow(){
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  return (h > 14 || (h === 14 && m >= 30));
}

async function sendStrategyMail({ day, out = [], relaxedUsed = false, warning = '', sourceUsed = 'eastmoney' } = {}) {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user || '';
  if (!(host && user && pass && from)) return { ok:false, skipped:true, reason:'smtp_not_configured' };
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  const text = [
    `隔夜套利法筛选结果（${day}）`,
    `时间窗：${inTimeWindow() ? '14:30后' : '当前非14:30后，仅手动触发'}`,
    `数据源：${sourceUsed}`,
    `总数：${out.length}${relaxedUsed ? '（已启用宽松候选）' : ''}`,
    `${warning ? `提示：${warning}` : ''}`,
    '',
    ...out.slice(0,30).map((r,i)=>`${i+1}. ${r.code} ${r.name}【${r.board || detectBoard(r.code)}】 涨幅${r.pct}% 换手${r.turnover}% 量比${r.volumeRatio} 市值${Number(r.marketCapYi||0).toFixed(1)}亿 分数${r.score}`),
    '',
    '铁律：次日早盘必须清仓离场。'
  ].join('\n');
  await transporter.sendMail({ from, to: STOCK_MAIL, subject: `A股隔夜套利筛选 ${day}`, text });
  return { ok:true };
}

function fetchDailyKlinesByNetease(code='', lmt=90){
  return new Promise(async (resolve)=>{
    try{
      const c = String(code||'').trim();
      if (!/^\d{6}$/.test(c)) return resolve({ ok:false, klines:[], error:'bad_code', source:'netease' });
      const nc = c.startsWith('6') ? `0${c}` : `1${c}`;
      const url = `https://quotes.money.163.com/service/chddata.html?code=${nc}&start=20000101&end=21000101&fields=TOPEN;HIGH;LOW;TCLOSE;CHG;PCHG;TURNOVER;VOTURNOVER;VATURNOVER`;
      const ctl = new AbortController();
      const tt = setTimeout(()=>ctl.abort(), 6500);
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
      clearTimeout(tt);
      if (!r.ok) return resolve({ ok:false, klines:[], error:`http_${r.status}`, source:'netease' });
      const txt = await r.text();
      const lines = String(txt||'').split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) return resolve({ ok:false, klines:[], error:'empty', source:'netease' });
      const kl = [];
      for (let i=1;i<lines.length;i++){
        const a = lines[i].split(',');
        if (a.length < 10) continue;
        const date = String(a[0]||'').replace(/\//g,'-');
        const close = Number((a[3]||'').replace(/"/g,'' )||0);
        const high = Number((a[4]||'').replace(/"/g,'' )||0);
        const low = Number((a[5]||'').replace(/"/g,'' )||0);
        const open = Number((a[6]||'').replace(/"/g,'' )||0);
        const chg = Number((a[7]||'').replace(/"/g,'' )||0);
        const pct = Number((a[8]||'').replace(/"|%/g,'' )||0);
        const turnover = Number((a[9]||'').replace(/"|%/g,'' )||0);
        const vol = Number((a[10]||'').replace(/"/g,'' )||0);
        const amount = Number((a[11]||'').replace(/"/g,'' )||0);
        if (!date || !close) continue;
        kl.push(`${date},${open},${close},${high},${low},${vol},${amount},0,${pct},${chg},${turnover}`);
      }
      const out = kl.slice(-Math.max(60,lmt));
      if (!out.length) return resolve({ ok:false, klines:[], error:'parsed_empty', source:'netease' });
      resolve({ ok:true, klines:out, error:'', source:'netease' });
    }catch(e){
      resolve({ ok:false, klines:[], error:`netease_failed:${String(e?.message||'')}`, source:'netease' });
    }
  });
}


async function fetchDailyKlinesByTencent(code='', lmt=90){
  try{
    const c = String(code||'').trim();
    if (!/^\d{6}$/.test(c)) return { ok:false, klines:[], error:'bad_code', source:'tencent' };
    const symbol = c.startsWith('6') ? `sh${c}` : `sz${c}`;
    const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${Math.max(60, lmt)},qfq`;
    const td = await fetchJson(txUrl);
    const node = td?.data?.[symbol] || {};
    const arr = node?.qfqday || node?.day || [];
    const kl = (arr||[]).map(x=>{
      const date = String(x[0]||'');
      const open = Number(x[1]||0), close = Number(x[2]||0), high = Number(x[3]||0), low = Number(x[4]||0);
      const vol = Number(x[5]||0); const amount = Number(x[6]||0);
      return `${date},${open},${close},${high},${low},${vol},${amount},0,0,0,0`;
    });
    if (!kl.length) return { ok:false, klines:[], error:'empty', source:'tencent' };
    for (let i=0;i<kl.length;i++) {
      const p = String(kl[i]).split(',');
      const prevClose = i>0 ? Number(String(kl[i-1]).split(',')[2]||0) : 0;
      const close = Number(p[2]||0);
      const pct = prevClose>0 ? ((close-prevClose)*100/prevClose) : 0;
      p[8] = String(Number.isFinite(pct)?pct:0);
      kl[i] = p.join(',');
    }
    return { ok:true, klines: kl, error:'', source:'tencent' };
  }catch(e){
    return { ok:false, klines:[], error:`tencent_failed:${String(e?.message||'')}`, source:'tencent' };
  }
}

function fetchDailyKlinesByAkshare(code='', lmt=90, timeoutMs=25000){
  try{
    const c = String(code||'').trim();
    if (!c) return { ok:false, klines:[], error:'bad_code', source:'akshare' };
    const py = [
      'import akshare as ak, json',
      `df=ak.stock_zh_a_hist(symbol="${c}",period="daily",start_date="20000101",end_date="21000101",adjust="qfq")`,
      `df=df.tail(${Math.max(60,lmt)})`,
      'rows=[]',
      'for _,r in df.iterrows():',
      ' d=str(r.get("日期", ""))[:10]',
      ' o=float(r.get("开盘",0) or 0); c=float(r.get("收盘",0) or 0); h=float(r.get("最高",0) or 0); l=float(r.get("最低",0) or 0)',
      ' v=float(r.get("成交量",0) or 0); amt=float(r.get("成交额",0) or 0); amp=float(r.get("振幅",0) or 0); pct=float(r.get("涨跌幅",0) or 0); chg=float(r.get("涨跌额",0) or 0); tor=float(r.get("换手率",0) or 0)',
      ' rows.append(f"{d},{o},{c},{h},{l},{v},{amt},{amp},{pct},{chg},{tor}")',
      'print(json.dumps(rows, ensure_ascii=False))'
    ].join('\n');
    const out = execFileSync('python3',['-c',py],{encoding:'utf8',timeout:Math.max(3000, Number(timeoutMs||25000))});
    const kl = JSON.parse(String(out||'[]'));
    if (Array.isArray(kl) && kl.length) return { ok:true, klines:kl, error:'', source:'akshare' };
  }catch(e){
    return { ok:false, klines:[], error:`akshare_failed:${String(e?.message||'')}`, source:'akshare' };
  }
  return { ok:false, klines:[], error:'akshare_empty', source:'akshare' };
}

async function fetchDailyKlines(code='', lmt=90){
  const secid = secidByCode(code);
  if (!secid) return { ok:false, klines:[], error:'bad_code', source:'none' };

  // 主源：东方财富（带失败短路，防止大批量分析时逐只超时）
  if (shouldTryEastmoneyForKline()) {
    const eastUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=${lmt}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
    try{
      const d = await fetchJsonEastmoney(eastUrl);
      const kl = d?.data?.klines || [];
      const ok = Array.isArray(kl) && kl.length;
      pushEastmoneyHealth(!!ok, ok ? '' : 'empty_klines');
      if (ok) return { ok:true, klines: kl, error:'', source:'eastmoney' };
    }catch(e){
      pushEastmoneyHealth(false, e?.message || 'kline_failed');
    }
  }

  // 备用源：腾讯 fqkline
  const tx = await fetchDailyKlinesByTencent(code, lmt);
  if (tx?.ok) return tx;

  // 兜底源1：网易历史
  const ne = await fetchDailyKlinesByNetease(code, lmt);
  if (ne?.ok) return ne;

  // 兜底源2：AkShare（python）
  return fetchDailyKlinesByAkshare(code, lmt);
}

function avg(arr){ if(!arr?.length) return 0; return arr.reduce((s,n)=>s+Number(n||0),0)/arr.length; }

function calcTech(kl = [], idx = -1){
  if (!Array.isArray(kl) || !kl.length) return null;
  const i = idx >= 0 ? idx : (kl.length - 1);
  if (i < 0 || i >= kl.length) return null;
  const get = (j,k)=> Number(String(kl[j]||'').split(',')[k]||0);
  const close = get(i,2);
  const pct = get(i,8);
  const vol = get(i,5);
  const high = get(i,3);
  const low = get(i,4);
  const maN = (n)=> avg(Array.from({length:n}).map((_,x)=> get(i-n+1+x,2)).filter(v=>v>0));
  const vma5 = avg(Array.from({length:5}).map((_,x)=> get(i-4+x,5)).filter(v=>v>0));
  const ma5 = i>=4 ? maN(5) : 0;
  const ma10 = i>=9 ? maN(10) : 0;
  const ma20 = i>=19 ? maN(20) : 0;
  const ma60 = i>=59 ? maN(60) : 0;
  const volRatio = vma5>0 ? vol/vma5 : 0;
  let trend = '震荡';
  if (close>ma5 && ma5>ma10 && ma10>ma20) trend = '多头';
  else if (close<ma5 && ma5<ma10 && ma10<ma20) trend = '空头';

  const up20 = ma20>0 ? ((close-ma20)/ma20*100) : 0;
  const up60 = ma60>0 ? ((close-ma60)/ma60*100) : 0;
  const dayAmp = low>0 ? ((high-low)/low*100) : 0;
  const support = ma20>0 ? ma20 : (ma10>0?ma10:ma5);
  const pressure = Math.max(ma5||0, ma10||0, ma20||0, ma60||0);

  let signal = '观察';
  if (trend==='多头' && volRatio>=1.2 && pct>0) signal = '偏强可跟踪';
  if (close>0 && ma20>0 && close<ma20*0.97) signal = '跌破20日线警惕';
  if (pct>=7) signal = '短线过热谨慎追高';

  let risk = '中';
  if (Math.abs(pct)>=7 || volRatio>=2.2 || dayAmp>=10) risk = '高';
  else if (trend==='多头' && volRatio<1.5 && Math.abs(pct)<4) risk = '中低';

  // 建议买入挂单价（仅在“偏强可跟踪”且非高风险时给出）
  let buyPrice = 0;
  let buyRange = '';
  if (signal === '偏强可跟踪' && risk !== '高') {
    const anchor = ma5 > 0 ? ma5 : close;
    const lowEntry = Number((anchor * 0.995).toFixed(2));
    const highEntry = Number((anchor * 1.005).toFixed(2));
    buyPrice = Number((((lowEntry + highEntry) / 2)).toFixed(2));
    buyRange = `${lowEntry}-${highEntry}`;
  }

  let buyIndex = 50;
  if (trend === '多头') buyIndex += 18;
  if (trend === '空头') buyIndex -= 20;
  if (close > ma20 && ma20 > 0) buyIndex += 10;
  if (close < ma20 && ma20 > 0) buyIndex -= 14;
  if (pct > 0 && pct <= 4) buyIndex += 8;
  if (pct > 6) buyIndex -= 8;
  if (volRatio >= 1.1 && volRatio <= 2.2) buyIndex += 8;
  if (volRatio > 2.8) buyIndex -= 6;
  if (Math.abs(up20) > 12) buyIndex -= 8;
  if (risk === '高') buyIndex -= 10;
  buyIndex = Math.max(0, Math.min(100, Math.round(buyIndex)));

  const comment = [
    `收盘${close.toFixed(2)}，涨跌${pct.toFixed(2)}%，振幅${dayAmp.toFixed(2)}%`,
    `均线位置：MA5 ${ma5.toFixed(2)} / MA10 ${ma10.toFixed(2)} / MA20 ${ma20.toFixed(2)} / MA60 ${ma60.toFixed(2)}`,
    `趋势判断：${trend}，量比${volRatio.toFixed(2)}，20日偏离${up20.toFixed(2)}%，60日偏离${up60.toFixed(2)}%`,
    `参考支撑：${support?support.toFixed(2):'-'}；参考压力：${pressure?pressure.toFixed(2):'-'}；信号：${signal}；建议购入指数：${buyIndex}`,
    buyPrice>0 ? `建议挂单买入价：${buyPrice}（区间 ${buyRange}）` : '建议挂单买入价：暂无（等待回踩/信号确认）'
  ].join('；');

  return { close, pct, ma5, ma10, ma20, ma60, volRatio, buyIndex, trend, signal, risk, buyPrice, buyRange, comment };
}

async function buildCandidatesFromWatchlist(day=''){
  const list = db.prepare('SELECT code,name FROM stock_watchlist WHERE active=1 ORDER BY pinned DESC, updated_at DESC LIMIT 160').all();
  const out = [];
  for (const it of list) {
    const code = String(it.code||'').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const klRes = await fetchDailyKlines(code, 80);
    const kl = klRes?.klines || [];
    if (!klRes?.ok || !kl.length) continue;
    let idx = kl.length - 1;
    if (day) {
      const i2 = kl.findIndex(line => String(line).startsWith(day+','));
      if (i2 >= 0) idx = i2;
    }
    const arr = String(kl[idx]||'').split(',');
    const close = Number(arr[2]||0);
    const pct = Number(arr[8]||0);
    const turnover = Number(arr[10]||0);
    const vol = Number(arr[5]||0);
    const prev5 = kl.slice(Math.max(0, idx-5), idx).map(s=>Number(String(s).split(',')[5]||0)).filter(Boolean);
    const avg5 = prev5.length ? (prev5.reduce((s,n)=>s+n,0)/prev5.length) : 0;
    const volumeRatio = avg5>0 ? (vol/avg5) : 1;
    out.push({
      code,
      name: String(it.name||''),
      board: detectBoard(code),
      price: close,
      pct,
      turnover,
      volumeRatio,
      marketCapYi: 120,
      amount: Number(arr[6]||0)
    });
  }
  return out;
}

async function runStrategy({ sendMail = false, operator = 'system', targetDay = '' } = {}){
  const day = String(targetDay || new Date().toISOString().slice(0,10));
  const isToday = day === new Date().toISOString().slice(0,10);
  let base = [];
  let sourceUsed = 'eastmoney';
  try{
    base = await fetchCandidates();
  }catch(_){
    base = await buildCandidatesFromWatchlist(day);
    sourceUsed = 'watchlist_fallback';
  }
  let rows = sourceUsed==='watchlist_fallback'
    ? base.filter(x => x.code && x.price > 0)
    : base.filter(x => x.code && x.price > 0 && x.marketCapYi >= 50 && x.marketCapYi <= 300);

  const out = [];
  let relaxedUsed = false;
  let warning = sourceUsed==='watchlist_fallback' ? '东财主源异常，已降级为自选池候选筛选' : '';
  if (isToday) {
    if (sourceUsed === 'watchlist_fallback') {
      // 降级快速模式：仅用已拿到的自选池行情，避免再次调用东财分时导致超时
      const fastRows = rows
        .filter(x => Number(x.pct)>=0 && Number(x.turnover)>=0)
        .sort((a,b)=>Number(b.volumeRatio||0)-Number(a.volumeRatio||0))
        .slice(0, 120);
      for (const x of fastRows) {
        const score = Number((Number(x.pct||0) * 7 + Number(x.turnover||0) * 1.8 + Number(x.volumeRatio||0) * 6).toFixed(2));
        out.push({ ...x, score, note: '降级筛选（东财异常，基于自选池多源K线）' });
      }
      if (!out.length) warning = '东财异常且自选池候选不足，暂未生成结果';
    } else {
      const strictRows = rows.filter(x => x.pct >= 3 && x.pct <= 5 && x.turnover >= 8 && x.turnover <= 15 && x.volumeRatio >= 2 && x.volumeRatio <= 5);
      for (const x of strictRows.slice(0, 220)) {
        const [hit20, aboveAvg] = await Promise.all([hasLimitUpIn20Days(x.code), intradayAboveAvg(x.code)]);
        const hitOk = hit20 === null ? true : !!hit20;
        const avgOk = aboveAvg === null ? true : !!aboveAvg;
        if (!hitOk || !avgOk) continue;
        const score = Number((x.pct * 8 + x.turnover * 2 + x.volumeRatio * 6).toFixed(2));
        out.push({ ...x, score, note: '当日实时筛选；次日早盘清仓' });
      }
      if (!out.length) {
        relaxedUsed = true;
        const relaxedRows = rows.filter(x => x.pct >= 2 && x.pct <= 7 && x.turnover >= 3 && x.turnover <= 25 && x.volumeRatio >= 1 && x.volumeRatio <= 10)
          .sort((a,b)=>Number(b.amount||0)-Number(a.amount||0))
          .slice(0, 80);
        for (const x of relaxedRows) {
          const [hit20, aboveAvg] = await Promise.all([hasLimitUpIn20Days(x.code), intradayAboveAvg(x.code)]);
          if (hit20 === false && aboveAvg === false) continue;
          const score = Number((x.pct * 6 + x.turnover * 1.5 + x.volumeRatio * 5).toFixed(2));
          out.push({ ...x, score, note: '宽松候选（严格条件0条时补充）' });
        }
      }
    }
  } else {
    // 历史日期回溯：采用日线近似（分时黄线不可完全还原）
    const pool = rows.sort((a,b)=>Number(b.amount||0)-Number(a.amount||0)).slice(0, 600);
    const histSamples = [];
    let sourceFailCount = 0;
    let foundDayCount = 0;
    for (const x of pool) {
      const klRes = await fetchDailyKlines(x.code, 120);
      const kl = klRes.klines || [];
      if (klRes?.source && klRes.source !== 'eastmoney') sourceUsed = `${klRes.source}(历史兜底)`;
      if (!klRes.ok) { sourceFailCount++; continue; }
      if (!kl.length) continue;
      const idx = kl.findIndex(line => String(line).startsWith(day+','));
      if (idx >= 0) foundDayCount++;
      if (idx < 25) continue;
      const arr = String(kl[idx]).split(',');
      const open = Number(arr[1]||0), close = Number(arr[2]||0), vol = Number(arr[5]||0);
      const pct = Number(arr[8]||0), turnover = Number(arr[10]||0);
      const prev5 = kl.slice(Math.max(0, idx-5), idx).map(s=>Number(String(s).split(',')[5]||0)).filter(Boolean);
      const avg5 = prev5.length ? (prev5.reduce((s,n)=>s+n,0)/prev5.length) : 0;
      const volumeRatio = avg5>0 ? (vol/avg5) : 0;
      const prev20 = kl.slice(Math.max(0, idx-20), idx);
      const hit20 = prev20.some(s=>Number(String(s).split(',')[8]||0) >= 9.8);
      const ma5 = prev5.length ? (prev5.reduce((s,n)=>s+n,0)/prev5.length) : 0;
      const strongProxy = close >= open && vol >= ma5; // 历史近似强势日
      histSamples.push({ ...x, pct, turnover, volumeRatio, hit20, strongProxy });
      if (!(pct>=3 && pct<=5 && turnover>=8 && turnover<=15 && volumeRatio>=2 && volumeRatio<=5)) continue;
      if (!hit20 || !strongProxy) continue;
      const score = Number((pct * 8 + turnover * 2 + volumeRatio * 6).toFixed(2));
      out.push({ ...x, pct, turnover, volumeRatio, score, note: '历史回溯(日线近似)；次日早盘清仓' });
    }
    if (!out.length) {
      relaxedUsed = true;
      histSamples
        .filter(x => x.pct>=2 && x.pct<=7 && x.turnover>=5 && x.turnover<=20 && x.volumeRatio>=1.2 && x.volumeRatio<=8 && (x.hit20 || x.strongProxy))
        .sort((a,b)=>(Number(b.volumeRatio||0)-Number(a.volumeRatio||0)) || (Number(b.pct||0)-Number(a.pct||0)))
        .slice(0, 50)
        .forEach(x=>{
          const score = Number((x.pct * 6 + x.turnover * 1.5 + x.volumeRatio * 5).toFixed(2));
          out.push({ ...x, score, note: '历史宽松候选（严格条件0条时补充）' });
        });
    }
    if (sourceFailCount > 80) warning = '历史数据源连接不稳定，部分股票未取到K线，结果可能偏少';
    else if (foundDayCount === 0) warning = `未发现 ${day} 交易日数据（可能休市）`;
    else if (!out.length) warning = '该日期按策略无命中（含宽松候选也为0）';
  }
  out.sort((a,b)=>b.score-a.score);

  db.prepare('DELETE FROM stock_screen_results WHERE trade_date=?').run(day);
  const ins = db.prepare(`
    INSERT INTO stock_screen_results(trade_date,code,name,board,pct,turnover,volume_ratio,market_cap,score,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `);
  const ts = now();
  out.slice(0, 60).forEach(r => {
    ins.run(day, r.code, r.name, r.board || detectBoard(r.code), r.pct, r.turnover, r.volumeRatio, r.marketCapYi, r.score, r.note, ts);
  });

  if (sendMail) {
    await sendStrategyMail({ day, out, relaxedUsed, warning, sourceUsed });
  }

  audit({ role: 'system', userName: operator, action: 'run_stock_strategy', resourceType: 'stock', resourceId: day, detail: `count=${out.length};relaxed=${relaxedUsed?1:0};source=${sourceUsed};warning=${warning||''}` });
  return { day, rows: out.slice(0, 60), total: out.length, relaxedUsed, warning, sourceUsed };
}

async function runWatchlistAnalysis({ operator = 'system', targetDay = '' } = {}){
  const day = String(targetDay || new Date().toISOString().slice(0,10));
  const list = db.prepare('SELECT code,name,pinned FROM stock_watchlist WHERE active=1 ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT 120').all();
  const ins = db.prepare(`INSERT INTO stock_watchlist_analysis(trade_date,code,name,close,pct,ma5,ma10,ma20,ma60,vol_ratio,buy_index,trend,signal,risk,source,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,close=excluded.close,pct=excluded.pct,ma5=excluded.ma5,ma10=excluded.ma10,ma20=excluded.ma20,ma60=excluded.ma60,vol_ratio=excluded.vol_ratio,buy_index=excluded.buy_index,trend=excluded.trend,signal=excluded.signal,risk=excluded.risk,source=excluded.source,note=excluded.note,created_at=excluded.created_at`);
  let ok=0, fail=0;
  let cursor = 0;
  const workers = Array.from({ length: 8 }).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= list.length) break;
      const x = list[i];
      const code = String(x.code||'').trim();
      if (!/^\d{6}$/.test(code)) { fail++; continue; }
      let klRes = null;
      try { klRes = await fetchDailyKlines(code, 140); } catch(_) { klRes = null; }
      const kl = klRes?.klines || [];
      if (!klRes?.ok || !kl.length) { fail++; continue; }
      let idx = kl.length - 1;
      if (targetDay) {
        idx = kl.findIndex(line => String(line).startsWith(day+','));
        if (idx < 0) { fail++; continue; }
      }
      const t = calcTech(kl, idx);
      if (!t) { fail++; continue; }
      ins.run(day, code, x.name || '', t.close, t.pct, t.ma5, t.ma10, t.ma20, t.ma60, t.volRatio, t.buyIndex, t.trend, t.signal, t.risk, klRes.source || '', t.comment || '技术面自动分析', now());
      ok++;
    }
  });
  await Promise.all(workers);
  audit({ role:'system', userName: operator, action:'run_stock_watchlist_analysis', resourceType:'stock_watchlist', resourceId: day, detail:`ok=${ok};fail=${fail};total=${list.length}` });
  return { day, total:list.length, ok, fail, rows: db.prepare("SELECT a.*, COALESCE(w.pinned,0) AS pinned FROM stock_watchlist_analysis a LEFT JOIN stock_watchlist w ON w.code=a.code WHERE a.trade_date=? ORDER BY COALESCE(w.pinned,0) DESC, COALESCE(a.buy_index,0) DESC, CASE a.signal WHEN '跌破20日线警惕' THEN 1 WHEN '短线过热谨慎追高' THEN 2 WHEN '偏强可跟踪' THEN 3 ELSE 9 END, a.pct DESC").all(day) };
}

router.use((req,res,next)=>{
  const u = String(req.user?.userName || '');
  if (STOCK_USERS.has(u) || req.user?.role === 'super_admin') return next();
  return res.status(403).json({ error: '仅指定用户可访问该模块' });
});

router.get('/results', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req,res)=>{
  const day = String(req.query.day || new Date().toISOString().slice(0,10));
  const rows = db.prepare('SELECT * FROM stock_screen_results WHERE trade_date=? ORDER BY score DESC, id DESC LIMIT 200').all(day);
  res.json({ day, rows });
});

router.get('/watchlist', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req,res)=>{
  const rows = db.prepare('SELECT * FROM stock_watchlist WHERE active=1 ORDER BY pinned DESC, updated_at DESC, id DESC').all();
  res.json({ rows });
});

router.post('/watchlist/add', allowRoles('super_admin','manager','ai_sales'), (req,res)=>{
  const code = String(req.body?.code||'').trim();
  const name = String(req.body?.name||'').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok:false, error:'代码需6位数字' });
  db.prepare(`INSERT INTO stock_watchlist(code,name,source,active,pinned,created_by,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?) ON CONFLICT(code) DO UPDATE SET name=CASE WHEN excluded.name='' THEN stock_watchlist.name ELSE excluded.name END,active=1,updated_at=excluded.updated_at`).run(code,name,'manual_add',1,req.user.userName||'manual',now(),now());
  res.json({ ok:true, code, name });
});

router.post('/watchlist/remove', allowRoles('super_admin','manager','ai_sales'), (req,res)=>{
  const code = String(req.body?.code||'').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok:false, error:'代码需6位数字' });
  db.prepare('UPDATE stock_watchlist SET active=0, pinned=0, updated_at=? WHERE code=?').run(now(), code);
  res.json({ ok:true, code });
});

router.post('/watchlist/pin', allowRoles('super_admin','manager','ai_sales'), (req,res)=>{
  const code = String(req.body?.code||'').trim();
  const pinned = Number(req.body?.pinned||0) ? 1 : 0;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok:false, error:'代码需6位数字' });
  db.prepare('UPDATE stock_watchlist SET pinned=?, updated_at=? WHERE code=?').run(pinned, now(), code);
  res.json({ ok:true, code, pinned });
});

router.post('/watchlist/import', allowRoles('super_admin','manager','ai_sales'), (req,res)=>{
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ ok:false, error:'items不能为空' });
  const up = db.prepare(`INSERT INTO stock_watchlist(code,name,source,active,pinned,created_by,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?) ON CONFLICT(code) DO UPDATE SET name=COALESCE(excluded.name,stock_watchlist.name),source=excluded.source,active=1,updated_at=excluded.updated_at`);
  let n=0;
  for (const it of items){
    const code = String(it?.code || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    up.run(code, String(it?.name||''), String(it?.source||'manual'), 1, req.user.userName||'manual', now(), now());
    n++;
  }
  audit({ role:req.user.role, userName:req.user.userName, action:'stock_watchlist_import', resourceType:'stock_watchlist', resourceId:String(n), detail:`from=${String(req.body?.source||'manual')}` });
  res.json({ ok:true, imported:n });
});

router.post('/watchlist/run', allowRoles('super_admin','manager','ai_sales'), async (req,res)=>{
  try{
    const day = String(req.body?.day || req.query?.day || '').trim();
    const d = await runWatchlistAnalysis({ operator: req.user.userName || 'manual', targetDay: day });
    res.json({ ok:true, ...d });
  }catch(e){
    res.status(400).json({ ok:false, error:String(e?.message || '运行失败') });
  }
});

router.get('/watchlist/analysis', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), (req,res)=>{
  const day = String(req.query.day || new Date().toISOString().slice(0,10));
  const rows = db.prepare("SELECT a.*, COALESCE(w.pinned,0) AS pinned FROM stock_watchlist_analysis a LEFT JOIN stock_watchlist w ON w.code=a.code WHERE a.trade_date=? ORDER BY COALESCE(w.pinned,0) DESC, COALESCE(a.buy_index,0) DESC, CASE a.signal WHEN '跌破20日线警惕' THEN 1 WHEN '短线过热谨慎追高' THEN 2 WHEN '偏强可跟踪' THEN 3 ELSE 9 END, a.pct DESC").all(day);
  res.json({ day, rows });
});

router.get('/sources/status', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), async (req,res)=>{
  const status = { checkedAt: now(), eastmoney: { ok:false }, tencent: { ok:false }, netease:{ ok:false }, akshare: { ok:false }, sina: { ok:false }, overallOk:false, mode:'degraded', notes: [], eastmoneyHealth: getEastmoneyHealth(), eastmoneyProxy: { primaryConfigured: !!EASTMONEY_PROXY_PRIMARY, backupConfigured: !!EASTMONEY_PROXY_BACKUP } };
  try{
    const d2 = await fetchJsonEastmoney('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=1&lmt=12&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
    const kl = d2?.data?.klines || [];
    status.eastmoney = { ok:Array.isArray(kl)&&kl.length>0, count:Array.isArray(kl)?kl.length:0, ping:'kline' };
  }catch(e){
    status.eastmoney = { ok:false, error:String(e?.message||'') };
  }

  try{
    const td = await fetchJson('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz000001,day,,,60,qfq');
    const arr = td?.data?.sz000001?.qfqday || td?.data?.sz000001?.day || [];
    status.tencent = { ok:Array.isArray(arr)&&arr.length>0, count:Array.isArray(arr)?arr.length:0 };
  }catch(e){ status.tencent = { ok:false, error:String(e?.message||'') }; }

  try{
    const ne = await fetchDailyKlinesByNetease('000001', 60);
    if (ne?.ok) {
      status.netease = { ok: true, count: (ne.klines||[]).length, source: ne.source, error: '' };
    } else {
      const tx2 = await fetchDailyKlinesByTencent('000001', 60);
      status.netease = tx2?.ok
        ? { ok:true, count:(tx2.klines||[]).length, source:'netease->tencent_fallback', error:'' }
        : { ok:false, count:0, source: ne?.source || 'netease', error: ne?.error || 'unavailable' };
    }
  }catch(e){ status.netease = { ok:false, error:String(e?.message||'') }; }

  try{
    const ak = fetchDailyKlinesByAkshare('000001', 60, 15000);
    if (ak?.ok) {
      status.akshare = { ok: true, count: (ak.klines||[]).length, source: ak.source, error: '' };
    } else {
      const tx3 = await fetchDailyKlinesByTencent('000001', 60);
      status.akshare = tx3?.ok
        ? { ok:true, count:(tx3.klines||[]).length, source:'akshare->tencent_fallback', error:'' }
        : { ok:false, count:0, source: ak?.source || 'akshare', error: ak?.error || 'unavailable' };
    }
  }catch(e){ status.akshare = { ok:false, error:String(e?.message||'') }; }

  try{
    const r = await fetch('https://hq.sinajs.cn/list=sh600000', { headers: { 'User-Agent':'Mozilla/5.0', 'Referer':'https://finance.sina.com.cn' } });
    status.sina = { ok: r.ok, status: r.status };
  }catch(e){ status.sina = { ok:false, error:String(e?.message||'') }; }

  status.overallOk = !!(status.eastmoney?.ok || status.tencent?.ok || status.netease?.ok || status.akshare?.ok);

  if (!status.eastmoney?.ok && status.tencent?.ok) status.notes.push('东财在当前网络受限，系统已自动以腾讯源作为主可用通道。');
  if (status.netease?.source==='netease->tencent_fallback') status.notes.push('网易接口异常，已自动回退腾讯行情。'); else if (!status.netease?.ok) status.notes.push('网易历史接口不稳定（常见 502），不影响主流程。');
  if (status.akshare?.source==='akshare->tencent_fallback') status.notes.push('AkShare 上游受限，已自动回退腾讯行情。'); else if (!status.akshare?.ok) status.notes.push('AkShare 依赖上游行情站点，当前环境可能超时或被限流。');
  status.mode = status.tencent?.ok ? 'normal' : ((status.eastmoney?.ok || status.netease?.ok || status.akshare?.ok) ? 'degraded' : 'down');
  res.json(status);
});

router.get('/sources/eastmoney-health', allowRoles('super_admin','manager','ai_sales','worker','worker_print','worker_film','worker_bag','worker_ship'), async (req,res)=>{
  res.json({ checkedAt: now(), eastmoneyHealth: getEastmoneyHealth() });
});

router.post('/sources/probe-eastmoney', allowRoles('super_admin','manager','ai_sales'), async (req,res)=>{
  const ok = await probeEastmoney();
  res.json({ ok, eastmoneyHealth: getEastmoneyHealth() });
});

router.post('/run', allowRoles('super_admin','manager','ai_sales'), async (req,res)=>{
  try {
    const day = String(req.body?.day || req.query?.day || '').trim();
    const d = await runStrategy({ sendMail: false, operator: req.user.userName || 'manual', targetDay: day });
    res.json({ ok: true, ...d });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || '筛选失败') });
  }
});

router.post('/send-mail', allowRoles('super_admin','manager','ai_sales'), async (req,res)=>{
  try {
    const day = String(req.body?.day || req.query?.day || new Date().toISOString().slice(0,10)).trim();
    const rows = db.prepare('SELECT * FROM stock_screen_results WHERE trade_date=? ORDER BY score DESC, id DESC LIMIT 200').all(day).map(r=>({
      ...r,
      marketCapYi: Number(r.market_cap || 0),
      volumeRatio: Number(r.volume_ratio || 0)
    }));
    if (!rows.length) return res.status(400).json({ ok:false, error:'该日期无筛选结果，先执行筛选' });
    await sendStrategyMail({ day, out: rows, relaxedUsed:false, warning:'', sourceUsed:'db_saved' });
    audit({ role:req.user.role, userName:req.user.userName, action:'stock_send_mail', resourceType:'stock', resourceId:day, detail:`count=${rows.length}` });
    res.json({ ok:true, day, sent: rows.length });
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e?.message || '发送失败') });
  }
});

module.exports = router;
module.exports.runStrategy = runStrategy;
module.exports.runWatchlistAnalysis = runWatchlistAnalysis;
module.exports.probeEastmoney = probeEastmoney;
module.exports.getEastmoneyHealth = getEastmoneyHealth;
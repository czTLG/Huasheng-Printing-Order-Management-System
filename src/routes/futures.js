const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { audit } = require('../db');

const router = express.Router();
const ONLY_USER = 'gavin';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STRATEGY_PATH = path.join(DATA_DIR, 'futures_strategy_framework.md');
const SCAN_CACHE_PATH = path.join(DATA_DIR, 'futures_scan_latest.json');
const EVENT_RISK_CACHE_PATH = path.join(DATA_DIR, 'futures_event_risk_cache.json');
const SINA_SYMBOL_JS = 'https://finance.sina.com.cn/iframe/futures_info_cff.js';

router.use((req, res, next) => {
  const u = String(req.user?.userName || '');
  if (u === ONLY_USER) return next();
  return res.status(403).json({ error: '无权限访问该模块' });
});

function readStrategyText(){
  try { return fs.readFileSync(STRATEGY_PATH, 'utf8'); } catch (_) { return '未找到策略文档'; }
}

function latestSummaryPath(){
  try{
    const files = fs.readdirSync(DATA_DIR).filter(f=>/^futures_import_\d{8}_summary\.json$/.test(f)).sort();
    if (!files.length) return '';
    return path.join(DATA_DIR, files[files.length-1]);
  }catch(_){ return ''; }
}

function readLatestSummary(){
  const p = latestSummaryPath();
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch (_) { return null; }
}

function httpGetText(url, timeoutMs = 10000, redirects = 0){
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? require('https') : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn' } }, (resp) => {
      if ([301,302,303,307,308].includes(Number(resp.statusCode||0)) && resp.headers?.location && redirects < 3) {
        const nextUrl = /^https?:\/\//i.test(resp.headers.location) ? resp.headers.location : new URL(resp.headers.location, url).toString();
        resp.resume();
        return resolve(httpGetText(nextUrl, timeoutMs, redirects + 1));
      }
      let out = '';
      resp.on('data', chunk => { out += chunk; });
      resp.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function stripHtml(s=''){
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRssItems(xml=''){
  const items = [];
  const text = String(xml || '');
  const blocks = text.match(/<item[\s\S]*?<\/item>/g) || text.match(/<entry[\s\S]*?<\/entry>/g) || [];
  for (const b of blocks) {
    const title = (b.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1];
    const desc = (b.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || b.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [,''])[1];
    const pubDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || b.match(/<updated>([\s\S]*?)<\/updated>/i) || [,''])[1];
    items.push({ title: stripHtml(title), desc: stripHtml(desc), pubDate: stripHtml(pubDate) });
  }
  return items;
}

async function detectEventRiskAuto(){
  // 15分钟缓存，避免频繁抓取
  try {
    if (fs.existsSync(EVENT_RISK_CACHE_PATH)) {
      const c = JSON.parse(fs.readFileSync(EVENT_RISK_CACHE_PATH, 'utf8'));
      if (Date.now() - new Date(c.generatedAt || 0).getTime() < 15 * 60 * 1000) return c;
    }
  } catch (_) {}

  const feeds = [
    'https://news.google.com/rss/search?q=Iran+US+conflict',
    'https://news.google.com/rss/search?q=Middle+East+attack+oil+shipping',
    'https://news.google.com/rss/search?q=Hormuz+strait+tension'
  ];

  const kw = [
    { k: /iran|伊朗/i, w: 2 },
    { k: /u\.?s\.?|united states|美国/i, w: 2 },
    { k: /attack|strike|missile|drone|war|冲突|袭击|导弹|战争/i, w: 3 },
    { k: /hormuz|霍尔木兹|gulf|波斯湾/i, w: 3 },
    { k: /oil|crude|原油|能源|shipping|航运/i, w: 2 },
    { k: /sanction|制裁|军事升级|escalation/i, w: 2 }
  ];

  let score = 0;
  let fetched = 0;
  const evidence = [];
  for (const url of feeds) {
    try {
      const xml = await httpGetText(url, 9000);
      fetched += 1;
      const items = parseRssItems(xml).slice(0, 20);
      if (/Iran\+US\+conflict/i.test(url) && items.length > 0) {
        score += Math.min(items.length * 3, 30);
        if (evidence.length < 8) evidence.push({ title: `Iran-US 冲突主题新闻命中 ${items.length} 条`, score: Math.min(items.length * 3, 30), pubDate: '' });
      }
      for (const it of items) {
        const txt = `${it.title} ${it.desc}`;
        let s = 0;
        for (const x of kw) if (x.k.test(txt)) s += x.w;
        if (s >= 5) {
          score += Math.min(s, 10);
          if (evidence.length < 8) evidence.push({ title: it.title, score: s, pubDate: it.pubDate || '' });
        }
      }
    } catch (_) {}
  }

  let resolvedEventRisk = 'normal';
  if (score >= 60) resolvedEventRisk = 'high';
  else if (score >= 25) resolvedEventRisk = 'medium';

  // 失败保护：若新闻源全部不可达，不降到“常态”，至少中等风控
  if (fetched === 0) {
    resolvedEventRisk = 'medium';
    evidence.unshift({ title: '自动识别新闻源暂不可达，触发保守风控（medium）', score: 0, pubDate: '' });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    score,
    fetched,
    resolvedEventRisk,
    evidence,
    source: 'rss-keyword'
  };

  try { fs.writeFileSync(EVENT_RISK_CACHE_PATH, JSON.stringify(out, null, 2), 'utf8'); } catch (_) {}
  return out;
}

function parseContinuousSymbols(jsText = ''){
  const re = /new Array\("([^\"]+)","([A-Z]{1,3}0)"\)/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(jsText)) !== null) {
    const name = String(m[1] || '');
    const code = String(m[2] || '');
    if (!seen.has(code)) seen.set(code, name);
  }
  return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
}

function ma(arr = [], n = 20){
  if (!Array.isArray(arr) || arr.length < n) return null;
  const seg = arr.slice(-n);
  return seg.reduce((a,b)=>a+Number(b||0),0) / n;
}

function contractMultiplier(code = ''){
  const p = String(code || '').replace(/\d+/g, '').toUpperCase();
  const map = {
    RB:10, HC:10, I:100, J:100, JM:60, FG:20, SA:20,
    MA:10, EG:10, PP:5, L:5, V:5, TA:5, RU:10, BU:10, FU:10,
    CU:5, AL:5, ZN:5, NI:1, SN:1, AU:1000, AG:15,
    M:10, Y:10, P:10, OI:10, RM:10, SR:10, CF:5,
    IF:300, IH:300, IC:200, IM:200, T:10000, TF:10000, TS:20000
  };
  return map[p] || 10;
}

function displayName(code = '', rawName = ''){
  const bad = /�/.test(String(rawName || '')) || !String(rawName || '').trim();
  if (!bad) return String(rawName || '').trim();
  const p = String(code || '').replace(/\d+/g, '').toUpperCase();
  const map = {
    RB:'螺纹钢', WR:'线材', CU:'沪铜', AL:'沪铝', RU:'橡胶', FU:'燃油', ZN:'沪锌', AU:'黄金', AG:'白银', BU:'沥青',
    HC:'热轧卷板', NI:'沪镍', SN:'锡', PB:'铅', SP:'纸浆', SS:'不锈钢',
    A:'豆一', B:'豆二', M:'豆粕', Y:'豆油', P:'棕榈油', C:'玉米', CS:'淀粉', I:'铁矿石', J:'焦炭', JM:'焦煤',
    L:'塑料', PP:'PP', V:'PVC', EG:'乙二醇', EB:'苯乙烯', PG:'LPG',
    SR:'白糖', CF:'棉花', TA:'PTA', MA:'甲醇', RM:'菜粕', OI:'菜油', SA:'纯碱', FG:'玻璃', CY:'棉纱',
    IF:'沪深300股指', IH:'上证50股指', IC:'中证500股指', IM:'中证1000股指', T:'10年国债', TF:'5年国债', TS:'2年国债'
  };
  return map[p] ? `${map[p]}连续` : `${code}连续`;
}

function buildRankingItem({ code, name, kline = [], capital = 50000, riskPct = 0.01, eventRisk = 'normal' }){
  if (!Array.isArray(kline) || kline.length < 80) return null;
  const closes = kline.map(x => Number(x.c || 0)).filter(Boolean);
  const highs = kline.map(x => Number(x.h || 0)).filter(Boolean);
  const lows = kline.map(x => Number(x.l || 0)).filter(Boolean);
  const vols = kline.map(x => Number(x.v || 0));
  if (closes.length < 80 || highs.length < 80 || lows.length < 80) return null;

  const close = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const ma20 = ma(closes, 20);
  const ma60 = ma(closes, 60);
  const ma20Prev = closes.slice(-21, -1).reduce((a,b)=>a+b,0) / 20;

  let trend = 0;
  if (close > ma20 && ma20 > ma60 && ma20 > ma20Prev) trend = 1;
  else if (close < ma20 && ma20 < ma60 && ma20 < ma20Prev) trend = -1;

  const tr = [];
  for (let i=1;i<closes.length;i++) {
    tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  }
  const atr14 = tr.length >= 14 ? tr.slice(-14).reduce((a,b)=>a+b,0)/14 : Math.max(1, close*0.01);
  const dist = Math.abs(close-ma20)/Math.max(atr14, 1e-6);
  const momentum = ((close/prev)-1) * 100;

  const trendScore = trend !== 0 ? 40 : 10;
  const posScore = Math.max(0, 20 - 5 * dist);
  const momScore = trend === 1 ? Math.min(20, Math.max(0, 10 + momentum*3)) : trend === -1 ? Math.min(20, Math.max(0, 10 - momentum*3)) : 8;
  const volRef = vols.length > 6 ? vols.slice(-6, -1).reduce((a,b)=>a+b,0)/5 : (vols[vols.length-1] || 0);
  const volScore = (vols[vols.length-1] || 0) > volRef ? 10 : 6;
  let score = trendScore + posScore + momScore + volScore;

  const low10 = Math.min(...lows.slice(-10));
  const high10 = Math.max(...highs.slice(-10));

  let direction = '观望';
  let stop = null; let tp1 = null; let tp2 = null;
  if (trend === 1) {
    direction = '做多';
    stop = Math.min(low10, ma20 - 0.8*atr14);
    const r = Math.max(close-stop, atr14*0.6);
    tp1 = close + r; tp2 = close + 2*r;
  } else if (trend === -1) {
    direction = '做空';
    stop = Math.max(high10, ma20 + 0.8*atr14);
    const r = Math.max(stop-close, atr14*0.6);
    tp1 = close - r; tp2 = close - 2*r;
  }

  // 黑天鹅/战争风控：降评分、降仓位
  const riskFactor = eventRisk === 'high' ? 0.5 : (eventRisk === 'medium' ? 0.75 : 1);
  if (eventRisk === 'high') score -= 8;
  else if (eventRisk === 'medium') score -= 4;

  const multiplier = contractMultiplier(code);
  const oneLotRisk = stop == null ? 0 : Math.abs(close - stop) * multiplier;
  const budgetRisk = capital * riskPct * riskFactor;
  const canOpenOneLot = oneLotRisk > 0 && oneLotRisk <= budgetRisk;

  const suggestion = direction === '观望'
    ? '先观望'
    : (canOpenOneLot ? '可开仓(1手优先)' : '先观望/等更优位置');

  const reason = [
    `趋势:${trend===1?'20日均线多头':trend===-1?'20日均线空头':'趋势未明'}`,
    `位置:距MA20约${dist.toFixed(2)}ATR`,
    `量能:${volScore>=10?'放量':'量能一般'}`,
    eventRisk === 'high' ? '事件风控:高（降仓）' : eventRisk === 'medium' ? '事件风控:中（谨慎）' : '事件风控:常态'
  ].join('；');

  return {
    code,
    name: displayName(code, name),
    direction,
    score: Number(score.toFixed(1)),
    reason,
    suggestion,
    close: Number(close.toFixed(3)),
    stop: stop == null ? null : Number(stop.toFixed(3)),
    tp1: tp1 == null ? null : Number(tp1.toFixed(3)),
    tp2: tp2 == null ? null : Number(tp2.toFixed(3)),
    expected: direction === '做多' ? (score >= 68 ? '偏强上涨' : '震荡偏多') : direction === '做空' ? (score >= 68 ? '偏弱下行' : '震荡偏空') : '震荡等待方向',
    multiplier,
    oneLotRisk: Number(oneLotRisk.toFixed(2)),
    budgetRisk: Number(budgetRisk.toFixed(2)),
  };
}

async function runFuturesRanking({ capital = 50000, riskPct = 0.01, maxPicks = 20, eventRisk = 'normal', eventMeta = null } = {}){
  const jsText = await httpGetText(SINA_SYMBOL_JS, 12000);
  const symbols = parseContinuousSymbols(jsText);
  const items = [];

  for (const s of symbols) {
    try {
      const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getDailyKLine?symbol=${s.code}`;
      const txt = await httpGetText(url, 10000);
      const kline = JSON.parse(txt);
      const row = buildRankingItem({ code: s.code, name: s.name, kline, capital, riskPct, eventRisk });
      if (row) items.push(row);
    } catch (_) {}
  }

  items.sort((a, b) => {
    const aObs = a.direction === '观望' ? 1 : 0;
    const bObs = b.direction === '观望' ? 1 : 0;
    if (aObs !== bObs) return aObs - bObs;
    return b.score - a.score;
  });

  const picks = [];
  let usedRisk = 0;
  for (const it of items) {
    if (picks.length >= Math.max(1, Number(maxPicks || 20))) break;
    if (it.direction === '观望') continue;
    if (usedRisk + it.oneLotRisk <= capital * 0.04) {
      picks.push({ ...it, allocation: '1手' });
      usedRisk += it.oneLotRisk;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    capital,
    riskPct,
    eventRisk,
    eventMeta,
    total: items.length,
    top: items.slice(0, Math.max(1, Number(maxPicks || 20))),
    picks,
    riskUsed: Number(usedRisk.toFixed(2)),
    riskCap: Number((capital * 0.04).toFixed(2)),
  };

  try { fs.writeFileSync(SCAN_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) {}
  return payload;
}

function productByInstrument(inst=''){
  const s=String(inst||'').toUpperCase();
  if (s.startsWith('RM')) return '菜粕';
  if (s.startsWith('SH')) return '纯碱';
  if (s.startsWith('AO')) return '氧化铝';
  return '';
}
function normalizeInstrument(inst=''){
  const raw=String(inst||'').trim().toUpperCase();
  const m=raw.match(/^([A-Z]+)(\d+)$/);
  if(!m) return raw;
  const p=m[1], n=m[2];
  if (n.length===3) return `${p}2${n}`; // 605 -> 2605
  return `${p}${n}`;
}
function fetchRealtimeMapByAkshare(positions=[]){
  try{
    const payload = positions.map(p=>({
      instrument: String(p.instrument||''),
      contract: normalizeInstrument(String(p.instrument||'')),
      product: productByInstrument(String(p.instrument||''))
    })).filter(x=>x.contract && x.product);
    if (!payload.length) return { map:{}, source:'none' };

    const py = `
import json, akshare as ak
items=json.loads('''${JSON.stringify(payload).replace(/\\/g,'\\\\').replace(/'''/g,"''\\''") }''')
out={}
for it in items:
    prod=it.get('product','')
    c=it.get('contract','').upper()
    try:
        df=ak.futures_zh_realtime(symbol=prod)
        row=None
        if not df.empty:
            m=df[df['symbol'].astype(str).str.upper()==c]
            if m.empty:
                m=df[df['symbol'].astype(str).str.upper().str.contains(c)]
            if not m.empty:
                row=m.iloc[0]
        if row is not None:
            out[it['instrument']]={
                'trade': float(row.get('trade',0) or 0),
                'open': float(row.get('open',0) or 0),
                'high': float(row.get('high',0) or 0),
                'low': float(row.get('low',0) or 0),
                'presettlement': float(row.get('presettlement',0) or 0),
                'changepercent': float(row.get('changepercent',0) or 0),
                'tradedate': str(row.get('tradedate','') or ''),
                'ticktime': str(row.get('ticktime','') or ''),
            }
    except Exception:
        pass
print(json.dumps(out, ensure_ascii=False))
`;
    const txt = execFileSync('python3', ['-c', py], { encoding:'utf8', timeout: 12000 });
    const map = JSON.parse(String(txt||'{}'));
    return { map, source:'akshare' };
  }catch(_){
    return { map:{}, source:'akshare_failed' };
  }
}

function buildPositionAdvice(pos = {}, equity = 0, rtMap = {}){
  const dir = String(pos.direction || '').toLowerCase();
  const isLong = dir === 'long';
  const entry = Number(pos.avg_buy_price || pos.avg_sell_price || 0);
  const rt = rtMap[String(pos.instrument||'')] || {};
  const mark = Number(rt.trade || pos.sttl_today || 0);
  const lot = Number(pos.long_pos || pos.short_pos || 0) || 1;
  const pnlPct = entry>0 ? ((isLong ? (mark-entry) : (entry-mark)) * 100 / entry) : 0;

  const stop = entry>0 ? (isLong ? entry * 0.985 : entry * 1.015) : 0;
  const tp1 = entry>0 ? (isLong ? entry * 1.02 : entry * 0.98) : 0;
  const tp2 = entry>0 ? (isLong ? entry * 1.035 : entry * 0.965) : 0;

  const trendRef = Number(rt.presettlement||0)>0 ? ((mark-Number(rt.presettlement||0))*100/Number(rt.presettlement||1)) : 0;
  const kState = mark>=Number(rt.open||mark) ? '日内偏强' : '日内偏弱';
  const riskLevel = Math.abs(pnlPct) >= 3 ? '高波动' : (Math.abs(pnlPct)>=1.5 ? '中等波动' : '低波动');
  const action = pnlPct >= 2 ? '可考虑分批止盈（先减半）' : (pnlPct <= -1.5 ? '接近止损区，严格执行纪律' : '继续跟踪，等待触发位');

  return {
    instrument: pos.instrument,
    productName: productByInstrument(pos.instrument),
    direction: isLong ? '多' : '空',
    lots: lot,
    entry,
    mark,
    pnlPct: Number(pnlPct.toFixed(2)),
    mtmPL: Number(pos.mtm_pl || 0),
    stop: Number(stop.toFixed(2)),
    tp1: Number(tp1.toFixed(2)),
    tp2: Number(tp2.toFixed(2)),
    riskLevel,
    action,
    kState,
    dayTrendPct: Number(trendRef.toFixed(2)),
    quoteTime: `${rt.tradedate||''} ${rt.ticktime||''}`.trim(),
    note: '止盈止损为策略近似值（接入实时行情后动态更新）'
  };
}

function buildReport(summary){
  const notePath = path.join(DATA_DIR, 'futures_notes.json');
  const account = summary?.account_summary || {};
  const equity = Number(account.client_equity || 0);
  const risk = Number(account.risk_degree_pct || 0);
  const avail = Number(account.fund_avail || 0);
  const positions = Array.isArray(summary?.positions) ? summary.positions : [];
  const rt = fetchRealtimeMapByAkshare(positions);
  const cards = positions.map(p => buildPositionAdvice(p, equity, rt.map||{}));

  const headline = risk >= 85
    ? '风险度偏高，优先降保证金占用，先控风险再扩交易。'
    : (risk >= 70 ? '风险中等，保持纪律，避免新增高波动仓位。' : '风险可控，按计划执行。');

  const checklist = [
    '趋势同向才开仓（20日均线）',
    '单笔风险不超过总资金2%',
    '盈利>1R后止损上移到成本区',
    '先减仓后跟踪，不恋战',
    '连续失误时暂停交易复盘'
  ];

  const strategyA = {
    name: 'A策略（稳健纪律）',
    focus: '风险优先、趋势确认、固定止损',
    actions: [
      '先降风险度到可控区（建议<=80%）',
      '未确认趋势前不加仓',
      '单笔风险<=2%，触发止损即执行'
    ]
  };
  const strategyB = {
    name: 'B策略（博主分批）',
    focus: '分批进出、见好就收、留尾仓',
    actions: [
      '先减一部分而非一刀切',
      '到目标位先减半锁定利润',
      '尾仓跟踪，不做情绪化追单'
    ]
  };

  const sh = cards.find(x=>String(x.instrument||'').toUpperCase().startsWith('SH'));
  const ao = cards.find(x=>String(x.instrument||'').toUpperCase().startsWith('AO'));
  let hedgeAdvice = '';
  if (sh && ao) {
    hedgeAdvice = '已记录：你当前使用“纯碱 + 氧化铝”对冲思路。当前两边都卡住时，先做净敞口校准：若纯碱与氧化铝同向波动导致双亏，优先减掉波动更大且走势更弱的一侧至半仓；保留相对强势腿观察，避免双边硬扛。';
    try {
      const note = {
        updatedAt: new Date().toISOString(),
        hedgePair: '纯碱(SH) vs 氧化铝(AO)',
        status: 'active',
        detail: '用户在纯碱大跌时买入氧化铝做对冲，现反馈双边卡住',
        sh: { instrument: sh.instrument, direction: sh.direction, lots: sh.lots },
        ao: { instrument: ao.instrument, direction: ao.direction, lots: ao.lots }
      };
      fs.writeFileSync(notePath, JSON.stringify(note, null, 2), 'utf8');
    } catch (_) {}
  }

  const fusionPlan = {
    title: 'A/B融合执行（先风控后分批）',
    steps: [
      '先执行A：不加仓、先降风险、先设硬止损',
      '再执行B：分批减仓/分批止盈，保留小尾仓跟踪',
      '任何时候触发硬止损，直接执行，不再主观讨论'
    ]
  };

  const orderTemplates = cards.map(c => {
    const dir = c.direction === '多' ? '卖出平仓' : '买入平仓';
    const stopText = `${dir} 止损 @ ${c.stop}`;
    const tp1Text = `${dir} 止盈1(减半) @ ${c.tp1}`;
    const tp2Text = `${dir} 止盈2(尾仓) @ ${c.tp2}`;
    return {
      instrument: c.instrument,
      productName: c.productName,
      direction: c.direction,
      lots: c.lots,
      stopText,
      tp1Text,
      tp2Text
    };
  });

  return {
    sourceDate: summary?.date || '',
    account: {
      equity,
      marginOccupied: Number(account.margin_occupied || 0),
      fundAvail: avail,
      riskDegreePct: risk,
      mtmPL: Number(account.mtm_pl || 0)
    },
    headline,
    cards,
    checklist,
    strategyA,
    strategyB,
    fusionPlan,
    orderTemplates,
    hedgeAdvice,
    quoteSource: rt.source || 'none',
    warning: risk >= 85 ? '当前风险度较高（>=85%）' : ''
  };
}

router.get('/framework', (req, res) => {
  res.json({ ok: true, text: readStrategyText() });
});

router.get('/positions/latest', (req, res) => {
  const s = readLatestSummary();
  if (!s) return res.status(404).json({ error: '未找到已导入的期货持仓数据' });
  res.json({ ok: true, summary: s });
});

router.get('/ranking/latest', (req, res) => {
  try {
    if (!fs.existsSync(SCAN_CACHE_PATH)) {
      return res.status(404).json({ ok: false, error: '暂无扫描结果，请先执行 /api/futures/ranking/run' });
    }
    const data = JSON.parse(fs.readFileSync(SCAN_CACHE_PATH, 'utf8'));
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '读取最新扫描结果失败' });
  }
});

router.post('/ranking/run', async (req, res) => {
  const capital = Number(req.body?.capital || 50000);
  const forceRefresh = String(req.body?.forceRefresh || '0') === '1' || req.body?.forceRefresh === true;
  const riskPct = Number(req.body?.riskPct || 0.01);
  const maxPicks = Number(req.body?.maxPicks || 20);
  const eventRiskRaw = String(req.body?.eventRisk || 'auto').toLowerCase();
  const inputEventRisk = ['auto', 'normal', 'medium', 'high'].includes(eventRiskRaw) ? eventRiskRaw : 'auto';

  try {
    if (!forceRefresh && fs.existsSync(SCAN_CACHE_PATH)) {
      try {
        const cached = JSON.parse(fs.readFileSync(SCAN_CACHE_PATH, 'utf8'));
        const ageMs = Date.now() - new Date(cached.generatedAt || 0).getTime();
        const sameProfile = Number(cached.capital || 0) === capital && Number(cached.riskPct || 0) === riskPct && String(cached.eventMeta?.inputEventRisk || cached.eventRisk || '') === inputEventRisk;
        if (ageMs >= 0 && ageMs < 10 * 60 * 1000 && sameProfile) {
          return res.json({ ok: true, message: '期货推荐榜已更新（使用10分钟内缓存）', data: cached, cached: true });
        }
      } catch (_) {}
    }

    let eventRisk = inputEventRisk;
    let eventMeta = null;
    if (inputEventRisk === 'auto') {
      eventMeta = await detectEventRiskAuto();
      eventRisk = eventMeta?.resolvedEventRisk || 'normal';
    }

    const data = await runFuturesRanking({ capital, riskPct, maxPicks, eventRisk, eventMeta: { inputEventRisk, ...(eventMeta || {}) } });

    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'run_futures_ranking',
      resourceType: 'futures',
      resourceId: data.generatedAt,
      detail: `total=${data.total};picks=${data.picks.length};eventRisk=${eventRisk};input=${inputEventRisk}`
    });

    return res.json({ ok: true, message: '期货推荐榜已更新', data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `扫描失败: ${e?.message || e}` });
  }
});

router.post('/report/run', (req, res) => {
  const s = readLatestSummary();
  if (!s) return res.status(404).json({ ok: false, error: '未找到持仓数据，请先导入结算单/持仓数据' });
  try { fs.writeFileSync(path.join(DATA_DIR,'futures_positions_current.json'), JSON.stringify(s,null,2), 'utf8'); } catch(_) {}
  const report = buildReport(s);

  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'run_futures_report_manual',
    resourceType: 'futures',
    resourceId: report.sourceDate || 'manual',
    detail: `positions=${report.cards.length};risk=${report.account.riskDegreePct}`
  });

  res.json({ ok: true, message: '期货报告已生成', report });
});

module.exports = router;

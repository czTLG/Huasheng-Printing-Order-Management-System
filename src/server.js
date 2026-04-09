const express = require('express');
const compression = require('compression');
const cron = require('node-cron');
const { initDb, db, audit } = require('./db');
const { fakeAuth } = require('./middleware/auth');

const authRouter = require('./routes/auth');
const ordersRouter = require('./routes/orders');
const quotesRouter = require('./routes/quotes');
const quoteSheetsRouter = require('./routes/quoteSheets');
const costRouter = require('./routes/cost');
const exportRouter = require('./routes/export');
const systemRouter = require('./routes/system');
const workOrdersRouter = require('./routes/workOrders');
const menuRouter = require('./routes/menu');
const stocksRouter = require('./routes/stocks');
const futuresRouter = require('./routes/futures');

initDb();

const app = express();
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // API 严格禁缓存；静态页允许协商缓存（提升首屏速度）
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  } else {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
  if (process.env.FORCE_HTTPS === '1' && req.header('x-forwarded-proto') === 'http') {
    const host = req.header('host');
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  }
  next();
});

app.use(compression());
app.use(express.json({ limit: '8mb' }));

// API 耗时日志（慢接口榜单基础）
const apiSlowStats = new Map();
app.locals.apiSlowStats = apiSlowStats;
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const key = `${req.method} ${req.path}`;
    const old = apiSlowStats.get(key) || { count: 0, total: 0, max: 0 };
    const cur = { count: old.count + 1, total: old.total + ms, max: Math.max(old.max, ms) };
    apiSlowStats.set(key, cur);
    if (ms >= 800) {
      const avg = Math.round(cur.total / Math.max(1, cur.count));
      console.warn(`[SLOW_API] ${key} ${ms}ms status=${res.statusCode} avg=${avg}ms max=${cur.max}ms count=${cur.count}`);
    }
  });
  next();
});
app.use(express.static(require('path').join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: '10m',
  setHeaders: (res, filePath) => {
    if (String(filePath || '').endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
  }
}));
app.use(fakeAuth);
app.use('/api/auth', authRouter);

app.get('/health', (_, res) => res.json({ ok: true, service: 'packaging-system-demo' }));
app.use('/api/orders', ordersRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/quote-sheets', quoteSheetsRouter);
app.use('/api/cost', costRouter);
app.use('/api/export', exportRouter);
app.use('/api/system', systemRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/menu', menuRouter);
app.use('/api/stocks', stocksRouter);
app.use('/api/futures', futuresRouter);

// 每日14:40（交易日）先执行筛选，不自动发邮件（邮件由独立动作触发）
cron.schedule('40 14 * * 1-5', async () => {
  try {
    await stocksRouter.runStrategy({ sendMail: false, operator: 'cron-stock' });
    console.log('[股市筛选任务] 已执行（未自动发邮件）');
  } catch (e) {
    console.warn('[股市筛选任务] 失败', e?.message || e);
  }
}, { timezone: 'Asia/Shanghai' });

// 每个交易日15:10 跑自选股技术面分析
cron.schedule('10 15 * * 1-5', async () => {
  try {
    await stocksRouter.runWatchlistAnalysis({ operator: 'cron-watchlist' });
    console.log('[自选股技术面] 已执行');
  } catch (e) {
    console.warn('[自选股技术面] 失败', e?.message || e);
  }
}, { timezone: 'Asia/Shanghai' });

const port = Number(process.env.PORT || 80);
const host = '0.0.0.0';
app.listen(port, host, () => {
  console.log(`packaging-system-demo running on http://${host}:${port}`);
  console.log('鉴权说明: 使用 x-user-role(super_admin|ai_sales|worker), x-user-name');
});

const bootEnv = { ...process.env };
require('dotenv').config({ quiet: true });
for (const [key, value] of Object.entries(bootEnv)) {
  if (value !== undefined) process.env[key] = value;
}

const insecureJwtSecret = !process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-in-production' || process.env.JWT_SECRET.length < 32;
if (process.env.NODE_ENV === 'production' && insecureJwtSecret) {
  throw new Error('生产环境必须配置至少 32 位且非默认值的 JWT_SECRET');
}
if (insecureJwtSecret) {
  console.warn('[security] JWT_SECRET 未安全配置；仅允许在开发或测试环境使用');
}

const express = require('express');
const compression = require('compression');
const cron = require('node-cron');
const path = require('path');
const dns = require('node:dns').promises;
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
const statsRouter = require('./routes/stats');
const crmRouter = require('./routes/crm');
const foreignCostingAssistantRouter = require('./routes/foreignCostingAssistant');
const { createMatrixBridgeAuth, createMatrixRouter } = require('./routes/matrix');
const { syncMailbox } = require('./lib/imapSync');
const { createInboxScheduler } = require('./services/matrixInboxScheduler');
const { createMatrixLedgerStore } = require('./services/matrixLedgerStore');
const { createMatrixLedgerReconciler } = require('./services/matrixStreamCorrelation');
const { createMatrixRelayFactory } = require('./services/matrixRelayFactory');
const { createMatrixStreamDelivery } = require('./services/matrixStreamDelivery');
const { createMatrixStreamReadiness } = require('./services/matrixStreamReadiness');
const { createMatrixStreamPreview } = require('./services/matrixStreamPreview');
const { createMatrixThreadRoute } = require('./services/matrixThreadRoute');
const { createMatrixThreadPreview } = require('./services/matrixThreadPreview');
const { createMatrixThreadDelivery } = require('./services/matrixThreadDelivery');

initDb();

const matrixLedgerStore = createMatrixLedgerStore({ db });
const matrixLedgerReconciler = createMatrixLedgerReconciler({ db, store: matrixLedgerStore });
const inboxScheduler = createInboxScheduler({
  db,
  sync: syncMailbox,
  reconcileLifecycle: matrixLedgerReconciler.reconcileLifecycle,
  cronImpl: cron,
  enabled: process.env.MATRIX_INBOX_ENABLED === '1',
  log: message => console.warn(`[matrix-inbox] ${message}`)
});
void inboxScheduler.start().catch(error => {
  console.warn(`[matrix-inbox] startup cycle failed: ${error?.code || error?.name || 'error'}`);
});

const matrixBridgeAuth = createMatrixBridgeAuth({ db });
let matrixRelayFactory = null;
let matrixDeliveryService = null;
let matrixPreviewService = null;
const matrixThreadRouteService = createMatrixThreadRoute({ db });
let matrixThreadPreviewService = null;
let matrixThreadDeliveryService = null;
if (process.env.MATRIX_RELAY_ENABLED === '1') {
  matrixRelayFactory = createMatrixRelayFactory({ env: process.env });
  const matrixReadinessService = createMatrixStreamReadiness({
    resolveTxt: dns.resolveTxt,
    verifyTransport: async () => {
      const result = await matrixRelayFactory.readiness();
      return { tls: result.ready === true, smtp: result.ready === true };
    }
  });
  matrixPreviewService = createMatrixStreamPreview({
    db,
    readinessService: matrixReadinessService,
    senderDomain: process.env.MATRIX_MESSAGE_ID_DOMAIN || 'gdhspack.com',
    dkimSelector: process.env.MATRIX_DKIM_SELECTOR
  });
  matrixDeliveryService = createMatrixStreamDelivery({
    db,
    transport: matrixRelayFactory.transport,
    fromAddress: matrixRelayFactory.senderAddress,
    fromHeader: matrixRelayFactory.senderHeader,
    replyToAddress: matrixRelayFactory.replyToAddress,
    messageIdDomain: process.env.MATRIX_MESSAGE_ID_DOMAIN || 'gdhspack.com',
    dkimSelector: process.env.MATRIX_DKIM_SELECTOR
  });
  matrixThreadPreviewService = createMatrixThreadPreview({db,readinessService:matrixReadinessService,senderDomain:process.env.MATRIX_MESSAGE_ID_DOMAIN||'gdhspack.com',dkimSelector:process.env.MATRIX_DKIM_SELECTOR});
  matrixThreadDeliveryService = createMatrixThreadDelivery({db,transport:matrixRelayFactory.transport,previewService:matrixThreadPreviewService,fromAddress:matrixRelayFactory.senderAddress,fromHeader:matrixRelayFactory.senderHeader,replyToAddress:matrixRelayFactory.replyToAddress,messageIdDomain:process.env.MATRIX_MESSAGE_ID_DOMAIN||'gdhspack.com'});
}
let matrixRouter = null;
function dispatchMatrix(req, res, next) {
  try {
    if (!matrixRouter) matrixRouter = createMatrixRouter({
      db,
      audit,
      deliveryService: matrixDeliveryService,
      previewService: matrixPreviewService
      , threadRouteService: matrixThreadRouteService
      , threadPreviewService: matrixThreadPreviewService
      , threadDeliveryService: matrixThreadDeliveryService
    });
    return matrixRouter(req, res, next);
  } catch (error) {
    console.warn('[matrix] unavailable:', error?.message || error);
    return res.status(503).json({ error: 'matrix data unavailable' });
  }
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.header('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
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
function normalizeApiMetricPath(method, requestPath) {
  const pathOnly = String(requestPath || '')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/ig, '/:id');
  return `${method} ${pathOnly}`;
}
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const key = normalizeApiMetricPath(req.method, req.path);
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
    const normalizedPath = String(filePath || '');
    if (normalizedPath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    // Vite filenames contain a content hash, so they can be cached permanently.
    if (/[/\\]new[/\\]assets[/\\].+\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/i.test(normalizedPath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
  }
}));
app.get(['/crm', '/crm/*'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'new', 'index.html'));
});
app.use('/api/matrix', matrixBridgeAuth, (req, res, next) => {
  if (req.authMode === 'matrix_bridge') {
    return dispatchMatrix(req, res, () => res.status(404).json({ error: 'matrix endpoint not found' }));
  }
  next();
});
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
app.use('/api/stats', statsRouter);
app.use('/api/foreign-costing-assistant', foreignCostingAssistantRouter);
app.use('/api/crm', crmRouter);
app.use('/api/matrix', dispatchMatrix);

if (process.env.DISABLE_CRON !== '1') {
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
}

const port = Number(process.env.PORT || 80);
const host = '0.0.0.0';
app.listen(port, host, () => {
  console.log(`packaging-system-demo running on http://${host}:${port}`);
  console.log('鉴权说明: 使用 x-user-role(super_admin|ai_sales|worker), x-user-name');
});

const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { isAutomaticWorkOrderMailEnabled } = require('../src/lib/workOrderMailPolicy');

assert.strictEqual(isAutomaticWorkOrderMailEnabled({}), false);
assert.strictEqual(isAutomaticWorkOrderMailEnabled({ WORK_ORDER_AUTO_EMAIL_ENABLED: '0' }), false);
assert.strictEqual(isAutomaticWorkOrderMailEnabled({ WORK_ORDER_AUTO_EMAIL_ENABLED: 'false' }), false);
assert.strictEqual(isAutomaticWorkOrderMailEnabled({ WORK_ORDER_AUTO_EMAIL_ENABLED: ' 1 ' }), true);

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workOrders.js'), 'utf8');
const createStart = routeSource.indexOf("router.post('/', allowRoles");
const manualStart = routeSource.indexOf("router.post('/:id/send-email'", createStart);
assert(createStart >= 0 && manualStart > createStart, 'work-order create and manual-mail routes must exist');

const createRoute = routeSource.slice(createStart, manualStart);
const manualRoute = routeSource.slice(manualStart);
assert.match(createRoute, /const autoEmailEnabled = isAutomaticWorkOrderMailEnabled\(\)/);
assert.match(createRoute, /if \(autoEmailEnabled\) \{[\s\S]*sendWorkOrderEmail\(/);
assert.match(createRoute, /emailQueued: autoEmailEnabled/);
assert.match(manualRoute, /sendWorkOrderEmail\(/, 'manual send endpoint must remain available');

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('temporary service did not become healthy');
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-work-order-mail-'));
  const port = await reservePort();
  const secret = 'matrix-work-order-mail-policy-test-secret-2026';
  let sendCount = 0;

  process.env.DB_PATH = path.join(scratch, 'app.db');
  process.env.PORT = String(port);
  process.env.DISABLE_CRON = '1';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.WORK_ORDER_AUTO_EMAIL_ENABLED = '0';
  process.env.SMTP_HOST = 'mock.invalid';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_USER = 'mock@example.invalid';
  process.env.SMTP_PASS = 'test-only';
  process.env.SMTP_FROM = 'mock@example.invalid';

  const nodemailer = require('nodemailer');
  nodemailer.createTransport = () => ({
    async sendMail() {
      sendCount += 1;
      return { accepted: ['receiver@example.invalid'], rejected: [] };
    }
  });

  const originalLog = console.log;
  console.log = (...args) => {
    if (!String(args[0] || '').startsWith('[db]')) originalLog(...args);
  };
  require('../src/server');
  console.log = originalLog;

  const { db } = require('../src/db');
  const admin = db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const salesperson = db.prepare('SELECT id FROM salespersons ORDER BY id LIMIT 1').get();
  assert(admin?.id && salesperson?.id, 'temporary database must contain seeded identities');

  const token = jwt.sign({ sub: String(admin.id), role: 'super_admin', userName: 'admin' }, secret, { expiresIn: '5m' });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  const createResponse = await fetch(`${baseUrl}/api/work-orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salespersonId: salesperson.id,
      customerName: '隔离测试',
      productName: '邮件策略',
      bagType: '三边封',
      spec: '10*20',
      quantity: '1000',
      roller: 'TEST-01',
      processRequirements: {
        printMold: 'PET',
        printFilmSize: '30*8c',
        printFilmQty: 100,
        printFilmUnit: '米'
      }
    })
  });
  const created = await createResponse.json();
  assert.strictEqual(createResponse.status, 200, JSON.stringify(created));
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.emailQueued, false);
  assert.strictEqual(created.emailStatus, 'pending');
  assert.strictEqual(sendCount, 0, 'creating a work order must not send email when automatic mail is disabled');

  const manualResponse = await fetch(`${baseUrl}/api/work-orders/${created.id}/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'receiver@example.invalid', cc: '' })
  });
  const manual = await manualResponse.json();
  assert.strictEqual(manualResponse.status, 200, JSON.stringify(manual));
  assert.strictEqual(manual.ok, true);
  assert.strictEqual(sendCount, 1, 'manual work-order mail must remain available');

  db.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  originalLog('work-order mail policy tests passed');
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});

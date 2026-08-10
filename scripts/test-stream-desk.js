const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStreamDeskStore, inspectOwnedPage } = require('../src/services/streamDeskStore');
const { createWechatDraftAdapter } = require('../src/services/wechatDraftAdapter');
const { createStreamMedia } = require('../src/services/streamMedia');
const Jimp = require('jimp');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-desk-'));
  const store = openStreamDeskStore(path.join(dir, 'stream.db'));
  const imported = store.importSource({
    sourceUrl: 'https://gdhspack.com/products/stand-up-zipper-pouches',
    title: 'Custom Stand Up Zipper Pouches',
    summary: 'A practical purchasing guide covering pouch structure, printed samples and validation decisions.',
    imageUrl: 'https://gdhspack.com/media/sample.webp',
    platforms: ['linkedin', 'wechat', 'invalid'],
    recommendedAt: '2026-08-11 09:30:00',
  }, 'tester');
  assert.equal(imported.created, 2);
  assert.equal(store.listTasks().length, 2);
  assert.throws(() => store.recordAction(1, 'published', 'tester', ''), /公开 URL/);
  const published = store.recordAction(1, 'published', 'tester', 'https://www.linkedin.com/posts/example');
  assert.equal(published.task.status, 'published');
  assert.equal(store.summary().counts.published, 1);
  assert.equal(store.calendar({ from: '2026-08-11', to: '2026-08-11' }).length, 2);
  store.recordMetrics(1, { impressions: 100, clicks: 8, reactions: 4, comments: 2, shares: 1, saves: 3 }, 'tester');
  assert.deepEqual(store.analytics().totals, { published: 1, impressions: 100, clicks: 8, engagement: 10 });
  await assert.rejects(() => inspectOwnedPage('https://example.com/', async () => ({})), /gdhspack/);
  const inspected = await inspectOwnedPage('https://gdhspack.com/test', async () => ({
    ok: true,
    text: async () => '<html><head><title>Packaging Test Guide</title><meta name="description" content="A sufficiently detailed packaging test guide for purchasing teams and factory validation."><meta property="og:image" content="https://gdhspack.com/test.webp"></head><body><main class="fb-container"><h2>Material checks</h2><h3>Printed sample</h3><p>This paragraph contains enough useful purchasing detail to be retained by the parser.</p></main></body></html>',
  }));
  assert.equal(inspected.title, 'Packaging Test Guide');
  assert.deepEqual(inspected.content.sections, ['Material checks']);
  const wechat = createWechatDraftAdapter({ env: {}, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(wechat.readiness().ready, false);
  await assert.rejects(() => wechat.addDraft({}), /尚未配置/);
  const rendered = wechat.renderContent({ title: '示例标题', body: '示例标题\n\n一、采购判断\n• 袋型结构\n\n阅读原文：https://gdhspack.com/test' });
  assert.match(rendered, /<h2/);
  assert.match(rendered, /阅读华胜包装完整技术页面/);
  const sample = await new Jimp(40, 60, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG);
  const media = createStreamMedia({ root: path.join(dir, 'media'), fetchImpl: async () => ({
    ok: true, url: 'https://gdhspack.com/media/sample.png', headers: new Headers({ 'content-type': 'image/png', 'content-length': String(sample.length) }),
    arrayBuffer: async () => sample,
  }) });
  const prepared = await media.prepare({ id: 2, platform: 'linkedin', media_url: 'https://gdhspack.com/media/sample.png' });
  assert.equal(fs.existsSync(prepared.file), true);
  const output = await Jimp.read(prepared.file);
  assert.deepEqual([output.bitmap.width, output.bitmap.height], [1200, 627]);
  store.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('stream desk tests passed');
}

run().catch((error) => { console.error(error); process.exit(1); });

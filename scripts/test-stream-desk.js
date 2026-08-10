const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStreamDeskStore, inspectOwnedPage } = require('../src/services/streamDeskStore');
const { createWechatDraftAdapter } = require('../src/services/wechatDraftAdapter');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-desk-'));
  const store = openStreamDeskStore(path.join(dir, 'stream.db'));
  const imported = store.importSource({
    sourceUrl: 'https://gdhspack.com/products/stand-up-zipper-pouches',
    title: 'Custom Stand Up Zipper Pouches',
    summary: 'A practical purchasing guide covering pouch structure, printed samples and validation decisions.',
    imageUrl: 'https://gdhspack.com/media/sample.webp',
    platforms: ['linkedin', 'wechat', 'invalid'],
  }, 'tester');
  assert.equal(imported.created, 2);
  assert.equal(store.listTasks().length, 2);
  assert.throws(() => store.recordAction(1, 'published', 'tester', ''), /公开 URL/);
  const published = store.recordAction(1, 'published', 'tester', 'https://www.linkedin.com/posts/example');
  assert.equal(published.task.status, 'published');
  assert.equal(store.summary().counts.published, 1);
  await assert.rejects(() => inspectOwnedPage('https://example.com/', async () => ({})), /gdhspack/);
  const inspected = await inspectOwnedPage('https://gdhspack.com/test', async () => ({
    ok: true,
    text: async () => '<html><head><title>Packaging Test Guide</title><meta name="description" content="A sufficiently detailed packaging test guide for purchasing teams and factory validation."><meta property="og:image" content="https://gdhspack.com/test.webp"></head></html>',
  }));
  assert.equal(inspected.title, 'Packaging Test Guide');
  const wechat = createWechatDraftAdapter({ env: {}, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(wechat.readiness().ready, false);
  await assert.rejects(() => wechat.addDraft({}), /尚未配置/);
  store.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('stream desk tests passed');
}

run().catch((error) => { console.error(error); process.exit(1); });

const fs = require('fs');
const path = require('path');
const { openStreamDeskStore, inspectOwnedPage } = require('../src/services/streamDeskStore');

async function run() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'stream-content-matrix.json'), 'utf8'));
  if (!Array.isArray(config.items) || config.items.length !== 30) throw new Error('内容矩阵必须恰好包含 30 个主题');
  const store = openStreamDeskStore();
  const results = [];
  for (let index = 0; index < config.items.length; index += 1) {
    const item = config.items[index];
    const date = new Date(`${config.startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    for (const language of ['en', 'zh']) {
      const prefix = language === 'zh' ? '/zh/' : '/';
      const sourceUrl = `https://gdhspack.com${prefix}${item.slug}`.replace(/\/$/, '');
      let page;
      try {
        page = await inspectOwnedPage(sourceUrl);
      } catch (error) {
        throw new Error(`${sourceUrl}: ${error.message}`);
      }
      const platforms = language === 'zh' ? config.chinesePlatforms : config.englishPlatforms;
      const platform = platforms[index % platforms.length];
      const result = store.importSource({ ...page, language, platforms: [platform], recommendedAt: `${day} ${config.dailyTimes[language]}` }, 'matrix-seed');
      results.push({ language, platform, sourceUrl, sourceId: result.sourceId });
    }
  }
  const counts = store.db.prepare('SELECT language,count(*) count FROM stream_tasks GROUP BY language ORDER BY language').all();
  console.log(JSON.stringify({ imported: results.length, counts }));
  store.db.close();
}

run().catch((error) => { console.error(error.message); process.exit(1); });

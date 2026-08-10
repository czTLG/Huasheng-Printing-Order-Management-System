const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'data', 'matrix-stream.db');

function now() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function metaValue(html, key, attribute = 'name') {
  const tags = String(html || '').match(/<meta\s+[^>]*>/gi) || [];
  const tag = tags.find((item) => new RegExp(`${attribute}=["']${key}["']`, 'i').test(item));
  const value = tag?.match(/content="([^"]*)"/i)?.[1] || tag?.match(/content='([^']*)'/i)?.[1] || '';
  return decodeEntities(value);
}

async function inspectOwnedPage(sourceUrl, fetchImpl = fetch) {
  const parsed = new URL(String(sourceUrl || '').trim());
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'gdhspack.com') throw new Error('只能读取 gdhspack.com 的 HTTPS 页面');
  const response = await fetchImpl(parsed.toString(), { headers: { 'User-Agent': 'HuashengStreamDesk/1.0' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`官网页面读取失败: HTTP ${response.status}`);
  if (response.url && new URL(response.url).hostname !== 'gdhspack.com') throw new Error('官网页面重定向到了外部域名');
  const declaredSize = Number(response.headers?.get?.('content-length') || 0);
  if (declaredSize > 2 * 1024 * 1024) throw new Error('官网页面超过读取上限');
  const html = (await response.text()).slice(0, 2 * 1024 * 1024);
  const title = metaValue(html, 'og:title', 'property') || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const summary = metaValue(html, 'description') || metaValue(html, 'og:description', 'property');
  const imageUrl = metaValue(html, 'og:image', 'property');
  if (title.length < 4 || summary.length < 10) throw new Error('页面缺少可用的标题或 SEO description');
  return { sourceUrl: parsed.toString(), title, summary, imageUrl };
}

function openStreamDeskStore(filePath = process.env.MATRIX_STREAM_DB_PATH || DEFAULT_PATH) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS stream_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      image_url TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stream_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      language TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hashtags TEXT NOT NULL DEFAULT '',
      media_url TEXT,
      target_url TEXT NOT NULL,
      destination_url TEXT NOT NULL,
      recommended_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      public_url TEXT,
      operator TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_id, platform, language),
      FOREIGN KEY(source_id) REFERENCES stream_sources(id)
    );
    CREATE TABLE IF NOT EXISTS stream_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES stream_tasks(id)
    );
    CREATE TABLE IF NOT EXISTS stream_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      reactions INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      reported_by TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES stream_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_stream_tasks_queue ON stream_tasks(status, recommended_at, id);
    CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events(task_id, id);
  `);

  const platformProfiles = {
    pinterest: { destination: 'https://www.pinterest.com/pin-builder/', cadenceDays: 2 },
    linkedin: { destination: 'https://www.linkedin.com/feed/?shareActive=true', cadenceDays: 3 },
    facebook: { destination: 'https://www.facebook.com/', cadenceDays: 3 },
    wechat: { destination: 'https://mp.weixin.qq.com/', cadenceDays: 7 },
    zhihu: { destination: 'https://zhuanlan.zhihu.com/write', cadenceDays: 5 },
    youtube: { destination: 'https://studio.youtube.com/', cadenceDays: 7 },
    medium: { destination: 'https://medium.com/new-story', cadenceDays: 7 },
    baijiahao: { destination: 'https://baijiahao.baidu.com/', cadenceDays: 6 },
    toutiao: { destination: 'https://mp.toutiao.com/', cadenceDays: 6 },
    sohu: { destination: 'https://mp.sohu.com/', cadenceDays: 7 },
    instagram: { destination: 'https://www.instagram.com/', cadenceDays: 3 },
    vk: { destination: 'https://vk.com/', cadenceDays: 7 },
  };

  function adapt(source, platform) {
    const url = `${source.source_url}${source.source_url.includes('?') ? '&' : '?'}utm_source=${platform}&utm_medium=social&utm_campaign=stream_desk`;
    const short = `${source.summary}\n\n${url}`;
    const tags = source.language === 'zh' ? '#软包装 #食品包装 #华胜包装' : '#FlexiblePackaging #FoodPackaging #HuashengPackaging';
    if (platform === 'pinterest') return { title: source.title.slice(0, 95), body: `${source.summary}\n${tags}`, hashtags: tags, targetUrl: url };
    if (platform === 'linkedin') return { title: source.title, body: `${source.title}\n\n${short}\n\n${tags}`, hashtags: tags, targetUrl: url };
    if (platform === 'wechat') return { title: source.title, body: `${source.summary}\n\n本文依据华胜包装公开技术内容整理。具体材料与工艺需按产品、设备和验证要求确认。\n\n阅读原文：${url}`, hashtags: '', targetUrl: url };
    if (['zhihu', 'baijiahao', 'toutiao', 'sohu'].includes(platform)) return { title: source.title, body: `${source.summary}\n\n采购判断应结合内容物、目标保质期、包装设备和样品验证，不应把示例结构视为唯一方案。\n\n参考资料：${url}`, hashtags: tags, targetUrl: url };
    return { title: source.title, body: `${short}\n\n${tags}`, hashtags: tags, targetUrl: url };
  }

  function importSource(input, operator) {
    const createdAt = now();
    const source = {
      source_url: String(input.sourceUrl || '').trim(),
      title: String(input.title || '').trim(),
      summary: String(input.summary || '').trim(),
      image_url: String(input.imageUrl || '').trim(),
      language: String(input.language || 'en').trim(),
    };
    if (source.summary.length >= 10 && source.summary.length < 30) {
      source.summary += source.language === 'zh'
        ? ' 本文进一步整理袋型、材料、印刷和样品验证等采购判断要点。'
        : ' This guide adds practical purchasing checks for format, materials, printing and sample validation.';
    }
    if (!/^https:\/\/gdhspack\.com\//.test(source.source_url)) throw new Error('来源必须是 gdhspack.com 的 HTTPS 页面');
    if (source.title.length < 8 || source.summary.length < 30) throw new Error('标题或摘要过短');
    const sourceId = db.prepare(`INSERT INTO stream_sources(source_url,title,summary,image_url,language,created_by,created_at)
      VALUES(@source_url,@title,@summary,@image_url,@language,@created_by,@created_at)
      ON CONFLICT(source_url) DO UPDATE SET title=excluded.title,summary=excluded.summary,image_url=excluded.image_url,language=excluded.language
      RETURNING id`).get({ ...source, created_by: operator, created_at: createdAt }).id;
    const platforms = Array.isArray(input.platforms) && input.platforms.length ? input.platforms : ['pinterest', 'linkedin', 'facebook', 'wechat', 'zhihu', 'medium'];
    const validPlatforms = platforms.filter((item) => platformProfiles[item]);
    const insert = db.prepare(`INSERT INTO stream_tasks(source_id,platform,language,title,body,hashtags,media_url,target_url,destination_url,recommended_at,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'ready',?,?)
      ON CONFLICT(source_id,platform,language) DO UPDATE SET
        title=CASE WHEN stream_tasks.status='ready' THEN excluded.title ELSE stream_tasks.title END,
        body=CASE WHEN stream_tasks.status='ready' THEN excluded.body ELSE stream_tasks.body END,
        hashtags=CASE WHEN stream_tasks.status='ready' THEN excluded.hashtags ELSE stream_tasks.hashtags END,
        media_url=CASE WHEN stream_tasks.status='ready' THEN excluded.media_url ELSE stream_tasks.media_url END,
        target_url=CASE WHEN stream_tasks.status='ready' THEN excluded.target_url ELSE stream_tasks.target_url END,
        destination_url=CASE WHEN stream_tasks.status='ready' THEN excluded.destination_url ELSE stream_tasks.destination_url END,
        recommended_at=CASE WHEN stream_tasks.status='ready' THEN excluded.recommended_at ELSE stream_tasks.recommended_at END,
        updated_at=CASE WHEN stream_tasks.status='ready' THEN excluded.updated_at ELSE stream_tasks.updated_at END`);
    validPlatforms.forEach((platform, index) => {
      const copy = adapt(source, platform);
      const schedule = String(input.recommendedAt || '').trim() || new Date(Date.now() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + ' 09:30:00';
      insert.run(sourceId, platform, source.language, copy.title, copy.body, copy.hashtags, source.image_url, copy.targetUrl, platformProfiles[platform].destination, schedule, createdAt, createdAt);
    });
    return { sourceId, created: validPlatforms.length };
  }

  function listTasks({ status = 'ready', limit = 50 } = {}) {
    return db.prepare(`SELECT t.*,s.source_url,s.summary FROM stream_tasks t JOIN stream_sources s ON s.id=t.source_id
      WHERE (?='all' OR t.status=?) ORDER BY CASE WHEN t.recommended_at<=datetime('now','localtime') THEN 0 ELSE 1 END,t.recommended_at,t.id LIMIT ?`).all(status, status, Math.min(Number(limit) || 50, 200));
  }

  function summary() {
    const counts = db.prepare('SELECT status,count(*) count FROM stream_tasks GROUP BY status').all();
    const publishedToday = db.prepare("SELECT count(*) count FROM stream_tasks WHERE status='published' AND date(published_at)=date('now','localtime')").get().count;
    const next = db.prepare("SELECT recommended_at,platform FROM stream_tasks WHERE status='ready' ORDER BY recommended_at,id LIMIT 1").get() || null;
    return { counts: Object.fromEntries(counts.map((row) => [row.status, row.count])), publishedToday, next };
  }

  function calendar({ from, to } = {}) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : new Date().toISOString().slice(0, 10);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    return db.prepare(`SELECT id,platform,title,status,recommended_at,published_at,public_url FROM stream_tasks
      WHERE date(recommended_at) BETWEEN date(?) AND date(?) ORDER BY recommended_at,id`).all(start, end);
  }

  function recordMetrics(taskId, input, operator) {
    const task = db.prepare('SELECT id FROM stream_tasks WHERE id=?').get(taskId);
    if (!task) throw new Error('任务不存在');
    const values = ['impressions', 'clicks', 'reactions', 'comments', 'shares', 'saves'].map((key) => Math.max(0, Math.floor(Number(input?.[key]) || 0)));
    const ts = now();
    db.prepare(`INSERT INTO stream_metrics(task_id,impressions,clicks,reactions,comments,shares,saves,reported_by,reported_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(taskId, ...values, operator, ts);
    return { ok: true, reportedAt: ts };
  }

  function analytics() {
    const byPlatform = db.prepare(`SELECT t.platform,count(DISTINCT CASE WHEN t.status='published' THEN t.id END) published,
      coalesce(sum(m.impressions),0) impressions,coalesce(sum(m.clicks),0) clicks,coalesce(sum(m.reactions+m.comments+m.shares+m.saves),0) engagement
      FROM stream_tasks t LEFT JOIN stream_metrics m ON m.task_id=t.id GROUP BY t.platform ORDER BY impressions DESC,t.platform`).all();
    const totals = byPlatform.reduce((acc, row) => ({
      published: acc.published + Number(row.published), impressions: acc.impressions + Number(row.impressions),
      clicks: acc.clicks + Number(row.clicks), engagement: acc.engagement + Number(row.engagement),
    }), { published: 0, impressions: 0, clicks: 0, engagement: 0 });
    return { totals, byPlatform };
  }

  function recordAction(taskId, action, operator, detail = '') {
    const allowed = new Set(['opened', 'copied', 'published', 'skipped', 'failed', 'draft_saved']);
    if (!allowed.has(action)) throw new Error('不支持的任务动作');
    const task = db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(taskId);
    if (!task) throw new Error('任务不存在');
    const ts = now();
    if (action === 'published' && !/^https?:\/\//.test(String(detail))) throw new Error('完成发布时必须填写公开 URL');
    const status = action === 'published' ? 'published' : action === 'skipped' ? 'skipped' : action === 'failed' ? 'failed' : action === 'draft_saved' ? 'draft_saved' : task.status;
    db.prepare(`UPDATE stream_tasks SET status=?,public_url=CASE WHEN ?='published' THEN ? ELSE public_url END,operator=?,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,updated_at=? WHERE id=?`)
      .run(status, action, detail, operator, action, ts, ts, taskId);
    db.prepare('INSERT INTO stream_events(task_id,action,operator,detail,created_at) VALUES(?,?,?,?,?)').run(taskId, action, operator, String(detail || ''), ts);
    return { task: db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(taskId), next: listTasks({ status: 'ready', limit: 1 })[0] || null };
  }

  return { db, platformProfiles, importSource, listTasks, summary, calendar, recordMetrics, analytics, recordAction };
}

module.exports = { openStreamDeskStore, inspectOwnedPage };

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parse } = require('node-html-parser');

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
  const fallbackStart = html.indexOf('<main class="fb-container"');
  const fallbackEnd = fallbackStart >= 0 ? html.indexOf('</main>', fallbackStart) : -1;
  const visibleHtml = fallbackStart >= 0 && fallbackEnd > fallbackStart ? html.slice(fallbackStart, fallbackEnd + 7) : html;
  const document = parse(visibleHtml);
  const contentRoot = document.querySelector('body') || document;
  const clean = (value) => decodeEntities(String(value || '').replace(/\s+/g, ' '));
  const unique = (values, limit) => [...new Set(values.map(clean).filter(Boolean))].slice(0, limit);
  const content = {
    sections: unique(contentRoot.querySelectorAll('h2').map((node) => node.textContent), 10),
    examples: unique(contentRoot.querySelectorAll('h3').map((node) => node.textContent), 12),
    paragraphs: unique(contentRoot.querySelectorAll('p').map((node) => node.textContent).filter((value) => clean(value).length >= 25 && clean(value).length <= 360), 12),
  };
  if (title.length < 4 || summary.length < 10) throw new Error('页面缺少可用的标题或 SEO description');
  return { sourceUrl: parsed.toString(), title, summary, imageUrl, content };
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
      content_json TEXT NOT NULL DEFAULT '{}',
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
      approval_status TEXT NOT NULL DEFAULT 'pending_review' CHECK(approval_status IN ('pending_review','approved','changes_requested')),
      approved_by TEXT,
      approved_at TEXT,
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
  const sourceColumns = new Set(db.prepare('PRAGMA table_info(stream_sources)').all().map((column) => column.name));
  if (!sourceColumns.has('content_json')) db.exec("ALTER TABLE stream_sources ADD COLUMN content_json TEXT NOT NULL DEFAULT '{}'");

  const taskColumns = new Set(db.prepare('PRAGMA table_info(stream_tasks)').all().map((column) => column.name));
  if (!taskColumns.has('approval_status')) db.exec("ALTER TABLE stream_tasks ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending_review' CHECK(approval_status IN ('pending_review','approved','changes_requested'))");
  if (!taskColumns.has('approved_by')) db.exec('ALTER TABLE stream_tasks ADD COLUMN approved_by TEXT');
  if (!taskColumns.has('approved_at')) db.exec('ALTER TABLE stream_tasks ADD COLUMN approved_at TEXT');

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
    if (platform === 'wechat') {
      const content = source.content || {};
      const sections = (content.sections || []).slice(0, 6);
      const examples = (content.examples || []).slice(0, 8);
      const paragraphs = (content.paragraphs || []).slice(0, 5);
      const sectionText = sections.length ? sections.map((item, index) => `${index + 1}. ${item}`).join('\n') : '1. 产品与应用场景\n2. 袋型和材料结构\n3. 印刷与样品验证';
      const exampleText = examples.length ? examples.map((item) => `• ${item}`).join('\n') : '• 袋型与装量\n• 材料与阻隔\n• 印刷、封口和使用条件';
      const evidenceText = paragraphs.length ? paragraphs.map((item) => `• ${item}`).join('\n\n') : source.summary;
      const body = `${source.title}\n\n导语\n${source.summary}\n\n一、这篇内容重点解决什么问题？\n软包装采购不能只看外观。袋型、装量、内容物特性、目标保质期、储存条件、包装设备、封口方式和图稿设计会共同影响最终方案。本文把页面中的真实样品与技术信息整理为可执行的判断顺序，帮助品牌方和采购团队在询价前减少规格遗漏。\n\n二、页面中的主要内容\n${sectionText}\n\n三、可以重点查看的样品或技术点\n${exampleText}\n\n四、从页面证据中可以得到什么？\n${evidenceText}\n\n五、采购时建议按这个顺序判断\n1. 先确认产品类型、单包净含量、尺寸和预期袋型。\n2. 再说明内容物对水汽、氧气、光线、香气和油脂迁移的敏感程度。\n3. 确认包装是手工灌装、预制袋设备还是自动卷膜设备，并提供设备方向和封口条件。\n4. 明确拉链、透明窗口、阀门、吸嘴、挂孔、哑光或局部效果等功能。\n5. 多个版本应分别列出图稿数量、颜色和每个版本的订购量。\n6. 在批量生产前，通过图稿确认、材料样品和必要的试机验证最终结构。\n\n六、询价前可准备的资料\n• 产品与装量\n• 袋型、尺寸和厚度\n• 已知材料结构或保质期目标\n• 印刷图稿与版本数量\n• 功能件和表面效果\n• 数量及包装设备信息\n\n结语\n本文依据华胜包装公开页面和实际展示内容整理。文中的材料和工艺属于采购判断参考，不代表所有产品都应采用同一结构。最终方案应结合内容物、设备条件、储存环境和样品验证确认。\n\n阅读原文：${url}`;
      return { title: source.title, body, hashtags: '', targetUrl: url };
    }
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
      content_json: JSON.stringify(input.content || {}),
      language: String(input.language || 'en').trim(),
    };
    if (source.summary.length >= 10 && source.summary.length < 30) {
      source.summary += source.language === 'zh'
        ? ' 本文进一步整理袋型、材料、印刷和样品验证等采购判断要点。'
        : ' This guide adds practical purchasing checks for format, materials, printing and sample validation.';
    }
    if (!/^https:\/\/gdhspack\.com\//.test(source.source_url)) throw new Error('来源必须是 gdhspack.com 的 HTTPS 页面');
    if (source.title.length < 8 || source.summary.length < 30) throw new Error('标题或摘要过短');
    const sourceId = db.prepare(`INSERT INTO stream_sources(source_url,title,summary,image_url,content_json,language,created_by,created_at)
      VALUES(@source_url,@title,@summary,@image_url,@content_json,@language,@created_by,@created_at)
      ON CONFLICT(source_url) DO UPDATE SET title=excluded.title,summary=excluded.summary,image_url=excluded.image_url,content_json=excluded.content_json,language=excluded.language
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
        approval_status=CASE WHEN stream_tasks.status='ready' THEN 'pending_review' ELSE stream_tasks.approval_status END,
        approved_by=CASE WHEN stream_tasks.status='ready' THEN NULL ELSE stream_tasks.approved_by END,
        approved_at=CASE WHEN stream_tasks.status='ready' THEN NULL ELSE stream_tasks.approved_at END,
        updated_at=CASE WHEN stream_tasks.status='ready' THEN excluded.updated_at ELSE stream_tasks.updated_at END`);
    validPlatforms.forEach((platform, index) => {
      const copy = adapt({ ...source, content: input.content || {} }, platform);
      const schedule = String(input.recommendedAt || '').trim() || new Date(Date.now() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + ' 09:30:00';
      insert.run(sourceId, platform, source.language, copy.title, copy.body, copy.hashtags, source.image_url, copy.targetUrl, platformProfiles[platform].destination, schedule, createdAt, createdAt);
    });
    return { sourceId, created: validPlatforms.length };
  }

  function listTasks({ status = 'ready', platform = 'all', approvalStatus = 'all', limit = 50 } = {}) {
    return db.prepare(`SELECT t.*,s.source_url,s.summary FROM stream_tasks t JOIN stream_sources s ON s.id=t.source_id
      WHERE (?='all' OR t.status=?) AND (?='all' OR t.platform=?) AND (?='all' OR t.approval_status=?)
      ORDER BY CASE WHEN t.recommended_at<=datetime('now','localtime') THEN 0 ELSE 1 END,t.recommended_at,t.id LIMIT ?`)
      .all(status, status, platform, platform, approvalStatus, approvalStatus, Math.min(Number(limit) || 50, 200));
  }

  function summary() {
    const counts = db.prepare('SELECT status,count(*) count FROM stream_tasks GROUP BY status').all();
    const publishedToday = db.prepare("SELECT count(*) count FROM stream_tasks WHERE status='published' AND date(published_at)=date('now','localtime')").get().count;
    const next = db.prepare("SELECT recommended_at,platform FROM stream_tasks WHERE status='ready' ORDER BY recommended_at,id LIMIT 1").get() || null;
    return { counts: Object.fromEntries(counts.map((row) => [row.status, row.count])), publishedToday, next };
  }

  function calendar({ from, to, platform = 'all' } = {}) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : new Date().toISOString().slice(0, 10);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    return db.prepare(`SELECT id,platform,title,status,recommended_at,published_at,public_url FROM stream_tasks
      WHERE date(recommended_at) BETWEEN date(?) AND date(?) AND (?='all' OR platform=?) ORDER BY recommended_at,id`).all(start, end, platform, platform);
  }

  function dailyDrafts({ date, platform = 'all' } = {}) {
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : now().slice(0, 10);
    const rows = db.prepare(`SELECT t.id,t.platform,t.language,t.title,t.body,t.hashtags,t.media_url,t.target_url,t.recommended_at,t.approval_status,s.source_url
      FROM stream_tasks t JOIN stream_sources s ON s.id=t.source_id
      WHERE date(t.recommended_at)=date(?) AND (?='all' OR t.platform=?)
      ORDER BY t.recommended_at,t.id`).all(selectedDate, platform, platform);
    return {
      contract_version: 1,
      date: selectedDate,
      timezone: 'Asia/Shanghai',
      platform,
      drafts: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        language: row.language,
        approval_status: row.approval_status,
        scheduled_for: row.recommended_at,
        content: { title: row.title, body: row.body, hashtags: row.hashtags },
        assets: row.media_url ? [{ type: 'image', source_url: row.media_url }] : [],
        source_url: row.source_url,
        target_url: row.target_url,
        delivery: { mode: 'draft_only', enabled: false }
      }))
    };
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

  function recordApproval(taskId, approvalStatus, operator, detail = '') {
    const allowed = new Set(['pending_review', 'approved', 'changes_requested']);
    if (!allowed.has(approvalStatus)) throw new Error('不支持的审批状态');
    const task = db.prepare('SELECT id FROM stream_tasks WHERE id=?').get(taskId);
    if (!task) throw new Error('任务不存在');
    const ts = now();
    db.prepare('UPDATE stream_tasks SET approval_status=?,approved_by=?,approved_at=?,updated_at=? WHERE id=?')
      .run(approvalStatus, approvalStatus === 'approved' ? operator : null, approvalStatus === 'approved' ? ts : null, ts, taskId);
    db.prepare('INSERT INTO stream_events(task_id,action,operator,detail,created_at) VALUES(?,?,?,?,?)')
      .run(taskId, 'approval_updated', operator, JSON.stringify({ approval_status: approvalStatus, detail: String(detail || '').slice(0, 500) }), ts);
    return { task: db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(taskId) };
  }

  function recordAction(taskId, action, operator, detail = '') {
    const allowed = new Set(['opened', 'copied', 'published', 'skipped', 'failed', 'draft_saved']);
    if (!allowed.has(action)) throw new Error('不支持的任务动作');
    const task = db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(taskId);
    if (!task) throw new Error('任务不存在');
    const ts = now();
    if (action === 'published' && task.approval_status !== 'approved') throw new Error('发布前必须完成审批');
    if (action === 'published' && !/^https?:\/\//.test(String(detail))) throw new Error('完成发布时必须填写公开 URL');
    const status = action === 'published' ? 'published' : action === 'skipped' ? 'skipped' : action === 'failed' ? 'failed' : action === 'draft_saved' ? 'draft_saved' : task.status;
    db.prepare(`UPDATE stream_tasks SET status=?,public_url=CASE WHEN ?='published' THEN ? ELSE public_url END,operator=?,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,updated_at=? WHERE id=?`)
      .run(status, action, detail, operator, action, ts, ts, taskId);
    db.prepare('INSERT INTO stream_events(task_id,action,operator,detail,created_at) VALUES(?,?,?,?,?)').run(taskId, action, operator, String(detail || ''), ts);
    return { task: db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(taskId), next: listTasks({ status: 'ready', platform: task.platform, limit: 1 })[0] || null };
  }

  return { db, platformProfiles, importSource, listTasks, summary, calendar, dailyDrafts, recordMetrics, analytics, recordApproval, recordAction };
}

module.exports = { openStreamDeskStore, inspectOwnedPage };

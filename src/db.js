const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

function initDb() {
  db.exec(`
    
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      approved_at TEXT,
      full_name TEXT,
      permissions_json TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      bag_type TEXT NOT NULL,
      use_case TEXT,
      size_json TEXT,
      order_qty TEXT,
      order_spec TEXT,
      status TEXT NOT NULL DEFAULT '印刷',
      urgency INTEGER NOT NULL DEFAULT 0,
      assigned_print_worker TEXT,
      assigned_lamination_worker TEXT,
      assigned_bagging_worker TEXT,
      assigned_shipping_worker TEXT,
      legacy_openid TEXT,
      legacy_order_state TEXT,
      legacy_source_key TEXT,
      legacy_json TEXT,
      created_by TEXT NOT NULL,
      start_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      quote_type TEXT NOT NULL,
      internal_json TEXT NOT NULL,
      customer_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      customer_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      bag_type TEXT,
      specs_json TEXT,
      input_json TEXT,
      calc_json TEXT,
      quantity INTEGER,
      unit_price REAL,
      amount REAL,
      cost REAL,
      profit_rate REAL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS material_prices (
      code TEXT PRIMARY KEY,
      prop REAL,
      price REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      cost_type TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS salespersons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      name TEXT NOT NULL,
      contact TEXT,
      phone TEXT,
      default_bag_type TEXT,
      default_spec TEXT,
      default_use_case TEXT,
      default_roller TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(salesperson_id, name)
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_no TEXT NOT NULL UNIQUE,
      salesperson_id INTEGER,
      customer_id INTEGER,
      salesperson_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      bag_type TEXT NOT NULL,
      spec TEXT NOT NULL,
      quantity TEXT NOT NULL,
      delivery_date TEXT,
      roller TEXT,
      remark TEXT,
      process_requirements_json TEXT,
      version_no INTEGER NOT NULL DEFAULT 1,
      parent_work_order_id INTEGER,
      order_id INTEGER,
      sync_to_order INTEGER NOT NULL DEFAULT 0,
      email_to TEXT,
      email_cc TEXT,
      email_status TEXT,
      email_error TEXT,
      export_excel_path TEXT,
      export_pdf_path TEXT,
      order_image_url TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      customer_id INTEGER,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_preview_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      salesperson_name TEXT,
      customer_name TEXT,
      product_name TEXT,
      bag_type TEXT,
      spec TEXT,
      quantity TEXT,
      roller TEXT,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      cost_type TEXT NOT NULL,
      to_list TEXT,
      cc_list TEXT,
      status TEXT NOT NULL,
      error TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_stage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      source TEXT NOT NULL,
      qty REAL,
      unit TEXT,
      operated_by TEXT,
      role TEXT,
      event_type TEXT NOT NULL DEFAULT 'COMPLETE',
      rolled_back INTEGER NOT NULL DEFAULT 0,
      rollback_of_log_id INTEGER,
      rollback_reason TEXT,
      extra_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(order_id, user_name)
    );

    CREATE TABLE IF NOT EXISTS stock_screen_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      board TEXT,
      pct REAL,
      turnover REAL,
      volume_ratio REAL,
      market_cap REAL,
      score REAL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      source TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_watchlist_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      close REAL,
      pct REAL,
      ma5 REAL,
      ma10 REAL,
      ma20 REAL,
      ma60 REAL,
      vol_ratio REAL,
      buy_index REAL,
      trend TEXT,
      signal TEXT,
      risk TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(trade_date, code)
    );
  `);

  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes('priority')) {
    db.exec("ALTER TABLE orders ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  }

  const ocols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!ocols.includes('assigned_shipping_worker')) db.exec("ALTER TABLE orders ADD COLUMN assigned_shipping_worker TEXT");
  if (!ocols.includes('order_qty')) db.exec("ALTER TABLE orders ADD COLUMN order_qty TEXT");
  if (!ocols.includes('order_spec')) db.exec("ALTER TABLE orders ADD COLUMN order_spec TEXT");
  if (!ocols.includes('legacy_openid')) db.exec("ALTER TABLE orders ADD COLUMN legacy_openid TEXT");
  if (!ocols.includes('legacy_order_state')) db.exec("ALTER TABLE orders ADD COLUMN legacy_order_state TEXT");
  if (!ocols.includes('legacy_source_key')) db.exec("ALTER TABLE orders ADD COLUMN legacy_source_key TEXT");
  if (!ocols.includes('legacy_json')) db.exec("ALTER TABLE orders ADD COLUMN legacy_json TEXT");
  if (!ocols.includes('start_time')) db.exec("ALTER TABLE orders ADD COLUMN start_time TEXT");
  if (!ocols.includes('order_image_url')) db.exec("ALTER TABLE orders ADD COLUMN order_image_url TEXT");
  if (!ocols.includes('order_image_thumb_url')) db.exec("ALTER TABLE orders ADD COLUMN order_image_thumb_url TEXT");
  if (!ocols.includes('order_image_uploaded_by')) db.exec("ALTER TABLE orders ADD COLUMN order_image_uploaded_by TEXT");
  if (!ocols.includes('processing_started_at')) db.exec("ALTER TABLE orders ADD COLUMN processing_started_at TEXT");
  if (!ocols.includes('processing_stage')) db.exec("ALTER TABLE orders ADD COLUMN processing_stage TEXT");
  db.exec("UPDATE orders SET start_time = COALESCE(start_time, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_legacy_source_key ON orders(legacy_source_key)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_start_time ON orders(start_time)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_processing ON orders(status, processing_started_at)");

  const ucols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!ucols.includes('full_name')) db.exec("ALTER TABLE users ADD COLUMN full_name TEXT");
  if (!ucols.includes('permissions_json')) db.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT");

  const mpcols = db.prepare("PRAGMA table_info(material_prices)").all().map(c => c.name);
  if (!mpcols.includes('prop')) db.exec("ALTER TABLE material_prices ADD COLUMN prop REAL");

  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_snapshots_user_kind ON cost_snapshots(user_name, kind, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_salesperson ON customers(salesperson_id, active, name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_salesperson ON work_orders(salesperson_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_order_id ON work_orders(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_email_logs_user ON cost_email_logs(user_name, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_order ON order_stage_logs(order_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_stage ON order_stage_logs(stage, source, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_subscriptions_user ON order_subscriptions(user_name, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_subscriptions_order ON order_subscriptions(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_screen_date ON stock_screen_results(trade_date, score DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_watchlist_active ON stock_watchlist(active, pinned DESC, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_watchlist_analysis_day ON stock_watchlist_analysis(trade_date, signal DESC)");
  const scols = db.prepare("PRAGMA table_info(stock_screen_results)").all().map(c => c.name);
  if (!scols.includes('board')) db.exec("ALTER TABLE stock_screen_results ADD COLUMN board TEXT");
  const swcols = db.prepare("PRAGMA table_info(stock_watchlist)").all().map(c => c.name);
  if (!swcols.includes('pinned')) db.exec("ALTER TABLE stock_watchlist ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  const sacols = db.prepare("PRAGMA table_info(stock_watchlist_analysis)").all().map(c => c.name);
  if (!sacols.includes('buy_index')) db.exec("ALTER TABLE stock_watchlist_analysis ADD COLUMN buy_index REAL");
  const mcols = db.prepare("PRAGMA table_info(menu_items)").all().map(c => c.name);
  if (!mcols.includes('disabled')) db.exec("ALTER TABLE menu_items ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS idx_menu_items_creator ON menu_items(created_by, type, updated_at DESC)");
  const wcols = db.prepare("PRAGMA table_info(work_orders)").all().map(c => c.name);
  if (!wcols.includes('order_image_url')) db.exec("ALTER TABLE work_orders ADD COLUMN order_image_url TEXT");

  const qcols = db.prepare("PRAGMA table_info(quote_sheets)").all().map(c => c.name);
  if (!qcols.includes('input_json')) db.exec("ALTER TABLE quote_sheets ADD COLUMN input_json TEXT");
  if (!qcols.includes('calc_json')) db.exec("ALTER TABLE quote_sheets ADD COLUMN calc_json TEXT");

  const slcols = db.prepare("PRAGMA table_info(order_stage_logs)").all().map(c => c.name);
  if (!slcols.includes('event_type')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'COMPLETE'");
  if (!slcols.includes('rolled_back')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rolled_back INTEGER NOT NULL DEFAULT 0");
  if (!slcols.includes('rollback_of_log_id')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rollback_of_log_id INTEGER");
  if (!slcols.includes('rollback_reason')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rollback_reason TEXT");
  if (!slcols.includes('extra_json')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN extra_json TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_event ON order_stage_logs(order_id, stage, event_type, rolled_back, id DESC)");

  const admin = db.prepare("SELECT id FROM users WHERE username = ?").get('admin');
  if (!admin) {
    db.prepare("INSERT INTO users (username, password, role, status, created_at, approved_at) VALUES (?, ?, 'super_admin', 'active', ?, ?)")
      .run('admin', 'admin', now(), now());
  }

  const spUpsert = db.prepare(`
    INSERT INTO salespersons (name, code, active, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at
  `);
  const salesUsers = db.prepare("SELECT username FROM users WHERE role IN ('super_admin','manager','ai_sales')").all();
  const tsSales = now();
  salesUsers.forEach((u, idx) => {
    const code = `YW${String(idx + 1).padStart(2, '0')}`;
    spUpsert.run(u.username, code, tsSales, tsSales);
  });

  const defaults = {
    PET: { prop: 1.38, price: 9800 },
    BOPP: { prop: 0.91, price: 9200 },
    CPP: { prop: 0.90, price: 9300 },
    PE: { prop: 0.92, price: 9000 },
    NY: { prop: 1.14, price: 12500 },
    AL: { prop: 2.70, price: 18000 },
    MOPP: { prop: 0.90, price: 11000 },
    VMCPP: { prop: 1.05, price: 13500 },
    VMPET: { prop: 1.40, price: 14000 },
    '纸': { prop: 0.80, price: 7600 }
  };
  const upsert = db.prepare(`
    INSERT INTO material_prices (code, prop, price, updated_by, updated_at)
    VALUES (?, ?, ?, 'system', ?)
    ON CONFLICT(code) DO UPDATE SET
      prop = COALESCE(material_prices.prop, excluded.prop),
      price = COALESCE(material_prices.price, excluded.price)
  `);
  const ts = now();
  Object.entries(defaults).forEach(([code, cfg]) => upsert.run(code, cfg.prop, cfg.price, ts));

  const menuCount = db.prepare('SELECT count(*) AS c FROM menu_items').get().c;
  if (!menuCount) {
    const insMenu = db.prepare('INSERT INTO menu_items (name, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const dishes = [
      ['卤鹅拼盘','肉菜'],['蚝烙','肉菜'],['潮汕牛肉丸','肉菜'],['普宁豆腐','菜'],['菜脯煎蛋','菜'],
      ['炒芥蓝','菜'],['蒜蓉空心菜','菜'],['苦瓜炒蛋','菜'],['潮汕咸菜炒肉末','肉菜'],['萝卜干炒饭豆','菜'],
      ['老菜脯排骨汤','汤'],['紫菜肉丸汤','汤'],['冬瓜薏米排骨汤','汤'],['咸菜豆腐汤','汤'],['苦瓜黄豆汤','汤']
    ];
    const t = now();
    dishes.forEach(([name, type]) => insMenu.run(name, type, 'system', t, t));
  }
}

function now() {
  // 全系统统一使用北京时间（Asia/Shanghai）字符串
  // 形如：2026-02-28 18:30:00
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function audit({ role, userName, action, resourceType, resourceId = '', detail = '' }) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(role, userName, action, resourceType, String(resourceId), detail, now());
}

module.exports = { db, initDb, now, audit };

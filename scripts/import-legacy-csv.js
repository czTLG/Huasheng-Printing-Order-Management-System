const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, initDb } = require('../src/db');

initDb();

const csvPath = process.argv[2] || '/home/admin/work/database_export-HzNvAC3ODFKm.csv';
if (!fs.existsSync(csvPath)) {
  console.error('CSV not found:', csvPath);
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let cur = '';
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      row.push(cur); cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function mapBagType(shape, name) {
  const s = `${shape || ''} ${name || ''}`;
  if (s.includes('八边')) return '八边封袋';
  if (s.includes('异形')) return '异形袋';
  if (s.includes('背封') || s.includes('三边封')) return '背封袋';
  if (s.includes('自立')) return '自立袋';
  return '自立袋';
}

function mapStatus(r) {
  const os = String(r.order_state || '').trim();
  if (os === '5') return '完成';
  if (String(r.sent_time || '').trim()) return '完成';
  if (String(r.bag_made_time || '').trim()) return '发货';
  if (String(r.recombination_time || '').trim()) return '制袋';
  if (String(r.printed_time || '').trim()) return '复膜';
  return '印刷';
}

function ts(v, fallback = new Date().toISOString()) {
  const x = String(v || '').trim();
  if (!x) return fallback;
  return x.replace(' ', 'T');
}

const raw = fs.readFileSync(csvPath, 'utf8');
const rows = parseCsv(raw);
const header = rows[0].map(h => h.replace(/^\uFEFF/, ''));
const dataRows = rows.slice(1);

const get = (arr, key) => {
  const idx = header.indexOf(key);
  return idx >= 0 ? (arr[idx] || '') : '';
};

const existsStmt = db.prepare('SELECT id FROM orders WHERE legacy_source_key = ? LIMIT 1');
const insertStmt = db.prepare(`
INSERT INTO orders (
  customer_name, bag_type, use_case, size_json, order_qty, order_spec,
  status, urgency, priority,
  assigned_print_worker, assigned_lamination_worker, assigned_bagging_worker, assigned_shipping_worker,
  legacy_openid, legacy_order_state, legacy_source_key, legacy_json,
  created_by, created_at, updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let inserted = 0, skipped = 0;
for (const arr of dataRows) {
  const rowObj = Object.fromEntries(header.map((k, i) => [k, arr[i] || '']));
  const sourceKey = crypto.createHash('sha1').update(JSON.stringify(rowObj)).digest('hex');
  if (existsStmt.get(sourceKey)) { skipped++; continue; }

  const name = get(arr, 'name').trim() || '历史导入客户';
  const bagType = mapBagType(get(arr, 'shape'), name);
  const qty = get(arr, 'number').trim();
  const spec = get(arr, 'size').trim();
  const status = mapStatus(rowObj);
  const quick = String(get(arr, 'quick')).trim().toLowerCase();
  const urgency = (quick === 'true' || quick === '1') ? 1 : 0;
  const priority = urgency ? 100 : 0;

  const parts = [
    get(arr, 'comment') ? `备注:${get(arr, 'comment').trim()}` : '',
    get(arr, 'order_info') ? get(arr, 'order_info').trim() : '',
    get(arr, 'roller') ? `滚筒:${get(arr, 'roller').trim()}` : '',
    get(arr, 'fumo') ? `复膜:${get(arr, 'fumo').trim()}` : '',
    get(arr, 'zhidai') ? `制袋:${get(arr, 'zhidai').trim()}` : '',
    qty ? `数量:${qty}` : '',
    spec ? `规格:${spec}` : ''
  ].filter(Boolean);

  const createdAt = ts(get(arr, 'start_time') || get(arr, 'printed_time') || get(arr, 'recombination_time'));
  const updatedAt = ts(get(arr, 'sent_time') || get(arr, 'bag_made_time') || get(arr, 'recombination_time') || get(arr, 'printed_time'), createdAt);

  insertStmt.run(
    name,
    bagType,
    parts.join('；'),
    JSON.stringify({ legacy: true }),
    qty,
    spec,
    status,
    urgency,
    priority,
    get(arr, 'printed_person').trim(),
    get(arr, 'recombination_person').trim(),
    get(arr, 'bag_made_person').trim(),
    get(arr, 'sent_person').trim(),
    get(arr, '_openid').trim(),
    get(arr, 'order_state').trim(),
    sourceKey,
    JSON.stringify(rowObj),
    'legacy_import',
    createdAt,
    updatedAt
  );
  inserted++;
}

console.log(`Import done. inserted=${inserted}, skipped=${skipped}, total=${dataRows.length}`);

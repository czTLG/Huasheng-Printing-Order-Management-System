#!/usr/bin/env node
'use strict';

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = '/refs/cache-index.db';
const [command, userName = 'chenyongjie', idArg] = process.argv.slice(2);
const normalizedUser = String(userName).trim().toLowerCase();

if (!['latest', 'get', 'materials', 'material'].includes(command)) {
  console.error('Usage: cache-index.js <latest USER|get USER ID|materials|material CODE>');
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

if (command === 'materials') {
  const rows = db.prepare(`
    SELECT code, prop AS density_g_cm3, price AS price_yuan_kg,
           updated_by, updated_at
    FROM material_prices
    ORDER BY code
  `).all();
  console.log(JSON.stringify({ status: 'ok', materials: rows }, null, 2));
  process.exit(0);
}

if (command === 'material') {
  const aliases = {
    ALOX: '氧化铝',
    ALUMINUM_OXIDE: '氧化铝',
    MATTE_BOPP: 'MBOPP'
  };
  const requested = String(userName || '').trim();
  const lookup = aliases[requested.toUpperCase()] || requested;
  const row = db.prepare(`
    SELECT code, prop AS density_g_cm3, price AS price_yuan_kg,
           updated_by, updated_at
    FROM material_prices
    WHERE lower(code) = lower(?)
    LIMIT 1
  `).get(lookup);
  if (!row) {
    console.error(JSON.stringify({ status: 'not_found', material: requested }));
    process.exit(3);
  }
  console.log(JSON.stringify({ status: 'ok', material: row }, null, 2));
  process.exit(0);
}

let row;
if (command === 'latest') {
  row = db.prepare(`
    SELECT id, user_name, cost_type, name, input_json, result_json, created_at, updated_at
    FROM cost_snapshots
    WHERE lower(user_name) = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(normalizedUser);
} else {
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('A positive snapshot ID is required');
    process.exit(2);
  }
  row = db.prepare(`
    SELECT id, user_name, cost_type, name, input_json, result_json, created_at, updated_at
    FROM cost_snapshots
    WHERE lower(user_name) = ? AND id = ?
    LIMIT 1
  `).get(normalizedUser, id);
}

if (!row) {
  console.error(JSON.stringify({ status: 'not_found', user_name: normalizedUser }));
  process.exit(3);
}

const input = JSON.parse(row.input_json || '{}');
const result = JSON.parse(row.result_json || '{}');
console.log(JSON.stringify({
  status: 'ok',
  snapshot: {
    id: row.id,
    user_name: row.user_name,
    cost_type: row.cost_type,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    input,
    result
  }
}, null, 2));

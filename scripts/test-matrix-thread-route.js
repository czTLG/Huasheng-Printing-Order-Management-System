'use strict';

const assert = require('node:assert');
const Database = require('better-sqlite3');
const { createMatrixThreadRoute } = require('../src/services/matrixThreadRoute');

const NOW = '2026-07-19T15:00:00.000Z';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, status TEXT, permissions_json TEXT);
    CREATE TABLE matrix_actor_bindings (id INTEGER PRIMARY KEY, feishu_open_id TEXT, user_id INTEGER, status TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, company_name TEXT, active INTEGER, is_invalid INTEGER, stage TEXT, email TEXT);
    CREATE TABLE inquiries (id INTEGER PRIMARY KEY, customer_id INTEGER, inquiry_title TEXT, status TEXT, next_action TEXT, updated_at TEXT);
    CREATE TABLE crm_messages (id INTEGER PRIMARY KEY, source_type TEXT, source_message_id TEXT, thread_id TEXT, customer_id INTEGER, inquiry_id INTEGER, direction TEXT, sender_contact TEXT, receiver_contact TEXT, received_at TEXT);
    CREATE TABLE email_messages (id INTEGER PRIMARY KEY, message_id TEXT, thread_id TEXT, in_reply_to TEXT, references_header TEXT, from_email TEXT, to_emails TEXT, direction TEXT, sent_at TEXT, received_at TEXT);
    CREATE TABLE crm_reply_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, inquiry_id INTEGER, source_message_id INTEGER, source_type TEXT, reply_channel TEXT, recipient_contact TEXT, email_subject TEXT, draft_text_en TEXT, draft_text_cn TEXT, status TEXT, referenced_attachment_ids_json TEXT, created_by TEXT, updated_by TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE matrix_thread_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, inquiry_id INTEGER NOT NULL, crm_draft_id INTEGER NOT NULL, source_crm_message_id INTEGER NOT NULL, source_email_message_id INTEGER NOT NULL, chat_id TEXT NOT NULL, thread_id TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL, recipient_email TEXT NOT NULL, subject TEXT NOT NULL, body_en TEXT NOT NULL, body_cn TEXT NOT NULL, in_reply_to TEXT NOT NULL, references_header TEXT NOT NULL DEFAULT '', attachment_manifest_json TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL, status TEXT NOT NULL, approved_by INTEGER, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(customer_id,inquiry_id,revision));
    CREATE TABLE matrix_thread_events (id INTEGER PRIMARY KEY AUTOINCREMENT, route_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, action TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, content_hash TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO users VALUES (1,'foreign_trade_crm_admin','active',?)").run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } }));
  db.prepare("INSERT INTO matrix_actor_bindings VALUES (7,'ou-owner',1,'active')").run();
  db.prepare("INSERT INTO customers VALUES (10,'Acepac','Acepac International',1,0,'active','buyer@example.sg')").run();
  db.prepare("INSERT INTO inquiries VALUES (20,10,'RFQ26.J055','quote_pending','technical clarification',?)").run(NOW);
  db.prepare("INSERT INTO email_messages VALUES (64,'<inbound@example.sg>','thread-rfq','', '<root@example.sg>', 'buyer@example.sg','sales@sender.test','inbound',NULL,?)").run(NOW);
  db.prepare("INSERT INTO crm_messages VALUES (263,'email','64','thread-rfq',10,20,'inbound','buyer@example.sg','sales@sender.test',?)").run(NOW);
  db.prepare(`INSERT INTO crm_reply_drafts (customer_id,inquiry_id,source_message_id,source_type,reply_channel,recipient_contact,email_subject,draft_text_en,draft_text_cn,status,referenced_attachment_ids_json,created_at,updated_at) VALUES (10,20,263,'email','email','buyer@example.sg','Clarification Required for RFQ26.J055 Material Structure','Approved body','已批准正文','draft','[99]',?,?)`).run(NOW,NOW);
  return db;
}

{
  const db = fixture();
  const route = createMatrixThreadRoute({ db, clock: () => new Date(NOW) });
  const prepared = route.prepare({ actorUserId: 1, bindingId: 7, customerId: 10, chatId: 'chat-build', threadId: 'thread-feishu', idempotencyKey: 'thread-prepare-1' });
  assert.strictEqual(prepared.route, 'existing_relationship');
  assert.strictEqual(prepared.recipient_email, 'buyer@example.sg');
  assert.strictEqual(prepared.status, 'draft');
  assert.deepStrictEqual(prepared.attachment_manifest, [], 'inbound/reference attachments must not become outbound attachments');
  assert.match(prepared.content_hash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(route.prepare({ actorUserId: 1, bindingId: 7, customerId: 10, chatId: 'chat-build', threadId: 'thread-feishu', idempotencyKey: 'thread-prepare-1' }), prepared);
  const approved = route.approve({ actorUserId: 1, bindingId: 7, routeId: prepared.id, expectedContentHash: prepared.content_hash, expectedRevision: 1, idempotencyKey: 'thread-approve-1' });
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(route.preview({ actorUserId: 1, bindingId: 7, routeId: prepared.id }).status, 'approved');
  db.close();
}

{
  const db = fixture();
  db.prepare("UPDATE crm_messages SET direction='outbound' WHERE id=263").run();
  const route = createMatrixThreadRoute({ db, clock: () => new Date(NOW) });
  assert.throws(() => route.prepare({ actorUserId: 1, bindingId: 7, customerId: 10, chatId: 'chat-build', threadId: '', idempotencyKey: 'thread-prepare-2' }), /one authoritative inbound email required/);
  db.close();
}

console.log('matrix thread route tests passed');

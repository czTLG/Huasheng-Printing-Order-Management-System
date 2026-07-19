'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-thread-reconcile-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb, now } = require('../src/db');
const { reconcileThread } = require('../src/services/matrixThreadReconcile');

try {
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  for (const [id, direction] of [[11, 'inbound'], [12, 'outbound'], [13, 'inbound']]) {
    db.prepare(`
      INSERT INTO email_messages (
        id, mailbox, folder, message_uid, message_id, from_email, to_emails, subject,
        cleaned_text, received_at, direction, processing_status, normalized_subject,
        contact_email, email_domain, created_at, updated_at
      ) VALUES (?, 'sales@example.test', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 'buyer.sg', ?, ?)
    `).run(
      id, direction === 'outbound' ? 'Sent' : 'INBOX', `uid-${id}`, `<${id}@example.test>`,
      direction === 'outbound' ? 'sales@example.test' : 'buyer@buyer.sg',
      direction === 'outbound' ? 'buyer@buyer.sg' : 'sales@example.test',
      direction === 'outbound' ? 'Re: RFQ-X' : 'RFQ-X', direction === 'outbound' ? 'Please send photos.' : 'Please quote.',
      `2026-07-${id === 11 ? '10' : id === 12 ? '11' : '12'}T00:00:00.000Z`, direction,
      'rfq-x', 'buyer@buyer.sg', now(), now()
    );
  }

  const input = {
    email_message_ids: [11, 12, 13],
    customer: {
      company_name: 'Example Buyer Pte Ltd', contact_person: 'Buyer Name', email: 'buyer@buyer.sg',
      country: 'Singapore', website: 'https://buyer.sg', priority: 'B', source_channel: 'email'
    },
    inquiry: {
      inquiry_code: 'RFQ-X', inquiry_title: 'RFQ-X - laminated pouch', product_type: 'Laminated pouch',
      packaging_type: 'Pouch', quantity: '4 SKUs x 10,000 pcs', destination_country: 'United Kingdom',
      trade_term_requested: 'FOB', priority: 'B', status: 'quote_pending', costing_required: 1,
      next_action: 'Internal costing and review'
    },
    specification: {
      product_type: 'Laminated pouch', bag_type: 'Pouch', size_width: '320 mm', size_height: '320 mm',
      gusset_size: '80 mm', thickness_total: '157', thickness_unit: 'micron',
      material_structure_text: '25 matte PE / 18 MET BOPP / 114 white PE', zipper_required: 1,
      tear_notch_required: 1, printing_colors: '4 SKUs, digital print', notes: 'Food contact'
    },
    research: {
      title: 'Official source verification', research_summary: 'Singapore-based organization verified from official sources.',
      customer_type: 'Packaging solution provider', industry: 'Packaging', main_products: 'Flexible packaging',
      website: 'https://buyer.sg', country: 'Singapore', suggested_priority: 'B',
      suggested_next_action: 'Complete internal quote', sources: [{ url: 'https://buyer.sg/about', type: 'official' }]
    }
  };

  const first = reconcileThread(db, input);
  const second = reconcileThread(db, input);
  assert.strictEqual(second.customer_id, first.customer_id);
  assert.strictEqual(second.inquiry_id, first.inquiry_id);
  assert.strictEqual(second.specification_id, first.specification_id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM customers').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM inquiries').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM inquiry_specifications').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM costing_requests').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM customer_research_notes').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM crm_messages').get().count, 3);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM email_messages WHERE matched_customer_id = ? AND matched_inquiry_id = ?').get(first.customer_id, first.inquiry_id).count, 3);
  console.log('PASS matrix thread reconcile');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');
const { REASON_CODES, PUBLIC_REASON_CODES } = require('../src/lib/schemaRank');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-crm-'));
const dbPath = path.join(tempDir, 'fixture.db');
const db = new Database(dbPath);

function digest() {
  return crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
}

function bySourceId(report, sourceType, id) {
  return report.records.find((record) => record.source_ids[sourceType]?.includes(id));
}

try {
  db.pragma('journal_mode = DELETE');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      role TEXT,
      status TEXT
    );
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT,
      company_name TEXT,
      country TEXT,
      email TEXT,
      whatsapp TEXT,
      phone TEXT,
      website TEXT,
      source_channel TEXT,
      main_product TEXT,
      notes TEXT,
      last_contact_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE crm_messages (
      id INTEGER PRIMARY KEY,
      source_type TEXT,
      source_message_id TEXT,
      thread_id TEXT,
      customer_id INTEGER,
      direction TEXT,
      sender_name TEXT,
      sender_contact TEXT,
      receiver_contact TEXT,
      message_text TEXT,
      raw_payload_json TEXT,
      received_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE email_messages (
      id INTEGER PRIMARY KEY,
      message_id TEXT,
      thread_id TEXT,
      from_email TEXT,
      from_name TEXT,
      to_emails TEXT,
      cc_emails TEXT,
      bcc_emails TEXT,
      subject TEXT,
      text_body TEXT,
      cleaned_text TEXT,
      sent_at TEXT,
      received_at TEXT,
      direction TEXT,
      contact_email TEXT,
      contact_name TEXT,
      matched_customer_id INTEGER,
      business_relevance TEXT,
      noise_level TEXT,
      raw_headers_json TEXT,
      detected_signals_json TEXT,
      parser_hints_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  const insertCustomer = db.prepare(`
    INSERT INTO customers (
      id, name, company_name, country, email, whatsapp, phone, website,
      source_channel, main_product, notes, last_contact_at, created_at, updated_at
    ) VALUES (
      @id, @name, @company_name, @country, @email, @whatsapp, @phone, @website,
      @source_channel, @main_product, @notes, @last_contact_at, @created_at, @updated_at
    )
  `);
  const customerDefaults = {
    email: '', whatsapp: '', phone: '', website: '', source_channel: '',
    main_product: '', notes: '', last_contact_at: '2026-07-01T00:00:00Z',
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z'
  };
  insertCustomer.run({ ...customerDefaults, id: 1, name: '国内老客户', company_name: '本地食品厂', country: '中国' });
  insertCustomer.run({ ...customerDefaults, id: 2, name: 'Token Test', company_name: 'Token Test', country: '', source_channel: 'whatsapp' });
  insertCustomer.run({
    ...customerDefaults,
    id: 5,
    name: 'Overseas Mail Contact',
    company_name: 'Vietnam Coffee Brand',
    country: 'Vietnam',
    email: 'buyer@vietcoffee.example',
    website: 'https://vietcoffee.example',
    source_channel: 'email',
    main_product: 'coffee pouch'
  });
  insertCustomer.run({
    ...customerDefaults,
    id: 6,
    name: 'Overseas Chat Contact',
    company_name: 'Indonesia Care Brand',
    country: 'Indonesia',
    whatsapp: '+628123456789',
    website: 'https://carebrand.example',
    source_channel: 'whatsapp',
    main_product: 'detergent refill pouch'
  });
  insertCustomer.run({ ...customerDefaults, id: 7, name: 'Legacy Local', company_name: 'Legacy Local', country: '' });
  insertCustomer.run({ ...customerDefaults, id: 8, name: 'Duplicate Chat', company_name: 'Duplicate Brand', country: 'Thailand', whatsapp: '+66812345678', website: 'duplicate.example', main_product: 'snack pouch' });
  insertCustomer.run({ ...customerDefaults, id: 9, name: 'Broken Payload', company_name: 'Payload Brand', country: 'Malaysia', email: 'buyer@payload.example', website: 'payload.example', main_product: 'liquid pouch' });
  insertCustomer.run({ ...customerDefaults, id: 10, name: 'Greeting Only', company_name: '', country: 'Philippines', email: 'hello@greeting.example', website: 'greeting.example', main_product: '' });
  insertCustomer.run({ ...customerDefaults, id: 11, name: 'Local Linked Legacy', company_name: 'Local Linked Legacy', country: '' });
  insertCustomer.run({ ...customerDefaults, id: 12, name: 'Malformed Time Brand', company_name: 'Malformed Time Brand', country: 'Vietnam', email: 'buyer@timebrand.example', website: 'timebrand.example', main_product: 'coffee pouch' });
  insertCustomer.run({ ...customerDefaults, id: 13, name: 'Repeated Messages', company_name: 'Repeated Messages Brand', country: 'Indonesia', whatsapp: '+628555555555', website: 'repeatbrand.example', main_product: 'snack pouch' });
  insertCustomer.run({ ...customerDefaults, id: 14, name: 'Unknown Linked Legacy', company_name: 'Unknown Linked Legacy', country: '' });
  insertCustomer.run({ ...customerDefaults, id: 15, name: 'Broken Mail JSON', company_name: 'Broken Mail JSON Brand', country: 'Vietnam', email: 'buyer@brokenmail.example', website: 'brokenmail.example', main_product: 'coffee pouch' });
  insertCustomer.run({ ...customerDefaults, id: 16, name: 'Company Shell', company_name: 'Company Only', country: 'Vietnam', email: 'buyer@companyshell.example', website: 'companyshell.example', main_product: '' });
  insertCustomer.run({ ...customerDefaults, id: 17, name: 'Impossible Day', company_name: 'Impossible Day Brand', country: 'Vietnam', email: 'buyer@daybrand.example', website: 'daybrand.example', main_product: 'coffee pouch' });
  insertCustomer.run({ ...customerDefaults, id: 18, name: 'Impossible Month', company_name: 'Impossible Month Brand', country: 'Thailand', email: 'buyer@monthbrand.example', website: 'monthbrand.example', main_product: 'snack pouch' });
  insertCustomer.run({ ...customerDefaults, id: 19, name: 'Permissive Date', company_name: 'Permissive Date Brand', country: 'Malaysia', email: 'buyer@datebrand.example', website: 'datebrand.example', main_product: 'liquid pouch' });
  insertCustomer.run({ ...customerDefaults, id: 20, name: 'Bad Customer Update', company_name: 'Bad Customer Update Brand', country: 'Vietnam', email: 'buyer@customerupdate.example', website: 'customerupdate.example', main_product: 'coffee pouch', updated_at: '2026-02-30' });
  insertCustomer.run({ ...customerDefaults, id: 21, name: 'Bad CRM Update', company_name: 'Bad CRM Update Brand', country: 'Thailand', email: 'buyer@crmupdate.example', website: 'crmupdate.example', main_product: 'snack pouch' });
  insertCustomer.run({ ...customerDefaults, id: 22, name: 'Bad Email Update', company_name: 'Bad Email Update Brand', country: 'Malaysia', email: 'buyer@emailupdate.example', website: 'emailupdate.example', main_product: 'liquid pouch' });
  insertCustomer.run({ ...customerDefaults, id: 23, name: 'Overseas With Agent Phone', company_name: 'Vietnam Agent Brand', country: 'Vietnam', email: 'buyer@agentbrand.example', phone: '+8613800000000', website: 'agentbrand.example', main_product: 'coffee pouch' });
  insertCustomer.run({ ...customerDefaults, id: 24, name: 'WhatsApp Only', company_name: 'Thai Snack Brand', country: 'Thailand', whatsapp: '+66888888888', main_product: 'snack pouch' });
  insertCustomer.run({ ...customerDefaults, id: 25, name: 'Mixed Fixture Text', company_name: 'Malaysia Real Brand', country: 'Malaysia', email: 'buyer@mixedbrand.example', website: 'mixedbrand.example', main_product: 'refill pouch' });

  const insertCrm = db.prepare(`
    INSERT INTO crm_messages (
      id, source_type, source_message_id, thread_id, customer_id, direction,
      sender_name, sender_contact, receiver_contact, message_text, raw_payload_json,
      received_at, created_at, updated_at
    ) VALUES (
      @id, @source_type, @source_message_id, @thread_id, @customer_id, @direction,
      @sender_name, @sender_contact, @receiver_contact, @message_text, @raw_payload_json,
      @received_at, @created_at, @updated_at
    )
  `);
  const crmDefaults = {
    source_message_id: '', thread_id: '', customer_id: null, direction: 'inbound',
    sender_name: '', sender_contact: '', receiver_contact: '', raw_payload_json: '{}',
    received_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z'
  };
  insertCrm.run({ ...crmDefaults, id: 20, source_type: 'whatsapp', customer_id: 2, sender_name: 'Token Test', message_text: 'hello token ok' });
  insertCrm.run({
    ...crmDefaults,
    id: 40,
    source_type: 'whatsapp',
    sender_name: '',
    sender_contact: '',
    message_text: 'Hello\nHello',
    received_at: 'not-a-date'
  });
  insertCrm.run({
    ...crmDefaults,
    id: 60,
    source_type: 'whatsapp',
    customer_id: 6,
    sender_name: 'Purchasing',
    sender_contact: '+628123456789',
    message_text: 'Need detergent refill pouch specifications'
  });
  insertCrm.run({ ...crmDefaults, id: 80, source_type: 'whatsapp', customer_id: 8, sender_name: 'Buyer', sender_contact: '+66812345678', message_text: 'Need snack pouch\nNeed snack pouch' });
  insertCrm.run({ ...crmDefaults, id: 90, source_type: 'whatsapp', customer_id: 9, sender_name: 'Buyer', sender_contact: '+60123456789', message_text: 'Need liquid pouch specifications', raw_payload_json: '{broken' });
  insertCrm.run({ ...crmDefaults, id: 110, source_type: 'whatsapp', customer_id: 11, sender_name: 'Local', sender_contact: '+8613812345678', message_text: '本地沟通' });
  insertCrm.run({ ...crmDefaults, id: 120, source_type: 'whatsapp', direction: 'outbound', sender_contact: '+8613900000000', receiver_contact: '+84911111111', message_text: 'First overseas conversation' });
  insertCrm.run({ ...crmDefaults, id: 121, source_type: 'whatsapp', direction: 'outbound', sender_contact: '+8613900000000', receiver_contact: '+66822222222', message_text: 'Second overseas conversation' });
  insertCrm.run({ ...crmDefaults, id: 122, source_type: 'whatsapp', direction: 'unknown', sender_contact: '+84933333333', receiver_contact: '+8613900000000', message_text: 'Direction is uncertain' });
  insertCrm.run({ ...crmDefaults, id: 130, source_type: 'whatsapp', customer_id: 12, sender_name: 'Buyer', sender_contact: '+84944444444', message_text: 'Need coffee pouch specifications', received_at: 'bad-time' });
  insertCrm.run({ ...crmDefaults, id: 131, source_type: 'whatsapp', customer_id: 12, sender_name: 'Buyer', sender_contact: '+84944444444', message_text: 'Follow up coffee pouch specifications', received_at: '2026-07-02T00:00:00Z' });
  insertCrm.run({ ...crmDefaults, id: 132, source_type: 'whatsapp', customer_id: 13, sender_name: 'Buyer', sender_contact: '+628555555555', message_text: 'Need the same snack pouch specification with zipper and matte finish' });
  insertCrm.run({ ...crmDefaults, id: 133, source_type: 'whatsapp', customer_id: 13, sender_name: 'Buyer', sender_contact: '+628555555555', message_text: 'Forwarded context: Need the same snack pouch specification with zipper and matte finish. Thanks.' });
  insertCrm.run({ ...crmDefaults, id: 140, source_type: 'whatsapp', customer_id: 14, sender_name: '', sender_contact: '', receiver_contact: '', message_text: 'Unknown overseas identity' });
  insertCrm.run({ ...crmDefaults, id: 170, source_type: 'whatsapp', customer_id: 17, sender_name: 'Buyer', sender_contact: '+84955555555', message_text: 'Need coffee pouch specifications', received_at: '2026-02-30' });
  insertCrm.run({ ...crmDefaults, id: 180, source_type: 'whatsapp', customer_id: 18, sender_name: 'Buyer', sender_contact: '+66866666666', message_text: 'Need snack pouch specifications', received_at: '2026-13-01' });
  insertCrm.run({ ...crmDefaults, id: 190, source_type: 'whatsapp', customer_id: 19, sender_name: 'Buyer', sender_contact: '+60177777777', message_text: 'Need liquid pouch specifications', received_at: '2026/07/01' });
  insertCrm.run({ ...crmDefaults, id: 200, source_type: 'whatsapp', customer_id: 20, sender_name: 'Buyer', sender_contact: '+84966666666', message_text: 'Need coffee pouch specifications' });
  insertCrm.run({ ...crmDefaults, id: 210, source_type: 'whatsapp', customer_id: 21, sender_name: 'Buyer', sender_contact: '+66877777777', message_text: 'Need snack pouch specifications', updated_at: '2026-13-01' });
  insertCrm.run({ ...crmDefaults, id: 230, source_type: 'whatsapp', customer_id: 23, sender_name: 'Buyer', sender_contact: '+84988888888', message_text: 'Please quote coffee pouches' });
  insertCrm.run({ ...crmDefaults, id: 240, source_type: 'whatsapp', customer_id: 24, sender_name: 'Buyer', sender_contact: '+66888888888', message_text: 'Need snack pouch specifications' });
  insertCrm.run({ ...crmDefaults, id: 250, source_type: 'whatsapp', customer_id: 25, sender_name: 'Buyer', sender_contact: '+60188888888', message_text: 'Old forwarded note said token test' });
  insertCrm.run({ ...crmDefaults, id: 251, source_type: 'whatsapp', customer_id: 25, sender_name: 'Buyer', sender_contact: '+60188888888', message_text: 'Please quote refill pouch specifications' });
  insertCrm.run({ ...crmDefaults, id: 260, source_type: 'whatsapp', direction: 'internal', sender_name: 'Operator', sender_contact: '+8613900000000', receiver_contact: '+8613800000000', message_text: 'Internal packaging note' });

  const insertEmail = db.prepare(`
    INSERT INTO email_messages (
      id, message_id, thread_id, from_email, from_name, to_emails, cc_emails, bcc_emails, subject,
      text_body, cleaned_text, sent_at, received_at, direction, contact_email,
      contact_name, matched_customer_id, business_relevance, noise_level,
      raw_headers_json, detected_signals_json, parser_hints_json, created_at, updated_at
    ) VALUES (
      @id, @message_id, @thread_id, @from_email, @from_name, @to_emails, @cc_emails, @bcc_emails, @subject,
      @text_body, @cleaned_text, @sent_at, @received_at, @direction, @contact_email,
      @contact_name, @matched_customer_id, @business_relevance, @noise_level,
      @raw_headers_json, @detected_signals_json, @parser_hints_json, @created_at, @updated_at
    )
  `);
  const emailDefaults = {
    thread_id: '', from_name: '', to_emails: '["sales@factory.invalid"]', cc_emails: '[]', bcc_emails: '[]',
    sent_at: '2026-07-01T00:00:00Z', received_at: '2026-07-01T00:00:00Z',
    direction: 'inbound', contact_email: '', contact_name: '', matched_customer_id: null,
    business_relevance: 'low', noise_level: 'low', raw_headers_json: '{}', detected_signals_json: '{}', parser_hints_json: '{}', created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z'
  };
  insertEmail.run({
    ...emailDefaults,
    id: 30,
    message_id: '<system-30@example.invalid>',
    from_email: 'no-reply@accounts.example.invalid',
    subject: 'Security alert',
    text_body: 'Automated account verification notice',
    cleaned_text: 'Automated account verification notice',
    contact_email: 'no-reply@accounts.example.invalid',
    noise_level: 'high'
  });
  insertEmail.run({
    ...emailDefaults,
    id: 50,
    message_id: '<business-50@vietcoffee.example>',
    from_email: 'buyer@vietcoffee.example',
    from_name: 'Buyer',
    subject: 'Coffee pouch inquiry',
    text_body: 'Please quote printed coffee pouches',
    cleaned_text: 'Please quote printed coffee pouches',
    contact_email: 'buyer@vietcoffee.example',
    contact_name: 'Buyer',
    matched_customer_id: 5,
    business_relevance: 'high'
  });
  insertEmail.run({ ...emailDefaults, id: 100, message_id: '<greeting-100@greeting.example>', from_email: 'hello@greeting.example', subject: 'Hello', text_body: 'Hello', cleaned_text: 'Hello', contact_email: 'hello@greeting.example', matched_customer_id: 10 });
  insertEmail.run({ ...emailDefaults, id: 150, message_id: '<broken-150@brokenmail.example>', from_email: 'buyer@brokenmail.example', subject: 'Coffee pouch inquiry', text_body: 'Need coffee pouch specifications', cleaned_text: 'Need coffee pouch specifications', contact_email: 'buyer@brokenmail.example', matched_customer_id: 15, business_relevance: 'high', bcc_emails: '{broken' });
  insertEmail.run({ ...emailDefaults, id: 220, message_id: '<update-220@emailupdate.example>', from_email: 'buyer@emailupdate.example', subject: 'Liquid pouch inquiry', text_body: 'Need liquid pouch specifications', cleaned_text: 'Need liquid pouch specifications', contact_email: 'buyer@emailupdate.example', matched_customer_id: 22, business_relevance: 'high', updated_at: '2026/07/01' });
  insertEmail.run({ ...emailDefaults, id: 270, message_id: '<unsubscribe-270@outside.example>', from_email: 'person@outside.example', subject: 'Unsubscribe', text_body: 'Please unsubscribe me', cleaned_text: 'Please unsubscribe me', contact_email: 'person@outside.example' });
  insertEmail.run({ ...emailDefaults, id: 271, message_id: '<refusal-271@outside.example>', from_email: 'buyer2@outside.example', subject: 'No interest', text_body: 'Do not contact us again', cleaned_text: 'Do not contact us again', contact_email: 'buyer2@outside.example' });
  insertEmail.run({ ...emailDefaults, id: 272, message_id: '<bounce-272@mailer.example>', from_email: 'mailer-daemon@mailer.example', subject: 'Undeliverable', text_body: 'Invalid recipient address', cleaned_text: 'Invalid recipient address', contact_email: 'mailer-daemon@mailer.example' });
  insertEmail.run({ ...emailDefaults, id: 273, message_id: '<system-273@vietcoffee.example>', from_email: 'no-reply@vietcoffee.example', subject: 'Security alert', text_body: 'Automated account verification notice', cleaned_text: 'Automated account verification notice', contact_email: 'no-reply@vietcoffee.example', matched_customer_id: 5, noise_level: 'high' });

  const before = digest();
  const { readEligibleCrmRecords, classifyCurrentCrm } = require('../src/lib/matrixCrmAdapter');
  const normalized = readEligibleCrmRecords(db);
  const report = classifyCurrentCrm(db, { now: '2026-07-16' });
  const after = digest();

  assert.equal(before, after, 'classification must not change the database bytes');
  assert.equal(normalized.excluded_domestic_ids.includes(1), true);
  assert.equal(normalized.excluded_domestic_ids.includes(7), true);
  assert.equal(normalized.excluded_domestic_ids.includes(11), true);
  assert.equal(normalized.excluded_domestic_ids.includes(14), true);
  assert.equal(report.counts.excluded_domestic, 4);
  assert.equal(bySourceId(report, 'crm_message_ids', 20).classification, 'test');
  assert.equal(bySourceId(report, 'email_message_ids', 30).classification, 'noise');
  assert.equal(bySourceId(report, 'crm_message_ids', 40).classification, 'needs_review');
  assert.equal(bySourceId(report, 'email_message_ids', 50).classification, 'valid');
  assert.equal(bySourceId(report, 'crm_message_ids', 60).classification, 'valid');
  assert.equal(bySourceId(report, 'crm_message_ids', 80).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 80).reason_codes.includes('duplicated_message_segments'));
  assert.equal(bySourceId(report, 'crm_message_ids', 90).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 90).reason_codes.includes('malformed_json_payload'));
  assert.equal(bySourceId(report, 'email_message_ids', 100).classification, 'needs_review');
  assert(bySourceId(report, 'email_message_ids', 100).reason_codes.includes('missing_business_evidence'));
  assert.notEqual(bySourceId(report, 'crm_message_ids', 120).identity_id, bySourceId(report, 'crm_message_ids', 121).identity_id);
  assert.equal(bySourceId(report, 'crm_message_ids', 122).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 122).reason_codes.includes('uncertain_direction'));
  assert.equal(bySourceId(report, 'crm_message_ids', 130).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 130).reason_codes.includes('malformed_source_time'));
  assert.equal(bySourceId(report, 'crm_message_ids', 132).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 132).reason_codes.includes('duplicated_message_segments'));
  assert.equal(bySourceId(report, 'crm_message_ids', 140).classification, 'needs_review');
  assert(bySourceId(report, 'crm_message_ids', 140).reason_codes.includes('unknown_whatsapp_sender'));
  assert.equal(bySourceId(report, 'email_message_ids', 150).classification, 'needs_review');
  assert(bySourceId(report, 'email_message_ids', 150).reason_codes.includes('malformed_json_payload'));
  const companyShell = report.records.find((record) => record.source_ids.customer_ids.includes(16));
  assert.equal(companyShell.classification, 'needs_review');
  assert(companyShell.reason_codes.includes('missing_business_evidence'));
  for (const id of [170, 180, 190]) {
    assert.equal(bySourceId(report, 'crm_message_ids', id).classification, 'needs_review');
    assert(bySourceId(report, 'crm_message_ids', id).reason_codes.includes('malformed_source_time'));
  }
  for (const id of [200, 210, 220]) {
    const sourceType = id === 220 ? 'email_message_ids' : 'crm_message_ids';
    assert.equal(bySourceId(report, sourceType, id).classification, 'needs_review');
    assert(bySourceId(report, sourceType, id).reason_codes.includes('malformed_source_time'));
  }
  assert.equal(normalized.excluded_domestic_ids.includes(23), false, 'explicit overseas facts outrank +86 agent contact');
  assert.equal(bySourceId(report, 'crm_message_ids', 230).classification, 'valid');
  assert.equal(bySourceId(report, 'crm_message_ids', 240).classification, 'valid', 'confirmed WhatsApp is a usable identity without website/email');
  assert.equal(bySourceId(report, 'crm_message_ids', 250).classification, 'test');
  assert.equal(bySourceId(report, 'crm_message_ids', 251).classification, 'valid', 'isolated fixture evidence must not poison a real grouped identity');
  assert.equal(bySourceId(report, 'crm_message_ids', 260).classification, 'noise');
  assert(bySourceId(report, 'crm_message_ids', 260).reason_codes.includes(REASON_CODES.INTERNAL_ONLY));
  assert.equal(bySourceId(report, 'email_message_ids', 270).classification, 'noise');
  assert(bySourceId(report, 'email_message_ids', 270).reason_codes.includes(REASON_CODES.UNSUBSCRIBE));
  assert.equal(bySourceId(report, 'email_message_ids', 271).classification, 'noise');
  assert(bySourceId(report, 'email_message_ids', 271).reason_codes.includes(REASON_CODES.REFUSAL));
  assert.equal(bySourceId(report, 'email_message_ids', 272).classification, 'noise');
  assert(bySourceId(report, 'email_message_ids', 272).reason_codes.includes(REASON_CODES.INVALID_ADDRESS));
  assert.equal(bySourceId(report, 'email_message_ids', 273).classification, 'noise');
  assert.equal(bySourceId(report, 'email_message_ids', 50).classification, 'valid', 'isolated system mail must not poison substantive customer mail');

  const errorReport = classifyCurrentCrm(db, {
    now: '2026-07-16',
    classifier() { throw new Error('fixture classifier failure'); }
  });
  assert.equal(errorReport.counts.errors, errorReport.counts.input);
  assert.equal(errorReport.counts.needs_review, errorReport.counts.input);
  assert.equal(errorReport.records.length, errorReport.counts.input);
  assert(errorReport.records.every((record) => record.classification === 'needs_review'));
  assert(errorReport.records.every((record) => record.reason_codes.includes('classification_error')));
  assert(errorReport.records.every((record) => record.identity_id && record.source_ids));
  const publicReasonCodeSet = new Set(PUBLIC_REASON_CODES);
  const observedAdapterCodes = new Set([...report.records, ...errorReport.records].flatMap(record => record.reason_codes));
  observedAdapterCodes.forEach(code => assert(publicReasonCodeSet.has(code), `matrixCrmAdapter produced non-public reason code: ${code}`));
  [
    REASON_CODES.CONFIRMED_INTERNATIONAL_WHATSAPP,
    REASON_CODES.SUBSTANTIVE_INTERACTION,
    REASON_CODES.INTERNAL_ONLY,
    REASON_CODES.UNSUBSCRIBE,
    REASON_CODES.REFUSAL,
    REASON_CODES.INVALID_ADDRESS,
    REASON_CODES.DUPLICATED_MESSAGE_SEGMENTS,
    REASON_CODES.MALFORMED_JSON_PAYLOAD,
    REASON_CODES.UNCERTAIN_DIRECTION,
    REASON_CODES.MISSING_BUSINESS_EVIDENCE,
    REASON_CODES.CLASSIFICATION_ERROR
  ].forEach(code => assert(observedAdapterCodes.has(code), `matrixCrmAdapter contract did not exercise ${code}`));
  assert(bySourceId(report, 'crm_message_ids', 40).reason_codes.includes('unknown_whatsapp_sender'));
  assert(bySourceId(report, 'crm_message_ids', 40).reason_codes.includes('malformed_source_time'));
  assert(bySourceId(report, 'crm_message_ids', 40).reason_codes.includes('duplicated_message_segments'));

  const defaultJson = JSON.stringify(report);
  for (const secret of [
    'buyer@vietcoffee.example',
    '+628123456789',
    'no-reply@accounts.example.invalid',
    'Please quote printed coffee pouches'
  ]) {
    assert.equal(defaultJson.includes(secret), false, `default report leaked private value: ${secret}`);
  }
  assert(report.records.every((record) => !Object.hasOwn(record, 'private_preview')));

  const flagOnly = classifyCurrentCrm(db, { includePrivatePreview: true, authenticatedLocalOperator: false });
  assert(flagOnly.records.every((record) => !Object.hasOwn(record, 'private_preview')));
  const authOnly = classifyCurrentCrm(db, { includePrivatePreview: false, authenticatedLocalOperator: true });
  assert(authOnly.records.every((record) => !Object.hasOwn(record, 'private_preview')));
  const privateReport = classifyCurrentCrm(db, { includePrivatePreview: true, authenticatedLocalOperator: true });
  assert(privateReport.records.some((record) => record.private_preview?.contact));
  assert(privateReport.records.every((record) => !record.private_preview?.message_body));

  db.exec("INSERT INTO users (id, username, role, status) VALUES (10, 'crm-operator', 'foreign_trade_crm_admin', 'active')");
  db.exec("INSERT INTO users (id, username, role, status) VALUES (11, 'inactive-admin', 'super_admin', 'pending')");
  db.exec("INSERT INTO users (id, username, role, status) VALUES (12, 'ordinary-user', 'worker', 'active')");
  const cliPath = path.join(__dirname, 'matrix-classify-current.js');
  const insecureToken = jwt.sign({ sub: '10', role: 'super_admin' }, 'change-this-in-production');
  const insecurePreview = spawnSync(process.execPath, [cliPath, '--include-private-preview'], {
    env: { ...process.env, DB_PATH: dbPath, MATRIX_LOCAL_OPERATOR_TOKEN: insecureToken, JWT_SECRET: '' },
    encoding: 'utf8'
  });
  assert.notEqual(insecurePreview.status, 0, 'private preview must reject the public fallback JWT secret');

  const jwtSecret = 'fixture-secret-that-is-explicitly-configured';
  const missingUserToken = jwt.sign({ sub: '999', role: 'super_admin' }, jwtSecret);
  const missingUserPreview = spawnSync(process.execPath, [cliPath, '--include-private-preview'], {
    env: { ...process.env, DB_PATH: dbPath, MATRIX_LOCAL_OPERATOR_TOKEN: missingUserToken, JWT_SECRET: jwtSecret },
    encoding: 'utf8'
  });
  assert.notEqual(missingUserPreview.status, 0, 'private preview must reject a token without an active database user');

  const validToken = jwt.sign({ sub: '10', role: 'foreign_trade_crm_admin' }, jwtSecret);
  const validPreview = spawnSync(process.execPath, [cliPath, '--include-private-preview'], {
    env: { ...process.env, DB_PATH: dbPath, MATRIX_LOCAL_OPERATOR_TOKEN: validToken, JWT_SECRET: jwtSecret },
    encoding: 'utf8'
  });
  assert.equal(validPreview.status, 0, validPreview.stderr);

  for (const id of ['11', '12']) {
    const deniedToken = jwt.sign({ sub: id, role: 'super_admin' }, jwtSecret);
    const deniedPreview = spawnSync(process.execPath, [cliPath, '--include-private-preview'], {
      env: { ...process.env, DB_PATH: dbPath, MATRIX_LOCAL_OPERATOR_TOKEN: deniedToken, JWT_SECRET: jwtSecret },
      encoding: 'utf8'
    });
    assert.notEqual(deniedPreview.status, 0, `database user ${id} must not receive a private preview`);
  }

  const escapedOutput = path.join(tempDir, 'escaped-report.json');
  const linkPath = path.join(__dirname, '.matrix-output-link');
  fs.rmSync(linkPath, { force: true });
  fs.symlinkSync(escapedOutput, linkPath);
  const symlinkOutput = spawnSync(process.execPath, [cliPath, '--output', linkPath], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  fs.rmSync(linkPath, { force: true });
  assert.notEqual(symlinkOutput.status, 0, 'output must reject a symlink target');
  assert.equal(fs.existsSync(escapedOutput), false, 'output symlink escaped the workspace');

  const escapedDirectory = path.join(tempDir, 'escaped-directory');
  fs.mkdirSync(escapedDirectory);
  const directoryLink = path.join(__dirname, '.matrix-output-directory-link');
  fs.rmSync(directoryLink, { recursive: true, force: true });
  fs.symlinkSync(escapedDirectory, directoryLink);
  const ancestorEscape = spawnSync(process.execPath, [cliPath, '--output', path.join(directoryLink, 'report.json')], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  fs.rmSync(directoryLink, { force: true });
  assert.notEqual(ancestorEscape.status, 0, 'output must reject a symlinked parent directory');
  assert.equal(fs.existsSync(path.join(escapedDirectory, 'report.json')), false);

  const externalHardLinkTarget = path.resolve(__dirname, '..', '..', '..', `.matrix-external-hard-link-${process.pid}.json`);
  const hardLinkOutput = path.join(__dirname, '..', '.matrix-hard-link-output.json');
  fs.writeFileSync(externalHardLinkTarget, 'external sentinel', { mode: 0o600 });
  fs.rmSync(hardLinkOutput, { force: true });
  fs.linkSync(externalHardLinkTarget, hardLinkOutput);
  const hardLinkWrite = spawnSync(process.execPath, [cliPath, '--output', hardLinkOutput], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  fs.rmSync(hardLinkOutput, { force: true });
  assert.notEqual(hardLinkWrite.status, 0, 'output must reject an existing hard link');
  assert.equal(fs.readFileSync(externalHardLinkTarget, 'utf8'), 'external sentinel');
  fs.rmSync(externalHardLinkTarget, { force: true });

  const nonRegularOutput = path.join(__dirname, '..', '.matrix-non-regular-output');
  fs.rmSync(nonRegularOutput, { recursive: true, force: true });
  fs.mkdirSync(nonRegularOutput);
  const nonRegularWrite = spawnSync(process.execPath, [cliPath, '--output', nonRegularOutput], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  fs.rmSync(nonRegularOutput, { recursive: true, force: true });
  assert.notEqual(nonRegularWrite.status, 0, 'output must reject non-regular files');

  const safeOutput = path.join(__dirname, '..', '.matrix-safe-output-test.json');
  fs.rmSync(safeOutput, { force: true });
  const safeWrite = spawnSync(process.execPath, [cliPath, '--output', safeOutput], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
  assert.equal(safeWrite.status, 0, safeWrite.stderr);
  assert.equal(fs.statSync(safeOutput).mode & 0o777, 0o600);
  fs.rmSync(safeOutput, { force: true });

  console.log('matrix CRM adapter tests passed');
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

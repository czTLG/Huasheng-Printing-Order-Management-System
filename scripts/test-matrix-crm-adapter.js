'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');

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

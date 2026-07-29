'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { admitReviewedCandidate, parseReviewedCandidate } = require('../src/services/matrixIntakeCandidate');

const NOW = '2026-07-28T08:00:00.000Z';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-intake-candidate-'));
const db = new Database(path.join(dir, 'candidate.db'));

function contactSelection(recipient, alternatives = []) {
  return {
    public_only: true,
    search_complete: true,
    searched_at: recipient.verified_at,
    scopes: [
      'official_contact',
      'official_about',
      'official_sales_export_procurement',
      'independent_organization_sources'
    ],
    selected: {
      channel: 'email',
      address: recipient.email,
      role: recipient.role,
      source_url: recipient.source_url,
      verified_at: recipient.verified_at
    },
    alternatives
  };
}

function fixture(overrides = {}) {
  const recipient = {
    email: 'sales@nutty-nuts.com',
    source_url: 'https://www.nutty-nuts.com/pages/contact',
    verified_at: '2026-07-27T08:00:00.000Z',
    role: 'public sales'
  };
  const value = {
    candidate_key: 'ae-nutty-nuts-20260728',
    company_name: 'Nutty Nuts Foodstuff Factory LLC',
    country_code: 'AE',
    normalized_domain: 'nutty-nuts.com',
    official_url: 'https://www.nutty-nuts.com/',
    recipient,
    contact_selection: contactSelection(recipient),
    categories: ['nuts', 'snacks'],
    formats: ['pouches', 'roll film'],
    size_signals: ['retail packs'],
    scale_tier: 'medium',
    priority: 'P0',
    fit_score: 93,
    confidence: 0.94,
    sources: [
      ['home', '/', 'Official home'],
      ['profile', '/pages/about-us', 'Company profile'],
      ['products', '/collections/all', 'Nut and snack products'],
      ['process', '/pages/quality', 'Manufacturing and quality'],
      ['contact', '/pages/contact', 'Public sales contact']
    ].map(([role, suffix, excerpt]) => ({
      role,
      source_url: `https://www.nutty-nuts.com${suffix}`,
      page_title: role,
      observed_at: '2026-07-27T08:00:00.000Z',
      excerpt
    })),
    discovery: {
      source_adapter: 'matrix_atlas',
      source_url: 'https://www.nutty-nuts.com/',
      source_query: 'UAE nut snack manufacturer',
      collected_at: '2026-07-27T08:00:00.000Z'
    },
    route_readiness: {
      id: 'food_snack_ar:AE',
      status: 'ready',
      expected_language: 'ar',
      commit: '650d7b3',
      verified_at: '2026-07-27T09:00:00.000Z',
      urls: {
        home: 'https://gdhspack.com/ar',
        about: 'https://gdhspack.com/ar/about',
        market: 'https://gdhspack.com/ar/markets/middle-east-food-packaging',
        application: 'https://gdhspack.com/ar/applications/snack-packaging',
        product: 'https://gdhspack.com/ar/products/food-packaging-roll-film'
      }
    }
  };
  return { ...value, ...overrides };
}

function publicMailboxFixture(overrides = {}) {
  const recipient = {
    email: 'hockxeng@gmail.com',
    source_url: 'https://www.hockxeng.com/contact-us/',
    verified_at: '2026-07-28T07:00:00.000Z',
    role: 'public business',
    evidence_mode: 'official_public_mailbox',
    corroboration: {
      source_url: 'https://example-exhibition.test/hock-xeng',
      source_class: 'official_exhibition',
      observed_at: '2026-07-28T07:10:00.000Z',
      email: 'hockxeng@gmail.com',
      organization_name: 'Hock Xeng Sdn Bhd',
      official_domain: 'hockxeng.com',
      identity_matches: {
        address: true,
        phone: true
      }
    }
  };
  const value = fixture({
    candidate_key: 'my-hock-xeng-20260728',
    company_name: 'Hock Xeng Sdn Bhd',
    country_code: 'MY',
    normalized_domain: 'hockxeng.com',
    official_url: 'https://www.hockxeng.com/',
    recipient,
    contact_selection: contactSelection(recipient),
    sources: [
      ['home', '/', 'Official home'],
      ['profile', '/company-profile/', 'Company profile and process'],
      ['products', '/our-products/seasoning/', 'Seasoning products'],
      ['process', '/company-profile/', 'OEM and automatic packaging'],
      ['contact', '/contact-us/', 'Public business contact']
    ].map(([role, suffix, excerpt]) => ({
      role,
      source_url: `https://www.hockxeng.com${suffix}`,
      page_title: role,
      observed_at: '2026-07-28T07:00:00.000Z',
      excerpt
    })),
    discovery: {
      source_adapter: 'matrix_atlas',
      source_url: 'https://www.hockxeng.com/',
      source_query: 'Malaysia seasoning OEM manufacturer',
      collected_at: '2026-07-28T07:00:00.000Z'
    },
    route_readiness: {
      id: 'malaysia_seasoning_en:MY',
      status: 'ready',
      expected_language: 'en',
      commit: '8243066',
      verified_at: '2026-07-28T07:20:00.000Z',
      urls: {
        home: 'https://gdhspack.com/',
        about: 'https://gdhspack.com/about',
        market: 'https://gdhspack.com/markets/malaysia-food-packaging',
        application: 'https://gdhspack.com/applications/food-snack-packaging',
        product: 'https://gdhspack.com/products/food-packaging-roll-film'
      }
    }
  });
  return { ...value, ...overrides };
}

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE cache_records(
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, country_code TEXT NOT NULL, city TEXT,
      normalized_domain TEXT NOT NULL UNIQUE, official_url TEXT NOT NULL, product_categories_json TEXT NOT NULL,
      format_signals_json TEXT NOT NULL, size_signals_json TEXT NOT NULL, scale_tier TEXT,
      public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
      priority TEXT NOT NULL, fit_score REAL NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
      assessment_cn TEXT, next_action_cn TEXT, stage_code TEXT NOT NULL, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      demand_fit_score REAL, access_score REAL, contact_role TEXT, audit_state TEXT NOT NULL, audit_note TEXT, audited_at TEXT
    );
    CREATE TABLE cache_evidence(
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, source_url TEXT NOT NULL, source_type TEXT NOT NULL,
      page_title TEXT, observed_at TEXT NOT NULL, excerpt TEXT, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(record_id, source_url, fingerprint), FOREIGN KEY(record_id) REFERENCES cache_records(id) ON DELETE CASCADE
    );
    CREATE TABLE cache_discovery(
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, normalized_domain TEXT NOT NULL,
      discovered_via TEXT NOT NULL, discovery_url TEXT NOT NULL, official_url TEXT NOT NULL, source_type TEXT NOT NULL,
      verified_at TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(record_id, fingerprint), FOREIGN KEY(record_id) REFERENCES cache_records(id) ON DELETE CASCADE
    );
  `);

  const admitted = admitReviewedCandidate(db, fixture(), { clock: () => NOW });
  assert.strictEqual(admitted.resolution, 'inserted');
  assert.strictEqual(admitReviewedCandidate(db, fixture(), { clock: () => NOW }).resolution, 'replayed');
  assert.throws(() => admitReviewedCandidate(db, fixture({ company_name: 'Conflicting Name' }), { clock: () => NOW }), /identity conflict/);

  const legacyFixture = fixture({
    candidate_key: 'my-cocome-20260728',
    company_name: 'COCOME (M) Sdn Bhd',
    country_code: 'MY',
    normalized_domain: 'cocome.com.my',
    official_url: 'https://www.cocome.com.my/',
    recipient: {
      email: 'hello@cocome.com.my',
      source_url: 'https://www.cocome.com.my/contact/',
      verified_at: '2026-07-28T07:00:00.000Z',
      role: 'public business'
    },
    contact_selection: contactSelection({
      email: 'hello@cocome.com.my',
      source_url: 'https://www.cocome.com.my/contact/',
      verified_at: '2026-07-28T07:00:00.000Z',
      role: 'public business'
    }),
    sources: [
      ['home', '/', 'Official home'],
      ['profile', '/about/', 'Company profile'],
      ['products', '/products/', 'Instant beverage products'],
      ['process', '/services/', 'OEM and private-label services'],
      ['contact', '/contact/', 'Public business contact']
    ].map(([role, suffix, excerpt]) => ({
      role,
      source_url: `https://www.cocome.com.my${suffix}`,
      page_title: role,
      observed_at: '2026-07-28T07:00:00.000Z',
      excerpt
    })),
    discovery: {
      source_adapter: 'matrix_atlas',
      source_url: 'https://www.cocome.com.my/',
      source_query: 'Malaysia instant beverage OEM manufacturer',
      collected_at: '2026-07-28T07:00:00.000Z'
    }
  });
  const legacyId = Number(db.prepare(`
    INSERT INTO cache_records (
      company_name,country_code,city,normalized_domain,official_url,product_categories_json,
      format_signals_json,size_signals_json,scale_tier,public_email,public_phone,public_whatsapp,
      contact_url,priority,fit_score,confidence,status,assessment_cn,next_action_cn,stage_code,
      first_seen_at,updated_at,demand_fit_score,access_score,contact_role,audit_state,audit_note,audited_at
    ) VALUES (?,?,?,?,?,'[]','[]','[]','medium',?,'','','','P0',90,0.9,'valid','','','observed',?,?,90,100,'public business','audited','legacy',?)
  `).run(
    legacyFixture.company_name,
    legacyFixture.country_code,
    '',
    legacyFixture.normalized_domain,
    legacyFixture.official_url,
    legacyFixture.recipient.email,
    NOW,
    NOW,
    NOW
  ).lastInsertRowid);
  const adopted = admitReviewedCandidate(db, legacyFixture, { clock: () => NOW });
  assert.strictEqual(adopted.resolution, 'adopted');
  assert.strictEqual(adopted.candidate_id, legacyId);
  assert.strictEqual(admitReviewedCandidate(db, legacyFixture, { clock: () => NOW }).resolution, 'replayed');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM cache_records WHERE normalized_domain=?').get(legacyFixture.normalized_domain).n, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM cache_evidence WHERE record_id=?').get(legacyId).n, 5);
  const refreshedFixture = {
    ...legacyFixture,
    sources: [
      ...legacyFixture.sources,
      {
        role: 'contact',
        source_url: 'https://www.cocome.com.my/business/',
        page_title: 'Business contact',
        observed_at: '2026-07-28T07:00:00.000Z',
        excerpt: 'Official organizational contact'
      }
    ]
  };
  assert.throws(
    () => admitReviewedCandidate(db, refreshedFixture, { clock: () => NOW }),
    /identity conflict/
  );
  const refreshed = admitReviewedCandidate(db, refreshedFixture, {
    clock: () => NOW,
    allowEvidenceRefresh: true
  });
  assert.strictEqual(refreshed.resolution, 'refreshed');
  assert.strictEqual(refreshed.candidate_id, legacyId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM cache_evidence WHERE record_id=?').get(legacyId).n, 6);
  assert.strictEqual(admitReviewedCandidate(db, refreshedFixture, { clock: () => NOW }).resolution, 'replayed');
  assert.throws(
    () => admitReviewedCandidate(db, { ...legacyFixture, candidate_key: 'my-cocome-name-conflict', company_name: 'Different Company' }, { clock: () => NOW }),
    /identity conflict/
  );
  assert.throws(
    () => admitReviewedCandidate(db, {
      ...legacyFixture,
      candidate_key: 'my-cocome-email-conflict',
      recipient: { ...legacyFixture.recipient, email: 'other@cocome.com.my' }
    }, { clock: () => NOW }),
    /selected contact does not match|identity conflict/
  );

  const stale = fixture({ candidate_key: 'stale', sources: fixture().sources.map(row => ({ ...row, observed_at: '2025-01-01T00:00:00.000Z' })) });
  assert.throws(() => admitReviewedCandidate(db, stale, { clock: () => NOW }), /evidence is stale/);
  const missingProcess = fixture({ candidate_key: 'missing', sources: fixture().sources.filter(row => row.role !== 'process') });
  assert.throws(() => admitReviewedCandidate(db, missingProcess, { clock: () => NOW }), /required official source role/);
  const mismatchedEmail = fixture({ candidate_key: 'mismatch', recipient: { ...fixture().recipient, email: 'sales@outside.test' } });
  assert.throws(() => admitReviewedCandidate(db, mismatchedEmail, { clock: () => NOW }), /recipient domain mismatch/);
  assert.throws(
    () => parseReviewedCandidate(fixture({
      candidate_key: 'generic-with-sales',
      recipient: {
        email: 'info@nutty-nuts.com',
        source_url: 'https://www.nutty-nuts.com/pages/contact',
        verified_at: '2026-07-27T08:00:00.000Z',
        role: 'general info'
      },
      contact_selection: contactSelection({
        email: 'info@nutty-nuts.com',
        source_url: 'https://www.nutty-nuts.com/pages/contact',
        verified_at: '2026-07-27T08:00:00.000Z',
        role: 'general info'
      }, [{
        channel: 'email',
        address: 'sales@nutty-nuts.com',
        role: 'public sales',
        source_url: 'https://www.nutty-nuts.com/pages/contact',
        verified_at: '2026-07-27T08:00:00.000Z'
      }])
    }), NOW),
    /not the best verified route/
  );
  assert.throws(
    () => parseReviewedCandidate(fixture({
      candidate_key: 'incomplete-contact-search',
      contact_selection: { ...fixture().contact_selection, search_complete: false }
    }), NOW),
    /contact selection review is incomplete/
  );

  const publicMailbox = admitReviewedCandidate(db, publicMailboxFixture(), { clock: () => NOW });
  assert.strictEqual(publicMailbox.resolution, 'inserted');
  const publicParsed = parseReviewedCandidate(publicMailboxFixture(), NOW);
  assert.strictEqual(publicParsed.recipient.evidence_mode, 'official_public_mailbox');
  assert.strictEqual(publicParsed.recipient.corroboration.source_class, 'official_exhibition');
  const storedPublicProvenance = JSON.parse(db.prepare(
    'SELECT recipient_provenance_json FROM cache_reviewed_intakes WHERE record_id=?'
  ).get(publicMailbox.candidate_id).recipient_provenance_json);
  assert.strictEqual(storedPublicProvenance.evidence_mode, 'official_public_mailbox');
  assert.strictEqual(storedPublicProvenance.corroboration.email, 'hockxeng@gmail.com');
  assert.throws(
    () => parseReviewedCandidate(publicMailboxFixture({
      recipient: { ...publicMailboxFixture().recipient, corroboration: undefined }
    }), NOW),
    /corroboration/
  );
  assert.throws(
    () => parseReviewedCandidate(publicMailboxFixture({
      recipient: {
        ...publicMailboxFixture().recipient,
        corroboration: { ...publicMailboxFixture().recipient.corroboration, email: 'other@gmail.com' }
      }
    }), NOW),
    /corroboration email mismatch/
  );
  assert.throws(
    () => parseReviewedCandidate(publicMailboxFixture({
      recipient: {
        ...publicMailboxFixture().recipient,
        corroboration: { ...publicMailboxFixture().recipient.corroboration, source_class: 'business_directory' }
      }
    }), NOW),
    /corroboration source class/
  );
  assert.throws(
    () => parseReviewedCandidate(publicMailboxFixture({
      recipient: {
        ...publicMailboxFixture().recipient,
        corroboration: { ...publicMailboxFixture().recipient.corroboration, observed_at: '2025-01-01T00:00:00.000Z' }
      }
    }), NOW),
    /corroboration.*stale/
  );
  assert.throws(
    () => parseReviewedCandidate(publicMailboxFixture({
      recipient: {
        ...publicMailboxFixture().recipient,
        corroboration: {
          ...publicMailboxFixture().recipient.corroboration,
          identity_matches: { address: true, phone: false }
        }
      }
    }), NOW),
    /at least two corroborated identity fields/
  );

  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_records').get().count, 3);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_evidence').get().count, 16);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM cache_discovery').get().count, 3);
  assert.strictEqual(db.prepare("SELECT audit_state FROM cache_records").get().audit_state, 'audited');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('matrix intake candidate tests passed');

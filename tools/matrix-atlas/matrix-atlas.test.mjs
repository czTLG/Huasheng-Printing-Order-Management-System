import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeRecords,
  normalizeRecord,
  planQueries,
  scoreRecord,
  validateRecord,
} from './matrix-atlas.mjs';

test('plans bounded English and local-language queries', () => {
  const plan = planQueries({
    countries: ['Thailand'],
    locations: ['Bangkok'],
    categories: ['snack manufacturer', 'seasoning manufacturer'],
    localLanguage: 'th',
    localCategories: ['ผู้ผลิตขนม', 'ผู้ผลิตเครื่องปรุงรส'],
    maxQueries: 3,
  });

  assert.deepEqual(plan.queries, [
    'snack manufacturer in Bangkok, Thailand',
    'ผู้ผลิตขนม Bangkok Thailand',
    'seasoning manufacturer in Bangkok, Thailand',
  ]);
  assert.equal(plan.policy.concurrency, 1);
  assert.equal(plan.policy.maxResults, 200);
  assert.equal(plan.policy.emailExtraction, false);
  assert.equal(plan.policy.extraReviews, false);
  assert.equal(plan.policy.proxyRotation, false);
});

test('rejects query limits above the fixed safety maximum', () => {
  assert.throws(
    () => planQueries({
      countries: ['Thailand'],
      locations: ['Bangkok'],
      categories: ['manufacturer'],
      maxQueries: 21,
    }),
    /maxQueries must be between 1 and 20/,
  );
});

test('normalizes a public organization and preserves provenance', () => {
  const record = normalizeRecord({
    title: '  Example Foods Co., Ltd. ',
    category: 'Food manufacturer',
    address: '99 Example Road, Bangkok',
    website: 'https://www.example.co.th/products?utm_source=maps',
    phone: '+66 (0)2 123 4567',
    latitude: '13.7563',
    longitude: '100.5018',
    rating: '4.5',
    review_count: '87',
    source_url: 'https://maps.example/listing/123',
  }, {
    countryCode: 'TH',
    locality: 'Bangkok',
    sourceAdapter: 'public-map-export',
    sourceQuery: 'food manufacturer in Bangkok, Thailand',
    collectedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(record.organization_name, 'Example Foods Co., Ltd.');
  assert.equal(record.website_official, 'https://example.co.th/products');
  assert.equal(record.phone_public, '+66021234567');
  assert.equal(record.country_code, 'TH');
  assert.equal(record.source_adapter, 'public-map-export');
  assert.equal(record.source_url, 'https://maps.example/listing/123');
  assert.equal(record.verification_state, 'unknown');
  assert.match(record.candidate_key, /^[a-f0-9]{24}$/);
});

test('deduplicates by official domain and retains every source', () => {
  const base = {
    organization_name: 'Example Foods',
    country_code: 'TH',
    locality: 'Bangkok',
    categories: ['Food manufacturer'],
    address_public: 'Bangkok',
    website_official: 'https://example.co.th',
    phone_public: '',
    map_url: '',
    latitude: null,
    longitude: null,
    rating: null,
    review_count: null,
    verification_state: 'unknown',
    verification_sources: [],
    fit_score: 0,
    scale_score: 0,
    source_quality_score: 0,
    completeness_score: 0,
    review_status: 'pending',
    notes: '',
  };
  const records = [
    { ...base, candidate_key: 'a', source_adapter: 'one', source_url: 'https://source.example/a', source_query: 'q1', collected_at: '2026-07-28T00:00:00.000Z' },
    { ...base, candidate_key: 'b', phone_public: '+6621234567', source_adapter: 'two', source_url: 'https://source.example/b', source_query: 'q2', collected_at: '2026-07-28T00:01:00.000Z' },
  ];

  const result = dedupeRecords(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].phone_public, '+6621234567');
  assert.deepEqual(result[0].provenance.map((item) => item.source_url), [
    'https://source.example/a',
    'https://source.example/b',
  ]);
});

test('scores confirmed evidence without promoting unknown claims', () => {
  const scored = scoreRecord({
    organization_name: 'Example Foods',
    country_code: 'TH',
    locality: 'Bangkok',
    categories: ['snack manufacturer'],
    website_official: 'https://example.co.th',
    phone_public: '+6621234567',
    address_public: 'Bangkok',
    source_url: 'https://example.co.th/about',
    verification_state: 'confirmed',
    verification_sources: [
      { url: 'https://example.co.th/about', type: 'official_website' },
    ],
    evidence: {
      product_match: 'confirmed',
      export_activity: 'unknown',
      facility_count: 'unknown',
    },
  });

  assert.equal(scored.fit_score, 40);
  assert.equal(scored.scale_score, 0);
  assert.equal(scored.source_quality_score, 30);
  assert.equal(scored.completeness_score, 30);
});

test('rejects forbidden personal and secret-bearing fields', () => {
  for (const forbidden of ['personal_email', 'cookie', 'api_token', 'smtp_message_id', 'message_body']) {
    const result = validateRecord({
      organization_name: 'Example',
      country_code: 'TH',
      source_url: 'https://example.test',
      [forbidden]: 'not-allowed',
    });
    assert.equal(result.valid, false, forbidden);
    assert.match(result.errors.join(' '), /forbidden field/);
  }
});


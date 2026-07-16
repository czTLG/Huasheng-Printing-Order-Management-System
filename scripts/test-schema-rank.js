const assert = require('assert');
const { classifyRecord, isApprovedCountry } = require('../src/lib/schemaRank');

assert.equal(isApprovedCountry('Vietnam'), true);
assert.equal(isApprovedCountry('India'), false);
assert.equal(classifyRecord({ fixture_marker: 'token-verification' }, {}).classification, 'test');
assert.equal(classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }, {}).classification, 'noise');
assert.equal(classifyRecord({ country: 'Thailand', business_email: 'sales@example.co.th' }, {}).classification, 'needs_review');
const valid = classifyRecord({
  country: 'Indonesia',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  product_evidence: ['coffee'],
  last_interaction_at: '2026-07-01'
}, { now: '2026-07-16' });
assert.equal(valid.classification, 'valid');
assert(valid.reason_codes.includes('official_domain'));
console.log('schema-rank tests passed');

const assert = require('assert');
const {
  classifyRecord,
  isApprovedCountry,
  APPROVED_COUNTRIES,
  EXCLUDED_COUNTRIES,
  RULESET_VERSION
} = require('../src/lib/schemaRank');

const validRecord = (overrides = {}) => ({
  country: 'Indonesia',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  product_evidence: ['coffee'],
  last_interaction_at: '2026-07-01',
  ...overrides
});

const assertClassification = (record, classification, reasonCode, context = {}) => {
  const result = classifyRecord(record, context);
  assert.equal(result.classification, classification);
  assert(result.reason_codes.includes(reasonCode));
  assert.equal(typeof result.confidence, 'number');
  assert(result.confidence >= 0 && result.confidence <= 1);
  return result;
};

assert.equal(isApprovedCountry('Vietnam'), true);
assert.equal(isApprovedCountry('India'), false);
assert.equal(classifyRecord({ fixture_marker: 'token-verification' }, {}).classification, 'test');
assert.equal(classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }, {}).classification, 'noise');
assert.equal(classifyRecord({ country: 'Thailand', business_email: 'sales@example.co.th' }, {}).classification, 'needs_review');
const valid = classifyRecord(validRecord(), { now: '2026-07-16' });
assert.equal(valid.classification, 'valid');
assert(valid.reason_codes.includes('official_domain'));

const expectedApprovedCountries = [
  'Vietnam',
  'Thailand',
  'Malaysia',
  'Indonesia',
  'Philippines',
  'Kazakhstan'
];
assert.deepEqual([...APPROVED_COUNTRIES].sort(), [...expectedApprovedCountries].sort());
for (const country of expectedApprovedCountries) {
  assert.equal(isApprovedCountry(`  ${country.toUpperCase()}  `), true);
}
assert.deepEqual(EXCLUDED_COUNTRIES, ['India']);
assert.equal(isApprovedCountry(' INDIA '), false);
assert.equal(typeof RULESET_VERSION, 'string');
assert(RULESET_VERSION.length > 0);

const testCollision = assertClassification({
  fixture_marker: 'collision',
  source_kind: 'security_notice',
  country: 'India'
}, 'test', 'fixture_marker');
assert.equal(testCollision.priority, 'C');
assert.equal(testCollision.confidence, 1);

const noiseCollision = assertClassification({
  source_kind: 'security_notice',
  country: 'Unknown',
  official_domain: 'one.example',
  business_email: 'sales@two.example'
}, 'noise', 'security_notice');
assert.equal(noiseCollision.priority, 'C');
assert.equal(noiseCollision.confidence, 1);

const excludedCountry = assertClassification(validRecord({
  country: ' India '
}), 'noise', 'excluded_country');
assert.equal(excludedCountry.priority, 'C');

const missingIdentity = assertClassification({ country: 'Vietnam' }, 'needs_review', 'missing_identity');
assert.equal(missingIdentity.priority, 'B');
assert.equal(missingIdentity.confidence, 0.5);

assertClassification({
  country: 'Thailand',
  official_domain: 'company.co.th',
  business_email: 'sales@example.co.th'
}, 'needs_review', 'ambiguous_contact');

assertClassification(validRecord({
  source_kind: 'whatsapp',
  sender_name: '   ',
  sender_phone: '\t'
}), 'needs_review', 'unknown_whatsapp_sender');

assertClassification(validRecord({
  source_kind: 'whatsapp'
}), 'needs_review', 'unknown_whatsapp_sender');

assertClassification(validRecord({
  last_interaction_at: '2026-02-30'
}), 'needs_review', 'malformed_source_time');

assertClassification(validRecord({
  official_domain: 'brand.example',
  business_email: 'sales@other.example'
}), 'needs_review', 'conflicting_domains');

assertClassification(validRecord({
  country: 'Philippines',
  official_domain: 'company.ph',
  business_email: 'sales@gmail.com'
}), 'needs_review', 'ambiguous_contact');

assert.equal(valid.priority, 'A');
assert.equal(valid.confidence, 0.95);
assert(valid.reason_codes.includes('approved_country'));
assert(valid.reason_codes.includes('product_evidence'));
assert(valid.reason_codes.includes('valid_source_time'));

const staleValid = assertClassification(validRecord({
  country: 'Kazakhstan',
  last_interaction_at: '2026-05-01'
}), 'valid', 'official_domain', { now: '2026-07-16' });
assert.equal(staleValid.priority, 'B');
assert.equal(staleValid.confidence, 0.85);

assert.deepEqual(Object.keys(valid), ['classification', 'priority', 'reason_codes', 'confidence']);
console.log('schema-rank tests passed');

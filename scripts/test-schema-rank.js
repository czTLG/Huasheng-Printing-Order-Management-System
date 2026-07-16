const assert = require('assert');
const {
  classifyRecord,
  isApprovedCountry,
  APPROVED_COUNTRIES,
  EXCLUDED_COUNTRIES,
  REASON_CODES,
  PUBLIC_REASON_CODES,
  RULESET_VERSION
} = require('../src/lib/schemaRank');

const publicReasonCodeSet = new Set(PUBLIC_REASON_CODES);
const observedReasonCodes = new Set();

const assertPublicReasonCodes = (result) => {
  result.reason_codes.forEach((code) => {
    assert(publicReasonCodeSet.has(code), `schemaRank produced non-public reason code: ${code}`);
    observedReasonCodes.add(code);
  });
  return result;
};

const validRecord = (overrides = {}) => ({
  country: 'Indonesia',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  product_evidence: ['coffee'],
  evidence_refs: ['evidence:1'],
  last_interaction_at: '2026-07-01',
  ...overrides
});

const assertClassification = (record, classification, reasonCode, context = {}) => {
  const result = assertPublicReasonCodes(classifyRecord(record, context));
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
assertPublicReasonCodes(valid);
assert.equal(valid.classification, 'valid');
assert(valid.reason_codes.includes('official_domain'));

// Final-review canaries: identity and business intent are independent gates.
const contactPageOnly = classifyRecord({
  country: 'Vietnam',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  evidence_refs: ['evidence:1']
}, { now: '2026-07-16' });
assert.equal(contactPageOnly.classification, 'needs_review');
assert.equal(contactPageOnly.priority, null);
assert(contactPageOnly.reason_codes.includes(REASON_CODES.MISSING_BUSINESS_EVIDENCE));

const recentWithoutInquiry = classifyRecord(validRecord({
  last_interaction_at: '2026-07-15'
}), { now: '2026-07-16' });
assert.equal(recentWithoutInquiry.classification, 'valid');
assert.equal(recentWithoutInquiry.priority, 'B');

const priorityA = classifyRecord(validRecord({
  inquiry_evidence: ['inquiry:42'],
  substantive_interaction: true,
  last_interaction_at: '2026-07-15'
}), { now: '2026-07-16' });
assert.equal(priorityA.priority, 'A');
assert(priorityA.reason_codes.includes(REASON_CODES.HISTORICAL_INQUIRY));

const whatsappOnly = classifyRecord({
  country: 'Thailand',
  confirmed_international_whatsapp: true,
  sender_phone: '+66812345678',
  product_evidence: ['snack pouch'],
  evidence_refs: ['crm-message:91']
}, { now: '2026-07-16' });
assert.equal(whatsappOnly.classification, 'valid');
assert.equal(whatsappOnly.priority, 'B');
assert(whatsappOnly.reason_codes.includes(REASON_CODES.CONFIRMED_INTERNATIONAL_WHATSAPP));

const noReferences = classifyRecord(validRecord({ evidence_refs: [] }), { now: '2026-07-16' });
assert.equal(noReferences.classification, 'needs_review');
assert.equal(noReferences.priority, null);
assert(noReferences.reason_codes.includes(REASON_CODES.MISSING_EVIDENCE_REFERENCES));

for (const nonValid of [
  classifyRecord({ fixture_marker: 'token-verification' }),
  classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }),
  classifyRecord({ country: 'Vietnam' })
]) assert.equal(nonValid.priority, null);

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
assert.equal(testCollision.priority, null);
assert.equal(testCollision.confidence, 1);

const noiseCollision = assertClassification({
  source_kind: 'security_notice',
  country: 'Unknown',
  official_domain: 'one.example',
  business_email: 'sales@two.example'
}, 'noise', 'security_notice');
assert.equal(noiseCollision.priority, null);
assert.equal(noiseCollision.confidence, 1);

const excludedCountry = assertClassification(validRecord({
  country: ' India '
}), 'noise', 'excluded_country');
assert.equal(excludedCountry.priority, null);

const missingIdentity = assertClassification({ country: 'Vietnam' }, 'needs_review', 'missing_identity');
assert.equal(missingIdentity.priority, null);
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

assert.equal(valid.priority, 'B');
assert.equal(valid.confidence, 0.85);
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
assertPublicReasonCodes(classifyRecord({ country: 'Unknown' }, {}));
const schemaRankReasonCodes = [
  REASON_CODES.FIXTURE_MARKER,
  REASON_CODES.SECURITY_NOTICE,
  REASON_CODES.EXCLUDED_COUNTRY,
  REASON_CODES.UNAPPROVED_COUNTRY,
  REASON_CODES.MISSING_IDENTITY,
  REASON_CODES.AMBIGUOUS_CONTACT,
  REASON_CODES.UNKNOWN_WHATSAPP_SENDER,
  REASON_CODES.MALFORMED_SOURCE_TIME,
  REASON_CODES.CONFLICTING_DOMAINS,
  REASON_CODES.APPROVED_COUNTRY,
  REASON_CODES.OFFICIAL_DOMAIN,
  REASON_CODES.PRODUCT_EVIDENCE,
  REASON_CODES.VALID_SOURCE_TIME
];
schemaRankReasonCodes.forEach(code => assert(observedReasonCodes.has(code), `schemaRank contract did not exercise ${code}`));
console.log('schema-rank tests passed');

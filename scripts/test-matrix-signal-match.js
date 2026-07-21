'use strict';

const assert = require('node:assert');
const { scoreSignalMatch } = require('../src/services/matrixSignalMatch');

function completeDetail() {
  return {
    country_code: 'TH',
    scale_tier: 'mid-large',
    categories: ['shampoo', 'body wash', 'home care'],
    format_signals: ['refill pouches', 'multiple private-label SKUs'],
    contacts: { email: 'packaging@example.test', contact_page: 'https://example.test/contact' },
    strategy_signal: {
      entry_product: 'refill pouch',
      differentiation_angle: 'filling-line fit, leak review and repeat-print control',
      first_contact_goal: 'review one representative SKU',
      questions: ['Which lines use refill pouches?'],
      risks: ['Current material and filling conditions remain unknown']
    },
    official_evidence: [
      { source_url: 'https://example.test/about', page_title: 'Company Profile', excerpt: 'OEM ODM manufacturer with export capacity' },
      { source_url: 'https://example.test/products', page_title: 'Product Portfolio', excerpt: 'Shampoo body wash and home care products' },
      { source_url: 'https://example.test/services', page_title: 'Packaging Service and Development', excerpt: 'Private label development and packaging testing' },
      { source_url: 'https://example.test/quality', page_title: 'Quality Testing', excerpt: 'Laboratory testing regulatory and traceability' },
      { source_url: 'https://example.test/sustainability', page_title: 'Sustainable Packaging', excerpt: 'Recyclable mono material and material efficiency' },
      { source_url: 'https://example.test/contact', page_title: 'Supplier Contact', excerpt: 'Packaging sourcing and procurement contact' }
    ]
  };
}

const ready = scoreSignalMatch(completeDetail(), { localizedRouteStatus: 'ready' });
assert.strictEqual(ready.passed, true);
assert.ok(ready.score >= ready.threshold);
assert.deepStrictEqual(ready.blockers, []);

const thin = completeDetail();
thin.official_evidence = thin.official_evidence.slice(0, 2);
const blocked = scoreSignalMatch(thin, { localizedRouteStatus: 'ready' });
assert.strictEqual(blocked.passed, false);
assert.ok(blocked.blockers.includes('official_source_coverage_below_3'));
assert.ok(blocked.blockers.includes('development_process_missing'));

const noRoute = scoreSignalMatch(completeDetail(), { localizedRouteStatus: 'not_checked' });
assert.strictEqual(noRoute.passed, false);
assert.ok(noRoute.blockers.includes('localized_journey_not_ready'));

const noContact = completeDetail();
noContact.contacts = { email: '', contact_page: '' };
const inaccessible = scoreSignalMatch(noContact, { localizedRouteStatus: 'ready' });
assert.strictEqual(inaccessible.passed, false);
assert.ok(inaccessible.blockers.includes('organizational_access_missing'));

console.log('matrix signal match gate tests passed');

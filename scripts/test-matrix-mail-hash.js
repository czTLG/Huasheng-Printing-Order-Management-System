'use strict';

const assert = require('node:assert');
const review = require('../src/services/matrixStreamReview');
const {
  MATRIX_MAIL_SIGNATURE,
  renderMatrixMail
} = require('../src/services/matrixMailRender');

const input = {
  recipientEmail: 'buyer@example.test',
  recipientSourceUrl: 'https://example.test/contact',
  subject: 'A focused proposal',
  bodyEn: 'Hello.\n\nThis is the approved body.',
  bodyCn: '您好。\n\n这是批准正文。'
};

const rendered = renderMatrixMail({ bodyEn: input.bodyEn });
const canonical = review.contentHash(input);
const same = review.contentHash({ ...input, bodyEn: input.bodyEn.replace(/\n/g, '\r\n') });
const changedSignature = review.contentHash({
  ...input,
  mailSignature: { ...MATRIX_MAIL_SIGNATURE, logoAlt: 'Changed company label' }
});

assert.match(canonical, /^[a-f0-9]{64}$/);
assert.strictEqual(canonical, same);
assert.notStrictEqual(canonical, changedSignature);
assert.strictEqual(
  canonical,
  review.contentHash({ ...input, expectedRenderHash: rendered.renderHash })
);
console.log('matrix mail hash tests passed');

'use strict';

const assert = require('node:assert');
const {
  MATRIX_MAIL_SIGNATURE,
  renderMatrixMail
} = require('../src/services/matrixMailRender');

const rendered = renderMatrixMail({
  bodyEn: 'Hello <Buyer> & team.\r\n\r\nLine two\nLine three\nสวัสดี'
});

assert.strictEqual(rendered.templateVersion, 'matrix-brand-v3');
assert.match(rendered.text, /Hello <Buyer> & team\./);
assert.match(rendered.text, /Line two\nLine three/);
assert.match(rendered.text, /สวัสดี/);
assert.match(rendered.text, /Gavin/);
assert.match(rendered.text, /Huasheng Printing Co\., Ltd\./);
assert.match(rendered.text, /https:\/\/gdhspack\.com/);
assert.match(rendered.text, /https:\/\/wa\.me\/8615850502651/);

assert.match(rendered.html, /Hello &lt;Buyer&gt; &amp; team\./);
assert.match(rendered.html, /Line two<br>Line three/);
assert.match(rendered.html, /สวัสดี/);
assert.strictEqual((rendered.html.match(/<img\b/g) || []).length, 1);
assert.match(rendered.html, /src="cid:huasheng-logo@gdhspack\.com"/);
assert.match(rendered.html, /alt="Huasheng Printing Co\., Ltd\."/);
assert.match(rendered.html, /width="160"/);
assert.doesNotMatch(rendered.html, /<script|<form|<iframe|onload=|onclick=|tracking|utm_|display\s*:\s*none/i);
assert.strictEqual(rendered.inlineAttachments.length, 1);
assert.strictEqual(rendered.inlineAttachments[0].cid, 'huasheng-logo@gdhspack.com');
assert.strictEqual(rendered.inlineAttachments[0].contentType, 'image/png');
assert.strictEqual(rendered.inlineAttachments[0].contentDisposition, 'inline');
assert.match(rendered.inlineAttachments[0].sha256, /^[a-f0-9]{64}$/);

assert.match(rendered.renderHash, /^[a-f0-9]{64}$/);
assert.strictEqual(
  rendered.renderHash,
  renderMatrixMail({ bodyEn: 'Hello <Buyer> & team.\n\nLine two\nLine three\nสวัสดี' }).renderHash
);
assert.notStrictEqual(rendered.renderHash, renderMatrixMail({ bodyEn: 'Changed body' }).renderHash);
assert.notStrictEqual(
  rendered.renderHash,
  renderMatrixMail({
    bodyEn: 'Hello <Buyer> & team.\n\nLine two\nLine three\nสวัสดี',
    signature: { ...MATRIX_MAIL_SIGNATURE, logoAlt: 'Changed company label' }
  }).renderHash
);

const legacy = renderMatrixMail({
  bodyEn: [
    'Dear Bidor Kwong Heng OEM Team,',
    '',
    'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
    '',
    'Could you share a current pack photo or specification?',
    '',
    'Best regards,',
    '',
    'Gavin',
    'Guangdong Huasheng Packaging Co., Ltd.',
    'https://gdhspack.com',
    'sales@gdhspack.com'
  ].join('\n')
});
for (const marker of ['Gavin', 'https://gdhspack.com', 'sales@gdhspack.com']) {
  assert.strictEqual((legacy.text.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
}
assert.strictEqual((legacy.text.match(/^Best regards,$/gmi) || []).length, 1);
assert.strictEqual((legacy.html.match(/Best regards,/g) || []).length, 1);
assert.match(legacy.text, /We are Guangdong Huasheng Packaging Co\., Ltd\., a flexible packaging manufacturer in China\./);

const shortBrandSignature = renderMatrixMail({
  bodyEn: 'Dear COCOME Business Team,\n\nThank you for your time.\n\nBest regards,\nGavin\nHuasheng Packaging'
});
assert.strictEqual((shortBrandSignature.text.match(/^Best regards,$/gmi) || []).length, 1);
assert.strictEqual((shortBrandSignature.text.match(/^Gavin$/gmi) || []).length, 1);
assert.strictEqual((shortBrandSignature.text.match(/^Huasheng Packaging$/gmi) || []).length, 0);

assert.throws(() => renderMatrixMail({ bodyEn: '' }), /body required/);
assert.throws(
  () => renderMatrixMail({
    bodyEn: 'Hello',
    signature: { ...MATRIX_MAIL_SIGNATURE, logoUrl: 'http://gdhspack.com/media/brand/logo.png' }
  }),
  /logo URL invalid/
);
assert.throws(
  () => renderMatrixMail({
    bodyEn: 'Hello',
    signature: { ...MATRIX_MAIL_SIGNATURE, logoUrl: 'https://example.com/logo.png' }
  }),
  /logo URL invalid/
);

assert.ok(Object.isFrozen(rendered));
assert.ok(Object.isFrozen(rendered.signature));
console.log('matrix mail render tests passed');

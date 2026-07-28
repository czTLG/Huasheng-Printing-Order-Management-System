'use strict';

const assert = require('node:assert');
const {
  MATRIX_MAIL_SIGNATURE,
  renderMatrixMail
} = require('../src/services/matrixMailRender');

const rendered = renderMatrixMail({
  bodyEn: 'Hello <Buyer> & team.\r\n\r\nLine two\nLine three\nสวัสดี'
});

assert.strictEqual(rendered.templateVersion, 'matrix-brand-v1');
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
assert.match(rendered.html, /src="https:\/\/gdhspack\.com\/media\/brand\/logo\.png"/);
assert.match(rendered.html, /alt="Huasheng Printing Co\., Ltd\."/);
assert.match(rendered.html, /width="160"/);
assert.doesNotMatch(rendered.html, /<script|<form|<iframe|onload=|onclick=|tracking|utm_|display\s*:\s*none/i);

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

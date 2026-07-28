'use strict';

const assert = require('node:assert');
const { renderMatrixMail } = require('../src/services/matrixMailRender');
const {
  inspectMatrixMail,
  buildMime,
  verificationPassed
} = require('./verify-matrix-mail-template');

(async () => {
  const rendered = renderMatrixMail({
    bodyEn: 'Dear team,\n\nCảm ơn Quý công ty đã dành thời gian xem thư.\nขอบคุณครับ'
  });
  const inspection = inspectMatrixMail(rendered);
  assert.deepStrictEqual(inspection, {
    safe_html: true,
    utf8_content: true,
    remote_image_count: 1,
    official_logo_count: 1,
    tracking_marker_count: 0,
    text_contact_complete: true,
    html_contact_complete: true
  });

  const mime = await buildMime({
    from: 'sales@gdhspack.com',
    to: 'compatibility@example.test',
    subject: 'Compatibility fixture',
    rendered
  });
  assert.match(mime, /Content-Type: multipart\/alternative/i);
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/i);
  assert.match(mime, /Content-Type: text\/html; charset=utf-8/i);
  assert.match(mime, /C=E1=BA=A3m =C6=A1n|Cảm ơn/i);
  assert.match(mime, /gdhspack\.com\/media\/brand\/logo\.png/);
  assert.doesNotMatch(mime, /Content-Disposition:\s*attachment/i);
  assert.strictEqual(verificationPassed({
    safe_html: true,
    utf8_content: true,
    remote_image_count: 1,
    official_logo_count: 1,
    tracking_marker_count: 0,
    text_contact_complete: true,
    html_contact_complete: true,
    multipart_alternative: true,
    text_plain_utf8: true,
    text_html_utf8: true,
    attachment_count: 0,
    logo_http_ok: true,
    logo_content_type_ok: true,
    send_invoked: false
  }), true);

  assert.throws(
    () => inspectMatrixMail({ ...rendered, html: `${rendered.html}<script>alert(1)</script>` }),
    /unsafe HTML/
  );
  console.log('matrix mail compatibility tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

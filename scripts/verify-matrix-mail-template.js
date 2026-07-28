'use strict';

const https = require('node:https');
const MailComposer = require('nodemailer/lib/mail-composer');
const { renderMatrixMail } = require('../src/services/matrixMailRender');

const LOGO_URL = 'https://gdhspack.com/media/brand/logo.png';
const CONTACTS = [
  'Gavin',
  'Huasheng Printing Co., Ltd.',
  'https://gdhspack.com',
  'sales@gdhspack.com',
  'https://wa.me/8615850502651'
];

function countMatches(value, pattern) {
  return (String(value || '').match(pattern) || []).length;
}

function inspectMatrixMail(rendered) {
  const html = String(rendered?.html || '');
  const text = String(rendered?.text || '');
  const unsafe = /<script|<form|<iframe|<object|<embed|<svg|\son[a-z]+\s*=|javascript:|display\s*:\s*none/i.test(html);
  if (unsafe) throw new Error('unsafe HTML');

  const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
  const official = images.filter(match => match[1] === LOGO_URL);
  const remoteUnapproved = images.filter(match => match[1] !== LOGO_URL);
  if (remoteUnapproved.length) throw new Error('unapproved remote image');
  if (images.length !== 1 || official.length !== 1) throw new Error('official logo count invalid');
  if (!/<img\b[^>]*\balt="[^"]+"[^>]*\bwidth="160"[^>]*>/i.test(html)) throw new Error('logo accessibility invalid');

  const trackingMarkerCount = countMatches(html, /utm_|tracking|pixel|open[_-]?track|click[_-]?track/gi);
  if (trackingMarkerCount) throw new Error('tracking content forbidden');

  const result = {
    safe_html: true,
    utf8_content: /[^\u0000-\u007f]/.test(`${text}${html}`),
    remote_image_count: images.length,
    official_logo_count: official.length,
    tracking_marker_count: trackingMarkerCount,
    text_contact_complete: CONTACTS.every(value => text.includes(value)),
    html_contact_complete: CONTACTS.every(value => html.includes(value === 'https://wa.me/8615850502651' ? value : value))
  };
  if (!result.text_contact_complete || !result.html_contact_complete) throw new Error('contact fallback incomplete');
  return result;
}

async function buildMime({ from, to, subject, rendered } = {}) {
  inspectMatrixMail(rendered);
  const composer = new MailComposer({
    from,
    to,
    subject,
    text: rendered.text,
    html: rendered.html
  });
  const buffer = await composer.compile().build();
  return buffer.toString('utf8');
}

function checkLogo() {
  return new Promise((resolve, reject) => {
    const request = https.get(LOGO_URL, {
      headers: { 'User-Agent': 'matrix-mail-template-verifier/1.0' },
      timeout: 10000
    }, response => {
      response.resume();
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      resolve({
        logo_http_ok: response.statusCode === 200,
        logo_content_type_ok: contentType.startsWith('image/'),
        logo_cache_header_present: Boolean(response.headers['cache-control'] || response.headers.etag)
      });
    });
    request.on('timeout', () => request.destroy(new Error('logo request timeout')));
    request.on('error', reject);
  });
}

function verificationPassed(result) {
  const requiredTrue = [
    'safe_html', 'utf8_content', 'text_contact_complete', 'html_contact_complete',
    'multipart_alternative', 'text_plain_utf8', 'text_html_utf8',
    'logo_http_ok', 'logo_content_type_ok'
  ];
  return requiredTrue.every(key => result?.[key] === true)
    && result?.remote_image_count === 1
    && result?.official_logo_count === 1
    && result?.tracking_marker_count === 0
    && result?.attachment_count === 0
    && result?.send_invoked === false;
}

async function main() {
  if (process.argv[2] !== '--no-send') throw new Error('--no-send required');
  const rendered = renderMatrixMail({
    bodyEn: 'Compatibility check.\n\nCảm ơn Quý công ty.\nขอบคุณครับ'
  });
  const inspection = inspectMatrixMail(rendered);
  const mime = await buildMime({
    from: 'sales@gdhspack.com',
    to: 'compatibility@example.test',
    subject: 'Compatibility check',
    rendered
  });
  const logo = await checkLogo();
  const result = {
    ...inspection,
    multipart_alternative: /Content-Type: multipart\/alternative/i.test(mime),
    text_plain_utf8: /Content-Type: text\/plain; charset=utf-8/i.test(mime),
    text_html_utf8: /Content-Type: text\/html; charset=utf-8/i.test(mime),
    attachment_count: countMatches(mime, /Content-Disposition:\s*attachment/gi),
    ...logo,
    send_invoked: false
  };
  if (!verificationPassed(result)) throw new Error('mail template verification failed');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(String(error?.message || 'mail template verification failed'));
    process.exitCode = 1;
  });
}

module.exports = {
  inspectMatrixMail,
  buildMime,
  verificationPassed
};

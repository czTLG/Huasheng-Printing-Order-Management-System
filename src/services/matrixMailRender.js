'use strict';

const crypto = require('node:crypto');

const MATRIX_MAIL_SIGNATURE = Object.freeze({
  templateVersion: 'matrix-brand-v2',
  name: 'Gavin',
  company: 'Huasheng Printing Co., Ltd.',
  website: 'https://gdhspack.com',
  email: 'sales@gdhspack.com',
  whatsapp: 'https://wa.me/8615850502651',
  logoUrl: 'https://gdhspack.com/media/brand/logo.png',
  logoAlt: 'Huasheng Printing Co., Ltd.'
});

function normalizedBody(value) {
  const body = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (!body) throw new Error('mail body required');
  return body;
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text || /[\r\n\0]/.test(text)) throw new Error(`${label} invalid`);
  return text;
}

function exactHttpsUrl(value, label, expectedHost, expectedPath = '') {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch (_) {
    throw new Error(`${label} invalid`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.hostname.toLowerCase() !== expectedHost
      || (expectedPath && url.pathname !== expectedPath)) {
    throw new Error(`${label} invalid`);
  }
  return url.toString().replace(/\/$/, '');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bodyHtml(body) {
  return body.split(/\n{2,}/).map(paragraph => (
    `<p style="margin:0 0 14px 0;">${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`
  )).join('');
}

function withoutLegacySignature(body) {
  const lines = body.split('\n');
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const legacyLine = value => {
    const line = value.trim();
    return line === 'Gavin'
      || /^Huasheng Packaging$/i.test(line)
      || /^(?:Guangdong\s+)?Huasheng (?:Printing|Packaging) Co\., Ltd\.?$/i.test(line)
      || line === 'https://gdhspack.com'
      || line === 'sales@gdhspack.com'
      || line === 'WhatsApp: https://wa.me/8615850502651';
  };
  let removed = false;
  while (lines.length && (legacyLine(lines.at(-1)) || !lines.at(-1).trim())) {
    if (legacyLine(lines.at(-1))) removed = true;
    lines.pop();
  }
  if (removed || /^Best regards,?$/i.test(String(lines.at(-1) || '').trim())) {
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    if (/^Best regards,?$/i.test(String(lines.at(-1) || '').trim())) lines.pop();
  }
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

function renderMatrixMail({ bodyEn, signature = MATRIX_MAIL_SIGNATURE } = {}) {
  const body = withoutLegacySignature(normalizedBody(bodyEn));
  const normalizedSignature = Object.freeze({
    templateVersion: requiredText(signature?.templateVersion, 'template version'),
    name: requiredText(signature?.name, 'signature name'),
    company: requiredText(signature?.company, 'signature company'),
    website: exactHttpsUrl(signature?.website, 'website URL', 'gdhspack.com'),
    email: requiredText(signature?.email, 'signature email').toLowerCase(),
    whatsapp: exactHttpsUrl(signature?.whatsapp, 'WhatsApp URL', 'wa.me', '/8615850502651'),
    logoUrl: exactHttpsUrl(
      signature?.logoUrl,
      'logo URL',
      'gdhspack.com',
      '/media/brand/logo.png'
    ),
    logoAlt: requiredText(signature?.logoAlt, 'logo alternative text')
  });
  if (normalizedSignature.email !== 'sales@gdhspack.com') throw new Error('signature email invalid');

  const text = [
    body,
    '',
    'Best regards,',
    normalizedSignature.name,
    normalizedSignature.company,
    `Website: ${normalizedSignature.website}`,
    `Email: ${normalizedSignature.email}`,
    `WhatsApp: ${normalizedSignature.whatsapp}`
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="margin:0;padding:0;background:#ffffff;color:#202124;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;">',
    '<div style="max-width:640px;margin:0;padding:0;">',
    bodyHtml(body),
    '<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e5e7eb;">',
    '<div style="margin:0 0 10px 0;color:#374151;">Best regards,</div>',
    `<a href="${escapeHtml(normalizedSignature.website)}" style="text-decoration:none;color:#14532d;">`,
    `<img src="${escapeHtml(normalizedSignature.logoUrl)}" alt="${escapeHtml(normalizedSignature.logoAlt)}" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;margin:0 0 12px 0;">`,
    '</a>',
    `<div style="font-weight:700;color:#111827;">${escapeHtml(normalizedSignature.name)}</div>`,
    `<div style="color:#374151;">${escapeHtml(normalizedSignature.company)}</div>`,
    `<div><a href="${escapeHtml(normalizedSignature.website)}" style="color:#14532d;text-decoration:underline;">${escapeHtml(normalizedSignature.website)}</a></div>`,
    `<div><a href="mailto:${escapeHtml(normalizedSignature.email)}" style="color:#14532d;text-decoration:underline;">${escapeHtml(normalizedSignature.email)}</a></div>`,
    `<div><a href="${escapeHtml(normalizedSignature.whatsapp)}" style="color:#14532d;text-decoration:underline;">WhatsApp: +86 158 5050 2651</a></div>`,
    '</div></div></body></html>'
  ].join('');

  const renderHash = crypto.createHash('sha256').update(JSON.stringify({
    template_version: normalizedSignature.templateVersion,
    body,
    text,
    html,
    signature: normalizedSignature
  })).digest('hex');

  return Object.freeze({
    templateVersion: normalizedSignature.templateVersion,
    text,
    html,
    signature: normalizedSignature,
    renderHash
  });
}

module.exports = {
  MATRIX_MAIL_SIGNATURE,
  renderMatrixMail
};

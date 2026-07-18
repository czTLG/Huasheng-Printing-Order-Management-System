'use strict';

function redactSensitiveText(value) {
  let text = String(value == null ? '' : value).normalize('NFKC');
  text = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[redacted private key]');
  text = text.replace(/\b(authorization\s*:\s*(?:bearer|basic))\s+[^\s,;]+/gi, '$1 [redacted]');
  text = text.replace(/\b((?:https?|smtps?|imaps?):\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[redacted]@');
  text = text.replace(/([?&](?:access_token|auth_token|token|api_key|apikey|secret|password)=)[^&#\s]*/gi, '$1[redacted]');
  text = text.replace(/^([ \t]*(?:password|passwd|passphrase|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|smtp[_ -]?(?:pass|password))\s*[:=])[ \t]*.*$/gim, '$1 [redacted]');
  return text;
}

module.exports = { redactSensitiveText };

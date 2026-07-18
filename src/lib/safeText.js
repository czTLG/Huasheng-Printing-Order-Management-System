'use strict';

function redactSensitiveText(value) {
  let text = String(value == null ? '' : value).normalize('NFKC');
  text = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[REDACTED]');
  text = text.replace(/\b((?:https?|smtps?|imaps?):\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[redacted]@');
  text = text.replace(/([?&](?:access_token|auth_token|token|api_key|apikey|secret|password)=)[^&#\s]*/gi, '$1[redacted]');
  const sensitiveLine = /(?:\bauthorization\s*:|\b(?:password|passwd|passphrase|secret|credentials?|api[_ -]?key|access[_ -]?token|auth[_ -]?token|smtp[_ -]?(?:pass|password))\b|\b(?:private|internal)\b.*\b(?:cost(?:ing)?|formula|margin)\b|\b(?:cost|margin)[_ -]?formula\b)/i;
  return text.split(/\r?\n/).map(line => sensitiveLine.test(line) ? '[REDACTED]' : line).join('\n');
}

module.exports = { redactSensitiveText };

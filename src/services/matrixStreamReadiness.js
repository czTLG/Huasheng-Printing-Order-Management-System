'use strict';

function normalizeTxt(records) {
  return (Array.isArray(records) ? records : []).flat(Infinity).map(value => String(value || '').trim()).filter(Boolean);
}

function currentPolicy(db, countryCode, channel, nowMs) {
  if (!db || typeof db.prepare !== 'function' || !/^[A-Z]{2}$/.test(countryCode) || !channel) return false;
  const row = db.prepare(`
    SELECT * FROM matrix_stream_country_policies WHERE country_code = ? AND channel = ?
  `).get(countryCode, channel);
  if (!row || row.status !== 'approved') return false;
  const reviewedAt = Date.parse(String(row.reviewed_at || ''));
  const expiresAt = Date.parse(String(row.expires_at || ''));
  let sources;
  try { sources = JSON.parse(row.source_urls_json); } catch (_) { return false; }
  const validSources = Array.isArray(sources) && sources.length > 0 && sources.every(value => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname.includes('.');
    } catch (_) {
      return false;
    }
  });
  return Number.isFinite(reviewedAt) && reviewedAt <= nowMs
    && Number.isFinite(expiresAt) && expiresAt > nowMs
    && row.sender_identity_required === 1 && row.opt_out_required === 1
    && validSources;
}

function cachedCheck(db, domain, selector, nowMs) {
  if (!db || typeof db.prepare !== 'function') return null;
  const rows = db.prepare(`
    SELECT * FROM matrix_stream_sender_checks WHERE sender_domain = ? ORDER BY checked_at DESC
  `).all(domain);
  return rows.find(row => {
    const expiresAt = Date.parse(String(row.expires_at || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
    try { return JSON.parse(row.detail_json || '{}').selector === selector; } catch (_) { return false; }
  }) || null;
}

function createMatrixStreamReadiness({ resolveTxt, verifyTransport, clock = () => new Date() } = {}) {
  if (typeof resolveTxt !== 'function' || typeof verifyTransport !== 'function' || typeof clock !== 'function') {
    throw new Error('readiness dependencies required');
  }
  return {
    async check(input = {}) {
      const domain = String(input.domain || '').trim().toLowerCase().replace(/\.$/, '');
      const selector = String(input.selector || '').trim().toLowerCase();
      const countryCode = String(input.countryCode || '').trim().toUpperCase();
      const channel = String(input.channel || '').trim().toLowerCase();
      const nowDate = clock();
      const nowMs = nowDate instanceof Date ? nowDate.getTime() : Date.parse(String(nowDate));
      const hardFailures = [];
      if (!domain || !domain.includes('.') || !Number.isFinite(nowMs)) hardFailures.push('missing_sender_domain');
      if (!selector) hardFailures.push('missing_selector');

      let row = null;
      try { row = domain && Number.isFinite(nowMs) ? cachedCheck(input.db, domain, selector, nowMs) : null; } catch (_) {}
      if (!row && domain && Number.isFinite(nowMs)) {
        let spf = [];
        let dkim = [];
        let dmarc = [];
        let transport = { tls: false, smtp: false };
        try {
          [spf, dkim, dmarc] = await Promise.all([
            resolveTxt(domain),
            selector ? resolveTxt(`${selector}._domainkey.${domain}`) : Promise.resolve([]),
            resolveTxt(`_dmarc.${domain}`)
          ]);
        } catch (_) {}
        try {
          const verified = await verifyTransport({ domain });
          transport = verified === true ? { tls: true, smtp: true } : (verified || transport);
        } catch (_) {}
        row = {
          sender_domain: domain,
          checked_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + 24 * 3600000).toISOString(),
          spf_ok: Number(normalizeTxt(spf).some(value => /^v=spf1\b/i.test(value))),
          dkim_ok: Number(normalizeTxt(dkim).some(value => /^v=dkim1\b/i.test(value))),
          dmarc_ok: Number(normalizeTxt(dmarc).some(value => /^v=dmarc1\b/i.test(value))),
          tls_ok: Number(transport.tls === true),
          smtp_ok: Number(transport.smtp === true),
          detail_json: JSON.stringify({ selector })
        };
        try {
          input.db.prepare(`
            INSERT INTO matrix_stream_sender_checks (
              sender_domain, checked_at, expires_at, spf_ok, dkim_ok, dmarc_ok,
              tls_ok, smtp_ok, detail_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(row.sender_domain, row.checked_at, row.expires_at, row.spf_ok, row.dkim_ok,
            row.dmarc_ok, row.tls_ok, row.smtp_ok, row.detail_json);
        } catch (_) {}
      }

      if (!row?.spf_ok) hardFailures.push('missing_spf');
      if (!row?.dkim_ok) hardFailures.push('missing_dkim');
      if (!row?.dmarc_ok) hardFailures.push('missing_dmarc');
      if (!row?.tls_ok) hardFailures.push('missing_tls');
      if (!row?.smtp_ok) hardFailures.push('missing_smtp_verification');
      try {
        if (!currentPolicy(input.db, countryCode, channel, nowMs)) hardFailures.push('country_channel_policy_not_approved');
      } catch (_) {
        hardFailures.push('country_channel_policy_not_approved');
      }
      return { ok: hardFailures.length === 0, hardFailures: [...new Set(hardFailures)], checkedAt: row?.checked_at || null };
    }
  };
}

module.exports = { createMatrixStreamReadiness };

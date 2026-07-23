'use strict';

const { evaluateInitialContact } = require('./matrixStreamGate');

function reasons(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))];
}

function gate(ok, values = []) {
  return { ok: ok === true, reasons: ok === true ? [] : reasons(values) };
}

function snapshotOf(version) {
  try {
    const value = JSON.parse(String(version?.source_snapshot_json || ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function createMatrixStreamPreview({ db, readinessService, clock = () => new Date(), senderDomain, dkimSelector } = {}) {
  if (!db || typeof db.prepare !== 'function' || !readinessService || typeof readinessService.check !== 'function' || typeof clock !== 'function') {
    throw new Error('preview gate dependencies required');
  }
  const domain = String(senderDomain || '').trim().toLowerCase();
  const selector = String(dkimSelector || '').trim().toLowerCase();

  return {
    async project(base = {}) {
      const nowValue = clock();
      const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue));
      const now = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : '';
      const version = base?.version || {};
      const snapshot = snapshotOf(version);
      const email = String(version.recipient_email || '').trim().toLowerCase();
      const recipientDomain = email.split('@')[1] || '';
      const suppliedIdentity = base?.identity;
      const identity = suppliedIdentity && typeof suppliedIdentity === 'object' ? suppliedIdentity : snapshot && now ? evaluateInitialContact(db, {
        email,
        domain: recipientDomain,
        companyName: snapshot.company,
        aliases: snapshot.aliases,
        now
      }) : { allowed: false, route: 'blocked', reasons: ['identity_check_failed'] };

      const identityReasons = reasons(identity.reasons);
      const initial = identity.allowed === true && identity.route === 'initial_contact';
      const existing = identity.allowed === true && identity.route === 'existing_relationship';
      const duplicateReasons = initial ? [] : existing
        ? ['existing_relationship_requires_reply_route']
        : identityReasons.filter(value => !['domain_cooling_90_days', 'daily_accepted_limit_5'].includes(value));
      const duplicate = gate(initial, duplicateReasons.length ? duplicateReasons : ['identity_check_failed']);
      const cooling = gate(initial || !identityReasons.includes('domain_cooling_90_days'), ['domain_cooling_90_days']);
      const quota = gate(initial || !identityReasons.includes('daily_accepted_limit_5'), ['daily_accepted_limit_5']);

      let readiness;
      try {
        readiness = await readinessService.check({
          db,
          domain,
          selector,
          countryCode: String(snapshot?.country_code || '').trim().toUpperCase(),
          channel: 'email'
        });
      } catch (_) {
        readiness = { ok: false, hardFailures: ['sender_readiness_unavailable', 'country_channel_policy_not_approved'] };
      }
      const readinessReasons = reasons(readiness?.hardFailures);
      const policyReasons = readinessReasons.filter(value => value === 'country_channel_policy_not_approved');
      const senderReasons = readinessReasons.filter(value => value !== 'country_channel_policy_not_approved');
      const readinessGate = gate(senderReasons.length === 0, senderReasons);
      const policy = gate(policyReasons.length === 0, policyReasons);
      const baseAllowed = base?.allowed === true && reasons(base?.reasons).length === 0;
      const allowed = baseAllowed && [duplicate, cooling, quota, readinessGate, policy].every(value => value.ok);
      return { ...base, allowed, duplicate, cooling, quota, readiness: readinessGate, policy };
    }
  };
}

module.exports = { createMatrixStreamPreview };

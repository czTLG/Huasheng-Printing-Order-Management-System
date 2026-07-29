'use strict';

const APPROVED_ADDRESS = 'sales@gdhspack.com';
const COMMERCIAL_SENDER_HEADER = `Gavin | Huasheng Packaging <${APPROVED_ADDRESS}>`;

function required(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error('SMTP configuration incomplete');
  return value;
}

function senderAddress(value) {
  const raw = String(value || '').trim();
  if ([...raw].some(character => [0, 10, 13].includes(character.charCodeAt(0)))) {
    throw new Error('SMTP sender identity invalid');
  }
  const bracketed = raw.match(/<([^<>]+)>\s*$/);
  const address = String(bracketed ? bracketed[1] : raw).trim().toLowerCase();
  if (address !== APPROVED_ADDRESS) throw new Error('SMTP sender identity mismatch');
  return address;
}

function secureValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error('SMTP secure setting invalid');
}

function createMatrixRelayFactory({ env = process.env, nodemailerImpl = require('nodemailer'), clock = () => new Date() } = {}) {
  const host = required(env, 'SMTP_HOST');
  const port = Number(required(env, 'SMTP_PORT'));
  const secure = secureValue(required(env, 'SMTP_SECURE'));
  const user = required(env, 'SMTP_USER');
  const pass = required(env, 'SMTP_PASS');
  const from = required(env, 'SMTP_FROM');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP port invalid');
  const approved = senderAddress(from);
  const transport = nodemailerImpl.createTransport({ host, port, secure, auth: { user, pass } });
  if (!transport || typeof transport.verify !== 'function' || typeof transport.sendMail !== 'function') {
    throw new Error('SMTP transport invalid');
  }

  return {
    senderAddress: approved,
    senderHeader: COMMERCIAL_SENDER_HEADER,
    replyToAddress: approved,
    transport,
    async readiness() {
      const checkedAt = new Date(clock()).toISOString();
      try {
        await transport.verify();
        return { ready: true, checkedAt, errorClass: '' };
      } catch (_) {
        return { ready: false, checkedAt, errorClass: 'smtp_unavailable' };
      }
    }
  };
}

module.exports = { createMatrixRelayFactory, APPROVED_ADDRESS, COMMERCIAL_SENDER_HEADER };

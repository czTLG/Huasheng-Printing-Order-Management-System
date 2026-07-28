#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const COMMANDS = new Set(['customer.get', 'preview.get', 'delivery.confirm', 'thread.list', 'task.list', 'intake.create']);
const FLAGS = new Set([
  'id', 'customer-id', 'version-id', 'content-hash', 'confirmation',
  'idempotency-key', 'chat-id', 'card-event-id', 'input'
]);

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} required`);
  return number;
}

function required(value, label, maximum = 256) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum || /[\r\n\0]/.test(text)) throw new Error(`${label} required`);
  return text;
}

function parseFlags(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = String(args[index] || '');
    if (!flag.startsWith('--') || index + 1 >= args.length) throw new Error('flag value required');
    const name = flag.slice(2);
    if (!FLAGS.has(name) || Object.hasOwn(values, name)) throw new Error(`unknown or repeated flag: ${flag}`);
    values[name] = args[index + 1];
  }
  return values;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const command = `${args[0] || ''}.${args[1] || ''}`;
  if (!COMMANDS.has(command)) throw new Error('supported command required');
  const flags = parseFlags(args.slice(2));
  if (command === 'customer.get') {
    if (Object.keys(flags).some(key => key !== 'id')) throw new Error('customer get accepts only --id');
    return { command, customerId: positiveId(flags.id, 'id') };
  }
  if (command === 'preview.get' || command === 'thread.list' || command === 'task.list') {
    if (Object.keys(flags).some(key => key !== 'customer-id')) throw new Error(`${command} accepts only --customer-id`);
    return { command, customerId: positiveId(flags['customer-id'], 'customer-id') };
  }
  if (command === 'intake.create') {
    if (Object.keys(flags).some(key => !new Set(['input', 'idempotency-key']).has(key))) throw new Error('intake create accepts only --input and --idempotency-key');
    return {
      command,
      inputPath: required(flags.input, 'input', 1000),
      idempotencyKey: required(flags['idempotency-key'], 'idempotency-key', 200)
    };
  }
  const allowed = new Set(['customer-id', 'version-id', 'content-hash', 'confirmation', 'idempotency-key', 'chat-id', 'card-event-id']);
  if (Object.keys(flags).some(key => !allowed.has(key))) throw new Error('unknown delivery confirmation flag');
  const customerId = positiveId(flags['customer-id'], 'customer-id');
  const versionId = positiveId(flags['version-id'], 'version-id');
  const contentHash = required(flags['content-hash'], 'content-hash', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('valid content-hash required');
  const confirmation = required(flags.confirmation, 'confirmation');
  if (!/^确认发送 \S.+$/u.test(confirmation)) throw new Error('exact confirmation required');
  const idempotencyKey = required(flags['idempotency-key'], 'idempotency-key', 200);
  return {
    command,
    customerId,
    versionId,
    contentHash,
    confirmation,
    idempotencyKey,
    chatId: required(flags['chat-id'] || 'codex-current-session', 'chat-id'),
    cardEventId: required(flags['card-event-id'] || `cli-${idempotencyKey}`, 'card-event-id')
  };
}

function openId(env) {
  return required(env.MATRIX_CONTEXT_OPEN_ID || env.MATRIX_OWNER_OPEN_ID, 'open id', 128);
}

function protectedIntake(inputPath, env) {
  const root = fs.realpathSync(env.MATRIX_INTAKE_DIR || '/home/admin/.codex/matrix-runtime/intakes');
  const requested = path.resolve(inputPath);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('intake input must be a regular protected file');
  const resolved = fs.realpathSync(requested);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('intake input is outside the protected directory');
  if ((stat.mode & 0o077) !== 0) throw new Error('intake input permissions must be 0600 or stricter');
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('intake input must be an object');
  const scan = item => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (/(?:password|token|secret|cookie|oauth|smtp)/i.test(key)) throw new Error('credential-like key is forbidden in intake input');
      scan(child);
    }
  };
  scan(value);
  return value;
}

async function run(argv, options = {}) {
  const input = parseArgs(argv);
  const env = options.env || process.env;
  const client = options.client || require(path.resolve(
    __dirname,
    '../.runtime/vm_debug_ci/workspace/scripts/matrix-client.js'
  ));
  const actor = openId(env);
  if (input.command === 'intake.create') {
    const payload = protectedIntake(input.inputPath, env);
    return client.createIntake(actor, { ...payload, idempotency_key: input.idempotencyKey });
  }
  if (input.command === 'customer.get') return client.customerGet(actor, input.customerId);
  if (input.command === 'preview.get') return client.finalPreview(actor, input.customerId);
  if (input.command === 'thread.list') return client.threadList(actor, input.customerId);
  if (input.command === 'task.list') return client.taskList(actor, input.customerId);
  return client.confirmDelivery(actor, input.customerId, input.versionId, {
    expected_content_hash: input.contentHash,
    confirmation_text: input.confirmation,
    idempotency_key: input.idempotencyKey,
    chat_id: input.chatId,
    card_event_id: input.cardEventId
  });
}

function safeError(error) {
  const status = Number(error?.status);
  const code = String(error?.apiPayload?.code || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  return { ok: false, ...(Number.isInteger(status) ? { status } : {}), ...(code ? { code } : {}), error: 'matrix command failed' };
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`${JSON.stringify(safeError(error))}\n`);
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, run };

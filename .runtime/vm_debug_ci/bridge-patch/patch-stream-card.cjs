#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ORIGINAL_SHA256 = 'b8016fbab2d60bc4da32b45f48564aec76059b184f943df1c1f0a4a1a1e32233';
const PATCHED_SHA256 = '6e47c9074a4872f4fd748ccd1eb54ceeadc3ebcf5d167492ac034841d86115a9';
const MESSAGE_CALL = 'if (streamCardHandler?.onMessage && await streamCardHandler.onMessage({ msg, project })) return;';
const REGISTRATION_FIRST_LINE = 'const streamCardPath = process.env.STREAM_CARD_EXTENSION;';
const LOADER_ANCHOR = 'var __defProp = Object.defineProperty;';
const LOADER_LINE = 'import { createRequire as createStreamCardRequire } from "node:module";';
const MANAGED_SIGNATURE_ORIGINAL = 'async function sendManagedCard(channel, to, card2, replyTo, replyInThread = false, receiveIdType = "chat_id") {';
const MANAGED_SIGNATURE_PATCHED = 'async function sendManagedCard(channel, to, card2, replyTo, replyInThread = false, receiveIdType = "chat_id", messageUuid) {';
const MANAGED_CREATE_ORIGINAL = 'data: { receive_id: to, msg_type: "interactive", content }';
const MANAGED_CREATE_PATCHED = 'data: { receive_id: to, msg_type: "interactive", content, ...messageUuid ? { uuid: messageUuid } : {} }';
const MANAGED_UUID_VALIDATION = 'if (messageUuid !== void 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(messageUuid)) throw new Error("invalid managed-card message uuid");';
const MANAGED_SINGLE_ATTEMPT = 'if (messageUuid !== void 0) return await attempt();';
const MANAGED_END_ANCHOR = 'async function updateManagedCard';
const DISPOSE_LINE = 'streamCardHandler?.dispose?.();';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function registrationBlock(indent) {
  return [
    `${indent}const streamCardPath = process.env.STREAM_CARD_EXTENSION;`,
    `${indent}const streamCardRequire = createStreamCardRequire(import.meta.url);`,
    `${indent}const streamCardExtension = streamCardPath ? streamCardRequire(streamCardPath) : null;`,
    `${indent}const streamCardHandler = streamCardExtension?.register?.({`,
    `${indent}  channel, dispatcher, sendManagedCard, updateManagedCard,`,
    `${indent}  card: { card, md, note, hr, actions, button, linkButton }`,
    `${indent}});`
  ].join('\n');
}

function exactPair(source, first, second, label) {
  if (occurrences(source, first) !== 1 || occurrences(source, second) !== 1) {
    throw new Error(`${label} must appear exactly once`);
  }
  const escapedFirst = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSecond = second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*)${escapedFirst}\\n\\1${escapedSecond}$`, 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label} must appear exactly once`);
  return { text: matches[0][0], indent: matches[0][1], index: matches[0].index };
}

function exactFunctionStart(source, signature, nestedLine, label) {
  if (occurrences(source, signature) !== 1) throw new Error(`${label} must appear exactly once`);
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedNested = nestedLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`^(\\s*)${escaped}\\n\\1  ${escapedNested}$`, 'gm'))];
  if (matches.length !== 1) throw new Error(`${label} must appear exactly once`);
  return { text: matches[0][0], indent: matches[0][1], index: matches[0].index };
}

function managedRetryAnchor(source, managedStart) {
  const end = source.indexOf(MANAGED_END_ANCHOR, managedStart);
  if (end < 0) throw new Error('managed-card retry boundary must appear after sender');
  const region = source.slice(managedStart, end);
  const retryLine = '  for (let i = 0; ; i++) {';
  if (occurrences(region, retryLine) !== 1) throw new Error('managed-card retry anchor must appear exactly once');
  return managedStart + region.indexOf(retryLine);
}

function patchSource(sourceValue) {
  const source = String(sourceValue);
  const loaderCount = occurrences(source, LOADER_LINE);
  const registrationCount = occurrences(source, REGISTRATION_FIRST_LINE);
  const messageCount = occurrences(source, MESSAGE_CALL);
  const managedCount = occurrences(source, MANAGED_SIGNATURE_PATCHED);
  const disposeCount = occurrences(source, DISPOSE_LINE);
  if (loaderCount || registrationCount || messageCount || managedCount || disposeCount) {
    if (loaderCount !== 1 || registrationCount !== 1 || messageCount !== 1 || managedCount !== 1 || disposeCount !== 1) throw new Error('partial or repeated stream-card patch');
    exactPair(
      source,
      REGISTRATION_FIRST_LINE,
      'const streamCardRequire = createStreamCardRequire(import.meta.url);',
      'patched registration anchor'
    );
    if (occurrences(source, 'const streamCardExtension = streamCardPath ? streamCardRequire(streamCardPath) : null;') !== 1) {
      throw new Error('patched extension loader must appear exactly once');
    }
    if (occurrences(source, MANAGED_CREATE_PATCHED) !== 1 || occurrences(source, MANAGED_UUID_VALIDATION) !== 1 || occurrences(source, MANAGED_SINGLE_ATTEMPT) !== 1) {
      throw new Error('patched managed-card uuid support must appear exactly once');
    }
    if (occurrences(source, 'const cmd = parseCommand(text);') !== 1) throw new Error('patched message anchor must appear exactly once');
    return source;
  }

  const messageAnchor = exactPair(
    source,
    'const text = msg.content.trim();',
    'const cmd = parseCommand(text);',
    'message anchor'
  );
  const registrationAnchor = exactPair(
    source,
    'const dispatcher = new CardDispatcher(channel, cfg);',
    'cliBridge?.register(dispatcher);',
    'registration anchor'
  );
  const managedAnchor = exactFunctionStart(source, MANAGED_SIGNATURE_ORIGINAL, 'stampRenderToken(card2);', 'managed-card signature anchor');
  const shutdownAnchor = exactFunctionStart(source, 'async function shutdown() {', 'clearInterval(reaper);', 'shutdown anchor');
  if (occurrences(source, MANAGED_CREATE_ORIGINAL) !== 1) throw new Error('managed-card create anchor must appear exactly once');
  if (occurrences(source, LOADER_ANCHOR) !== 1) throw new Error('loader anchor must appear exactly once');
  const retryAnchor = managedRetryAnchor(source, managedAnchor.index);

  const patchedMessage = [
    `${messageAnchor.indent}const text = msg.content.trim();`,
    `${messageAnchor.indent}${MESSAGE_CALL}`,
    `${messageAnchor.indent}const cmd = parseCommand(text);`
  ].join('\n');
  const patchedRegistration = [
    registrationAnchor.text,
    registrationBlock(registrationAnchor.indent)
  ].join('\n');
  const patchedManaged = [
    `${managedAnchor.indent}${MANAGED_SIGNATURE_PATCHED}`,
    `${managedAnchor.indent}  stampRenderToken(card2);`,
    `${managedAnchor.indent}  ${MANAGED_UUID_VALIDATION}`
  ].join('\n');
  const patchedShutdown = [
    shutdownAnchor.text,
    `${shutdownAnchor.indent}  ${DISPOSE_LINE}`
  ].join('\n');

  const replacements = [
    { index: messageAnchor.index, before: messageAnchor.text, after: patchedMessage },
    { index: registrationAnchor.index, before: registrationAnchor.text, after: patchedRegistration },
    { index: managedAnchor.index, before: managedAnchor.text, after: patchedManaged },
    { index: shutdownAnchor.index, before: shutdownAnchor.text, after: patchedShutdown },
    { index: source.indexOf(MANAGED_CREATE_ORIGINAL), before: MANAGED_CREATE_ORIGINAL, after: MANAGED_CREATE_PATCHED },
    { index: retryAnchor, before: '', after: `  ${MANAGED_SINGLE_ATTEMPT}\n` },
    { index: source.indexOf(LOADER_ANCHOR), before: '', after: `${LOADER_LINE}\n` }
  ].sort((left, right) => right.index - left.index);
  let output = source;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.index)}${replacement.after}${output.slice(replacement.index + replacement.before.length)}`;
  }
  if (occurrences(output, LOADER_LINE) !== 1 || occurrences(output, REGISTRATION_FIRST_LINE) !== 1 || occurrences(output, MESSAGE_CALL) !== 1 || occurrences(output, MANAGED_SIGNATURE_PATCHED) !== 1 || occurrences(output, MANAGED_CREATE_PATCHED) !== 1 || occurrences(output, MANAGED_UUID_VALIDATION) !== 1 || occurrences(output, MANAGED_SINGLE_ATTEMPT) !== 1 || occurrences(output, DISPOSE_LINE) !== 1) {
    throw new Error('patch postcondition failed');
  }
  return output;
}

function patchFile(targetPath) {
  if (!targetPath) throw new Error('target bundle path required');
  const target = path.resolve(targetPath);
  const original = fs.readFileSync(target);
  const actualHash = sha256(original);
  if (actualHash === PATCHED_SHA256) {
    const validated = patchSource(original.toString('utf8'));
    if (sha256(validated) !== PATCHED_SHA256) throw new Error('patched bundle validation failed');
    process.stdout.write(`original sha256=${ORIGINAL_SHA256}\npatched sha256=${PATCHED_SHA256}\n`);
    return { originalHash: ORIGINAL_SHA256, patchedHash: PATCHED_SHA256, changed: false };
  }
  if (actualHash !== ORIGINAL_SHA256) throw new Error(`checksum mismatch: ${actualHash}`);

  const patched = patchSource(original.toString('utf8'));
  const patchedHash = sha256(patched);
  if (patchedHash !== PATCHED_SHA256) throw new Error(`patched checksum mismatch: ${patchedHash}`);

  const stat = fs.statSync(target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, patched, { flag: 'wx', mode: stat.mode });
    fs.chmodSync(temporary, stat.mode);
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
  process.stdout.write(`original sha256=${actualHash}\npatched sha256=${patchedHash}\n`);
  return { originalHash: actualHash, patchedHash, changed: true };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('exactly one target bundle path required');
    patchFile(process.argv[2]);
  } catch (error) {
    process.stderr.write(`bridge patch failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ORIGINAL_SHA256, PATCHED_SHA256, patchSource, patchFile, sha256 };

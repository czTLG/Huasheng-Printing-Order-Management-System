#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ORIGINAL_SHA256 = 'b8016fbab2d60bc4da32b45f48564aec76059b184f943df1c1f0a4a1a1e32233';
const PATCHED_SHA256 = '95e6b56e8158124dda6a976bff7b1471d23f14386c772776386483c517de3078';
const MESSAGE_CALL = 'if (streamCardHandler?.onMessage && await streamCardHandler.onMessage({ msg, project })) return;';
const REGISTRATION_FIRST_LINE = 'const streamCardPath = process.env.STREAM_CARD_EXTENSION;';
const LOADER_ANCHOR = 'var __defProp = Object.defineProperty;';
const LOADER_LINE = 'import { createRequire as createStreamCardRequire } from "node:module";';

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

function patchSource(sourceValue) {
  const source = String(sourceValue);
  const loaderCount = occurrences(source, LOADER_LINE);
  const registrationCount = occurrences(source, REGISTRATION_FIRST_LINE);
  const messageCount = occurrences(source, MESSAGE_CALL);
  if (loaderCount || registrationCount || messageCount) {
    if (loaderCount !== 1 || registrationCount !== 1 || messageCount !== 1) throw new Error('partial or repeated stream-card patch');
    exactPair(
      source,
      REGISTRATION_FIRST_LINE,
      'const streamCardRequire = createStreamCardRequire(import.meta.url);',
      'patched registration anchor'
    );
    if (occurrences(source, 'const streamCardExtension = streamCardPath ? streamCardRequire(streamCardPath) : null;') !== 1) {
      throw new Error('patched extension loader must appear exactly once');
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
  if (occurrences(source, LOADER_ANCHOR) !== 1) throw new Error('loader anchor must appear exactly once');

  const patchedMessage = [
    `${messageAnchor.indent}const text = msg.content.trim();`,
    `${messageAnchor.indent}${MESSAGE_CALL}`,
    `${messageAnchor.indent}const cmd = parseCommand(text);`
  ].join('\n');
  const patchedRegistration = [
    registrationAnchor.text,
    registrationBlock(registrationAnchor.indent)
  ].join('\n');

  const replacements = [
    { index: messageAnchor.index, before: messageAnchor.text, after: patchedMessage },
    { index: registrationAnchor.index, before: registrationAnchor.text, after: patchedRegistration },
    { index: source.indexOf(LOADER_ANCHOR), before: '', after: `${LOADER_LINE}\n` }
  ].sort((left, right) => right.index - left.index);
  let output = source;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.index)}${replacement.after}${output.slice(replacement.index + replacement.before.length)}`;
  }
  if (occurrences(output, LOADER_LINE) !== 1 || occurrences(output, REGISTRATION_FIRST_LINE) !== 1 || occurrences(output, MESSAGE_CALL) !== 1) {
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

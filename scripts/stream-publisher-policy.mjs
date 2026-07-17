#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const POLICY_MESSAGE =
  'Blocked by draft approval policy: top-level type must be "draft".';

export function assertDraftPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(
      'Draft approval policy requires a single post payload object.',
    );
  }

  if (payload.type !== 'draft') {
    throw new Error(POLICY_MESSAGE);
  }

  return payload;
}

export function validateDraftJson(source) {
  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON input.');
  }

  return assertDraftPayload(payload);
}

async function readInput(filePath) {
  if (filePath) {
    return readFile(filePath, 'utf8');
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const source = await readInput(process.argv[2]);
    const payload = validateDraftJson(source);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Policy validation failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}

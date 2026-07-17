#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateDraftJson } from './stream-publisher-policy.mjs';

function optionValue(args, names) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (names.includes(argument)) {
      return args[index + 1];
    }

    for (const name of names) {
      if (argument.startsWith(`${name}=`)) {
        return argument.slice(name.length + 1);
      }
    }
  }

  return undefined;
}

export async function prepareInvocation(args) {
  const prepared = [...args];
  const command = prepared[0];

  if (command === 'posts:create') {
    const requestedType = optionValue(prepared, ['--type', '-t']);
    if (requestedType && requestedType !== 'draft') {
      throw new Error(
        'Blocked by draft approval policy: post creation must use type "draft".',
      );
    }

    const jsonPath = optionValue(prepared, ['--json', '-j']);
    if (jsonPath) {
      const source = await readFile(jsonPath, 'utf8');
      validateDraftJson(source);
      return prepared;
    }

    if (!requestedType) {
      prepared.push('--type', 'draft');
    }
  }

  if (command === 'posts:status') {
    const requestedStatus = optionValue(prepared, ['--status']);
    if (requestedStatus && requestedStatus !== 'draft') {
      throw new Error(
        'Blocked: explicit publication approval is required before scheduling a draft.',
      );
    }
  }

  return prepared;
}

async function run() {
  try {
    const args = await prepareInvocation(process.argv.slice(2));
    const child = spawn('postiz', args, {
      env: {
        ...process.env,
        POSTIZ_API_URL:
          process.env.POSTIZ_API_URL || 'http://127.0.0.1:4407/api',
      },
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      process.stderr.write(`Unable to start upstream CLI: ${error.message}\n`);
      process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
      process.exitCode = signal ? 1 : (code ?? 1);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Policy validation failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await run();
}

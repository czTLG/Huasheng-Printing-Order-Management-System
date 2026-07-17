import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareInvocation } from './stream-publisher-cli.mjs';

test('adds draft type to flag-based post creation', async () => {
  const args = await prepareInvocation([
    'posts:create',
    '-c',
    'https://gdhspack.com',
    '-s',
    '2026-07-18T01:00:00.000Z',
    '-i',
    'pinterest-1',
  ]);

  assert.deepEqual(args.slice(-2), ['--type', 'draft']);
});

test('rejects a non-draft type in flag-based post creation', async () => {
  await assert.rejects(
    prepareInvocation(['posts:create', '-t', 'schedule']),
    /draft approval policy/i,
  );
});

test('validates JSON post creation before invoking the upstream CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stream-publisher-test-'));
  const draftPath = join(directory, 'draft.json');
  const schedulePath = join(directory, 'schedule.json');

  try {
    await writeFile(draftPath, '{"type":"draft","posts":[]}');
    await writeFile(schedulePath, '{"type":"schedule","posts":[]}');

    assert.deepEqual(
      await prepareInvocation(['posts:create', '--json', draftPath]),
      ['posts:create', '--json', draftPath],
    );
    await assert.rejects(
      prepareInvocation(['posts:create', '--json', schedulePath]),
      /draft approval policy/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('blocks promotion of a draft into the publishing queue', async () => {
  await assert.rejects(
    prepareInvocation(['posts:status', 'post-1', '--status', 'schedule']),
    /explicit publication approval/i,
  );
});

test('passes read-only discovery commands unchanged', async () => {
  assert.deepEqual(
    await prepareInvocation(['integrations:list']),
    ['integrations:list'],
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDraftPayload,
  validateDraftJson,
} from './stream-publisher-policy.mjs';

const draft = {
  type: 'draft',
  date: '2026-07-18T01:00:00.000Z',
  shortLink: false,
  tags: [],
  posts: [
    {
      integration: { id: 'pinterest-1' },
      value: [{ content: 'https://gdhspack.com', image: [] }],
      settings: { __type: 'pinterest', board: 'board-1' },
    },
    {
      integration: { id: 'youtube-1' },
      value: [{ content: 'https://gdhspack.com', image: [] }],
      settings: { __type: 'youtube', title: 'Draft', type: 'private' },
    },
  ],
};

test('accepts a multi-platform draft payload', () => {
  assert.equal(assertDraftPayload(draft), draft);
});

test('rejects immediate and scheduled publication', () => {
  for (const type of ['now', 'schedule']) {
    assert.throws(
      () => assertDraftPayload({ ...draft, type }),
      /draft approval policy/i,
    );
  }
});

test('rejects a payload without an explicit draft type', () => {
  const { type: _type, ...withoutType } = draft;
  assert.throws(() => assertDraftPayload(withoutType), /draft approval policy/i);
});

test('rejects batch arrays that could mix publication states', () => {
  assert.throws(
    () => assertDraftPayload([draft, { ...draft, type: 'now' }]),
    /single post payload/i,
  );
});

test('rejects malformed JSON without echoing content', () => {
  const sensitiveContent = 'private-content-that-must-not-be-logged';
  assert.throws(
    () => validateDraftJson(`{"type":"draft","posts":["${sensitiveContent}"]`),
    (error) => {
      assert.match(error.message, /invalid json/i);
      assert.doesNotMatch(error.message, new RegExp(sensitiveContent));
      return true;
    },
  );
});

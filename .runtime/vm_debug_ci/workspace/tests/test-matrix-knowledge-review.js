'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const review = require('../scripts/matrix-knowledge-review.js');

function binding(question) {
  return {
    question_id: question.id,
    question_version: question.version,
    fingerprint: question.fingerprint
  };
}

function read(storePath) {
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-knowledge-'));
const storePath = path.join(root, 'knowledge.json');
const now = new Date('2026-08-20T01:00:00.000Z');
const store = review.createStore({ storePath, now: () => now });

try {
  const first = store.current();
  const firstCard = review.questionCard(first);
  assert.strictEqual(review.cardBinding(firstCard).question_id, first.id);
  const firstMarkdown = firstCard.body.elements.filter(element => element.tag === 'markdown').map(element => element.content).join('\n');
  for (const [letter, label] of Object.entries(first.options)) {
    assert(firstMarkdown.includes(label), `full option ${letter} must remain visible outside the button`);
  }
  const firstButtons = firstCard.body.elements.flatMap(element => element.columns || []).flatMap(column => column.elements || []);
  assert.deepStrictEqual(firstButtons.map(button => button.text.content), ['选择 A', '选择 B', '选择 C', '选择 D']);
  assert(firstButtons.every(button => button.text.content.length <= 4), 'choice buttons must stay short enough to avoid truncation');
  assert.strictEqual(review.reviewerAllowed('ou-owner', { MATRIX_OWNER_OPEN_ID: 'ou-owner' }), true);
  assert.strictEqual(review.reviewerAllowed('ou-other', { MATRIX_OWNER_OPEN_ID: 'ou-owner' }), false);

  assert.throws(() => store.submitChoice({
    ...binding(first), fingerprint: '0'.repeat(64), choice: 'A', actor_id: 'ou-owner', event_key: 'wrong-fingerprint'
  }), /binding mismatch/);
  assert.strictEqual(store.current().id, first.id);

  const answer = store.submitChoice({
    ...binding(first), choice: 'D', actor_id: 'ou-owner', event_key: 'choice-1'
  });
  assert.strictEqual(answer.status, 'recorded');
  assert.notStrictEqual(answer.current.id, first.id);
  const duplicate = store.submitChoice({
    ...binding(first), choice: 'D', actor_id: 'ou-owner', event_key: 'choice-1'
  });
  assert.strictEqual(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.current.id, answer.current.id);
  assert.strictEqual(read(storePath).answers.length, 1);
  assert.throws(() => store.submitChoice({
    ...binding(first), choice: 'A', actor_id: 'ou-owner', event_key: 'stale-card-new-event'
  }), /binding mismatch/);
  assert.strictEqual(store.current().id, answer.current.id);
  assert.strictEqual(read(storePath).answers.length, 1);

  const firstCandidate = store.listCandidates({ status: 'pending_review' })[0];
  assert.strictEqual(firstCandidate.question_id, first.id);
  assert.strictEqual(firstCandidate.answer_text, first.options.D);
  assert.throws(() => store.reviewCandidate({
    candidate_id: firstCandidate.candidate_id,
    expected_digest: '2'.repeat(64),
    action: 'approved_for_rule_draft',
    reviewer: 'ou-owner',
    note: 'wrong digest must not pass'
  }), /digest mismatch/);
  assert.strictEqual(store.listCandidates({ status: 'pending_review' }).length, 1);
  const reviewedCandidate = store.reviewCandidate({
    candidate_id: firstCandidate.candidate_id,
    expected_digest: firstCandidate.candidate_digest,
    action: 'approved_for_rule_draft',
    reviewer: 'ou-owner',
    note: '只批准进入非激活规则草案，不作为生产规则。'
  });
  assert.strictEqual(reviewedCandidate.candidate.question_id, first.id);
  assert.strictEqual(store.listCandidates({ status: 'approved_for_rule_draft' }).length, 1);
  assert.throws(() => store.createRuleDraft({
    candidate_id: firstCandidate.candidate_id,
    expected_digest: firstCandidate.candidate_digest,
    created_by: 'ou-owner',
    scope: '所有订单',
    exclusions: '',
    validity_days: 30,
    test_cases: []
  }), /inactive rule draft fields/);
  const ruleDraft = store.createRuleDraft({
    candidate_id: firstCandidate.candidate_id,
    expected_digest: firstCandidate.candidate_digest,
    created_by: 'ou-owner',
    scope: '仅用于通用商业门槛候选规则的内部复核',
    exclusions: '不适用于具体客户、特殊工艺或未确认材料采购门槛',
    validity_days: 30,
    test_cases: ['相同订单金额但不同图稿时必须重新复核', '缺少最低开机价值时不得输出数值']
  });
  assert.strictEqual(ruleDraft.rule_draft.status, 'draft_inactive');
  assert.strictEqual(store.listRuleDrafts().length, 1);
  assert.strictEqual(read(storePath).answers[0].knowledge_status, 'rule_draft_inactive');
  const duplicateDraft = store.createRuleDraft({
    candidate_id: firstCandidate.candidate_id,
    expected_digest: firstCandidate.candidate_digest,
    created_by: 'ou-owner',
    scope: '仅用于通用商业门槛候选规则的内部复核',
    exclusions: '不适用于具体客户、特殊工艺或未确认材料采购门槛',
    validity_days: 30,
    test_cases: ['不得输出未批准数值']
  });
  assert.strictEqual(duplicateDraft.status, 'duplicate');
  assert.strictEqual(store.listRuleDrafts().length, 1);

  const second = store.current();
  const staged = store.stageText({
    ...binding(second), text: '我说的是另一个问题，不是这道题', actor_id: 'ou-owner', event_key: 'text-other'
  });
  assert.strictEqual(staged.pending.proposed_classification, 'different_question');
  const classificationCard = review.classificationCard(staged);
  const classificationMarkdown = classificationCard.body.elements.filter(element => element.tag === 'markdown').map(element => element.content).join('\n');
  for (const label of ['这是当前题的答案', '这道题问得不对', '我回答的是另一道题', '暂时跳过这道题']) {
    assert(classificationMarkdown.includes(label), `full classification label must remain visible: ${label}`);
  }
  const classificationButtons = classificationCard.body.elements.flatMap(element => element.columns || []).flatMap(column => column.elements || []);
  assert.deepStrictEqual(classificationButtons.map(button => button.text.content), ['确认 A', '确认 B', '确认 C', '确认 D']);
  assert.strictEqual(store.current().id, second.id);
  assert.throws(() => store.confirmText({
    ...binding(second), pending_id: staged.pending.id, text_hash: '1'.repeat(64),
    classification: 'different_question', actor_id: 'ou-owner'
  }), /binding mismatch/);
  assert.strictEqual(store.current().id, second.id);
  const routed = store.confirmText({
    ...binding(second), pending_id: staged.pending.id, text_hash: staged.pending.text_hash,
    classification: 'different_question', actor_id: 'ou-owner'
  });
  assert.strictEqual(routed.status, 'stored_for_routing');
  assert.strictEqual(routed.current.id, second.id);
  assert.strictEqual(read(storePath).different_question_answers.length, 1);

  const currentText = store.stageText({
    ...binding(second), text: '以上条件需要组合判断，但材料采购门槛优先。', actor_id: 'ou-owner', event_key: 'text-current'
  });
  assert.strictEqual(store.current().id, second.id);
  const confirmed = store.confirmText({
    ...binding(second), pending_id: currentText.pending.id, text_hash: currentText.pending.text_hash,
    classification: 'current_answer', actor_id: 'ou-owner'
  });
  assert.notStrictEqual(confirmed.current.id, second.id);

  const third = store.current();
  const wrongQuestion = store.stageText({
    ...binding(third), text: '这道题问法不对，边界不能这样分。', actor_id: 'ou-owner', event_key: 'text-wrong-question'
  });
  const wrongResult = store.confirmText({
    ...binding(third), pending_id: wrongQuestion.pending.id, text_hash: wrongQuestion.pending.text_hash,
    classification: 'question_wrong', actor_id: 'ou-owner'
  });
  assert.notStrictEqual(wrongResult.current.id, third.id);
  assert.strictEqual(read(storePath).questions.find(item => item.id === third.id).status, 'needs_rewrite');

  const lockedPath = `${storePath}.lock`;
  fs.writeFileSync(lockedPath, 'owned elsewhere');
  assert.throws(() => store.submitChoice({
    ...binding(store.current()), choice: 'A', actor_id: 'ou-owner', event_key: 'locked'
  }), /busy/);
  assert.strictEqual(fs.readFileSync(lockedPath, 'utf8'), 'owned elsewhere');
  fs.unlinkSync(lockedPath);

  assert.strictEqual(fs.statSync(storePath).mode & 0o777, 0o600);

  const raceStorePath = path.join(root, 'knowledge-race.json');
  const raceStore = review.createStore({ storePath: raceStorePath, now: () => now });
  const raceQuestion = raceStore.current();
  const raceText = raceStore.stageText({
    ...binding(raceQuestion), text: '这个文字先不要直接归到题目里。', actor_id: 'ou-owner', event_key: 'race-text'
  });
  const raceChoice = raceStore.submitChoice({
    ...binding(raceQuestion), choice: 'B', actor_id: 'ou-owner', event_key: 'race-choice'
  });
  assert.notStrictEqual(raceChoice.current.id, raceQuestion.id);
  assert.throws(() => raceStore.confirmText({
    ...binding(raceQuestion), pending_id: raceText.pending.id, text_hash: raceText.pending.text_hash,
    classification: 'current_answer', actor_id: 'ou-owner'
  }), /binding mismatch/);
  const raceState = read(raceStorePath);
  assert.strictEqual(raceState.answers.length, 1);
  assert.strictEqual(raceState.answers[0].answer_kind, 'choice');
  assert.strictEqual(raceState.pending_text.length, 1);
  assert.strictEqual(raceStore.current().id, raceChoice.current.id);
  process.stdout.write('matrix knowledge review tests passed\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

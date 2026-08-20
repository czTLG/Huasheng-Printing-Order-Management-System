'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = '/workspace/store/matrix-knowledge-review.json';
const STORE_VERSION = 1;
const QUESTION_SET_VERSION = 1;
const CLASSIFICATIONS = new Set(['current_answer', 'question_wrong', 'different_question', 'skip']);

const QUESTIONS = Object.freeze([
  {
    id: 'commercial-threshold-scope',
    version: 1,
    title: '商业接单门槛按什么维度判断？',
    prompt: '这里问的是通用商业门槛，不是某个客户订单。若没有固定规则，请选 A。',
    options: {
      A: '没有固定通用门槛，每单人工判断',
      B: '主要按整张订单总金额或开机价值',
      C: '主要按每个规格、SKU 或图稿分别判断',
      D: '同时看订单金额和每规格/图稿门槛，具体条件用文字补充'
    }
  },
  {
    id: 'production-threshold-scope',
    version: 1,
    title: '生产数量门槛主要由什么决定？',
    prompt: '请区分母卷可产出数量、材料采购门槛和商业最低货值。',
    options: {
      A: '只按母卷投料后的可产出数量',
      B: '主要按材料、厚度、宽度的采购或投料门槛',
      C: '每个 SKU、规格或图稿还要另设最低数量',
      D: '以上条件组合判断，具体优先级用文字补充'
    }
  },
  {
    id: 'layout-manual-boundary',
    version: 1,
    title: '哪些情况必须转人工排版或设备确认？',
    prompt: '这道题用于阻止普通袋型公式误套特殊结构。',
    options: {
      A: '只要尺寸完整都可以自动判断',
      B: '异形袋必须人工，其他可以自动',
      C: '异形、吸嘴、阀门和特殊结构都必须人工',
      D: '还有更多人工边界，使用文字列出'
    }
  },
  {
    id: 'yield-loss-scope',
    version: 1,
    title: '生产产出损耗是否可以使用统一规则？',
    prompt: '这里只确认生产产出数量的损耗，不确认成本损耗。',
    options: {
      A: '可以统一，并且与成本损耗相同',
      B: '可以统一，但必须与成本损耗分开',
      C: '要按袋型、材料、数量或换版变化',
      D: '目前没有通用规则，每单人工确认'
    }
  },
  {
    id: 'family-c-unit',
    version: 1,
    title: '家人直接录入的 C 应如何解释？',
    prompt: '这道题专门防止 C 被再次除以 10。',
    options: {
      A: '录入的 C 就是内部原始 C，不能再次换算',
      B: '录入的 C 实际是微米，系统仍需除以 10',
      C: '要根据字段来源判断，不能只看字符 C',
      D: '现有说法不准确，请用文字给出正确口径'
    }
  },
  {
    id: 'packing-cbm-authority',
    version: 1,
    title: '装箱和 CBM 能否使用通用表自动计算？',
    prompt: '请考虑折叠方式、每箱数量、外箱尺寸、卷径、托盘和出口包装。',
    options: {
      A: '暂时不能，必须逐单确认装箱资料',
      B: '普通袋可以用通用表，特殊袋转人工',
      C: '袋型和卷膜都可以用通用表',
      D: '可以部分自动，但适用范围需要文字说明'
    }
  },
  {
    id: 'approval-invalidation',
    version: 1,
    title: '哪些变化会让原批准自动失效？',
    prompt: '这道题决定机器人何时必须重新找陈湧杰确认。',
    options: {
      A: '只有客户或数量变化才失效',
      B: '材料、厚度、尺寸、数量或工艺任一变化都失效',
      C: '只有材料价格过期或利润变化才失效',
      D: '需要按字段分级，请用文字补充失效规则'
    }
  }
]);

function canonicalQuestion(question) {
  return JSON.stringify({ id: question.id, version: question.version, title: question.title, prompt: question.prompt, options: question.options });
}

function questionFingerprint(question) {
  return crypto.createHash('sha256').update(canonicalQuestion(question)).digest('hex');
}

function defaultState() {
  return {
    version: STORE_VERSION,
    question_set_version: QUESTION_SET_VERSION,
    revision: 0,
    questions: QUESTIONS.map(question => ({
      id: question.id,
      version: question.version,
      fingerprint: questionFingerprint(question),
      status: 'pending'
    })),
    answers: [],
    pending_text: [],
    different_question_answers: [],
    rule_drafts: []
  };
}

function normalizeState(parsed) {
  if (parsed?.version !== STORE_VERSION || parsed?.question_set_version !== QUESTION_SET_VERSION
      || !Array.isArray(parsed.questions) || !Array.isArray(parsed.answers)
      || !Array.isArray(parsed.pending_text) || !Array.isArray(parsed.different_question_answers)) {
    throw new Error('invalid knowledge review store');
  }
  if (!Array.isArray(parsed.rule_drafts)) parsed.rule_drafts = [];
  return parsed;
}

function readState(storePath = DEFAULT_STORE_PATH) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(storePath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultState();
    throw error;
  }
}

function writeState(storePath, state) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporary = `${storePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, storePath);
    fs.chmodSync(storePath, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function withLock(storePath, operation) {
  const lockPath = `${storePath}.lock`;
  let descriptor;
  let acquired = false;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
    acquired = true;
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
    fs.fsyncSync(descriptor);
    const state = readState(storePath);
    const result = operation(state);
    state.revision = Number(state.revision || 0) + 1;
    writeState(storePath, state);
    return result;
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('knowledge review store is busy');
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (acquired) {
      try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
}

function questionById(questionId) {
  return QUESTIONS.find(question => question.id === String(questionId || '')) || null;
}

function currentQuestionFromState(state) {
  const record = state.questions.find(item => item.status === 'pending');
  if (!record) return null;
  const question = questionById(record.id);
  if (!question || record.version !== question.version || record.fingerprint !== questionFingerprint(question)) {
    throw new Error('knowledge question definition drift');
  }
  const index = state.questions.findIndex(item => item.id === record.id);
  return { ...question, fingerprint: record.fingerprint, index, total: state.questions.length };
}

function currentQuestion(storePath = DEFAULT_STORE_PATH) {
  return currentQuestionFromState(readState(storePath));
}

function assertCurrentBinding(state, binding) {
  const current = currentQuestionFromState(state);
  if (!current) throw new Error('knowledge review complete');
  if (current.id !== String(binding?.question_id || '')
      || current.version !== Number(binding?.question_version)
      || current.fingerprint !== String(binding?.fingerprint || '')) {
    throw new Error('knowledge answer question binding mismatch');
  }
  return current;
}

function eventExists(state, eventKey) {
  return [...state.answers, ...state.pending_text, ...state.different_question_answers]
    .some(record => record.event_key === eventKey);
}

function markQuestion(state, questionId, status) {
  const record = state.questions.find(item => item.id === questionId);
  if (!record || record.status !== 'pending') throw new Error('knowledge question is not pending');
  record.status = status;
  record.updated_at = new Date().toISOString();
}

function candidateDigest(record) {
  return crypto.createHash('sha256').update(JSON.stringify({
    candidate_id: record.candidate_id,
    question_id: record.question_id,
    question_version: record.question_version,
    question_fingerprint: record.question_fingerprint,
    answer_kind: record.answer_kind,
    choice: record.choice || '',
    answer_text: record.answer_text,
    classification: record.classification || 'current_answer',
    answered_at: record.answered_at
  })).digest('hex');
}

function candidateRecord(input) {
  const record = {
    candidate_id: crypto.randomUUID(),
    event_key: input.event_key,
    question_id: input.current.id,
    question_version: input.current.version,
    question_fingerprint: input.current.fingerprint,
    answer_kind: input.answer_kind,
    answer_text: input.answer_text,
    classification: input.classification || 'current_answer',
    knowledge_status: 'candidate',
    review_status: 'pending_review',
    actor_id: input.actor_id,
    answered_at: new Date(input.now).toISOString()
  };
  if (input.choice) record.choice = input.choice;
  record.candidate_digest = candidateDigest(record);
  return record;
}

function submitChoice(input, { storePath = DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const letter = String(input?.choice || '').trim().toUpperCase();
  if (!/^[A-D]$/.test(letter)) throw new Error('knowledge choice must be A-D');
  const eventKey = String(input?.event_key || '').trim();
  const actorId = String(input?.actor_id || '').trim();
  if (!eventKey || !actorId) throw new Error('knowledge answer event and actor required');
  return withLock(storePath, state => {
    if (eventExists(state, eventKey)) return { status: 'duplicate', current: currentQuestionFromState(state) };
    const current = assertCurrentBinding(state, input);
    const candidate = candidateRecord({
      event_key: eventKey, current, answer_kind: 'choice', choice: letter,
      answer_text: current.options[letter], actor_id: actorId, now
    });
    state.answers.push(candidate);
    markQuestion(state, current.id, 'answered');
    return { status: 'recorded', candidate, current: currentQuestionFromState(state) };
  });
}

function proposeClassification(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('knowledge text answer required');
  if (/(?:问题|问法|题目).{0,8}(?:不对|错了|不准确|不成立)|应该问|别这么问/u.test(value)) return 'question_wrong';
  if (/(?:回答|说的|讲的).{0,8}(?:另一个|别的|其他).{0,4}(?:问题|事情)|不是(?:这个|这道)(?:问题|题)/u.test(value)) return 'different_question';
  return 'current_answer';
}

function stageTextResponse(input, { storePath = DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const text = String(input?.text || '').trim();
  const eventKey = String(input?.event_key || '').trim();
  const actorId = String(input?.actor_id || '').trim();
  if (!text || [...text].length > 2000 || !eventKey || !actorId) throw new Error('valid knowledge text response required');
  return withLock(storePath, state => {
    const current = assertCurrentBinding(state, input);
    const existing = state.pending_text.find(record => record.event_key === eventKey);
    if (existing) return { status: 'duplicate', pending: existing, question: current };
    if (eventExists(state, eventKey)) throw new Error('knowledge response event already resolved');
    const textHash = crypto.createHash('sha256').update(text).digest('hex');
    const pending = {
      id: crypto.randomUUID(),
      event_key: eventKey,
      question_id: current.id,
      question_version: current.version,
      question_fingerprint: current.fingerprint,
      text,
      text_hash: textHash,
      proposed_classification: proposeClassification(text),
      actor_id: actorId,
      created_at: new Date(now).toISOString()
    };
    state.pending_text.push(pending);
    return { status: 'staged', pending, question: current };
  });
}

function confirmTextClassification(input, { storePath = DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const classification = String(input?.classification || '');
  if (!CLASSIFICATIONS.has(classification)) throw new Error('invalid knowledge response classification');
  const actorId = String(input?.actor_id || '').trim();
  if (!actorId) throw new Error('knowledge reviewer required');
  return withLock(storePath, state => {
    const current = assertCurrentBinding(state, input);
    const pendingIndex = state.pending_text.findIndex(record => record.id === input?.pending_id
      && record.text_hash === input?.text_hash
      && record.question_id === current.id
      && record.question_version === current.version
      && record.question_fingerprint === current.fingerprint);
    if (pendingIndex < 0) throw new Error('knowledge text response binding mismatch');
    const pending = state.pending_text[pendingIndex];
    if (pending.actor_id !== actorId) throw new Error('knowledge text response actor mismatch');
    state.pending_text.splice(pendingIndex, 1);
    const record = candidateRecord({
      event_key: pending.event_key, current, answer_kind: 'text', answer_text: pending.text,
      classification, actor_id: actorId, now
    });
    if (classification === 'different_question') {
      state.different_question_answers.push(record);
      return { status: 'stored_for_routing', current: currentQuestionFromState(state) };
    }
    state.answers.push(record);
    markQuestion(state, current.id, classification === 'question_wrong' ? 'needs_rewrite' : classification === 'skip' ? 'skipped' : 'answered');
    return { status: 'recorded', current: currentQuestionFromState(state) };
  });
}

function candidateCollections(state) {
  return [state.answers, state.different_question_answers];
}

function candidateById(state, candidateId) {
  for (const collection of candidateCollections(state)) {
    const record = collection.find(item => item.candidate_id === candidateId);
    if (record) return record;
  }
  return null;
}

function listCandidates(storePath = DEFAULT_STORE_PATH, { status = 'all' } = {}) {
  const state = readState(storePath);
  const records = candidateCollections(state).flat().map(record => ({
    ...record,
    candidate_digest: record.candidate_digest || candidateDigest(record),
    question: questionById(record.question_id)
  }));
  return records
    .filter(record => status === 'all' || (record.review_status || 'pending_review') === status)
    .sort((left, right) => String(right.answered_at).localeCompare(String(left.answered_at)));
}

function reviewCandidate(input, { storePath = DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const action = String(input?.action || '');
  if (!new Set(['needs_clarification', 'rejected', 'approved_for_rule_draft']).has(action)) {
    throw new Error('invalid knowledge candidate review action');
  }
  const reviewer = String(input?.reviewer || '').trim();
  const note = String(input?.note || '').trim();
  if (!reviewer || [...note].length > 1000) throw new Error('valid knowledge candidate reviewer and note required');
  return withLock(storePath, state => {
    const record = candidateById(state, String(input?.candidate_id || ''));
    if (!record) throw new Error('knowledge candidate not found');
    const digest = record.candidate_digest || candidateDigest(record);
    if (digest !== String(input?.expected_digest || '')) throw new Error('knowledge candidate digest mismatch');
    if (state.rule_drafts.some(draft => draft.candidate_id === record.candidate_id)) {
      throw new Error('knowledge candidate already has a rule draft');
    }
    record.candidate_digest = digest;
    record.review_status = action;
    record.reviewed_by = reviewer;
    record.reviewed_at = new Date(now).toISOString();
    record.review_note = note;
    return { status: action, candidate: { ...record } };
  });
}

function createRuleDraft(input, { storePath = DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const createdBy = String(input?.created_by || '').trim();
  const scope = String(input?.scope || '').trim();
  const exclusions = String(input?.exclusions || '').trim();
  const validityDays = Number(input?.validity_days);
  const testCases = Array.isArray(input?.test_cases) ? input.test_cases.map(value => String(value || '').trim()).filter(Boolean) : [];
  if (!createdBy || scope.length < 5 || scope.length > 500 || exclusions.length > 1000
      || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365
      || testCases.length < 1 || testCases.length > 10 || testCases.some(value => value.length > 500)) {
    throw new Error('valid inactive rule draft fields required');
  }
  return withLock(storePath, state => {
    const record = candidateById(state, String(input?.candidate_id || ''));
    if (!record) throw new Error('knowledge candidate not found');
    const digest = record.candidate_digest || candidateDigest(record);
    if (digest !== String(input?.expected_digest || '')) throw new Error('knowledge candidate digest mismatch');
    if (record.review_status !== 'approved_for_rule_draft') throw new Error('knowledge candidate review approval required');
    const existing = state.rule_drafts.find(draft => draft.candidate_id === record.candidate_id);
    if (existing) return { status: 'duplicate', rule_draft: { ...existing } };
    const draft = {
      rule_draft_id: crypto.randomUUID(),
      candidate_id: record.candidate_id,
      candidate_digest: digest,
      question_id: record.question_id,
      question_version: record.question_version,
      answer_text: record.answer_text,
      scope,
      exclusions,
      validity_days: validityDays,
      test_cases: testCases,
      status: 'draft_inactive',
      created_by: createdBy,
      created_at: new Date(now).toISOString()
    };
    state.rule_drafts.push(draft);
    record.knowledge_status = 'rule_draft_inactive';
    return { status: 'created', rule_draft: { ...draft } };
  });
}

function listRuleDrafts(storePath = DEFAULT_STORE_PATH) {
  return readState(storePath).rule_drafts.slice().sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function enabled(env = process.env) {
  return String(env?.MATRIX_KNOWLEDGE_REVIEW_ENABLED || '') === '1';
}

function reviewerAllowed(actorId, env = process.env) {
  const expected = String(env?.MATRIX_KNOWLEDGE_REVIEWER_OPEN_ID || env?.MATRIX_OWNER_OPEN_ID || '').trim();
  return Boolean(expected && String(actorId || '').trim() === expected);
}

function questionCard(question) {
  if (!question) {
    return {
      schema: '2.0', config: { update_multi: true },
      header: { template: 'green', title: { tag: 'plain_text', content: '陈湧杰知识确认' } },
      body: { elements: [{ tag: 'markdown', content: '当前题目已经完成。所有回答仍是候选知识，进入规则前还要做范围、有效期和测试复核。' }] }
    };
  }
  const binding = { q: question.id, v: question.version, f: question.fingerprint };
  const columns = Object.entries(question.options).map(([letter, label]) => ({
    tag: 'column', width: 'weighted', weight: 1,
    elements: [{
      tag: 'button', type: 'default', text: { tag: 'plain_text', content: `${letter}. ${label}` },
      behaviors: [{ type: 'callback', value: { a: 'mx.knowledge_choice', ...binding, c: letter } }]
    }]
  }));
  return {
    schema: '2.0', config: { update_multi: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: '陈湧杰知识确认' } },
    body: { elements: [
      { tag: 'markdown', content: `**第 ${question.index + 1}/${question.total} 题｜${question.title}**\n${question.prompt}` },
      { tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: 'small', columns: columns.slice(0, 2) },
      { tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: 'small', columns: columns.slice(2, 4) },
      { tag: 'markdown', content: `题目编号：\`${question.id}\`｜版本：${question.version}\n可直接点击 A-D，也可以**引用本卡**输入文字。文字不会直接归档，必须再确认它属于当前题、问题不对，还是回答了别的问题。` }
    ] }
  };
}

function classificationCard(staged) {
  const { pending, question } = staged;
  const labels = {
    current_answer: 'A. 这是当前题的答案',
    question_wrong: 'B. 这道题问得不对',
    different_question: 'C. 我回答的是另一道题',
    skip: 'D. 暂时跳过这道题'
  };
  const values = [
    ['current_answer', labels.current_answer],
    ['question_wrong', labels.question_wrong],
    ['different_question', labels.different_question],
    ['skip', labels.skip]
  ];
  const binding = { q: question.id, v: question.version, f: question.fingerprint, p: pending.id, h: pending.text_hash };
  const columns = values.map(([classification, label]) => ({
    tag: 'column', width: 'weighted', weight: 1,
    elements: [{
      tag: 'button', type: classification === pending.proposed_classification ? 'primary' : 'default',
      text: { tag: 'plain_text', content: label },
      behaviors: [{ type: 'callback', value: { a: 'mx.knowledge_classify', ...binding, k: classification } }]
    }]
  }));
  return {
    schema: '2.0', config: { update_multi: true },
    header: { template: 'orange', title: { tag: 'plain_text', content: '先确认回答对应哪道题' } },
    body: { elements: [
      { tag: 'markdown', content: `**系统准备关联的题目**\n${question.title}\n\n**收到的文字**\n${[...pending.text].slice(0, 600).join('')}\n\n系统初步判断：**${labels[pending.proposed_classification]}**。确认前不会推进题目。` },
      { tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: 'small', columns: columns.slice(0, 2) },
      { tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: 'small', columns: columns.slice(2, 4) }
    ] }
  };
}

function cardBinding(card) {
  const elements = Array.isArray(card?.body?.elements) ? card.body.elements : [];
  const buttons = elements.flatMap(element => Array.isArray(element?.columns)
    ? element.columns.flatMap(column => Array.isArray(column?.elements) ? column.elements : [])
    : []);
  const value = buttons.map(button => button?.behaviors?.[0]?.value).find(item => item?.a === 'mx.knowledge_choice');
  if (!value) return null;
  const question = questionById(value.q);
  if (!question || Number(value.v) !== question.version || String(value.f) !== questionFingerprint(question)) return null;
  return { question_id: question.id, question_version: question.version, fingerprint: questionFingerprint(question) };
}

function createStore({ storePath = process.env.MATRIX_KNOWLEDGE_REVIEW_PATH || DEFAULT_STORE_PATH, now = () => new Date() } = {}) {
  return {
    current: () => currentQuestion(storePath),
    submitChoice: input => submitChoice(input, { storePath, now: now() }),
    stageText: input => stageTextResponse(input, { storePath, now: now() }),
    confirmText: input => confirmTextClassification(input, { storePath, now: now() }),
    listCandidates: options => listCandidates(storePath, options),
    reviewCandidate: input => reviewCandidate(input, { storePath, now: now() }),
    createRuleDraft: input => createRuleDraft(input, { storePath, now: now() }),
    listRuleDrafts: () => listRuleDrafts(storePath)
  };
}

module.exports = {
  DEFAULT_STORE_PATH,
  QUESTIONS,
  questionFingerprint,
  currentQuestion,
  submitChoice,
  proposeClassification,
  stageTextResponse,
  confirmTextClassification,
  candidateDigest,
  listCandidates,
  reviewCandidate,
  createRuleDraft,
  listRuleDrafts,
  enabled,
  reviewerAllowed,
  questionCard,
  classificationCard,
  cardBinding,
  createStore
};

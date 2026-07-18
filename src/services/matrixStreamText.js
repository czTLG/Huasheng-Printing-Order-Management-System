const { callJsonProvider } = require('./aiProvider');

const REVISION_KEYS = ['subject', 'body_en', 'body_cn'];
const INBOUND_KEYS = [
  'translation_cn',
  'requirements_cn',
  'suggested_subject',
  'suggested_body_en',
  'suggested_body_cn'
];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function extractUrls(value) {
  return String(value || '').match(/https?:\/\/[^\s<>'"）)]+/gi) || [];
}

function priceClaims(value) {
  return String(value || '').match(/(?:[$€£¥]\s*\d[\d,.]*|\b(?:usd|eur|gbp|cny|rmb)\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:usd|eur|gbp|cny|rmb)\b|(?:美元|美金|人民币|欧元|英镑|日元|元)\s*\d[\d,.]*|\d[\d,.]*\s*(?:美元|美金|人民币|欧元|英镑|日元|元))/gi) || [];
}

function qualificationClaims(value) {
  return String(value || '').match(/(?:\b(?:ISO(?:\s*\d+)?|BRCGS?|FDA|HACCP|GMP|CE|certified|qualified)\b|[\u4e00-\u9fffA-Za-z0-9 ]{0,24}(?:认证|资质))/gi) || [];
}

function evidenceText(input) {
  return JSON.stringify(input?.sourceSnapshot || input?.source_snapshot || input?.publicEvidence || input?.public_evidence || {});
}

function validateClaims(output, input) {
  const outputText = Object.values(output).join('\n');
  const source = evidenceText(input);
  const allowedUrlText = [source, JSON.stringify(input?.current || {}), String(input?.inboundText || input?.message || '')].join('\n');
  for (const url of extractUrls(outputText)) {
    if (!allowedUrlText.includes(url)) throw new Error('invalid bilingual output: model introduced URL');
  }
  for (const price of priceClaims(outputText)) {
    if (!source.toLowerCase().includes(price.toLowerCase())) throw new Error('invalid bilingual output: unsupported price claim');
  }
  for (const claim of qualificationClaims(outputText)) {
    if (!source.toLowerCase().includes(claim.toLowerCase())) throw new Error('invalid bilingual output: unsupported qualification claim');
  }
}

function validatedOutput(value, keys, input) {
  if (!exactObject(value, keys) || keys.some(key => !String(value[key] || '').trim())) {
    throw new Error('invalid bilingual output: exact non-empty fields required');
  }
  const normalized = Object.fromEntries(keys.map(key => [key, String(value[key]).replace(/\r\n?/g, '\n').trim()]));
  validateClaims(normalized, input);
  return normalized;
}

function unwrapProviderResult(value) {
  if (value && value.ok === false) {
    if (value.reason === 'text_provider_unavailable') return value;
    throw new Error(`text provider failed: ${value.reason || 'unknown error'}`);
  }
  return value && value.ok === true && isPlainObject(value.json) ? value.json : value;
}

function createMatrixStreamText({ callJson = callJsonProvider } = {}) {
  if (typeof callJson !== 'function') throw new Error('callJson function required');

  async function run({ keys, systemPrompt, userPrompt, input }) {
    const providerValue = await callJson({
      systemPrompt,
      userPrompt,
      exactKeys: keys,
      timeoutMs: 15000,
      maxTokens: 1200
    });
    const output = unwrapProviderResult(providerValue);
    if (output && output.ok === false && output.reason === 'text_provider_unavailable') return output;
    return validatedOutput(output, keys, input);
  }

  return {
    revise(input = {}) {
      if (!isPlainObject(input.current)) return Promise.reject(new Error('current version required'));
      const instruction = String(input.instruction || '').trim();
      if (!instruction) return Promise.reject(new Error('revision instruction required'));
      return run({
        keys: REVISION_KEYS,
        systemPrompt: 'Return only the requested bilingual JSON fields. Preserve evidence; introduce no facts, prices, qualifications, or URLs.',
        userPrompt: JSON.stringify({ current: input.current, instruction }),
        input: { ...input, sourceSnapshot: input.sourceSnapshot || input.current.source_snapshot_json }
      });
    },

    translateInbound(input = {}) {
      const inboundText = String(input.inboundText || input.message || '').trim();
      if (!inboundText) return Promise.reject(new Error('inbound text required'));
      return run({
        keys: INBOUND_KEYS,
        systemPrompt: 'Translate and suggest a bilingual response using only supplied public evidence. Return only the requested JSON fields.',
        userPrompt: JSON.stringify({ inbound_text: inboundText, public_evidence: input.publicEvidence || {} }),
        input: { ...input, inboundText }
      });
    }
  };
}

module.exports = { createMatrixStreamText };

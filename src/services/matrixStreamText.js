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

const AMOUNT_PATTERN = '(?:\\d[\\d,.]*(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万点]+)';
const CURRENCY_PATTERN = '(?:usd|eur|gbp|cny|rmb|[$€£¥]|美元|美金|人民币|欧元|英镑|日元|元)';

function chineseNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  const [integerPart, decimalPart] = String(value).split('点');
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of integerPart) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) {
      number = digits[char];
    } else if (units[char]) {
      section += (number || 1) * units[char];
      number = 0;
    } else if (char === '万') {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    } else {
      return null;
    }
  }
  let result = total + section + number;
  if (decimalPart) {
    if ([...decimalPart].some(char => !Object.prototype.hasOwnProperty.call(digits, char))) return null;
    result += Number(`0.${[...decimalPart].map(char => digits[char]).join('')}`);
  }
  return Number.isFinite(result) ? result : null;
}

function normalizedAmount(value) {
  const raw = String(value || '').trim();
  const number = /^\d/.test(raw) ? Number(raw.replace(/,/g, '')) : chineseNumber(raw);
  return Number.isFinite(number) ? String(number) : null;
}

function normalizedCurrency(value) {
  const raw = String(value || '').toLowerCase();
  if (/usd|美元|美金|\$/.test(raw)) return 'USD';
  if (/eur|欧元|€/.test(raw)) return 'EUR';
  if (/gbp|英镑|£/.test(raw)) return 'GBP';
  if (/日元/.test(raw)) return 'JPY';
  if (/cny|rmb|人民币|元|¥/.test(raw)) return 'CNY';
  return 'UNSPECIFIED';
}

function priceClaims(value) {
  const text = String(value || '');
  const claims = new Set();
  const currencyAdjacent = new RegExp(`(?:${CURRENCY_PATTERN}\\s*${AMOUNT_PATTERN}|${AMOUNT_PATTERN}\\s*${CURRENCY_PATTERN})`, 'gi');
  for (const match of text.matchAll(currencyAdjacent)) {
    const amountMatch = match[0].match(new RegExp(AMOUNT_PATTERN, 'i'));
    const amount = normalizedAmount(amountMatch?.[0]);
    if (amount !== null) claims.add(`price:${normalizedCurrency(match[0])}:${amount}`);
  }
  const priceLanguage = new RegExp(`(?:单价|售价|价格|报价|费用|金额|成本)\\s*(?:为|是|约|：|:)?\\s*(${AMOUNT_PATTERN})(?:\\s*(${CURRENCY_PATTERN}))?`, 'gi');
  for (const match of text.matchAll(priceLanguage)) {
    const amount = normalizedAmount(match[1]);
    if (amount !== null) claims.add(`price:${normalizedCurrency(match[2])}:${amount}`);
  }
  for (const segment of text.split(/[。；;，,\n]/)) {
    if (!/(?:单价|售价|价格|报价|费用|金额|成本)/.test(segment)) continue;
    const amountMatch = segment.match(new RegExp(AMOUNT_PATTERN, 'i'));
    if (!amountMatch) continue;
    const normalizedPriceLanguage = new RegExp(`(?:单价|售价|价格|报价|费用|金额|成本)\\s*(?:为|是|约|：|:)?\\s*${AMOUNT_PATTERN}(?:\\s*${CURRENCY_PATTERN})?`, 'i');
    if (!normalizedPriceLanguage.test(segment)) {
      const fallback = segment.replace(/\s+/g, '').toLowerCase();
      if (fallback) claims.add(`price:fallback:${fallback}`);
    }
  }
  return [...claims];
}

function qualificationClaims(value) {
  const text = String(value || '');
  const claims = new Set();
  for (const match of text.matchAll(/\b(ISO)\s*(\d+(?:[-:]\d+)?)?\b/gi)) claims.add(`qualification:iso:${match[2] || 'unspecified'}`);
  for (const match of text.matchAll(/\b(BRCGS?|FDA|HACCP|GMP|CE|ROHS|REACH)\b/gi)) claims.add(`qualification:${match[1].toLowerCase()}`);
  if (/食品级|\bfood[- ]grade\b/i.test(text)) claims.add('qualification:food-grade');
  if (/(?:欧盟)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:eu');
  if (/(?:有机)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:organic');
  if (/(?:清真)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:halal');
  if (/(?:犹太)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:kosher');
  for (const match of text.matchAll(/(?:符合|满足|达到)\s*([^。；，,\n]{1,24}?)\s*(?:标准|规范|要求)/g)) {
    const identifier = match[1].replace(/\s+/g, '').toLowerCase();
    if (identifier && identifier !== '食品级' && identifier !== '欧盟') claims.add(`qualification:requirement:${identifier}`);
  }
  for (const match of text.matchAll(/([^。；，,\n]{1,24}?)(?:认证|资质)/g)) {
    const rawIdentifier = match[1].replace(/\s+/g, '').toLowerCase();
    const strippedIdentifier = rawIdentifier.replace(/^(?:我们|产品|材料|该产品|已|通过|获得|拥有|具备)+/, '');
    const identifier = strippedIdentifier || rawIdentifier;
    if (identifier && !/(食品级|欧盟|有机|清真|犹太)$/.test(identifier)) claims.add(`qualification:credential:${identifier}`);
  }
  for (const segment of text.split(/[。；;，,\n]/)) {
    if (!/(?:认证|资质|合规|\b(?:compliant|compliance|certified|certification|qualified)\b)/i.test(segment)) continue;
    if (/\b(?:ISO|BRCGS?|FDA|HACCP|GMP|CE|ROHS|REACH)\b|食品级|\bfood[- ]grade\b|(?:欧盟|有机|清真|犹太)(?:认证|资质|标准|规范|要求)/i.test(segment)) continue;
    const fallback = segment.replace(/\s+/g, '').toLowerCase();
    if (fallback) claims.add(`qualification:fallback:${fallback}`);
  }
  return [...claims];
}

function evidenceText(input) {
  return JSON.stringify(input?.sourceSnapshot || input?.source_snapshot || input?.publicEvidence || input?.public_evidence || {});
}

function validateClaims(output, input) {
  const outputText = Object.values(output).join('\n');
  const source = evidenceText(input);
  const sourcePrices = new Set(priceClaims(source));
  const sourceQualifications = new Set(qualificationClaims(source));
  const allowedUrlText = [source, JSON.stringify(input?.current || {}), String(input?.inboundText || input?.message || '')].join('\n');
  for (const url of extractUrls(outputText)) {
    if (!allowedUrlText.includes(url)) throw new Error('invalid bilingual output: model introduced URL');
  }
  for (const price of priceClaims(outputText)) {
    if (!sourcePrices.has(price)) throw new Error('invalid bilingual output: unsupported price claim');
  }
  for (const claim of qualificationClaims(outputText)) {
    if (!sourceQualifications.has(claim)) throw new Error('invalid bilingual output: unsupported qualification claim');
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

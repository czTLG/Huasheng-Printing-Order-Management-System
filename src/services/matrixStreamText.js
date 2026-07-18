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

const PRICE_SEMANTIC = /(?:价格|报价|单价|售价|费用|收费|免费|成本|\b(?:price|quote|rate|fee|cost|free)\b)/i;
const QUALIFICATION_SEMANTIC = /(?:认证|证书|资质|许可证|许可|审核|认可|批准|合规|标准|规范|要求|\b(?:certified|certificate|certification|license[ds]?|permit(?:ted)?|audit(?:ed)?|approved|recognized|compliant|compliance|standard|requirement)\b)/i;
const CHINESE_REQUEST = /^(?:(?:请|烦请)(?:您|贵司)?(?:提供|告知|确认|说明|回复|报价)|(?:能否|可以|可否)(?:请)?(?:您|贵司)?(?:提供|告知|确认|说明|回复|报价)|(?:是否有|您是否有|贵司是否有|贵司是否(?:可以|能够|提供)))(.*)$/i;
const ENGLISH_REQUEST = /^(?:(?:(?:could|would|can) you)(?: please)? (?:provide|confirm|quote|tell|share|send)|please (?:provide|confirm|quote|tell|share|send)|what (?:is|are))(?:\s+|$)(.*)$/i;
const CHINESE_ASSERTION = /(?:是|为|已|拥有|通过|获得|获|无需|免收费|免费|符合|满足|达到|具备|持有|取得|认可|批准|备案|单价请询价)/i;
const ENGLISH_ASSERTION = /\b(?:is|are|our price|we are|we have|have|has|approved|certified|recognized|compliant|free|no[ -]?fee|note)\b|\b(?:price|quote|rate|fee|cost)\s+(?:is|are)\b/i;

function splitSentences(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?])|(?<=\.)\s+|\n+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function normalizedSentence(value) {
  return String(value || '').normalize('NFKC').trim().replace(/[。.!?！？]+$/u, '').replace(/\s+/g, '').toLowerCase();
}

function normalizedSyntaxSentence(value) {
  return String(value || '').normalize('NFKC').trim().replace(/[。.!?！？]+$/u, '').replace(/\s+/g, ' ');
}

function sensitiveKinds(sentence) {
  return {
    price: PRICE_SEMANTIC.test(sentence),
    qualification: QUALIFICATION_SEMANTIC.test(sentence)
  };
}

function isNonAssertionRequest(sentence) {
  const text = normalizedSyntaxSentence(sentence);
  const chinese = text.match(CHINESE_REQUEST);
  if (chinese) return !CHINESE_ASSERTION.test(chinese[1]);
  const english = text.match(ENGLISH_REQUEST);
  return Boolean(english && !ENGLISH_ASSERTION.test(english[1]));
}

function assertionText(value) {
  return splitSentences(value).filter(sentence => !isNonAssertionRequest(sentence)).join('\n');
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
  const text = assertionText(value);
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
    const priceState = /(?:面议|待定|另议|请询价|询价|视[^。；，,\n]{0,16}而定|\b(?:negotiable|tbd|to be determined|contact for price)\b)/i;
    if (!amountMatch && !priceState.test(segment)) continue;
    const normalizedPriceLanguage = new RegExp(`(?:单价|售价|价格|报价|费用|金额|成本)\\s*(?:为|是|约|：|:)?\\s*${AMOUNT_PATTERN}(?:\\s*${CURRENCY_PATTERN})?`, 'i');
    if (!amountMatch || !normalizedPriceLanguage.test(segment)) {
      const fallback = segment.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
      if (fallback) claims.add(`price:fallback:${fallback}`);
    }
  }
  return [...claims];
}

function qualificationClaims(value) {
  const text = assertionText(value);
  const claims = new Set();
  for (const match of text.matchAll(/\b(ISO)\s*(\d+(?:[-:]\d+)?)?\b/gi)) claims.add(`qualification:iso:${match[2] || 'unspecified'}`);
  for (const match of text.matchAll(/\b(BRCGS?|FDA|HACCP|GMP|CE|ROHS|REACH)\b/gi)) claims.add(`qualification:${match[1].toLowerCase()}`);
  if (/食品级|\bfood[- ]grade\b/i.test(text)) claims.add('qualification:food-grade');
  if (/(?:欧盟)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:eu');
  if (/(?:有机)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:organic');
  if (/(?:清真)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:halal');
  if (/(?:犹太)(?:认证|资质|标准|要求)/.test(text)) claims.add('qualification:kosher');
  for (const segment of text.split(/[。；;，,\n]/)) {
    const qualificationSignal = /(?:审核|认证|证书|许可证|许可|资质|合规|(?:符合|满足|达到)[^。；，,\n]{0,32}(?:标准|规范|要求)|\b(?:audit(?:ed)?|license[ds]?|certificate|certified|certification|compliant|compliance|qualified|qualification)\b)/i;
    if (!qualificationSignal.test(segment)) continue;
    if (/\b(?:ISO|BRCGS?|FDA|HACCP|GMP|CE|ROHS|REACH)\b|食品级|\bfood[- ]grade\b|(?:欧盟|有机|清真|犹太)(?:认证|资质|标准|规范|要求)/i.test(segment)) continue;
    const fallback = segment.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    if (fallback) claims.add(`qualification:fallback:${fallback}`);
  }
  return [...claims];
}

function collectEvidenceValues(value, output) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectEvidenceValues(JSON.parse(trimmed), output);
        return output;
      } catch (_) {
        // A non-JSON string remains evidence text.
      }
    }
    if (trimmed) output.push(trimmed);
  } else if (Array.isArray(value)) {
    for (const item of value) collectEvidenceValues(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEvidenceValues(item, output);
  }
  return output;
}

function evidenceValues(input) {
  const source = input?.sourceSnapshot ?? input?.source_snapshot ?? input?.publicEvidence ?? input?.public_evidence ?? {};
  return collectEvidenceValues(source, []);
}

function validateClaims(output, input) {
  const outputValues = Object.values(output);
  const outputText = outputValues.join('\n');
  const sourceValues = evidenceValues(input);
  const sourceSentences = new Set(sourceValues.flatMap(splitSentences).map(normalizedSentence).filter(Boolean));
  const sourcePrices = new Set(sourceValues.flatMap(priceClaims));
  const sourceQualifications = new Set(sourceValues.flatMap(qualificationClaims));
  const allowedUrlText = [sourceValues.join('\n'), JSON.stringify(input?.current || {}), String(input?.inboundText || input?.message || '')].join('\n');
  for (const url of extractUrls(outputText)) {
    if (!allowedUrlText.includes(url)) throw new Error('invalid bilingual output: model introduced URL');
  }
  for (const sentence of outputValues.flatMap(splitSentences)) {
    const kinds = sensitiveKinds(sentence);
    if ((!kinds.price && !kinds.qualification) || isNonAssertionRequest(sentence)) continue;
    if (!sourceSentences.has(normalizedSentence(sentence))) {
      const kind = kinds.price ? 'price' : 'qualification';
      throw new Error(`invalid bilingual output: unsupported ${kind} claim`);
    }
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

module.exports = { createMatrixStreamText, isNonAssertionRequest, splitSentences, normalizedSentence };

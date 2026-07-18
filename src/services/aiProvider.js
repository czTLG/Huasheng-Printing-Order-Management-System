const DEFAULT_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
};

const SUPPORTED_PROVIDERS = ['deepseek', 'openai', 'glm', 'mock'];

function getProviderConfig(preferredProvider) {
  const provider = String(preferredProvider || process.env.COSTING_AI_PROVIDER || 'mock').trim().toLowerCase();
  const config = {
    provider,
    model: null,
    apiKey: null,
    endpoint: DEFAULT_ENDPOINTS[provider] || null
  };

  if (provider === 'deepseek') {
    config.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    config.apiKey = process.env.DEEPSEEK_API_KEY || '';
  } else if (provider === 'openai') {
    config.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    config.apiKey = process.env.OPENAI_API_KEY || '';
  } else if (provider === 'glm') {
    config.model = process.env.GLM_MODEL || 'glm-4.5';
    config.apiKey = process.env.GLM_API_KEY || '';
  } else {
    config.model = process.env.MOCK_AI_MODEL || 'mock-rule-parser';
    config.apiKey = '';
  }

  if (!config.endpoint && provider !== 'mock') {
    config.endpoint = DEFAULT_ENDPOINTS.openai;
  }

  return config;
}

function stripCodeFences(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (!raw.startsWith('```')) return raw;
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const raw = stripCodeFences(String(value));
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateStructuredObject(value, schemaName = 'assistant', requiredKeys = []) {
  if (!isPlainObject(value)) {
    return { ok: false, error: `${schemaName} output must be a JSON object` };
  }
  const missing = requiredKeys.filter(key => !(key in value));
  if (missing.length) {
    return { ok: false, error: `${schemaName} output missing required keys: ${missing.join(', ')}` };
  }
  return { ok: true };
}

function buildMessages({ systemPrompt, userPrompt }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: String(systemPrompt) });
  messages.push({ role: 'user', content: String(userPrompt || '') });
  return messages;
}

async function fetchJson(endpoint, payload, apiKey, { signal } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available in this runtime');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {})
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = { raw: text };
  }

  if (!res.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return json;
}

async function callJsonProvider({
  provider,
  model,
  systemPrompt,
  userPrompt,
  exactKeys,
  temperature = 0,
  maxTokens = 1200,
  timeoutMs = 15000
} = {}) {
  try {
    const keys = Array.isArray(exactKeys) ? [...exactKeys] : [];
    if (!keys.length || keys.some(key => typeof key !== 'string' || !key)) {
      throw new Error('caller-owned exact key set required');
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4000) throw new Error('invalid maximum token count');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('invalid timeout');
    const cfg = getProviderConfig(provider || process.env.MATRIX_TEXT_PROVIDER);
    if (cfg.provider === 'mock' || !cfg.apiKey) {
      return { ok: false, reason: 'text_provider_unavailable', provider: cfg.provider, model: cfg.model };
    }
    const payload = {
      model: model || cfg.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: buildMessages({ systemPrompt, userPrompt })
    };
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs) : undefined;
    const raw = await fetchJson(cfg.endpoint || DEFAULT_ENDPOINTS[cfg.provider] || DEFAULT_ENDPOINTS.openai, payload, cfg.apiKey, { signal });
    const content = raw?.choices?.[0]?.message?.content ?? raw?.choices?.[0]?.text ?? '';
    const json = safeJsonParse(content);
    if (!isPlainObject(json)) throw new Error('JSON provider output must be an object');
    const actualKeys = Object.keys(json).sort();
    const expectedKeys = [...keys].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
      throw new Error(`JSON provider output must contain exactly: ${keys.join(', ')}`);
    }
    return { ok: true, provider: cfg.provider, model: payload.model, json };
  } catch (err) {
    return {
      ok: false,
      reason: err.name === 'TimeoutError' ? 'text_provider_timeout' : err.message,
      provider: String(provider || process.env.MATRIX_TEXT_PROVIDER || '').trim().toLowerCase(),
      model: model || null
    };
  }
}

async function callStructuredProvider({
  provider,
  model,
  systemPrompt,
  userPrompt,
  temperature = 0,
  maxTokens = 2000
}) {
  try {
    const cfg = getProviderConfig(provider);
    if (cfg.provider === 'mock' || !cfg.apiKey) {
      return { ok: false, reason: 'provider unavailable or api key missing', provider: cfg.provider, model: cfg.model };
    }

    const endpoint = cfg.endpoint || DEFAULT_ENDPOINTS[cfg.provider] || DEFAULT_ENDPOINTS.openai;
    const payload = {
      model: model || cfg.model,
      temperature,
      max_tokens: maxTokens,
      messages: buildMessages({ systemPrompt, userPrompt })
    };

    const raw = await fetchJson(endpoint, payload, cfg.apiKey);
    const content = raw?.choices?.[0]?.message?.content ?? raw?.choices?.[0]?.text ?? '';
    const parsed = safeJsonParse(content);
    const validation = validateStructuredObject(parsed, 'structured AI', [
      'customer_order_info',
      'customer_provided',
      'ai_inferred',
      'missing_fields',
      'risk_flags',
      'material_mapping_warnings',
      'suggested_cost_type',
      'confidence'
    ]);
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.error,
        provider: cfg.provider,
        model: payload.model,
        rawContent: content
      };
    }

    return {
      ok: true,
      provider: cfg.provider,
      model: payload.model,
      content,
      json: parsed
    };
  } catch (err) {
    return {
      ok: false,
      reason: err.message,
      provider: String(provider || '').trim().toLowerCase() || getProviderConfig(provider).provider,
      model: model || getProviderConfig(provider).model,
      error: err.message
    };
  }
}

module.exports = {
  DEFAULT_ENDPOINTS,
  SUPPORTED_PROVIDERS,
  getProviderConfig,
  stripCodeFences,
  safeJsonParse,
  validateStructuredObject,
  callJsonProvider,
  callStructuredProvider
};

'use strict';

const crypto = require('node:crypto');

const SOURCE_FIELDS = [
  'code',
  'publisher',
  'landing_url',
  'source_class',
  'countries',
  'allowed_origins',
  'allowed_paths',
  'disallowed_paths',
  'auth_mode',
  'min_interval_ms',
  'concurrency',
  'daily_budget',
  'cache_ttl_seconds',
  'robots_reviewed_at',
  'policy_expires_at',
  'parser_version',
  'license_note',
  'status'
];

const APPROVED_COUNTRIES = new Set([
  'AE', 'AU', 'BR', 'CA', 'ID', 'JP', 'KR', 'MY', 'MX', 'NZ',
  'PH', 'SA', 'SG', 'TH', 'US', 'VN', 'ZA'
]);

const PAUSED_EUROPEAN_COUNTRIES = new Set([
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ',
  'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU',
  'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME',
  'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE',
  'SI', 'SK', 'SM', 'UA', 'VA'
]);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function integerInRange(value, field, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function timestamp(value, field) {
  const text = requiredString(value, field);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} must be a valid timestamp`);
  return { text, milliseconds };
}

function stringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const normalized = value.map((entry) => requiredString(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} contains duplicate values`);
  return normalized;
}

function canonicalHttpsUrl(value, field) {
  let parsed;
  try {
    parsed = new URL(requiredString(value, field));
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${field} must not contain login authentication`);
  if (parsed.hostname.includes('*')) throw new Error(`${field} must not contain a wildcard`);
  return parsed;
}

function validateOrigin(value) {
  const origin = canonicalHttpsUrl(value, 'allowed_origins');
  if (origin.href !== `${origin.origin}/`) {
    throw new Error('allowed_origins entries must contain only an exact HTTPS origin');
  }
  return origin.origin;
}

function validatePathPrefix(value, field) {
  const prefix = requiredString(value, field);
  if (!prefix.startsWith('/') || prefix.startsWith('//') || prefix.includes('?') || prefix.includes('#')) {
    throw new Error(`${field} entries must be URL path prefixes`);
  }
  const canonical = new URL(prefix, 'https://path.invalid').pathname;
  if (canonical !== prefix) throw new Error(`${field} entries must be canonical URL path prefixes`);
  return prefix;
}

function validateSourceDefinition(value, now = new Date().toISOString()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('source definition must be an object');
  }
  for (const field of Object.keys(value)) {
    if (!SOURCE_FIELDS.includes(field)) throw new Error(`unknown field: ${field}`);
  }
  for (const field of SOURCE_FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`${field} is required`);
  }

  const code = requiredString(value.code, 'code');
  if (!/^source-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) throw new Error('code has an invalid format');
  const publisher = requiredString(value.publisher, 'publisher');
  const licenseNote = requiredString(value.license_note, 'license_note');
  const sourceClass = requiredString(value.source_class, 'source_class');
  if (!['P0', 'P1', 'P2', 'P3'].includes(sourceClass)) throw new Error('source_class is not supported');

  const countries = stringArray(value.countries, 'countries').map((country) => country.toUpperCase());
  for (const country of countries) {
    if (!/^[A-Z]{2}$/.test(country)) throw new Error(`invalid country code ${country}`);
    if (country === 'CN' || country === 'IN') throw new Error(`country ${country} is prohibited`);
    if (PAUSED_EUROPEAN_COUNTRIES.has(country)) throw new Error(`European country ${country} is paused`);
    if (!APPROVED_COUNTRIES.has(country)) throw new Error(`country ${country} is not an approved country`);
  }
  if (new Set(countries).size !== countries.length) throw new Error('countries contains duplicate values');

  const origins = stringArray(value.allowed_origins, 'allowed_origins').map(validateOrigin);
  if (new Set(origins).size !== origins.length) throw new Error('allowed_origins contains duplicate values');
  const allowedPaths = stringArray(value.allowed_paths, 'allowed_paths').map((entry) => validatePathPrefix(entry, 'allowed_paths'));
  const disallowedPaths = stringArray(value.disallowed_paths, 'disallowed_paths', { allowEmpty: true })
    .map((entry) => validatePathPrefix(entry, 'disallowed_paths'));

  const landing = canonicalHttpsUrl(value.landing_url, 'landing_url');
  landing.hash = '';
  if (!origins.includes(landing.origin)) throw new Error('landing_url origin must be an exact allowed origin');

  const authMode = requiredString(value.auth_mode, 'auth_mode');
  if (!['none', 'public_api_key'].includes(authMode)) throw new Error('user-login authentication is prohibited');
  const status = requiredString(value.status, 'status');
  if (!['active', 'paused', 'blocked'].includes(status)) throw new Error('status is not supported');

  const review = timestamp(value.robots_reviewed_at, 'robots_reviewed_at');
  const expiry = timestamp(value.policy_expires_at, 'policy_expires_at');
  const current = timestamp(now, 'now');
  if (review.milliseconds > current.milliseconds) throw new Error('robots review cannot be in the future');
  if (expiry.milliseconds <= current.milliseconds) throw new Error('source policy review is expired');
  if (expiry.milliseconds <= review.milliseconds) throw new Error('policy expiry must follow robots review');

  return {
    code,
    publisher,
    landing_url: landing.href,
    source_class: sourceClass,
    countries,
    allowed_origins: origins,
    allowed_paths: allowedPaths,
    disallowed_paths: disallowedPaths,
    auth_mode: authMode,
    min_interval_ms: integerInRange(value.min_interval_ms, 'minimum interval', 1000),
    concurrency: integerInRange(value.concurrency, 'concurrency', 1, 2),
    daily_budget: integerInRange(value.daily_budget, 'daily_budget', 1, 1000),
    cache_ttl_seconds: integerInRange(value.cache_ttl_seconds, 'cache_ttl_seconds', 3600),
    robots_reviewed_at: review.text,
    policy_expires_at: expiry.text,
    parser_version: requiredString(value.parser_version, 'parser_version'),
    license_note: licenseNote,
    status
  };
}

function definitionFromRow(row) {
  return {
    code: row.code,
    publisher: row.publisher,
    landing_url: row.landing_url,
    source_class: row.source_class,
    countries: JSON.parse(row.countries_json),
    allowed_origins: JSON.parse(row.allowed_origins_json),
    allowed_paths: JSON.parse(row.allowed_paths_json),
    disallowed_paths: JSON.parse(row.disallowed_paths_json),
    auth_mode: row.auth_mode,
    min_interval_ms: row.min_interval_ms,
    concurrency: row.concurrency,
    daily_budget: row.daily_budget,
    cache_ttl_seconds: row.cache_ttl_seconds,
    robots_reviewed_at: row.robots_reviewed_at,
    policy_expires_at: row.policy_expires_at,
    parser_version: row.parser_version,
    license_note: row.license_note,
    status: row.status
  };
}

function checksumDefinition(definition) {
  return crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

function registerSources(db, definitions, actor) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db is required');
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('definitions must be a non-empty array');
  const actorName = requiredString(typeof actor === 'string' ? actor : actor?.userName, 'actor.userName');
  const now = timestamp(typeof actor === 'object' && actor?.now ? actor.now : new Date().toISOString(), 'actor.now').text;
  const normalized = definitions.map((definition) => validateSourceDefinition(definition, now));
  if (new Set(normalized.map(({ code }) => code)).size !== normalized.length) {
    throw new Error('definitions contains duplicate source codes');
  }

  return db.transaction(() => normalized.map((definition) => {
    const checksum = checksumDefinition(definition);
    const existing = db.prepare('SELECT * FROM atlas_sources WHERE code = ?').get(definition.code);
    const before = existing ? definitionFromRow(existing) : {};
    if (existing && checksumDefinition(before) === checksum) {
      return { id: existing.id, code: definition.code, checksum, changed: false };
    }

    const values = {
      ...definition,
      countries_json: JSON.stringify(definition.countries),
      allowed_origins_json: JSON.stringify(definition.allowed_origins),
      allowed_paths_json: JSON.stringify(definition.allowed_paths),
      disallowed_paths_json: JSON.stringify(definition.disallowed_paths),
      now
    };
    let sourceId;
    if (existing) {
      db.prepare(`
        UPDATE atlas_sources SET
          publisher=@publisher, landing_url=@landing_url, source_class=@source_class,
          countries_json=@countries_json, allowed_origins_json=@allowed_origins_json,
          allowed_paths_json=@allowed_paths_json, disallowed_paths_json=@disallowed_paths_json,
          auth_mode=@auth_mode, min_interval_ms=@min_interval_ms, concurrency=@concurrency,
          daily_budget=@daily_budget, cache_ttl_seconds=@cache_ttl_seconds,
          robots_reviewed_at=@robots_reviewed_at, policy_expires_at=@policy_expires_at,
          parser_version=@parser_version, license_note=@license_note, status=@status,
          updated_at=@now
        WHERE id=@id
      `).run({ ...values, id: existing.id });
      sourceId = existing.id;
    } else {
      const inserted = db.prepare(`
        INSERT INTO atlas_sources (
          code, publisher, landing_url, source_class, countries_json,
          allowed_origins_json, allowed_paths_json, disallowed_paths_json,
          auth_mode, min_interval_ms, concurrency, daily_budget, cache_ttl_seconds,
          robots_reviewed_at, policy_expires_at, parser_version, license_note,
          status, created_at, updated_at
        ) VALUES (
          @code, @publisher, @landing_url, @source_class, @countries_json,
          @allowed_origins_json, @allowed_paths_json, @disallowed_paths_json,
          @auth_mode, @min_interval_ms, @concurrency, @daily_budget, @cache_ttl_seconds,
          @robots_reviewed_at, @policy_expires_at, @parser_version, @license_note,
          @status, @now, @now
        )
      `).run(values);
      sourceId = Number(inserted.lastInsertRowid);
    }

    db.prepare(`
      INSERT INTO atlas_events (
        action, entity_type, entity_id, before_json, after_json,
        reason, idempotency_key, created_at
      ) VALUES (?, 'source', ?, ?, ?, ?, ?, ?)
    `).run(
      existing ? 'source_updated' : 'source_registered',
      sourceId,
      JSON.stringify(before),
      JSON.stringify({ ...definition, checksum }),
      `actor=${actorName}`,
      `source-registry:${definition.code}:${checksum}`,
      now
    );
    return { id: sourceId, code: definition.code, checksum, changed: true };
  }))();
}

function authorizeFetch(db, { sourceCode, url, countryCode, now = new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db is required');
  const code = requiredString(sourceCode, 'sourceCode');
  const country = requiredString(countryCode, 'countryCode').toUpperCase();
  const row = db.prepare('SELECT * FROM atlas_sources WHERE code = ?').get(code);
  if (!row) throw new Error(`unknown source ${code}`);
  const source = validateSourceDefinition(definitionFromRow(row), now);
  if (source.status !== 'active') throw new Error(`source ${code} is not active`);
  if (!source.countries.includes(country)) throw new Error(`country ${country} is not authorized for source ${code}`);

  const requested = canonicalHttpsUrl(url, 'url');
  requested.hash = '';
  if (!source.allowed_origins.includes(requested.origin)) throw new Error('URL origin is not allowed');
  if (source.disallowed_paths.some((prefix) => requested.pathname.startsWith(prefix))) {
    throw new Error('URL path is disallowed');
  }
  if (!source.allowed_paths.some((prefix) => requested.pathname.startsWith(prefix))) {
    throw new Error('URL is outside an allowed path');
  }

  return {
    sourceId: row.id,
    source,
    canonicalUrl: requested.href,
    countryCode: country
  };
}

module.exports = {
  validateSourceDefinition,
  registerSources,
  authorizeFetch
};

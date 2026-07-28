#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_FIELD = /(personal.?email|cookie|api.?key|api.?token|oauth|password|secret|smtp.?message.?id|message.?body|quotation|order.?record|formula)/i;
const TRACKING_PARAM = /^(utm_.+|gclid|fbclid)$/i;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function canonicalUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.search = url.searchParams.toString() ? `?${url.searchParams}` : '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function publicPhone(value) {
  const raw = text(value);
  if (!raw) return '';
  const leadingPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return `${leadingPlus ? '+' : ''}${digits}`;
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function domainOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function candidateKey(record) {
  const identity = [
    domainOf(record.website_official),
    record.phone_public,
    text(record.organization_name).toLowerCase(),
    text(record.locality).toLowerCase(),
    text(record.country_code).toUpperCase(),
  ].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

export function planQueries(input = {}) {
  const maxQueries = Number(input.maxQueries ?? 20);
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 20) {
    throw new Error('maxQueries must be between 1 and 20');
  }
  const countries = (input.countries ?? []).map(text).filter(Boolean);
  const locations = (input.locations ?? []).map(text).filter(Boolean);
  const categories = (input.categories ?? []).map(text).filter(Boolean);
  const localCategories = (input.localCategories ?? []).map(text).filter(Boolean);
  if (!countries.length || !locations.length || !categories.length) {
    throw new Error('countries, locations, and categories are required');
  }

  const queries = [];
  for (const country of countries) {
    for (const location of locations) {
      for (let index = 0; index < categories.length; index += 1) {
        queries.push(`${categories[index]} in ${location}, ${country}`);
        if (localCategories[index]) {
          queries.push(`${localCategories[index]} ${location} ${country}`);
        }
      }
    }
  }

  return {
    queries: [...new Set(queries)].slice(0, maxQueries),
    local_language: text(input.localLanguage) || 'en',
    policy: {
      concurrency: 1,
      maxQueries,
      maxResults: 200,
      cacheHours: 24,
      emailExtraction: false,
      extraReviews: false,
      proxyRotation: false,
      exhaustive: false,
    },
  };
}

export function normalizeRecord(input = {}, context = {}) {
  const website = canonicalUrl(input.website ?? input.website_official);
  const record = {
    candidate_key: '',
    organization_name: text(input.title ?? input.organization_name),
    country_code: text(context.countryCode ?? input.country_code).toUpperCase(),
    locality: text(context.locality ?? input.locality),
    categories: [...new Set([input.category, ...(input.categories ?? [])].map(text).filter(Boolean))],
    address_public: text(input.address ?? input.address_public),
    website_official: website,
    phone_public: publicPhone(input.phone ?? input.phone_public),
    map_url: canonicalUrl(input.map_url),
    latitude: finiteNumber(input.latitude),
    longitude: finiteNumber(input.longitude),
    rating: finiteNumber(input.rating),
    review_count: finiteNumber(input.review_count),
    source_adapter: text(context.sourceAdapter ?? input.source_adapter),
    source_url: canonicalUrl(input.source_url),
    source_query: text(context.sourceQuery ?? input.source_query),
    collected_at: text(context.collectedAt ?? input.collected_at) || new Date().toISOString(),
    verification_state: ['confirmed', 'inferred', 'unknown'].includes(input.verification_state)
      ? input.verification_state
      : 'unknown',
    verification_sources: Array.isArray(input.verification_sources) ? input.verification_sources : [],
    fit_score: 0,
    scale_score: 0,
    source_quality_score: 0,
    completeness_score: 0,
    review_status: text(input.review_status) || 'pending',
    notes: text(input.notes),
  };
  record.candidate_key = candidateKey(record);
  return record;
}

function mergeKey(record) {
  const domain = domainOf(record.website_official);
  if (domain) return `domain:${domain}`;
  if (record.phone_public) return `phone:${record.phone_public}`;
  return `name:${text(record.organization_name).toLowerCase()}|${text(record.locality).toLowerCase()}|${text(record.country_code).toUpperCase()}`;
}

function provenanceOf(record) {
  if (Array.isArray(record.provenance)) return record.provenance;
  return [{
    source_adapter: record.source_adapter ?? '',
    source_url: record.source_url ?? '',
    source_query: record.source_query ?? '',
    collected_at: record.collected_at ?? '',
  }];
}

export function dedupeRecords(records = []) {
  const merged = new Map();
  for (const record of records) {
    const key = mergeKey(record);
    if (!merged.has(key)) {
      merged.set(key, { ...record, provenance: provenanceOf(record) });
      continue;
    }
    const current = merged.get(key);
    for (const field of ['phone_public', 'website_official', 'address_public', 'map_url', 'latitude', 'longitude', 'rating', 'review_count']) {
      if ((current[field] === '' || current[field] === null || current[field] === undefined) && record[field] !== '' && record[field] !== null && record[field] !== undefined) {
        current[field] = record[field];
      }
    }
    current.categories = [...new Set([...(current.categories ?? []), ...(record.categories ?? [])])];
    current.verification_sources = [...(current.verification_sources ?? []), ...(record.verification_sources ?? [])];
    current.provenance = [...current.provenance, ...provenanceOf(record)]
      .filter((item, index, list) => index === list.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)));
  }
  return [...merged.values()].sort((a, b) => a.candidate_key.localeCompare(b.candidate_key));
}

export function scoreRecord(record) {
  const evidence = record.evidence ?? {};
  const confirmedProduct = evidence.product_match === 'confirmed';
  const confirmedScale = ['export_activity', 'facility_count', 'production_capacity', 'distribution_reach']
    .filter((field) => evidence[field] === 'confirmed').length;
  const officialEvidence = (record.verification_sources ?? [])
    .some((source) => ['official_website', 'government', 'association'].includes(source.type));
  const completenessFields = [
    record.organization_name,
    record.country_code,
    record.locality,
    record.website_official,
    record.phone_public,
    record.address_public,
    record.source_url,
  ];
  const completeness = completenessFields.filter(Boolean).length / completenessFields.length;
  return {
    ...record,
    fit_score: confirmedProduct ? 40 : 0,
    scale_score: Math.min(20, confirmedScale * 5),
    source_quality_score: record.verification_state === 'confirmed' && officialEvidence ? 30 : 0,
    completeness_score: Math.round(completeness * 30),
  };
}

export function validateRecord(record) {
  const errors = [];
  for (const key of Object.keys(record ?? {})) {
    if (FORBIDDEN_FIELD.test(key)) errors.push(`forbidden field: ${key}`);
  }
  if (!text(record?.organization_name)) errors.push('organization_name is required');
  if (!/^[A-Z]{2}$/.test(text(record?.country_code))) errors.push('country_code must be ISO alpha-2');
  if (!canonicalUrl(record?.source_url)) errors.push('source_url must be a public absolute URL');
  if (record?.verification_state && !['confirmed', 'inferred', 'unknown'].includes(record.verification_state)) {
    errors.push('verification_state is invalid');
  }
  return { valid: errors.length === 0, errors };
}

function parseJsonLines(content) {
  return content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function emitJsonLines(records) {
  process.stdout.write(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

async function main(argv) {
  const [command = 'help', inputPath, contextJson = '{}'] = argv;
  if (command === 'help') {
    process.stdout.write([
      'matrix-atlas: bounded public-organization discovery preparation',
      'Commands:',
      '  plan <input.json>',
      '  normalize <source.jsonl> [context-json]',
      '  dedupe <records.jsonl>',
      '  score <records.jsonl>',
      '  verify <records.jsonl>',
      'This command does not send messages or write production records.',
      '',
    ].join('\n'));
    return;
  }
  if (!inputPath) throw new Error(`${command} requires an input file`);
  const content = await readFile(inputPath, 'utf8');
  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(planQueries(JSON.parse(content)), null, 2)}\n`);
    return;
  }
  const records = parseJsonLines(content);
  if (command === 'normalize') {
    const context = JSON.parse(contextJson);
    emitJsonLines(records.slice(0, 200).map((record) => normalizeRecord(record, context)));
    return;
  }
  if (command === 'dedupe') {
    emitJsonLines(dedupeRecords(records.slice(0, 200)));
    return;
  }
  if (command === 'score') {
    emitJsonLines(records.slice(0, 200).map(scoreRecord));
    return;
  }
  if (command === 'verify') {
    const results = records.slice(0, 200).map(validateRecord);
    const invalid = results.flatMap((result, index) => result.valid ? [] : [{ line: index + 1, errors: result.errors }]);
    process.stdout.write(`${JSON.stringify({ valid: invalid.length === 0, checked: results.length, invalid }, null, 2)}\n`);
    if (invalid.length) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`matrix-atlas: ${error.message}\n`);
    process.exitCode = 1;
  });
}

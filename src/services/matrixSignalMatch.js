'use strict';

const DEFAULT_THRESHOLD = 75;

function text(value) {
  return String(value || '').normalize('NFKC').toLowerCase().trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean) : [];
}

const ROLE_PATTERNS = Object.freeze({
  profile: /(?:about|profile|company|history|capacity|factory|export|เกี่ยวกับ|บริษัท|กำลังการผลิต)/iu,
  products: /(?:product|portfolio|category|shampoo|body wash|home care|coffee|tea|snack|ผลิตภัณฑ์|สินค้า)/iu,
  process: /(?:service|oem|odm|private label|development|research|innovation|packaging service|manufactur|บริการ|วิจัย|พัฒนา)/iu,
  quality: /(?:quality|testing|laboratory|regulatory|certif|iso|gmp|traceability|ทดสอบ|คุณภาพ|มาตรฐาน)/iu,
  sustainability: /(?:sustainab|recycl|mono material|pcr|obp|material efficiency|product waste|สิ่งแวดล้อม|รีไซเคิล)/iu,
  contact: /(?:contact|supplier|sourcing|procurement|purchas|ติดต่อ|จัดซื้อ|ซัพพลายเออร์)/iu
});

function evidenceRows(detail) {
  return (Array.isArray(detail?.official_evidence) ? detail.official_evidence : [])
    .filter(row => /^https:\/\//i.test(String(row?.source_url || '')))
    .map(row => ({
      source_url: String(row.source_url),
      locator: text([row.source_url, row.page_title].join(' ')),
      value: text([row.source_url, row.page_title, row.excerpt].join(' '))
    }));
}

function classifiedRoles(rows) {
  const roles = {};
  for (const [name, pattern] of Object.entries(ROLE_PATTERNS)) {
    roles[name] = rows.filter(row => pattern.test(row.locator)).map(row => row.source_url);
  }
  return roles;
}

function addComponent(components, name, points, maximum, reasons) {
  components[name] = { points: Math.min(maximum, Math.max(0, points)), maximum, reasons };
}

function scoreSignalMatch(detail, { localizedRouteStatus = 'not_checked', threshold = DEFAULT_THRESHOLD } = {}) {
  const rows = evidenceRows(detail);
  const roles = classifiedRoles(rows);
  const components = {};
  const categories = list(detail?.categories);
  const formats = list(detail?.format_signals);
  const evidenceText = rows.map(row => row.value).join(' ');
  const strategy = detail?.strategy_signal && typeof detail.strategy_signal === 'object' ? detail.strategy_signal : {};

  const coveredRoles = Object.values(roles).filter(urls => urls.length > 0).length;
  addComponent(components, 'official_coverage', coveredRoles * 4, 24,
    coveredRoles ? [`${coveredRoles}/6 official-site evidence roles covered`] : ['official-site role coverage missing']);

  let operating = 0;
  if (roles.profile.length) operating += 5;
  if (/(?:oem|odm|private label|manufacturer|factory|production|capacity|export)/iu.test(evidenceText)) operating += 6;
  if (text(detail?.scale_tier)) operating += 2;
  if (text(detail?.country_code)) operating += 2;
  addComponent(components, 'operating_model', operating, 15, operating >= 11 ? ['operating model evidenced'] : ['operating model evidence incomplete']);

  let product = 0;
  if (categories.length) product += 8;
  if (formats.length) product += 4;
  if (categories.some(category => evidenceText.includes(category)) || roles.products.length) product += 8;
  addComponent(components, 'product_alignment', product, 20, product >= 16 ? ['product/category fit evidenced'] : ['product/category fit incomplete']);

  let workflow = 0;
  if (roles.process.length) workflow += 8;
  if (roles.quality.length) workflow += 7;
  addComponent(components, 'development_workflow', workflow, 15, workflow === 15 ? ['development and quality workflow evidenced'] : ['development or quality workflow missing']);

  let priorities = 0;
  if (roles.sustainability.length) priorities += 5;
  const strategyText = text([strategy.entry_product, strategy.differentiation_angle, strategy.first_contact_goal, ...(strategy.questions || []), ...(strategy.risks || [])].join(' '));
  if (strategyText || /(?:filling|leak|multi.?sku|artwork|barcode|repeat|material efficiency|product waste)/iu.test(evidenceText)) priorities += 5;
  addComponent(components, 'buyer_priorities', priorities, 10, priorities === 10 ? ['buyer priorities evidenced'] : ['buyer priorities need deeper research']);

  let access = 0;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(detail?.contacts?.email || '').trim())) access += 4;
  if (/^https:\/\//i.test(String(detail?.contacts?.contact_page || '').trim()) && roles.contact.length) access += 4;
  addComponent(components, 'organizational_access', access, 8, access === 8 ? ['official organizational access evidenced'] : ['official organizational access incomplete']);

  const routePoints = localizedRouteStatus === 'ready' ? 8 : localizedRouteStatus === 'not_required' ? 6 : 0;
  addComponent(components, 'localized_journey', routePoints, 8,
    routePoints ? [`localized route status: ${localizedRouteStatus}`] : ['localized route set not verified']);

  const score = Object.values(components).reduce((sum, row) => sum + row.points, 0);
  const blockers = [];
  if (new Set(rows.map(row => row.source_url)).size < 3) blockers.push('official_source_coverage_below_3');
  if (!roles.profile.length) blockers.push('operating_profile_missing');
  if (!roles.products.length || !categories.length) blockers.push('product_evidence_missing');
  if (!roles.process.length) blockers.push('development_process_missing');
  if (access < 8) blockers.push('organizational_access_missing');
  if (localizedRouteStatus !== 'ready' && localizedRouteStatus !== 'not_required') blockers.push('localized_journey_not_ready');
  if (score < threshold) blockers.push('score_below_threshold');

  return {
    score,
    threshold,
    passed: blockers.length === 0,
    status: blockers.length ? 'blocked' : 'ready',
    blockers,
    components,
    source_count: new Set(rows.map(row => row.source_url)).size,
    checked_at: new Date().toISOString()
  };
}

module.exports = { DEFAULT_THRESHOLD, scoreSignalMatch };

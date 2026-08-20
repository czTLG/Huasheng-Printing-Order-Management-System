const { db, now } = require('../db');
const { generateQuote } = require('./quoteEngine');
const { callStructuredProvider, getProviderConfig } = require('./aiProvider');

const FIRST_STAGE_COST_TYPES = new Set([
  'auto_bag',
  'stand_zipper_bag',
  'three_side_seal',
  'eight_side_seal',
  'material_weight'
]);

const CAUTIOUS_COST_TYPES = new Set([
  'irregular_zipper_bag',
  'back_seal',
  'four_side_seal'
]);

const SECONDARY_COST_TYPES = new Set(['side_seal']);

const COST_LABELS = {
  jgf: '每平方加工费',
  zxyf: '运费',
  yf: '运费(自动包)',
  fqfy: '分切费用',
  lldj: '拉链单价',
  ba_zdf: '拉链总费用',
  sh: '损耗',
  lr: '利润',
  ba_chang: '高/长',
  ba_kuang: '宽',
  ba_di: '底',
  ba_ce: '侧边',
  thick: '厚度(C)',
  price: '单价(元/kg)',
  proportion: '比重'
};

const MATERIAL_ALIAS_PATTERNS = [
  { pattern: /matt(?:e)? varnish/i, raw: 'Matt varnish', normalized: 'surface_finish', cn: '哑光光油', confidence: 'medium', needs_confirm: 1, note: 'surface finish, not a material layer' },
  { pattern: /gloss varnish/i, raw: 'Gloss varnish', normalized: 'surface_finish', cn: '光油', confidence: 'medium', needs_confirm: 1, note: 'surface finish, not a material layer' },
  { pattern: /\btransparent\s+ldpe\b/i, raw: 'transparent LDPE', normalized: 'PE', cn: '透明PE', confidence: 'medium', needs_confirm: 1, note: 'mapped to PE for costing; confirm price and density' },
  { pattern: /\bldpe\s*tr\.?\b/i, raw: 'LDPE Tr.', normalized: 'PE', cn: '透明PE', confidence: 'medium', needs_confirm: 1, note: 'mapped to PE for costing; confirm price and density' },
  { pattern: /\bldpe\b/i, raw: 'LDPE', normalized: 'PE', cn: '低密度聚乙烯', confidence: 'medium', needs_confirm: 1, note: 'mapped to PE for costing; confirm price and density' },
  { pattern: /\blldpe\b/i, raw: 'LLDPE', normalized: 'PE', cn: '线性低密度聚乙烯', confidence: 'medium', needs_confirm: 1, note: 'mapped to PE for costing; confirm price and density' },
  { pattern: /\brcpp\b/i, raw: 'RCPP', normalized: 'CPP', cn: 'RCPP/CPP', confidence: 'medium', needs_confirm: 1, note: 'mapped to CPP family; confirm canonical code' },
  { pattern: /\bmet\s*pet\b/i, raw: 'MET PET', normalized: 'VMPET', cn: '镀铝PET', confidence: 'medium', needs_confirm: 1, note: 'mapped to VMPET family; confirm canonical code' },
  { pattern: /\bvmpet\b/i, raw: 'VMPET', normalized: 'VMPET', cn: '镀铝PET', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bvmcpp\b/i, raw: 'VMCPP', normalized: 'VMCPP', cn: '镀铝CPP', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bbopp\b/i, raw: 'BOPP', normalized: 'BOPP', cn: '双向拉伸聚丙烯', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bmopp\b/i, raw: 'MOPP', normalized: 'MOPP', cn: '单向拉伸聚丙烯', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bcpp\b/i, raw: 'CPP', normalized: 'CPP', cn: '流延聚丙烯', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bpet\b/i, raw: 'PET', normalized: 'PET', cn: '聚酯PET', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\baluminum\s+foil\b/i, raw: 'Aluminum foil', normalized: 'AL', cn: '铝箔', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\bal\b/i, raw: 'AL', normalized: 'AL', cn: '铝箔', confidence: 'high', needs_confirm: 0, note: '' },
  { pattern: /\balox\b/i, raw: 'ALOX', normalized: 'VMPET', cn: '氧化铝/ALOX', confidence: 'medium', needs_confirm: 1, note: 'barrier coating; confirm canonical material and price' },
  { pattern: /\bkraft\b/i, raw: 'Kraft', normalized: '纸', cn: '牛皮纸', confidence: 'medium', needs_confirm: 1, note: 'paper-based layer; confirm canonical material and price' }
];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function nOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function normalizeThicknessToC(value, unit) {
  const parsed = nOrNull(value);
  if (parsed === null) return null;
  const normalizedUnit = String(unit || '').trim().toLowerCase();
  if (normalizedUnit === 'c') return parsed;
  if (['mic', 'micron', 'um', 'μm', 'µm'].includes(normalizedUnit)) return parsed / 10;
  return null;
}

function toText(v) {
  return v === null || v === undefined ? '' : String(v);
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function flattenValues(values) {
  const out = [];
  (values || []).forEach(item => {
    if (Array.isArray(item)) out.push(...flattenValues(item));
    else if (item !== undefined && item !== null && item !== '') out.push(item);
  });
  return out;
}

function normalizeText(text) {
  return toText(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDimensionMeasure(value, unit) {
  const n = nOrNull(value);
  if (n === null) return null;
  const u = String(unit || '').toLowerCase();
  if (u === 'cm') return n * 10;
  if (u === 'm') return n * 1000;
  return n;
}

function lowerCompact(text) {
  return normalizeText(text).toLowerCase().replace(/[\s._\-\/()+,，;:]/g, '');
}

function stripHtml(text) {
  return toText(text)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCountry(text) {
  const source = normalizeText(text);
  const patterns = [
    { re: /\bUAE\b/i, value: 'UAE' },
    { re: /\bUnited Arab Emirates\b/i, value: 'UAE' },
    { re: /\bPakistan\b/i, value: 'Pakistan' },
    { re: /\bBangladesh\b/i, value: 'Bangladesh' },
    { re: /\bChina\b/i, value: 'China' },
    { re: /\bSaudi Arabia\b/i, value: 'Saudi Arabia' },
    { re: /\bIndia\b/i, value: 'India' },
    { re: /\bKarachi\b/i, value: 'Pakistan' },
    { re: /\bChittagong\b/i, value: 'Bangladesh' },
    { re: /\bDhaka\b/i, value: 'Bangladesh' },
    { re: /\bFaridpur\b/i, value: 'Bangladesh' }
  ];
  for (const p of patterns) {
    if (p.re.test(source)) return p.value;
  }
  return '';
}

function detectDestination(text) {
  const source = normalizeText(text);
  const patterns = [
    /\bDestination\s*[:\-]?\s*([A-Za-z][A-Za-z ,./-]{1,40})/i,
    /\bShip(?:ping)?\s+to\s*[:\-]?\s*([A-Za-z][A-Za-z ,./-]{1,40})/i,
    /\bFor\s+([A-Za-z][A-Za-z ,./-]{1,40})\s+delivery/i
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (m) return m[1].trim().replace(/[.。]$/, '');
  }
  const country = detectCountry(source);
  return country;
}

function detectTradeTerm(text) {
  const source = normalizeText(text);
  const terms = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'FCA', 'DDU'];
  const found = terms.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(source));
  return uniq(found);
}

function detectBagType(text) {
  const source = normalizeText(text).toLowerCase();
  const bag = {
    cost_type: '',
    bag_type: '',
    packaging_type: '',
    confidence: 'low',
    evidence: []
  };

  const push = (costType, bagType, packagingType, evidence, confidence = 'high') => {
    bag.cost_type = costType;
    bag.bag_type = bagType;
    bag.packaging_type = packagingType || bagType;
    bag.confidence = confidence;
    bag.evidence = evidence;
  };

  if (/flat bottom pouch|3d pouch|three dimensional pouch|bottom gusset pouch|block bottom pouch/i.test(source)) {
    push('eight_side_seal', '八边封 / 平底袋', 'flat bottom pouch', ['flat bottom pouch / 3D pouch']);
    return bag;
  }
  if (/stand[-\s]?up pouch|doypack|zipper pouch|pouch with zipper/i.test(source)) {
    push('stand_zipper_bag', '自立拉链袋', 'stand-up zipper pouch', ['stand-up pouch / zipper pouch']);
    return bag;
  }
  if (/three side seal|3 side seal|sachet|pillow sachet/i.test(source)) {
    push('three_side_seal', '三边封 / 小袋', 'three side seal', ['three side seal / sachet']);
    return bag;
  }
  if (/roll film|roll stock|web film|film roll|lamination roll/i.test(source)) {
    push('auto_bag', '卷膜 / 自动包', 'roll film', ['roll film / roll stock']);
    return bag;
  }
  if (/back seal|back sealing|pillow bag/i.test(source)) {
    push('back_seal', '背封袋 / 枕包袋', 'back seal', ['back seal']);
    return bag;
  }
  if (/side seal/i.test(source)) {
    push('side_seal', '边封', 'side seal', ['side seal']);
    return bag;
  }
  if (/four side seal|4 side seal/i.test(source)) {
    push('four_side_seal', '四边封', 'four side seal', ['four side seal']);
    return bag;
  }
  if (/irregular|shaped zipper|special shape/i.test(source)) {
    push('irregular_zipper_bag', '异形拉链袋', 'irregular zipper bag', ['irregular / special shape']);
    return bag;
  }
  if (/material weight|weight only/i.test(source)) {
    push('material_weight', '材料重量', 'material weight', ['material weight only'], 'medium');
    return bag;
  }

  return bag;
}

function extractDimensions(text) {
  const source = normalizeText(text);
  const dims = {
    width_mm: null,
    height_mm: null,
    gusset_mm: null,
    roll_width_mm: null,
    roll_length_m: null,
    raw_size: '',
    evidence: []
  };

  let m = source.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*[w宽]?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*[h高]?\s*x\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*(?:gusset|底|侧)?/i);
  if (m) {
    dims.width_mm = parseDimensionMeasure(m[1], m[2]);
    dims.height_mm = parseDimensionMeasure(m[3], m[4]);
    dims.gusset_mm = parseDimensionMeasure(m[5], m[7]);
    dims.raw_size = `${m[1]}${m[2]}x${m[3]}${m[4]}x${m[5]}+${m[6]}${m[7]}`;
    dims.evidence.push(m[0]);
    return dims;
  }

  m = source.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*[w宽]?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*[h高]?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*(?:gusset|底|侧)?/i);
  if (m) {
    dims.width_mm = parseDimensionMeasure(m[1], m[2]);
    dims.height_mm = parseDimensionMeasure(m[3], m[4]);
    dims.gusset_mm = parseDimensionMeasure(m[5], m[6]);
    dims.raw_size = `${m[1]}${m[2]}x${m[3]}${m[4]}x${m[5]}${m[6]}`;
    dims.evidence.push(m[0]);
    return dims;
  }

  m = source.match(/roll\s*width\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)/i);
  if (m) {
    dims.roll_width_mm = parseDimensionMeasure(m[1], m[2]);
    dims.evidence.push(m[0]);
  }

  m = source.match(/roll\s*length\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(m|meter|cm|mm)/i);
  if (m) {
    const unit = String(m[2] || '').toLowerCase();
    const value = nOrNull(m[1]);
    dims.roll_length_m = value === null ? null : (unit === 'cm' ? value / 100 : unit === 'mm' ? value / 1000 : value);
    dims.evidence.push(m[0]);
  }

  return dims;
}

function extractQuantity(text) {
  const source = normalizeText(text);
  const quantity = {
    quantity_total: null,
    quantity_per_variant: null,
    variants: null,
    quantity_unit: '',
    evidence: []
  };

  let m = source.match(/(\d[\d,]*)\s*(pcs?|pieces?|bags?|rolls?|sets?)\s*[x×*]\s*(\d+)\s*(variants?|colors?|arts?|artworks?)/i);
  if (m) {
    const per = Number(m[1].replace(/,/g, ''));
    const variants = Number(m[3]);
    if (Number.isFinite(per) && Number.isFinite(variants)) {
      quantity.quantity_per_variant = per;
      quantity.variants = variants;
      quantity.quantity_total = per * variants;
      quantity.quantity_unit = m[2].toLowerCase();
      quantity.evidence.push(m[0]);
    }
  }

  m = source.match(/total\s+(\d[\d,]*)\s*(pcs?|pieces?|bags?|rolls?|sets?)/i);
  if (m) {
    quantity.quantity_total = Number(m[1].replace(/,/g, ''));
    quantity.quantity_unit = m[2].toLowerCase();
    quantity.evidence.push(m[0]);
  }

  m = source.match(/(?:quantity|qty)\s*[:\-]?\s*(\d[\d,]*)\s*(pcs?|pieces?|bags?|rolls?|sets?)/i);
  if (m && quantity.quantity_total === null) {
    quantity.quantity_total = Number(m[1].replace(/,/g, ''));
    quantity.quantity_unit = m[2].toLowerCase();
    quantity.evidence.push(m[0]);
  }

  m = source.match(/(\d[\d,]*)\s*(pcs?|pieces?|bags?|rolls?|sets?)/i);
  if (m && quantity.quantity_total === null) {
    quantity.quantity_total = Number(m[1].replace(/,/g, ''));
    quantity.quantity_unit = m[2].toLowerCase();
    quantity.evidence.push(m[0]);
  }

  if (quantity.quantity_total !== null && quantity.quantity_per_variant === null && quantity.variants !== null && quantity.variants > 0) {
    quantity.quantity_per_variant = Math.round(quantity.quantity_total / quantity.variants);
  }
  if (quantity.quantity_total !== null && quantity.quantity_per_variant !== null && quantity.variants === null && quantity.quantity_per_variant > 0) {
    quantity.variants = Math.max(1, Math.round(quantity.quantity_total / quantity.quantity_per_variant));
  }

  return quantity;
}

function parseThicknessToken(token) {
  const raw = normalizeText(token);
  let m = raw.match(/(\d+(?:\.\d+)?)\s*(mic|micron|um|μm|µm|c)\b/i);
  if (m) return normalizeThicknessToC(m[1], m[2]);
  m = raw.match(/\b([A-Za-z][A-Za-z \-./()]*)\s*(\d+(?:\.\d+)?)\s*(mic|micron|um|μm|µm|c)\b/i);
  if (m) return normalizeThicknessToC(m[2], m[3]);
  return null;
}

function detectMaterialName(token) {
  const raw = normalizeText(token);
  const compact = lowerCompact(raw);
  for (const p of MATERIAL_ALIAS_PATTERNS) {
    if (p.pattern.test(raw)) {
      return {
        raw_name: p.raw,
        normalized_material: p.normalized,
        display_name_cn: p.cn,
        confidence: p.confidence,
        needs_confirm: p.needs_confirm,
        note: p.note,
        source: raw
      };
    }
  }
  if (/paper|kraft|white board/i.test(raw)) {
    return { raw_name: raw, normalized_material: '纸', display_name_cn: '纸', confidence: 'low', needs_confirm: 1, note: 'fallback paper mapping needs confirmation', source: raw };
  }
  if (/pet/i.test(raw)) {
    return { raw_name: raw, normalized_material: 'PET', display_name_cn: 'PET', confidence: 'high', needs_confirm: 0, note: '', source: raw };
  }
  if (/bopp/i.test(raw)) {
    return { raw_name: raw, normalized_material: 'BOPP', display_name_cn: 'BOPP', confidence: 'high', needs_confirm: 0, note: '', source: raw };
  }
  if (/cpp/i.test(raw)) {
    return { raw_name: raw, normalized_material: 'CPP', display_name_cn: 'CPP', confidence: 'high', needs_confirm: 0, note: '', source: raw };
  }
  if (/alox/i.test(raw)) {
    return { raw_name: raw, normalized_material: 'VMPET', display_name_cn: '氧化铝/ALOX', confidence: 'medium', needs_confirm: 1, note: 'barrier coating mapping needs confirmation', source: raw };
  }
  return {
    raw_name: raw,
    normalized_material: raw,
    display_name_cn: raw,
    confidence: 'low',
    needs_confirm: 1,
    note: 'unrecognized material name',
    source: raw
  };
}

function extractMaterialCandidates(text) {
  const source = normalizeText(text);
  const tokens = [];
  const specialSurface = [];

  source.split(/[+，,；;]/).map(s => s.trim()).filter(Boolean).forEach(segment => {
    if (/matt(?:e)? varnish|gloss varnish/i.test(segment)) {
      specialSurface.push(segment);
      return;
    }
    let matched = false;
    const thickFirst = segment.match(/(\d+(?:\.\d+)?)\s*(mic|micron|um|μm|µm|c)\s*([A-Za-z][A-Za-z0-9 \-./()]*)/i);
    if (thickFirst) {
      tokens.push({ raw_name: thickFirst[3].trim(), thickness_value: normalizeThicknessToC(thickFirst[1], thickFirst[2]), source: segment });
      matched = true;
    }
    const materialFirst = segment.match(/([A-Za-z][A-Za-z \-./()]*)\s*(\d+(?:\.\d+)?)\s*(mic|micron|um|μm|µm|c)\b/i);
    if (materialFirst) {
      tokens.push({ raw_name: materialFirst[1].trim(), thickness_value: normalizeThicknessToC(materialFirst[2], materialFirst[3]), source: segment });
      matched = true;
    }
    if (!matched && /pet|bopp|cpp|ldpe|lldpe|vmpet|vmcpp|alox|kraft|aluminum foil|al\b/i.test(segment)) {
      tokens.push({ raw_name: segment.trim(), thickness_value: null, source: segment });
    }
  });

  // Fallback for compact strings like PET12/AL7/PE70
  if (!tokens.length && /[A-Za-z]+\d+/.test(source)) {
    source.split(/[+/]/).map(s => s.trim()).filter(Boolean).forEach(part => {
      const m1 = part.match(/([A-Za-z][A-Za-z0-9 \-()]*)\s*(\d+(?:\.\d+)?)/i);
      if (m1) tokens.push({ raw_name: m1[1].trim(), thickness_value: nOrNull(m1[2]) / 10, source: part });
    });
  }

  return { layers: tokens, surface_finish: specialSurface };
}

function queryMaterialAliasRows() {
  try {
    return db.prepare(`
      SELECT id, raw_name, normalized_material, display_name_cn, density, price, price_unit, confidence, needs_confirm, note, updated_by, updated_at
      FROM material_aliases
    `).all();
  } catch (err) {
    if (/no such table/i.test(String(err.message || ''))) return [];
    throw err;
  }
}

function queryMaterialPriceMap() {
  try {
    const rows = db.prepare(`SELECT code, prop, price, updated_by, updated_at FROM material_prices`).all();
    const map = new Map();
    rows.forEach(r => map.set(String(r.code || '').toUpperCase(), r));
    return map;
  } catch (err) {
    if (/no such table/i.test(String(err.message || ''))) return new Map();
    throw err;
  }
}

function resolveMaterialPriceCode(normalizedMaterial, materialPriceMap) {
  const candidates = uniq([
    normalizedMaterial,
    normalizedMaterial.split('/')[0],
    normalizedMaterial.replace(/\s+/g, ''),
    normalizedMaterial.toUpperCase()
  ].filter(Boolean));
  for (const c of candidates) {
    const key = String(c).toUpperCase();
    if (materialPriceMap.has(key)) return key;
  }
  if (/PE/i.test(normalizedMaterial) && materialPriceMap.has('PE')) return 'PE';
  if (/PET/i.test(normalizedMaterial) && materialPriceMap.has('PET')) return 'PET';
  if (/BOPP/i.test(normalizedMaterial) && materialPriceMap.has('BOPP')) return 'BOPP';
  if (/CPP/i.test(normalizedMaterial) && materialPriceMap.has('CPP')) return 'CPP';
  if (/VMPET/i.test(normalizedMaterial) && materialPriceMap.has('VMPET')) return 'VMPET';
  if (/VMCPP/i.test(normalizedMaterial) && materialPriceMap.has('VMCPP')) return 'VMCPP';
  if (/AL\b/i.test(normalizedMaterial) && materialPriceMap.has('AL')) return 'AL';
  if (/纸/.test(normalizedMaterial) && materialPriceMap.has('纸')) return '纸';
  return '';
}

function buildMaterialFallbackEntry(rawLayer, aliasRow, priceRow) {
  const confidence = String(aliasRow?.confidence || 'low').toLowerCase();
  const needsConfirm = Number(aliasRow?.needs_confirm || 0) === 1;
  const priceUsed = priceRow ? nOrNull(priceRow.price) : null;
  const proportionUsed = priceRow ? nOrNull(priceRow.prop) : null;
  return {
    raw_name: rawLayer.raw_name,
    normalized_material: aliasRow?.normalized_material || rawLayer.raw_name,
    display_name_cn: aliasRow?.display_name_cn || rawLayer.raw_name,
    thickness: rawLayer.thickness_value,
    thickness_unit: 'C',
    price_used: priceUsed,
    price_unit: priceRow ? 'yuan/kg' : null,
    proportion_used: proportionUsed,
    confidence,
    needs_confirm: needsConfirm || confidence !== 'high',
    note: aliasRow?.note || '',
    source: rawLayer.source,
    alias_id: aliasRow?.id || null,
    material_price_code: priceRow?.code || null,
    material_price_prop: priceRow ? nOrNull(priceRow.prop) : null
  };
}

async function normalizeMaterialLayers(parsedSpec = {}) {
  const text = normalizeText(parsedSpec.material_structure_text || parsedSpec.material_text || parsedSpec.materials_text || '');
  const extracted = Array.isArray(parsedSpec.material_layers) && parsedSpec.material_layers.length
    ? { layers: parsedSpec.material_layers, surface_finish: parsedSpec.surface_finish ? [parsedSpec.surface_finish] : [] }
    : extractMaterialCandidates(text);

  const aliasRows = queryMaterialAliasRows();
  const aliasMap = new Map();
  aliasRows.forEach(row => {
    aliasMap.set(lowerCompact(row.raw_name), row);
  });
  const materialPriceMap = queryMaterialPriceMap();

  const layers = [];
  const warnings = [];
  const mappingJson = [];
  const surfaceFinish = [];

  for (const rawLayer of extracted.layers) {
    const rawName = normalizeText(rawLayer.raw_name || rawLayer.name || rawLayer.material || '');
    if (!rawName) continue;
    const aliasKey = lowerCompact(rawName);
    let aliasRow = aliasMap.get(aliasKey) || null;
    if (!aliasRow) {
      const special = MATERIAL_ALIAS_PATTERNS.find(p => p.pattern.test(rawName));
      if (special) {
        aliasRow = {
          id: null,
          raw_name: special.raw,
          normalized_material: special.normalized,
          display_name_cn: special.cn,
          density: null,
          price: null,
          price_unit: null,
          confidence: special.confidence,
          needs_confirm: special.needs_confirm,
          note: special.note,
          updated_by: 'system',
          updated_at: now()
        };
      } else {
        aliasRow = {
          id: null,
          raw_name: rawName,
          normalized_material: rawName,
          display_name_cn: rawName,
          density: null,
          price: null,
          price_unit: null,
          confidence: 'low',
          needs_confirm: 1,
          note: 'unrecognized material name',
          updated_by: 'system',
          updated_at: now()
        };
      }
    }

    const priceCode = resolveMaterialPriceCode(aliasRow.normalized_material, materialPriceMap);
    const priceRow = priceCode ? materialPriceMap.get(priceCode) : null;
    const entry = buildMaterialFallbackEntry(
      {
        raw_name: rawName,
        thickness_value: rawLayer.thickness_value ?? parseThicknessToken(rawName),
        source: rawLayer.source || rawName
      },
      aliasRow,
      priceRow
    );

    layers.push(entry);
    mappingJson.push(entry);
    if (entry.confidence !== 'high' || entry.needs_confirm) {
      warnings.push(`材料名 ${entry.raw_name} 暂映射为 ${entry.normalized_material}，请确认材料单价和比重。`);
    }
  }

  for (const item of extracted.surface_finish || []) {
    const raw = normalizeText(item);
    if (raw) surfaceFinish.push(raw);
    if (/matt(?:e)? varnish/i.test(raw) && !surfaceFinish.includes('matt varnish')) {
      surfaceFinish.push('matt varnish');
    }
  }

  return {
    layers,
    surface_finish: uniq(surfaceFinish),
    material_mapping_warnings: uniq(warnings),
    material_mapping_json: mappingJson
  };
}

function mapCostTypeForEngine(costType) {
  if (costType === 'three_side_seal') return 'stand_zipper_bag';
  return costType || 'stand_zipper_bag';
}

function inferQuantityField(parsedSpec) {
  const order = parsedSpec.customer_order_info || parsedSpec || {};
  return {
    quantity_total: nOrNull(order.quantity_total),
    quantity_per_variant: nOrNull(order.quantity_per_variant),
    variants: nOrNull(order.variants),
    quantity_unit: order.quantity_unit || '',
    quantity_basis: order.quantity_basis || ''
  };
}

function pickBagFields(parsedSpec = {}, normalizedLayers = []) {
  const order = parsedSpec.customer_order_info || parsedSpec || {};
  const dims = order.dimensions || {};
  const bagType = String(order.cost_type || parsedSpec.suggested_cost_type || '').trim();
  const quoteType = mapCostTypeForEngine(bagType);

  const result = {
    cost_type: bagType,
    quoteType,
    bag_type: order.bag_type || '',
    packaging_type: order.packaging_type || '',
    product_type: order.product_type || '',
    application: order.application || '',
    trade_term_requested: order.trade_term_requested || '',
    destination_country: order.destination_country || '',
    destination_port: order.destination_port || '',
    destination_address: order.destination_address || '',
    customer_name: order.customer_name || '',
    contact_person: order.contact_person || '',
    customer_questions: order.customer_questions || [],
    material_structure_text: order.material_structure_text || '',
    size_text: order.size_text || order.raw_size || '',
    quantity_total: order.quantity_total ?? null,
    quantity_per_variant: order.quantity_per_variant ?? null,
    variants: order.variants ?? null,
    quantity_unit: order.quantity_unit || '',
    zippers: order.zipper_required ?? null,
    fill_weight: order.filling_weight || order.fill_weight || '',
    artwork_status: order.artwork_status || '',
    sample_image_status: order.sample_image_status || '',
    special_features: order.special_features || [],
    note: order.note || '',
    dimensions: dims,
    material_layers: normalizedLayers
  };

  if (!result.trade_term_requested) result.trade_term_requested = (parsedSpec.ai_inferred || {}).trade_term_requested || '';
  if (!result.destination_country) result.destination_country = (parsedSpec.ai_inferred || {}).destination_country || '';

  return result;
}

function parseDimensionValues(dims = {}, costType = '') {
  const hasWidthMm = Object.prototype.hasOwnProperty.call(dims, 'width_mm');
  const hasHeightMm = Object.prototype.hasOwnProperty.call(dims, 'height_mm');
  const hasGussetMm = Object.prototype.hasOwnProperty.call(dims, 'gusset_mm');
  const hasSideMm = Object.prototype.hasOwnProperty.call(dims, 'side_mm');
  const hasRollWidthMm = Object.prototype.hasOwnProperty.call(dims, 'roll_width_mm');
  const hasRollLengthM = Object.prototype.hasOwnProperty.call(dims, 'roll_length_m');

  const widthRaw = nOrNull(hasWidthMm ? dims.width_mm : dims.ba_kuang);
  const heightRaw = nOrNull(hasHeightMm ? dims.height_mm : dims.ba_chang);
  const gussetRaw = nOrNull(hasGussetMm ? dims.gusset_mm : dims.ba_di);
  const sideRaw = nOrNull(hasSideMm ? dims.side_mm : dims.ba_ce);
  const rollWidthRaw = nOrNull(hasRollWidthMm ? dims.roll_width_mm : dims.roll_w);
  const rollLengthRaw = nOrNull(hasRollLengthM ? dims.roll_length_m : dims.roll_l);

  const out = {};
  if (costType === 'material_weight') {
    out.chang = hasHeightMm ? (heightRaw !== null ? heightRaw / 1000 : null) : heightRaw;
    out.kuang = hasWidthMm ? (widthRaw !== null ? widthRaw / 1000 : null) : widthRaw;
    return out;
  }

  if (costType === 'auto_bag') {
    out.roll_w = hasRollWidthMm ? (rollWidthRaw !== null ? rollWidthRaw / 10 : null) : rollWidthRaw;
    out.roll_l = hasRollLengthM ? rollLengthRaw : rollLengthRaw;
    return out;
  }

  if (hasWidthMm) out.ba_kuang = widthRaw !== null ? widthRaw / 10 : null;
  else if (widthRaw !== null) out.ba_kuang = widthRaw;
  if (hasHeightMm) out.ba_chang = heightRaw !== null ? heightRaw / 10 : null;
  else if (heightRaw !== null) out.ba_chang = heightRaw;
  if (hasSideMm) out.ba_ce = sideRaw !== null ? sideRaw / 10 : null;
  else if (sideRaw !== null) out.ba_ce = sideRaw;
  if (costType === 'three_side_seal') {
    out.ba_di = 0;
  } else if (hasGussetMm) {
    out.ba_di = gussetRaw !== null ? gussetRaw / 10 : null;
  } else if (gussetRaw !== null) {
    out.ba_di = gussetRaw;
  }
  return out;
}

function applyDefaultCostParams(costType, parsedSpec = {}) {
  const merged = {
    jgf: null,
    zxyf: null,
    yf: null,
    fqfy: null,
    lldj: null,
    ba_zdf: null,
    sh: null,
    lr: null
  };
  const warnings = [];
  const defaultNotes = [];
  const defaultedFields = [];

  const q = parsedSpec.customer_order_info || parsedSpec || {};
  const hasPouch = !['auto_bag', 'material_weight'].includes(costType);
  const defaults = {
    auto_bag: { jgf: 0.12, sh: 0.02, lr: 0.1, fqfy: 0, yf: 0 },
    stand_zipper_bag: { jgf: 0.65, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    three_side_seal: { jgf: 0.6, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    eight_side_seal: { jgf: 0.81, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    irregular_zipper_bag: { jgf: 0.7, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    back_seal: { jgf: 0.58, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    side_seal: { jgf: 0.58, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    four_side_seal: { jgf: 0.62, sh: 0.1, lr: 0.1, zxyf: 0, lldj: 0 },
    material_weight: { sh: 0, lr: 0 }
  };

  const picked = defaults[costType] || {};
  merged.jgf = nOrNull(q.jgf) ?? picked.jgf ?? null;
  merged.zxyf = nOrNull(q.zxyf) ?? picked.zxyf ?? null;
  merged.yf = nOrNull(q.yf) ?? picked.yf ?? null;
  merged.fqfy = nOrNull(q.fqfy) ?? picked.fqfy ?? null;
  merged.lldj = nOrNull(q.lldj) ?? picked.lldj ?? null;
  merged.ba_zdf = nOrNull(q.ba_zdf) ?? picked.ba_zdf ?? null;
  merged.sh = nOrNull(q.sh) ?? picked.sh ?? null;
  merged.lr = nOrNull(q.lr) ?? picked.lr ?? null;

  if (merged.jgf !== null && q.jgf === undefined) {
    defaultNotes.push('jgf 使用系统默认值，需复核');
    defaultedFields.push('jgf');
  }
  if (merged.sh !== null && q.sh === undefined) {
    defaultNotes.push('sh 使用系统默认值，需复核');
    defaultedFields.push('sh');
  }
  if (merged.lr !== null && q.lr === undefined) {
    defaultNotes.push('lr 使用系统默认值，需复核');
    defaultedFields.push('lr');
  }
  if (costType === 'auto_bag' && q.yf === undefined) {
    defaultNotes.push('yf 使用系统默认值，需复核');
    defaultedFields.push('yf');
  }
  if (hasPouch && q.zxyf === undefined) {
    defaultNotes.push('zxyf 使用系统默认值，需复核');
    defaultedFields.push('zxyf');
  }
  if (q.lldj === undefined) {
    defaultNotes.push('lldj 使用系统默认值，需复核');
    defaultedFields.push('lldj');
  }

  const quantity = inferQuantityField(parsedSpec);
  if (quantity.variants && quantity.quantity_per_variant && quantity.quantity_total) {
    if (quantity.quantity_per_variant < 10000) {
      warnings.push(`每款数量 ${quantity.quantity_per_variant} 低于常见版费摊销线，版费/利润率需人工复核。`);
    }
  } else if (quantity.quantity_total && quantity.quantity_total < 10000) {
    warnings.push(`总量 ${quantity.quantity_total} 偏低，可能影响版费、损耗和利润率。`);
  }

  return {
    ...merged,
    defaultNotes,
    quantity,
    warnings,
    defaultedFields
  };
}

function ensureSixteen(v) {
  const x = nOrNull(v);
  return x === null ? null : Number(x.toFixed(6));
}

function normalizeToQuoteInput(parsedSpec = {}) {
  const order = parsedSpec.customer_order_info || parsedSpec || {};
  const costType = String(order.cost_type || parsedSpec.suggested_cost_type || '').trim();
  const quoteType = mapCostTypeForEngine(costType);
  const normalizedLayers = Array.isArray(parsedSpec.normalized_material_layers)
    ? parsedSpec.normalized_material_layers
    : [];
  const dimsSource = order.dimensions || order;
  const dims = parseDimensionValues(dimsSource, costType);
  const defaults = applyDefaultCostParams(costType, parsedSpec);
  const materialLayers = normalizedLayers.length ? normalizedLayers : (order.material_layers || []);
  const orderSurfaceFinish = Array.isArray(order.surface_finish) ? order.surface_finish : (order.surface_finish ? [order.surface_finish] : []);

  const thick = [];
  const price = [];
  const proportion = [];
  const materialLayerRecords = [];
  const materialWarnings = [];

  materialLayers.slice(0, 4).forEach((layer, index) => {
    const mapped = layer.normalized_material || layer.material || layer.code || '';
    const priceValue = nOrNull(layer.price_used ?? layer.price ?? null);
    const proportionValue = nOrNull(layer.proportion_used ?? layer.proportion ?? null);
    thick.push(ensureSixteen(layer.thickness));
    price.push(priceValue !== null ? priceValue : 0);
    proportion.push(proportionValue !== null ? proportionValue : 1);
    materialLayerRecords.push({
      layer_order: index + 1,
      raw_name: layer.raw_name || layer.name || layer.material || '',
      normalized_material: mapped,
      display_name_cn: layer.display_name_cn || layer.displayNameCn || '',
      thickness: ensureSixteen(layer.thickness),
      thickness_unit: layer.thickness_unit || 'C',
      price_used: priceValue,
      proportion_used: proportionValue,
      confidence: layer.confidence || 'low',
      needs_confirm: layer.needs_confirm !== undefined ? Number(layer.needs_confirm) : 1,
      alias_id: layer.alias_id || null,
      material_price_code: layer.material_price_code || null,
      material_price_prop: layer.material_price_prop || null,
      note: layer.note || ''
    });
    if ((layer.confidence || 'low') !== 'high' || Number(layer.needs_confirm || 0) === 1) {
      materialWarnings.push(`材料名 ${layer.raw_name || mapped} 暂映射为 ${mapped}，请确认材料单价和比重。`);
    }
  });

  while (thick.length < 4) thick.push(0);
  while (price.length < 4) price.push(0);
  while (proportion.length < 4) proportion.push(0);

  const quoteInput = {
    quoteType,
    cost_type: costType,
    bag_type: order.bag_type || '',
    packaging_type: order.packaging_type || '',
    product_type: order.product_type || '',
    customer_name: order.customer_name || '',
    contact_person: order.contact_person || '',
    destination_country: order.destination_country || order.country || '',
    destination_port: order.destination_port || '',
    destination_address: order.destination_address || '',
    trade_term_requested: order.trade_term_requested || '',
    raw_size: order.raw_size || '',
    size_text: order.size_text || order.raw_size || '',
    quantity_total: defaults.quantity.quantity_total,
    quantity_per_variant: defaults.quantity.quantity_per_variant,
    variants: defaults.quantity.variants,
    quantity_unit: defaults.quantity.quantity_unit,
    material_structure_text: order.material_structure_text || '',
    material_layers: materialLayerRecords,
    surface_finish: uniq(flattenValues([
      parsedSpec.normalized_surface_finish || [],
      orderSurfaceFinish
    ])),
    thick,
    price,
    proportion,
    jgf: defaults.jgf,
    zxyf: defaults.zxyf,
    yf: defaults.yf,
    fqfy: defaults.fqfy,
    lldj: defaults.lldj,
    ba_zdf: defaults.ba_zdf,
    sh: defaults.sh,
    lr: defaults.lr,
    ba_chang: dims.ba_chang !== undefined ? ensureSixteen(dims.ba_chang) : ensureSixteen(order.ba_chang),
    ba_kuang: dims.ba_kuang !== undefined ? ensureSixteen(dims.ba_kuang) : ensureSixteen(order.ba_kuang),
    ba_di: dims.ba_di !== undefined ? ensureSixteen(dims.ba_di) : ensureSixteen(order.ba_di),
    ba_ce: dims.ba_ce !== undefined ? ensureSixteen(dims.ba_ce) : ensureSixteen(order.ba_ce),
    chang: dims.chang !== undefined ? ensureSixteen(dims.chang) : ensureSixteen(order.chang),
    kuang: dims.kuang !== undefined ? ensureSixteen(dims.kuang) : ensureSixteen(order.kuang),
    roll_w: dims.roll_w !== undefined ? ensureSixteen(dims.roll_w) : ensureSixteen(order.roll_w),
    roll_l: dims.roll_l !== undefined ? ensureSixteen(dims.roll_l) : ensureSixteen(order.roll_l),
    summary: order.summary || '',
    note: order.note || '',
    special_features: order.special_features || [],
    zipper_required: order.zipper_required ?? order.zipper ?? null,
    window_required: order.window_required ?? null,
    valve_required: order.valve_required ?? null,
    spout_required: order.spout_required ?? null,
    tear_notch_required: order.tear_notch_required ?? null,
    artwork_status: order.artwork_status || '',
    sample_image_status: order.sample_image_status || '',
    quantity_basis: order.quantity_basis || '',
    source_text: parsedSpec.source_text || '',
    default_notes: defaults.defaultNotes,
    defaulted_fields: defaults.defaultedFields,
    material_mapping_json: materialLayerRecords,
    material_mapping_warnings: uniq([
      ...(parsedSpec.material_mapping_warnings || []),
      ...materialWarnings
    ]),
    quote_scope: {
      quoted_total: defaults.quantity.quantity_total,
      variants: defaults.quantity.variants,
      per_variant: defaults.quantity.quantity_per_variant
    }
  };

  return {
    cost_type: costType,
    quoteType,
    quote_input: quoteInput,
    material_mapping_json: materialLayerRecords,
    material_mapping_warnings: uniq([
      ...(parsedSpec.material_mapping_warnings || []),
      ...materialWarnings
    ]),
    default_notes: defaults.defaultNotes,
    defaultedFields: defaults.defaultedFields,
    warnings: defaults.warnings
  };
}

function isPositiveFinite(value) {
  const parsed = nOrNull(value);
  return parsed !== null && parsed > 0;
}

function evaluatePreCostingReadiness(quoteInput = {}, options = {}) {
  const input = quoteInput.quote_input || quoteInput.input || quoteInput;
  const costType = String(quoteInput.cost_type || input.cost_type || '').trim();
  const quoteType = String(quoteInput.quoteType || input.quoteType || mapCostTypeForEngine(costType)).trim();
  const blockingFields = [];
  const warnings = [];
  const block = (field, reason) => {
    if (!blockingFields.some(item => item.field === field && item.reason === reason)) {
      blockingFields.push({ field, reason });
    }
  };

  if (!costType || !quoteType) block('cost_type', 'missing');
  if (options.allowManualTemplates !== true) {
    if (CAUTIOUS_COST_TYPES.has(costType)) block('cost_type', 'manual_template_review_required');
    if (SECONDARY_COST_TYPES.has(costType)) block('cost_type', 'secondary_template_review_required');
  }

  if (quoteType === 'material_weight') {
    if (!isPositiveFinite(input.chang)) block('chang', 'missing_or_non_positive');
    if (!isPositiveFinite(input.kuang)) block('kuang', 'missing_or_non_positive');
  } else if (quoteType === 'auto_bag') {
    if (!isPositiveFinite(input.roll_w)) block('roll_w', 'missing_or_non_positive');
    if (!isPositiveFinite(input.roll_l)) block('roll_l', 'missing_or_non_positive');
  } else {
    if (!isPositiveFinite(input.ba_chang)) block('ba_chang', 'missing_or_non_positive');
    if (!isPositiveFinite(input.ba_kuang)) block('ba_kuang', 'missing_or_non_positive');
    if (['stand_zipper_bag', 'eight_side_seal'].includes(costType) && !isPositiveFinite(input.ba_di)) {
      block('ba_di', 'missing_or_non_positive');
    }
  }

  if (options.requireQuantity !== false) {
    if (!isPositiveFinite(input.quantity_total)) block('quantity_total', 'missing_or_non_positive');
    if (!isPositiveFinite(input.quantity_per_variant)) block('quantity_per_variant', 'missing_or_non_positive');
    if (!isPositiveFinite(input.variants)) block('variants', 'missing_or_non_positive');
  }

  const layers = Array.isArray(input.material_layers) ? input.material_layers : [];
  const activeLayers = layers.filter(layer => {
    return Boolean(layer?.raw_name || layer?.normalized_material || isPositiveFinite(layer?.thickness));
  });
  if (!activeLayers.length) block('material_layers', 'missing');
  activeLayers.forEach((layer, index) => {
    const prefix = `material_layers[${index}]`;
    if (!isPositiveFinite(layer.thickness)) block(`${prefix}.thickness`, 'missing_or_non_positive');
    if (!isPositiveFinite(layer.proportion_used)) block(`${prefix}.proportion_used`, 'missing_or_non_positive');
    if (quoteType !== 'material_weight' && !isPositiveFinite(layer.price_used)) {
      block(`${prefix}.price_used`, 'missing_or_non_positive');
    }
    if (options.requireMappingConfirmation !== false
      && (Number(layer.needs_confirm || 0) === 1 || String(layer.confidence || 'low') !== 'high')) {
      block(`${prefix}.mapping`, 'unconfirmed');
    }
  });

  const defaultedFields = new Set([
    ...(Array.isArray(quoteInput.defaultedFields) ? quoteInput.defaultedFields : []),
    ...(Array.isArray(input.defaulted_fields) ? input.defaulted_fields : [])
  ]);
  const requiredCommercialFields = quoteType === 'material_weight'
    ? []
    : quoteType === 'auto_bag'
      ? ['jgf', 'sh', 'lr', 'fqfy', 'yf']
      : ['jgf', 'sh', 'lr', 'zxyf'];
  requiredCommercialFields.forEach(field => {
    if (nOrNull(input[field]) === null) block(field, 'missing');
    if (defaultedFields.has(field)) block(field, 'unconfirmed_default');
  });

  if (input.zipper_required === true
    && !isPositiveFinite(input.lldj)
    && !isPositiveFinite(input.ba_zdf)) {
    block('lldj_or_ba_zdf', 'zipper_cost_missing');
  }

  if (blockingFields.length) {
    warnings.push('Required fields are missing or unconfirmed; no numeric result was generated.');
  }
  return {
    status: blockingFields.length ? 'blocked' : 'internal_estimate',
    can_calculate: blockingFields.length === 0,
    blocking_fields: blockingFields,
    warnings
  };
}

const QUOTE_OVERRIDE_ARRAY_FIELDS = new Set(['thick', 'proportion', 'price']);
const QUOTE_OVERRIDE_SCALAR_FIELDS = new Set([
  'jgf', 'zxyf', 'yf', 'fqfy', 'lldj', 'ba_zdf', 'sh', 'lr', 'zt', 'btzt'
]);

function finiteOverride(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeQuoteInputOverrides(quoteNorm = {}, overrides = {}, source = 'reviewed_form') {
  const baseInput = quoteNorm.quote_input || {};
  const nextInput = {
    ...baseInput,
    thick: Array.isArray(baseInput.thick) ? [...baseInput.thick] : [],
    proportion: Array.isArray(baseInput.proportion) ? [...baseInput.proportion] : [],
    price: Array.isArray(baseInput.price) ? [...baseInput.price] : [],
    material_layers: Array.isArray(baseInput.material_layers)
      ? baseInput.material_layers.map(layer => ({ ...layer }))
      : []
  };
  const appliedFields = [];
  const ignoredFields = [];
  const fieldSources = { ...(baseInput.input_provenance?.field_sources || {}) };

  Object.entries(overrides && typeof overrides === 'object' ? overrides : {}).forEach(([field, rawValue]) => {
    if (QUOTE_OVERRIDE_ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(rawValue)) {
        ignoredFields.push(field);
        return;
      }
      rawValue.slice(0, 4).forEach((value, index) => {
        const parsed = finiteOverride(value);
        if (parsed === null) return;
        if (!nextInput.material_layers[index]) {
          ignoredFields.push(`${field}[${index}]`);
          return;
        }
        nextInput[field][index] = parsed;
        if (field === 'thick') nextInput.material_layers[index].thickness = parsed;
        if (field === 'proportion') nextInput.material_layers[index].proportion_used = parsed;
        if (field === 'price') nextInput.material_layers[index].price_used = parsed;
        const key = `${field}[${index}]`;
        appliedFields.push(key);
        fieldSources[key] = source;
      });
      return;
    }
    if (!QUOTE_OVERRIDE_SCALAR_FIELDS.has(field)) {
      ignoredFields.push(field);
      return;
    }
    const parsed = finiteOverride(rawValue);
    if (parsed === null) return;
    nextInput[field] = parsed;
    appliedFields.push(field);
    fieldSources[field] = source;
  });

  const defaultedFields = new Set([
    ...(Array.isArray(quoteNorm.defaultedFields) ? quoteNorm.defaultedFields : []),
    ...(Array.isArray(nextInput.defaulted_fields) ? nextInput.defaulted_fields : [])
  ]);
  appliedFields.forEach(field => defaultedFields.delete(field.replace(/\[\d+\]$/, '')));
  const appliedScalarFields = new Set(appliedFields.filter(field => !field.includes('[')));
  const remainingDefaultNotes = (Array.isArray(quoteNorm.default_notes) ? quoteNorm.default_notes : [])
    .filter(note => ![...appliedScalarFields].some(field => String(note).startsWith(`${field} `)));
  nextInput.defaulted_fields = [...defaultedFields];
  nextInput.default_notes = remainingDefaultNotes;
  nextInput.input_provenance = {
    ...(baseInput.input_provenance || {}),
    field_sources: fieldSources,
    revisions: [
      ...(Array.isArray(baseInput.input_provenance?.revisions) ? baseInput.input_provenance.revisions : []),
      { source, applied_fields: uniq(appliedFields), ignored_fields: uniq(ignoredFields) }
    ]
  };

  return {
    ...quoteNorm,
    quote_input: nextInput,
    defaultedFields: [...defaultedFields],
    default_notes: remainingDefaultNotes,
    override_provenance: nextInput.input_provenance.revisions.at(-1)
  };
}

function normalizeLegacyQuoteInput(costType, rawInput = {}) {
  const input = { ...rawInput };
  const quoteType = mapCostTypeForEngine(costType);
  const thick = Array.isArray(input.thick) ? input.thick.slice(0, 4) : [input.t1, input.t2, input.t3, input.t4];
  const proportion = Array.isArray(input.proportion) ? input.proportion.slice(0, 4) : [input.p1, input.p2, input.p3, input.p4];
  const price = Array.isArray(input.price) ? input.price.slice(0, 4) : [input.pr1, input.pr2, input.pr3, input.pr4];
  const names = [input.mat1, input.mat2, input.mat3, input.mat4];
  const materialLayers = [0, 1, 2, 3].map(index => ({
    raw_name: toText(names[index]).trim(),
    normalized_material: toText(names[index]).trim(),
    thickness: finiteOverride(thick[index]),
    proportion_used: finiteOverride(proportion[index]),
    price_used: finiteOverride(price[index]),
    confidence: names[index] ? 'high' : 'low',
    needs_confirm: names[index] ? 0 : 1
  })).filter(layer => layer.raw_name || layer.thickness !== null || layer.proportion_used !== null || layer.price_used !== null);

  return {
    ...input,
    cost_type: costType,
    quoteType,
    thick,
    proportion,
    price,
    material_layers: materialLayers,
    zipper_required: input.zipper_required ?? ['stand_zipper_bag', 'irregular_zipper_bag'].includes(costType),
    defaulted_fields: Array.isArray(input.defaulted_fields) ? input.defaulted_fields : []
  };
}

function extractCustomerInfo(text) {
  const source = normalizeText(text);
  const lines = source.split(/\n|\. /).map(s => s.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  let customerName = '';
  let contactPerson = '';
  const nameMatch = firstLine.match(/^([A-Za-z][A-Za-z0-9&.,'()\-\/\s]{2,80}?)(?:,\s*|\s+)(UAE|Pakistan|Bangladesh|China|India|Saudi Arabia|KSA|USA|US|UK|Turkey|Vietnam|Thailand|Indonesia|Malaysia)\b/i);
  if (nameMatch) {
    customerName = nameMatch[1].replace(/[, ]+$/, '').trim();
  }
  const personMatch = source.match(/\b(?:dear|hello|hi|mr\.?|mrs\.?|ms\.?)\s+([A-Z][A-Za-z'\- ]{1,40})/i);
  if (personMatch) contactPerson = personMatch[1].trim();
  const emailMatch = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const websiteMatch = source.match(/\bhttps?:\/\/[^\s)]+/i) || source.match(/\bwww\.[^\s)]+/i);
  return {
    customer_name: customerName,
    contact_person: contactPerson,
    email: emailMatch ? emailMatch[0] : '',
    website: websiteMatch ? websiteMatch[0].replace(/[)\].,]+$/, '') : '',
    country: detectCountry(source),
    city: '',
    source: firstLine
  };
}

function detectSpecialFeatures(text) {
  const source = normalizeText(text).toLowerCase();
  const features = [];
  if (/zipper/.test(source)) features.push('zipper');
  if (/window/.test(source)) features.push('window');
  if (/valve/.test(source)) features.push('valve');
  if (/spout/.test(source)) features.push('spout');
  if (/tear notch|tear-notch/.test(source)) features.push('tear_notch');
  if (/matte|matt/.test(source)) features.push('matte_finish');
  return uniq(features);
}

function detectRisks(text, parsed) {
  const source = normalizeText(text);
  const risks = [];
  const lower = source.toLowerCase();
  if (/artwork will be provided|artwork not provided|final artwork/i.test(source)) {
    risks.push('final artwork not provided');
  }
  if (!/\b(color|colour|colors?|cmyk|pantone|printing colors?)\b/i.test(source)) {
    risks.push('printing colors not confirmed');
  }
  if (/chocolate|premium|gift|luxury/i.test(lower) && !/\bgold\b|\bmetallic\b/i.test(lower)) {
    risks.push('gold effect not confirmed');
  }
  if ((parsed.variants || 0) > 1) {
    risks.push(`${parsed.variants} variants may require ${parsed.variants} sets of cylinders`);
  }
  if (parsed.zipper_required) {
    risks.push('zipper cost needs father confirmation');
  }
  if (parsed.default_notes?.length) {
    if (parsed.default_notes.some(x => /jgf/.test(x))) risks.push('jgf need father confirmation');
    if (parsed.default_notes.some(x => /损耗|利润/.test(x))) {
      risks.push('sh / lr need father confirmation');
    }
  }
  if (parsed.material_mapping_warnings?.length) {
    parsed.material_mapping_warnings.forEach(w => risks.push(w));
    risks.push('material LDPE Tr. / transparent LDPE mapping needs father confirmation');
  }
  return uniq(risks);
}

function buildMissingFields(parsed) {
  const missing = [];
  const q = parsed.customer_order_info || {};
  const required = ['cost_type', 'bag_type', 'trade_term_requested', 'destination_country'];
  required.forEach(field => {
    if (!q[field]) missing.push(field);
  });
  if (!q.quantity_total && !q.quantity_per_variant) missing.push('quantity_total');
  if (!q.material_structure_text) missing.push('material_structure_text');
  return uniq(missing);
}

function buildCustomerProvided(parsed) {
  return {
    customer_name: parsed.customer_order_info?.customer_name || '',
    contact_person: parsed.customer_order_info?.contact_person || '',
    email: parsed.customer_order_info?.email || '',
    website: parsed.customer_order_info?.website || '',
    product_type: parsed.customer_order_info?.product_type || '',
    bag_type: parsed.customer_order_info?.bag_type || '',
    size_text: parsed.customer_order_info?.size_text || '',
    quantity_total: parsed.customer_order_info?.quantity_total ?? null,
    quantity_per_variant: parsed.customer_order_info?.quantity_per_variant ?? null,
    variants: parsed.customer_order_info?.variants ?? null,
    trade_term_requested: parsed.customer_order_info?.trade_term_requested || '',
    destination_country: parsed.customer_order_info?.destination_country || '',
    destination_port: parsed.customer_order_info?.destination_port || '',
    material_structure_text: parsed.customer_order_info?.material_structure_text || '',
    artwork_status: parsed.customer_order_info?.artwork_status || '',
    special_features: parsed.customer_order_info?.special_features || [],
    evidence: parsed.evidence || []
  };
}

function buildAiInferred(parsed, normalizedLayers, quoteInput) {
  return {
    suggested_cost_type: parsed.suggested_cost_type || quoteInput.quoteType || '',
    confidence: parsed.confidence || 'low',
    bag_type: quoteInput.bag_type || '',
    packaging_type: quoteInput.packaging_type || '',
    dimensions: {
      ba_chang: quoteInput.ba_chang ?? null,
      ba_kuang: quoteInput.ba_kuang ?? null,
      ba_di: quoteInput.ba_di ?? null,
      ba_ce: quoteInput.ba_ce ?? null,
      chang: quoteInput.chang ?? null,
      kuang: quoteInput.kuang ?? null,
      roll_w: quoteInput.roll_w ?? null,
      roll_l: quoteInput.roll_l ?? null
    },
    quantity_total: quoteInput.quantity_total ?? null,
    quantity_per_variant: quoteInput.quantity_per_variant ?? null,
    variants: quoteInput.variants ?? null,
    trade_term_requested: quoteInput.trade_term_requested || '',
    destination_country: quoteInput.destination_country || '',
    material_layers: normalizedLayers.map(x => ({
      raw_name: x.raw_name,
      normalized_material: x.normalized_material,
      thickness: x.thickness,
      thickness_unit: x.thickness_unit,
      confidence: x.confidence
    })),
    surface_finish: quoteInput.surface_finish || [],
    default_notes: quoteInput.default_notes || []
  };
}

function scoreConfidence(parsed, missingFields, riskFlags) {
  const hasDirect = (parsed.customer_order_info?.material_structure_text || parsed.customer_order_info?.size_text || parsed.customer_order_info?.trade_term_requested);
  const riskCount = riskFlags.length;
  const missingCount = missingFields.length;
  if (hasDirect && missingCount <= 2 && riskCount <= 3) return 'high';
  if (hasDirect && missingCount <= 4 && riskCount <= 7) return 'medium';
  return 'low';
}

async function parseInquiryText(text, options = {}) {
  const sourceText = normalizeText(text);
  const aiConfig = getProviderConfig(options.provider);
  let aiParsed = null;

  if (options.allowAi !== false && aiConfig.provider !== 'mock' && aiConfig.apiKey) {
    const prompt = buildAiPrompt(sourceText);
    const aiResult = await callStructuredProvider({
      provider: options.provider || aiConfig.provider,
      model: options.model || aiConfig.model,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      temperature: 0,
      maxTokens: 2500
    });
    if (aiResult.ok && aiResult.json) {
      aiParsed = aiResult.json;
    }
  }

  const ruleParsed = parseInquiryTextRuleBased(sourceText, options);
  const merged = mergeParsedOutputs(ruleParsed, aiParsed);
  const normalizedLayersResult = await normalizeMaterialLayers(merged.customer_order_info);
  const quoteNorm = normalizeToQuoteInput({
    ...merged,
    normalized_material_layers: normalizedLayersResult.layers,
    material_mapping_warnings: normalizedLayersResult.material_mapping_warnings,
    normalized_surface_finish: normalizedLayersResult.surface_finish
  });

  const customerProvided = buildCustomerProvided(merged);
  const aiInferred = buildAiInferred(merged, normalizedLayersResult.layers, quoteNorm.quote_input);
  const missingFields = buildMissingFields({
    ...merged,
    customer_order_info: {
      ...merged.customer_order_info,
      cost_type: quoteNorm.cost_type,
      bag_type: quoteNorm.quote_input.bag_type,
      trade_term_requested: quoteNorm.quote_input.trade_term_requested,
      destination_country: quoteNorm.quote_input.destination_country
    }
  });
  const riskFlags = detectRisks(sourceText, {
    ...quoteNorm.quote_input,
    variants: quoteNorm.quote_input.variants,
    zipper_required: quoteNorm.quote_input.zipper_required,
    default_notes: quoteNorm.default_notes,
    material_mapping_warnings: quoteNorm.material_mapping_warnings
  });
  const confidence = scoreConfidence(merged, missingFields, riskFlags);

  return {
    source_text: sourceText,
    customer_order_info: {
      ...merged.customer_order_info,
      cost_type: quoteNorm.cost_type,
      quoteType: quoteNorm.quoteType,
      bag_type: quoteNorm.quote_input.bag_type,
      packaging_type: quoteNorm.quote_input.packaging_type,
      dimensions: {
        ba_chang: quoteNorm.quote_input.ba_chang ?? null,
        ba_kuang: quoteNorm.quote_input.ba_kuang ?? null,
        ba_di: quoteNorm.quote_input.ba_di ?? null,
        ba_ce: quoteNorm.quote_input.ba_ce ?? null,
        chang: quoteNorm.quote_input.chang ?? null,
        kuang: quoteNorm.quote_input.kuang ?? null,
        roll_w: quoteNorm.quote_input.roll_w ?? null,
        roll_l: quoteNorm.quote_input.roll_l ?? null
      },
      quantity_total: quoteNorm.quote_input.quantity_total ?? null,
      quantity_per_variant: quoteNorm.quote_input.quantity_per_variant ?? null,
      variants: quoteNorm.quote_input.variants ?? null,
      quantity_unit: quoteNorm.quote_input.quantity_unit || '',
      trade_term_requested: quoteNorm.quote_input.trade_term_requested || '',
      destination_country: quoteNorm.quote_input.destination_country || '',
      destination_port: quoteNorm.quote_input.destination_port || '',
      destination_address: quoteNorm.quote_input.destination_address || '',
      material_structure_text: quoteNorm.quote_input.material_structure_text || '',
      material_layers: quoteNorm.quote_input.material_layers || [],
      surface_finish: quoteNorm.quote_input.surface_finish || [],
      zipper_required: quoteNorm.quote_input.zipper_required ?? null,
      window_required: quoteNorm.quote_input.window_required ?? null,
      valve_required: quoteNorm.quote_input.valve_required ?? null,
      spout_required: quoteNorm.quote_input.spout_required ?? null,
      tear_notch_required: quoteNorm.quote_input.tear_notch_required ?? null,
      artwork_status: quoteNorm.quote_input.artwork_status || '',
      sample_image_status: quoteNorm.quote_input.sample_image_status || '',
      special_features: quoteNorm.quote_input.special_features || [],
      note: quoteNorm.quote_input.note || ''
    },
    customer_provided: customerProvided,
    ai_inferred: aiInferred,
    missing_fields: missingFields,
    risk_flags: riskFlags,
    material_mapping_warnings: uniq(quoteNorm.material_mapping_warnings),
    suggested_cost_type: quoteNorm.cost_type,
    confidence,
    status: 'internal_pre_quote',
    normalized_material_layers: normalizedLayersResult.layers,
    normalized_surface_finish: normalizedLayersResult.surface_finish,
    material_mapping_json: normalizedLayersResult.material_mapping_json,
    defaultedFields: quoteNorm.defaultedFields,
    default_notes: quoteNorm.default_notes,
    quote_input: quoteNorm.quote_input
  };
}

function mergeParsedOutputs(ruleParsed, aiParsed) {
  if (!aiParsed || typeof aiParsed !== 'object') return ruleParsed;
  const merged = JSON.parse(JSON.stringify(ruleParsed));
  merged.customer_order_info = { ...merged.customer_order_info };
  merged.customer_provided = { ...merged.customer_provided };
  merged.ai_inferred = { ...merged.ai_inferred };
  merged.evidence = uniq([...(merged.evidence || []), ...(aiParsed.evidence || [])]);

  const aiOrder = aiParsed.customer_order_info || {};
  Object.entries(aiOrder).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') merged.customer_order_info[key] = value;
  });
  if (aiParsed.suggested_cost_type) merged.suggested_cost_type = aiParsed.suggested_cost_type;
  if (aiParsed.confidence) merged.confidence = aiParsed.confidence;
  if (Array.isArray(aiParsed.risk_flags)) merged.risk_flags = uniq([...(merged.risk_flags || []), ...aiParsed.risk_flags]);
  if (Array.isArray(aiParsed.missing_fields)) merged.missing_fields = uniq([...(merged.missing_fields || []), ...aiParsed.missing_fields]);
  if (Array.isArray(aiParsed.material_mapping_warnings)) merged.material_mapping_warnings = uniq([...(merged.material_mapping_warnings || []), ...aiParsed.material_mapping_warnings]);
  if (aiParsed.customer_provided) merged.customer_provided = { ...merged.customer_provided, ...aiParsed.customer_provided };
  if (aiParsed.ai_inferred) merged.ai_inferred = { ...merged.ai_inferred, ...aiParsed.ai_inferred };
  return merged;
}

function buildAiPrompt(text) {
  const systemPrompt = [
    'You are an internal foreign trade costing assistant.',
    'Return only strict JSON.',
    'Do not produce a customer-facing quotation.',
    'Do not promise final prices.',
    'Extract customer-provided facts, AI inferences, missing fields, and risk flags.',
    'Prefer conservative assumptions and mark uncertain values as null.',
    'The output must contain: customer_order_info, customer_provided, ai_inferred, missing_fields, risk_flags, material_mapping_warnings, suggested_cost_type, confidence.'
  ].join(' ');

  const userPrompt = JSON.stringify({
    task: 'Parse the inquiry text into structured internal pre-costing data.',
    output_schema: {
      customer_order_info: {},
      customer_provided: {},
      ai_inferred: {},
      missing_fields: [],
      risk_flags: [],
      material_mapping_warnings: [],
      suggested_cost_type: '',
      confidence: 'low|medium|high'
    },
    instructions: [
      'Keep customer-provided facts separate from AI inferences.',
      'If a field is uncertain, use null.',
      'Recognize bag type, size, material, thickness, quantity, variants, trade term, destination, accessories, and artwork-related risks.',
      'Never output a final customer quotation or commit to price.',
      'Return JSON only.'
    ],
    text
  });

  return { systemPrompt, userPrompt };
}

function parseInquiryTextRuleBased(text, options = {}) {
  const source = normalizeText(text);
  const customerInfo = extractCustomerInfo(source);
  const bagInfo = detectBagType(source);
  const dims = extractDimensions(source);
  const quantity = extractQuantity(source);
  const tradeTerms = detectTradeTerm(source);
  const destination = detectDestination(source);
  const specialFeatures = detectSpecialFeatures(source);

  const materialsText = source.match(/material\s*[:\-]?\s*([^\.]{3,240})/i);
  const materialStructureText = materialsText ? materialsText[1].trim() : '';
  const materialSourceText = materialStructureText || source;

  const customerOrderInfo = {
    customer_name: customerInfo.customer_name,
    contact_person: customerInfo.contact_person,
    email: customerInfo.email,
    website: customerInfo.website,
    country: customerInfo.country,
    city: customerInfo.city,
    product_name: '',
    product_type: '',
    application: '',
    bag_type: bagInfo.bag_type,
    packaging_type: bagInfo.packaging_type,
    cost_type: bagInfo.cost_type,
    material_structure_text: materialSourceText,
    size_text: dims.raw_size || '',
    dimensions: dims,
    quantity_total: quantity.quantity_total,
    quantity_per_variant: quantity.quantity_per_variant,
    variants: quantity.variants,
    quantity_unit: quantity.quantity_unit,
    trade_term_requested: tradeTerms.join(', '),
    destination_country: destination || '',
    destination_port: '',
    destination_address: '',
    filling_weight: '',
    material_layers: [],
    surface_finish: [],
    zipper_required: /zipper/i.test(source),
    window_required: /window/i.test(source),
    valve_required: /valve/i.test(source),
    spout_required: /spout/i.test(source),
    tear_notch_required: /tear notch|tear-notch/i.test(source),
    artwork_status: /artwork will be provided|artwork provided/i.test(source) ? 'provided' : '',
    sample_image_status: /sample image|sample provided/i.test(source) ? 'provided' : '',
    special_features: specialFeatures,
    note: ''
  };

  if (/filling weight/i.test(source)) {
    const m = source.match(/filling weight\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(g|kg)/i);
    if (m) customerOrderInfo.filling_weight = `${m[1]}${m[2]}`;
  }

  if (/final artwork/i.test(source)) {
    customerOrderInfo.artwork_status = 'final';
  }

  const materials = extractMaterialCandidates(materialSourceText);
  customerOrderInfo.material_layers = materials.layers;
  customerOrderInfo.surface_finish = materials.surface_finish;

  const suggested_cost_type = bagInfo.cost_type;
  const missing_fields = [];
  if (!customerOrderInfo.trade_term_requested) missing_fields.push('trade_term_requested');
  if (!customerOrderInfo.destination_country) missing_fields.push('destination_country');
  if (!customerOrderInfo.material_structure_text) missing_fields.push('material_structure_text');
  if (!customerOrderInfo.quantity_total) missing_fields.push('quantity_total');
  if (!customerOrderInfo.bag_type) missing_fields.push('bag_type');

  const risk_flags = [];
  if (/artwork will be provided|artwork not provided|final artwork/i.test(source)) {
    risk_flags.push('final artwork not provided');
  }
  if (!/\b(color|colour|colors?|cmyk|pantone|printing colors?)\b/i.test(source)) {
    risk_flags.push('printing colors not confirmed');
  }
  if (/chocolate|premium|gift|luxury/i.test(source) && !/\bgold\b|\bmetallic\b/i.test(source)) {
    risk_flags.push('gold effect not confirmed');
  }
  if ((quantity.variants || 0) > 1) {
    risk_flags.push(`${quantity.variants} variants may require ${quantity.variants} sets of cylinders`);
  }
  if (/zipper/i.test(source)) risk_flags.push('zipper cost needs father confirmation');

  const material_mapping_warnings = [];
  materials.layers.forEach(layer => {
    if ((layer.confidence || 'low') !== 'high' || Number(layer.needs_confirm || 0) === 1) {
      material_mapping_warnings.push(`材料名 ${layer.raw_name} 暂映射为 ${layer.normalized_material}，请确认材料单价和比重。`);
    }
  });
  if (material_mapping_warnings.length > 0) {
    risk_flags.push('material LDPE Tr. / transparent LDPE mapping needs father confirmation');
  }

  return {
    source_text: source,
    customer_order_info: customerOrderInfo,
    customer_provided: {
      customer_name: customerInfo.customer_name,
      contact_person: customerInfo.contact_person,
      email: customerInfo.email,
      website: customerInfo.website,
      product_type: customerOrderInfo.product_type,
      bag_type: customerOrderInfo.bag_type,
      size_text: customerOrderInfo.size_text,
      quantity_total: customerOrderInfo.quantity_total,
      quantity_per_variant: customerOrderInfo.quantity_per_variant,
      variants: customerOrderInfo.variants,
      trade_term_requested: customerOrderInfo.trade_term_requested,
      destination_country: customerOrderInfo.destination_country,
      destination_port: customerOrderInfo.destination_port,
      material_structure_text: customerOrderInfo.material_structure_text,
      artwork_status: customerOrderInfo.artwork_status,
      special_features: customerOrderInfo.special_features,
      evidence: [...bagInfo.evidence, ...quantity.evidence, ...dims.evidence].filter(Boolean)
    },
    ai_inferred: {
      suggested_cost_type,
      confidence: bagInfo.confidence,
      bag_type: customerOrderInfo.bag_type,
      packaging_type: customerOrderInfo.packaging_type,
      dimensions: {
        ba_chang: dims.height_mm !== null ? dims.height_mm / 10 : null,
        ba_kuang: dims.width_mm !== null ? dims.width_mm / 10 : null,
        ba_di: dims.gusset_mm !== null ? dims.gusset_mm / 10 : null,
        ba_ce: 0
      },
      material_layers: materials.layers.map(layer => ({
        raw_name: layer.raw_name,
        thickness: layer.thickness_value,
        source: layer.source
      })),
      surface_finish: materials.surface_finish,
      trade_term_requested: customerOrderInfo.trade_term_requested,
      destination_country: customerOrderInfo.destination_country,
      quantity_total: quantity.quantity_total,
      quantity_per_variant: quantity.quantity_per_variant,
      variants: quantity.variants
    },
    missing_fields: uniq(missing_fields),
    risk_flags: uniq(risk_flags),
    material_mapping_warnings: uniq(material_mapping_warnings),
    suggested_cost_type,
    confidence: 'medium',
    status: 'internal_pre_quote',
    evidence: [...bagInfo.evidence, ...quantity.evidence, ...dims.evidence].filter(Boolean)
  };
}

function runPreCosting(quoteInput = {}) {
  const quoteType = quoteInput.quoteType || quoteInput.cost_type || mapCostTypeForEngine(quoteInput.suggested_cost_type);
  if (!quoteType) throw new Error('quoteType is required for pre-costing');
  const input = quoteInput.quote_input || quoteInput.input || quoteInput;
  const readiness = evaluatePreCostingReadiness(quoteInput);
  if (!readiness.can_calculate) {
    return {
      quoteType,
      input,
      status: 'blocked',
      readiness,
      result: null,
      internalVersion: null,
      customerVersion: null
    };
  }
  const result = generateQuote({ quoteType, input, margin: nOrNull(input.lr) });
  return {
    quoteType,
    input,
    status: 'internal_estimate',
    readiness,
    result,
    internalVersion: result.internalVersion,
    customerVersion: null
  };
}

function formatNumber(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return Number(num.toFixed(digits));
}

function buildCalculationTable(costType, quoteInput = {}, quoteResult = {}) {
  const calc = quoteResult?.internalVersion?.calc || quoteResult?.result?.internalVersion?.calc || quoteResult?.result?.calc || quoteResult?.calc || {};
  const input = quoteInput.quote_input || quoteInput.input || quoteInput;
  const quoteType = quoteInput.quoteType || quoteInput.cost_type || quoteTypeFromInput(input) || costType;
  const rows = [];

  const push = (section, label, fieldKey, formula, inputValue, calculatedValue, note = '', editable = true) => {
    rows.push({ section, label, field_key: fieldKey, formula, input_value: inputValue, calculated_value: calculatedValue, note, editable });
  };

  push('基础信息', '成本类型', 'cost_type', 'quoteType', costType, quoteType, '内部预核价', false);
  push('基础信息', '贸易条款', 'trade_term_requested', '客户输入', input.trade_term_requested || '', input.trade_term_requested || '', '', true);
  push('基础信息', '目的国', 'destination_country', '客户输入', input.destination_country || '', input.destination_country || '', '', true);
  push('基础信息', '数量总计', 'quantity_total', '客户输入', input.quantity_total ?? '', input.quantity_total ?? '', '', true);
  push('基础信息', '每款数量', 'quantity_per_variant', '客户输入', input.quantity_per_variant ?? '', input.quantity_per_variant ?? '', '', true);
  push('基础信息', '款数', 'variants', '客户输入', input.variants ?? '', input.variants ?? '', '', true);

  if (quoteType === 'material_weight') {
    push('尺寸', COST_LABELS.ba_chang, 'chang', 'chang * kuang', input.chang ?? '', calc.totalWeightKg ?? '', '', true);
    push('尺寸', COST_LABELS.ba_kuang, 'kuang', 'chang * kuang', input.kuang ?? '', calc.totalWeightKg ?? '', '', true);
  } else if (quoteType === 'auto_bag') {
    push('尺寸', '卷宽', 'roll_w', '系统输入', input.roll_w ?? '', calc.rollAreaM2 ?? '', '', true);
    push('尺寸', '卷长', 'roll_l', '系统输入', input.roll_l ?? '', calc.rollAreaM2 ?? '', '', true);
  } else {
    push('尺寸', COST_LABELS.ba_chang, 'ba_chang', 'quoteEngine bag-type formula', input.ba_chang ?? '', calc.z_chang ?? calc.front_len ?? calc.z_chang ?? '', '', true);
    push('尺寸', COST_LABELS.ba_kuang, 'ba_kuang', 'quoteEngine bag-type formula', input.ba_kuang ?? '', calc.z_kuang ?? calc.front_wid ?? '', '', true);
    push('尺寸', COST_LABELS.ba_di, 'ba_di', 'quoteEngine bag-type formula', input.ba_di ?? '', input.ba_di ?? '', '', true);
    push('尺寸', COST_LABELS.ba_ce, 'ba_ce', 'quoteEngine bag-type formula', input.ba_ce ?? '', input.ba_ce ?? '', '', true);
  }

  const layers = input.material_layers || [];
  layers.forEach((layer, index) => {
    const prefix = `材料层${index + 1}`;
    push(prefix, '材料名称', `material_layers[${index}].raw_name`, '材料映射', layer.raw_name || '', layer.normalized_material || '', layer.note || '', true);
    push(prefix, COST_LABELS.thick, `thick[${index}]`, 'parse thickness / 10', input.thick?.[index] ?? '', input.thick?.[index] ?? '', '', true);
    push(prefix, COST_LABELS.price, `price[${index}]`, 'material_prices', input.price?.[index] ?? '', input.price?.[index] ?? '', layer.needs_confirm ? '系统默认/待复核' : '', true);
    push(prefix, COST_LABELS.proportion, `proportion[${index}]`, 'material_prices', input.proportion?.[index] ?? '', input.proportion?.[index] ?? '', layer.needs_confirm ? '系统默认/待复核' : '', true);
  });

  push('费用参数', COST_LABELS.jgf, 'jgf', '系统默认或人工输入', input.jgf ?? '', calc.processCost ?? calc.alljgf ?? '', input.default_notes?.join('；') || '', true);
  if (quoteType === 'auto_bag') {
    push('费用参数', COST_LABELS.yf, 'yf', '系统默认或人工输入', input.yf ?? '', calc.yf ?? '', '', true);
    push('费用参数', COST_LABELS.fqfy, 'fqfy', '系统默认或人工输入', input.fqfy ?? '', calc.fqfy ?? '', '', true);
  } else {
    push('费用参数', COST_LABELS.zxyf, 'zxyf', '系统默认或人工输入', input.zxyf ?? '', calc.freightCost ?? '', '', true);
  }
  push('费用参数', COST_LABELS.lldj, 'lldj', '系统默认或人工输入', input.lldj ?? '', calc.zipperCost ?? '', '', true);
  push('费用参数', COST_LABELS.ba_zdf, 'ba_zdf', '系统默认或人工输入', input.ba_zdf ?? '', calc.zipperCost ?? '', '', true);
  push('费用参数', COST_LABELS.sh, 'sh', '系统默认或人工输入', input.sh ?? '', input.sh ?? '', '', true);
  push('费用参数', COST_LABELS.lr, 'lr', '系统默认或人工输入', input.lr ?? '', input.lr ?? '', '', true);

  push('结果', '材料成本', 'materialCost', 'quoteEngine result', '', calc.materialCost ?? '', '', false);
  push('结果', '加工费', 'processCost', 'quoteEngine result', '', calc.processCost ?? calc.alljgf ?? '', '', false);
  push('结果', '损耗后成本', 'totalCost', 'quoteEngine result', '', calc.totalCost ?? calc.costBeforeProfit ?? '', '', false);
  push('结果', '内部预核价', 'finalQuote', 'quoteEngine result', '', calc.finalQuote ?? calc.unitQuote ?? '', 'internal_pre_quote', false);

  return rows;
}

function quoteTypeFromInput(input = {}) {
  return input.quoteType || input.cost_type || input.suggested_cost_type || '';
}

function buildFatherReviewPanel(parsedSpec = {}, quoteInput = {}, quoteResult = {}) {
  const input = quoteInput.quote_input || quoteInput.input || quoteInput;
  const calc = quoteResult?.internalVersion?.calc || quoteResult?.result?.internalVersion?.calc || quoteResult?.result?.calc || quoteResult?.calc || {};
  const defaultedFields = new Set(Array.isArray(quoteInput.defaultedFields || quoteInput.defaulted_fields)
    ? (quoteInput.defaultedFields || quoteInput.defaulted_fields)
    : []);
  const warnings = uniq([
    ...(parsedSpec.risk_flags || []),
    ...(parsedSpec.material_mapping_warnings || []),
    ...(quoteInput.material_mapping_warnings || []),
    ...(quoteInput.warnings || []),
    ...(quoteInput.default_notes || [])
  ]);

  const statusByField = (field, value) => {
    if (defaultedFields.has(field)) return 'needs_review';
    if (value === undefined || value === null || value === '') return 'needs_review';
    if (typeof value === 'number' && value === 0 && (field === 'lldj' || field === 'zxyf' || field === 'jgf')) return 'needs_review';
    return 'ok';
  };

  const readiness = quoteResult?.readiness || evaluatePreCostingReadiness(quoteInput);
  const checklist = [
    { key: 'bag_type', label: '袋型模板是否正确', status: parsedSpec.suggested_cost_type ? 'needs_review' : 'missing' },
    { key: 'size', label: '尺寸字段是否正确', status: (input.ba_chang || input.ba_kuang || input.chang) ? 'needs_review' : 'missing' },
    { key: 'material_mapping', label: '材料映射是否正确', status: (quoteInput.material_mapping_warnings || []).length ? 'needs_review' : 'ok' },
    { key: 'material_price', label: '材料价格/比重是否正确', status: 'needs_review' },
    { key: 'jgf', label: 'jgf 是否合适', status: statusByField('jgf', input.jgf) },
    { key: 'sh', label: 'sh 是否合适', status: statusByField('sh', input.sh) },
    { key: 'lr', label: 'lr 是否合适', status: statusByField('lr', input.lr) },
    { key: 'freight', label: 'zxyf/yf/fqfy 是否合适', status: (statusByField('zxyf', input.zxyf) === 'ok' || statusByField('yf', input.yf) === 'ok' || statusByField('fqfy', input.fqfy) === 'ok') ? 'ok' : 'needs_review' },
    { key: 'zipper', label: 'lldj/ba_zdf 是否合适', status: (statusByField('lldj', input.lldj) === 'ok' || (input.ba_zdf !== null && input.ba_zdf !== undefined)) ? 'ok' : 'needs_review' },
    { key: 'accessories', label: '版费/样品费/特殊工艺/配件是否明确', status: 'needs_review' },
    { key: 'customer_quote', label: '是否可作为 EXW 内部预核价', status: readiness.status }
  ];

  return {
    status: readiness.status,
    summary: readiness.status === 'blocked'
      ? '资料缺失或存在未确认字段，系统未生成数值结果。'
      : '本结果仅供陈湧杰复核，不可直接对客户正式报价。',
    checklist,
    blocking_fields: readiness.blocking_fields || [],
    warnings,
    questions: [
      '袋型模板是否选对？',
      '尺寸、底边、侧边口径是否与手算一致？',
      '材料别名是否需要改成更准确的系统材料名？',
      '材料单价和比重是否沿用当前 material_prices？',
      'jgf、sh、lr 是否需要按当前单据调整？',
      'zxyf / yf / fqfy / lldj / ba_zdf 是否需要人工覆盖？',
      '这单是否可以作为 EXW 内部预核价？'
    ],
    father_note: '',
    father_correction_note: '',
    approved_unit_price: readiness.status === 'blocked' ? null : (nOrNull(calc.finalQuote || calc.unitQuote) ?? null),
    approved_total_price: readiness.status === 'blocked' ? null : (nOrNull(calc.finalQuote || calc.totalCost) ?? null),
    can_generate_quote_draft: false
  };
}

async function createDraftFromText(text, options = {}) {
  const parsed = await parseInquiryText(text, options);
  const quoteNorm = normalizeToQuoteInput(parsed);
  const preCost = runPreCosting(quoteNorm);
  const calculationTable = buildCalculationTable(quoteNorm.cost_type, quoteNorm, preCost);
  const fatherReviewPanel = buildFatherReviewPanel(parsed, quoteNorm, preCost);

  const draft = {
    source_text: parsed.source_text,
    parsed_spec: parsed,
    material_mapping_json: quoteNorm.material_mapping_json,
    quote_input: quoteNorm.quote_input,
    quote_result: preCost.internalVersion,
    readiness: preCost.readiness,
    calculation_table: calculationTable,
    father_review_panel: fatherReviewPanel,
    warnings: uniq([
      ...parsed.risk_flags,
      ...parsed.material_mapping_warnings,
      ...quoteNorm.warnings,
      ...quoteNorm.default_notes
    ]),
    status: preCost.status,
    ai_provider: getProviderConfig(options.provider).provider,
    ai_model: getProviderConfig(options.provider).model
  };

  return draft;
}

module.exports = {
  parseInquiryText,
  normalizeMaterialLayers,
  normalizeToQuoteInput,
  applyDefaultCostParams,
  evaluatePreCostingReadiness,
  mergeQuoteInputOverrides,
  normalizeLegacyQuoteInput,
  runPreCosting,
  buildCalculationTable,
  buildFatherReviewPanel,
  createDraftFromText,
  // exported for tests/debugging
  _internals: {
    detectBagType,
    extractDimensions,
    extractQuantity,
    detectTradeTerm,
    detectDestination,
    parseInquiryTextRuleBased,
    mapCostTypeForEngine,
    normalizeThicknessToC,
    extractMaterialCandidates
  }
};

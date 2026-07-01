const CRM_STAGE_LABELS = {
  new_unprocessed: '新线索未整理',
  organized: '已整理',
  missing_info: '待补资料',
  technical_check: '技术确认',
  costing: '核价中',
  freight_checking: '物流确认',
  ready_to_quote: '待报价',
  quoted: '已报价',
  quoted_no_reply: '已报价未回复',
  sample_discussion: '样品讨论',
  sample_sent: '样品已寄',
  negotiation: '谈判中',
  ordered: '已下单',
  paused: '暂停',
  invalid: '无效',
  lost: '流失',
};

const CRM_STAGE_ALIASES = {
  new: 'new_unprocessed',
  researching: 'organized',
  spec_checking: 'technical_check',
  qualified: 'ready_to_quote',
  sample: 'sample_discussion',
  order: 'ordered',
};

const CRM_STAGE_OPTIONS = Object.keys(CRM_STAGE_LABELS).map((value) => ({ value, label: CRM_STAGE_LABELS[value] }));

const BAG_KEYWORDS = ['pouch', 'bag', 'sachet', 'stand up', 'stand-up', 'zipper', 'retort', 'spout', 'window', 'gusset', 'doypack', 'flat bottom', 'bottom gusset'];
const ROLL_KEYWORDS = ['roll film', 'film roll', 'web', 'roll stock', 'lamination roll', 'reel'];
const TECH_KEYWORDS = ['wvtr', 'otr', 'cof', 'barrier', 'retort', 'frozen', 'heat seal', 'machine direction', 'reverse gravure', 'core id', 'od max', 'web width', 'repeat length'];
const HARD_TECH_KEYWORDS = ['sterilization', 'sterilisation', '121°c', '121 c', '121c', 'boiling', 'boil', 'microwave', 'high temperature', 'pressure cooking'];
const HARD_TECH_STRUCTURE_KEYWORDS = ['retort', 'frozen', 'steril', '121', 'boil', 'microwave', 'pressure cooking', 'high temperature'];
const SPECIAL_KEYS = {
  zipper_required: ['zipper'],
  spout_required: ['spout'],
  valve_required: ['valve'],
  tear_notch_required: ['tear notch', 'tear-notch', 'notch'],
  window_required: ['window'],
  shelf_life_requirement: ['shelf life'],
  high_barrier_required: ['high barrier', 'barrier'],
  retort_required: ['retort', 'boil', 'steril'],
  frozen_required: ['frozen', 'freeze', 'cold chain'],
};

function toText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSpace(value) {
  return toText(value).replace(/\s+/g, ' ').trim();
}

function normalizedLower(value) {
  return normalizeSpace(value).toLowerCase();
}

function hasText(value) {
  return toText(value) !== '';
}

function joinText(...parts) {
  return parts.map(normalizeSpace).filter(Boolean).join(' ');
}

function normalizeCrmStage(stage) {
  const raw = normalizedLower(stage);
  if (!raw) return 'new_unprocessed';
  if (CRM_STAGE_LABELS[raw]) return raw;
  return CRM_STAGE_ALIASES[raw] || 'new_unprocessed';
}

function getCrmStageLabel(stage) {
  const normalized = normalizeCrmStage(stage);
  return CRM_STAGE_LABELS[normalized] || normalized;
}

function containsAny(text, keywords) {
  const value = normalizedLower(text);
  return keywords.some((keyword) => value.includes(keyword));
}

function looksLikeRollFilm(inquiryText, spec = {}) {
  return containsAny(inquiryText, ROLL_KEYWORDS)
    || hasText(spec.roll_width)
    || hasText(spec.repeat_length)
    || hasText(spec.roll_length);
}

function looksLikeBag(inquiryText, spec = {}) {
  return containsAny(inquiryText, BAG_KEYWORDS)
    || hasText(spec.size_width)
    || hasText(spec.size_height)
    || hasText(spec.gusset_size);
}

function detectSpecialSignals(inquiryText, spec = {}) {
  const text = normalizedLower(inquiryText);
  const signals = [];
  Object.entries(SPECIAL_KEYS).forEach(([key, keywords]) => {
    if (keywords.some((keyword) => text.includes(keyword))) {
      signals.push(key);
    }
  });
  if (hasText(spec.material_structure_text) && containsAny(spec.material_structure_text, HARD_TECH_STRUCTURE_KEYWORDS)) {
    signals.push('technical_structure');
  }
  if (hasText(spec.notes) && containsAny(spec.notes, HARD_TECH_STRUCTURE_KEYWORDS)) {
    signals.push('technical_notes');
  }
  return Array.from(new Set(signals));
}

function pushIfMissing(target, key, condition) {
  if (!condition) target.push(key);
}

function evaluateQuoteReadiness(inquiry = {}, specification = {}) {
  const inquiryText = joinText(
    inquiry.inquiry_title,
    inquiry.product_type,
    inquiry.application,
    inquiry.packaging_type,
    inquiry.destination_country,
    inquiry.destination_port,
    inquiry.destination_address,
    inquiry.trade_term_requested,
    inquiry.customer_target_price,
    inquiry.missing_info,
    inquiry.customer_questions,
    inquiry.technical_risks,
    inquiry.commercial_risks,
    specification.material_structure_text,
    specification.notes
  );

  const rollFilm = looksLikeRollFilm(inquiryText, specification);
  const bag = looksLikeBag(inquiryText, specification);
  const mode = rollFilm && !bag ? 'roll_film' : bag ? 'bag' : rollFilm ? 'roll_film' : 'unknown';
  const specialSignals = detectSpecialSignals(inquiryText, specification);
  const hasHardTechnicalRequest = containsAny(inquiryText, HARD_TECH_KEYWORDS);
  const hasHighBarrierRequest = specialSignals.includes('high_barrier_required');

  const missingRequiredFields = [];
  const missingOptionalFields = [];
  const warnings = [];
  let score = 0;

  const quantity = joinText(inquiry.quantity, specification.filling_weight);
  const destinationCountry = joinText(inquiry.destination_country);
  const tradeTerm = joinText(inquiry.trade_term_requested);
  const material = joinText(specification.material_structure_text);
  const thickness = joinText(specification.thickness_total);
  const printingColors = joinText(specification.printing_colors);
  const surfaceFinish = joinText(specification.surface_finish);
  const productContent = joinText(inquiry.application, inquiry.product_type);
  const fillingWeight = joinText(specification.filling_weight);
  const targetPrice = joinText(inquiry.customer_target_price);
  const bagSize = joinText(specification.size_width, specification.size_height, specification.gusset_size);
  const rollWidth = joinText(specification.roll_width);
  const repeatLength = joinText(specification.repeat_length);
  const coreId = joinText(specification.core_id, specification.packing_machine_type);
  const rollLength = joinText(specification.roll_length);
  const maxRollDiameter = joinText(specification.max_roll_diameter);

  if (!hasText(mode === 'unknown' ? '' : mode)) {
    missingRequiredFields.push('product_mode');
  }

  if (mode === 'bag') {
    score += 10;
    pushIfMissing(missingRequiredFields, 'bag_type', hasText(inquiry.packaging_type) || hasText(specification.bag_type));
    pushIfMissing(missingRequiredFields, 'size', hasText(bagSize));
    pushIfMissing(missingRequiredFields, 'quantity', hasText(quantity));
    pushIfMissing(missingRequiredFields, 'destination_country', hasText(destinationCountry));
    pushIfMissing(missingRequiredFields, 'trade_term_requested', hasText(tradeTerm));

    if (hasText(bagSize)) score += 20;
    if (hasText(quantity)) score += 12;
    if (hasText(destinationCountry)) score += 10;
    if (hasText(tradeTerm)) score += 10;
    if (hasText(material)) score += 10; else missingOptionalFields.push('material_structure_text');
    if (hasText(thickness)) score += 10; else missingOptionalFields.push('thickness_total');
    if (hasText(printingColors)) score += 5; else missingOptionalFields.push('printing_colors');
    if (hasText(surfaceFinish)) score += 5; else missingOptionalFields.push('surface_finish');
    if (hasText(productContent)) score += 4; else missingOptionalFields.push('product_content');
    if (hasText(fillingWeight)) score += 4; else missingOptionalFields.push('filling_weight');
  } else if (mode === 'roll_film') {
    score += 10;
    pushIfMissing(missingRequiredFields, 'film_usage_or_product_type', hasText(inquiry.product_type) || hasText(inquiry.packaging_type) || hasText(specification.film_type));
    pushIfMissing(missingRequiredFields, 'roll_width', hasText(rollWidth));
    pushIfMissing(missingRequiredFields, 'repeat_length', hasText(repeatLength));
    pushIfMissing(missingRequiredFields, 'quantity', hasText(quantity));
    pushIfMissing(missingRequiredFields, 'destination_country', hasText(destinationCountry));
    pushIfMissing(missingRequiredFields, 'trade_term_requested', hasText(tradeTerm));

    if (hasText(rollWidth)) score += 15;
    if (hasText(repeatLength)) score += 15;
    if (hasText(quantity)) score += 12;
    if (hasText(destinationCountry)) score += 10;
    if (hasText(tradeTerm)) score += 10;
    if (hasText(material)) score += 10; else missingOptionalFields.push('material_structure_text');
    if (hasText(thickness)) score += 10; else missingOptionalFields.push('thickness_total');
    if (hasText(printingColors)) score += 5; else missingOptionalFields.push('printing_colors');
    if (hasText(coreId)) score += 3; else missingOptionalFields.push('core_id');
    if (hasText(maxRollDiameter)) score += 3; else missingOptionalFields.push('max_roll_diameter');
    if (hasText(joinText(specification.packing_machine_type))) score += 2; else missingOptionalFields.push('packing_machine_type');
    if (hasText(rollLength)) score += 2; else missingOptionalFields.push('roll_length');
  } else {
    warnings.push('无法识别袋型或卷膜类型，请先补充包装类型。');
  }

  if (mode === 'bag' || mode === 'roll_film') {
    if (!hasText(material)) missingOptionalFields.push('material_structure_text');
    if (!hasText(thickness)) missingOptionalFields.push('thickness_total');
  }

  const designMissing = !hasText(printingColors) || !hasText(joinText(specification.artwork_status));
  if (designMissing) {
    missingOptionalFields.push('printing_colors');
    missingOptionalFields.push('artwork_status');
  }

  if (specialSignals.length) {
    specialSignals.forEach((signal) => missingOptionalFields.push(signal));
  }

  const uniqueOptional = Array.from(new Set(missingOptionalFields.filter(Boolean)));
  const uniqueRequired = Array.from(new Set(missingRequiredFields.filter(Boolean)));

  if (!hasText(material) || !hasText(thickness)) {
    warnings.push('材料结构或厚度未完全确认，建议先补资料或按经验预报价。');
  }
  if (!hasText(printingColors) || !hasText(joinText(specification.artwork_status))) {
    warnings.push('印刷颜色或设计稿未完全确认。');
  }
  const technicalSignals = hasHardTechnicalRequest
    || specialSignals.some((item) => item.startsWith('technical') || ['retort_required', 'frozen_required'].includes(item));
  const highBarrierOnly = hasHighBarrierRequest && !technicalSignals;
  if (technicalSignals) {
    warnings.push('检测到高阻隔/蒸煮/冷冻等技术要求，需要技术确认。');
  }
  if (highBarrierOnly) {
    warnings.push('High barrier / ALOX structure should be confirmed before quotation.');
  }
  if (hasText(targetPrice)) {
    warnings.push('客户存在目标价，需要老板确认价格边界。');
  }

  let status = 'ready';
  let color = 'green';
  let nextAction = '可进入核价';

  if (!hasText(mode) || uniqueRequired.length) {
    status = 'blocked';
    color = 'red';
    nextAction = mode === 'unknown'
      ? '请先确认袋型或卷膜类型'
      : '请补齐袋型/尺寸/数量/目的国/贸易条款';
  } else if (technicalSignals) {
    status = 'technical_check';
    color = 'yellow';
    nextAction = '请技术确认高阻隔/蒸煮/冷冻等要求';
  } else if (highBarrierOnly) {
    status = 'partial';
    color = 'yellow';
    nextAction = 'Confirm final barrier structure, MOQ, and quotation scope.';
  } else if (!hasText(material) || !hasText(thickness)) {
    status = 'need_customer_info';
    color = 'yellow';
    nextAction = '请向客户补齐材料结构和厚度';
  } else if (!hasText(printingColors) || !hasText(joinText(specification.artwork_status))) {
    status = 'partial';
    color = 'yellow';
    nextAction = '请补齐印刷颜色或设计稿';
  } else if (hasText(targetPrice) && score >= 85) {
    status = 'boss_check';
    color = 'yellow';
    nextAction = '请老板确认价格边界和利润';
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (status === 'ready' && score < 100) score = Math.min(100, Math.max(score, 90));
  if (status === 'blocked' && score > 40) score = 40;
  if (status === 'need_customer_info' && score > 70) score = 70;
  if (status === 'technical_check' && score > 80) score = 80;
  if (status === 'partial' && score > 85) score = 85;
  if (status === 'boss_check' && score > 95) score = 95;

  return {
    status,
    color,
    score,
    missing_required_fields: uniqueRequired,
    missing_optional_fields: uniqueOptional,
    warnings: Array.from(new Set(warnings)),
    next_action: nextAction,
    mode,
  };
}

module.exports = {
  CRM_STAGE_LABELS,
  CRM_STAGE_OPTIONS,
  evaluateQuoteReadiness,
  getCrmStageLabel,
  normalizeCrmStage,
};

function clean(value) {
  return String(value ?? '').trim();
}

function firstMatch(source, regex, group = 1) {
  const match = source.match(regex);
  return match ? clean(match[group]) : '';
}

function inferBagType(lower) {
  if (/retort\s*pouch|蒸煮袋/.test(lower)) return { bag_type: 'retort_pouch', roll_or_bag: 'bag' };
  if (/spout\s*pouch|吸嘴袋/.test(lower)) return { bag_type: 'spout_pouch', roll_or_bag: 'bag' };
  if (/flat\s*bottom|3d\s*pouch|eight\s*side|八边封|平底袋/.test(lower)) return { bag_type: 'flat_bottom_pouch', roll_or_bag: 'bag' };
  if (/three[ -]?side|sachet|三边封/.test(lower)) return { bag_type: 'three_side_seal', roll_or_bag: 'bag' };
  if (/stand[ -]?up|zipper\s*pouch|自立袋|拉链袋/.test(lower)) return { bag_type: 'stand_zipper_bag', roll_or_bag: 'bag' };
  if (/roll\s*(film|stock)|卷膜/.test(lower)) return { bag_type: 'auto_bag', roll_or_bag: 'roll' };
  return { bag_type: '', roll_or_bag: '' };
}

function inferProductType(lower) {
  if (/coffee\s*(?:bags?|pouches?)/.test(lower)) return 'coffee_bags';
  if (/printed\s*roll\s*film|printed\s*roll\s*stock/.test(lower)) return 'printed_roll_film';
  if (/spout\s*pouch/.test(lower) && /juice|sauce/.test(lower)) return 'juice_sauce_packaging';
  if (/retort\s*pouch/.test(lower) && /ready\s*meal/.test(lower)) return 'ready_meal_packaging';
  if (/sachet/.test(lower) && /powder|seasoning/.test(lower)) return 'powder_seasoning_packaging';
  return '';
}

function inferMessageType(lower) {
  if (/material|thickness|wvtr|otr|structure|laminate|laminated|barrier|alox|kbopp|bopp|pet|r?cpp|nylon|pa|结构|厚度|阻隔/.test(lower)) return 'technical_question';
  if (/payment|deposit|付款|账期/.test(lower)) return 'payment_question';
  if (/cif|ddp|freight|customs|door delivery|目的港|运费|清关/.test(lower)) return 'logistics_question';
  if (/sample|样品/.test(lower)) return 'sample_request';
  if (/discount|too high|target price|议价|价格太高/.test(lower)) return 'price_negotiation';
  if (/quote|quotation|price|报价/.test(lower)) return 'quote_request';
  return 'customer_reply';
}

function inferCountry(source) {
  const known = ['Bangladesh', 'Pakistan', 'UAE', 'United Arab Emirates', 'Oman', 'India', 'China', 'USA', 'United States', 'Canada', 'Australia', 'Germany', 'France', 'UK'];
  return known.find((country) => new RegExp(`\\b${country.replace(/ /g, '\\s+')}\\b`, 'i').test(source)) || '';
}

function inferPort(source) {
  const ports = ['Ajman', 'Chittagong', 'Karachi', 'ICD Dhaka', 'Dhaka', 'Jebel Ali', 'Dubai', 'Faridpur'];
  return ports.find((port) => new RegExp(`\\b${port.replace(/ /g, '\\s+')}\\b`, 'i').test(source)) || '';
}

function uniqueMatches(source, regex) {
  const values = [];
  for (const match of source.matchAll(regex)) {
    const value = clean(match[1] || match[0]).toUpperCase();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function extractCapacity(source) {
  const labeled = source.match(/(?:size|capacity|filling(?:\s*weight)?)\s*[:：]?\s*([0-9.]+\s*(?:kg|g|ml|l)(?:\s*(?:and|&|\/|,|\+|or)\s*[0-9.]+\s*(?:kg|g|ml|l))*)/i);
  if (labeled) return clean(labeled[1]).replace(/\s+/g, ' ');
  return firstMatch(source, /\b([0-9.]+\s*(?:g|ml|l)\s*(?:and|&|\/|,|\+|or)\s*[0-9.]+\s*(?:g|ml|l))\b/i).replace(/\s+/g, ' ');
}

function extractDimensions(source) {
  return firstMatch(source, /(?:size\s*[:：]?\s*)?([0-9.]+\s*(?:mm|cm)?\s*[x×*]\s*[0-9.]+(?:\s*[x×*+]\s*[0-9.+]+)?\s*(?:mm|cm)?)/i)
    || firstMatch(source, /(?:width|web\s*width)\s*[:：]?\s*([0-9.]+\s*(?:mm|cm))/i);
}

function extractQuantity(source) {
  const quantities = [];
  for (const match of source.matchAll(/([0-9][0-9,]*\s*(?:pcs|pieces|bags|pouches|kg|mt|tons?)(?:\s*(?:each\s*(?:size|design|variant)|per\s*(?:size|design|variant|month)|\/month))?)/gi)) {
    const value = clean(match[1]).replace(/\s+/g, ' ');
    if (value && !quantities.includes(value)) quantities.push(value);
  }
  if (quantities.length > 1) return quantities.join(' + ');
  if (quantities.length === 1) return quantities[0];
  return firstMatch(source, /([0-9][0-9,]*\s*(?:pcs|pieces|bags|pouches|kg|mt|tons?)(?:\s*(?:each\s*(?:size|design|variant)|per\s*(?:size|design|variant|month)|\/month))?)/i)
    || firstMatch(source, /([0-9][0-9,]*)\s+(?=(?:stand[ -]?up|flat\s*bottom|three[ -]?side|zipper)\b)/i);
}

function extractMaterialStructure(source) {
  const labeled = firstMatch(source, /(?:material|structure)\s*[:：]?\s*([^.;\n]+)/i);
  const materialToken = String.raw`(?:PET|PE|PA|AL|RCPP|CPP|BOPP|VMPET|VMCPP|NYLON|LLDPE|LDPE)`;
  const laminate = firstMatch(labeled || source, new RegExp(`\\b(${materialToken}(?:\\s*\\/\\s*${materialToken})+)\\b`, 'i'));
  if (labeled && (new RegExp(`\\b${materialToken}\\b`, 'i').test(labeled) || /matte|barrier|maybe|finish|mic|µm|um|\//i.test(labeled))) return labeled;
  return laminate || '';
}

function cleanProductFallback(value) {
  const candidate = clean(value);
  if (!candidate) return '';
  if (/^(your|our|the)\s+(detailed\s+)?(review|technical questions|message|clarification)\b/i.test(candidate)) return '';
  if (/^(use|using|from)\s+/i.test(candidate)) return '';
  return candidate;
}

function extractDestination(source) {
  const destinationText = firstMatch(source, /destination\s*[:：]?\s*([^.;\n]+)/i)
    || firstMatch(source, /\b(?:CIF|CFR|DDP|DAP)\s+([A-Za-z][A-Za-z\s]+(?:,\s*[A-Za-z\s]+)?)/i);
  const country = inferCountry(destinationText || source);
  const port = inferPort(destinationText || source);
  return { destination_text: destinationText, destination_country: country, destination_port: port };
}

function interpretCrmMessage(message, attachments = []) {
  const source = clean(message?.message_text);
  const lower = source.toLowerCase();
  const bag = inferBagType(lower);
  const productType = inferProductType(lower);
  const capacityText = extractCapacity(source);
  const dimensionText = extractDimensions(source);
  const sizeText = dimensionText || capacityText;
  const quantityText = extractQuantity(source);
  const materialStructure = extractMaterialStructure(source);
  const thicknessText = firstMatch(source, /(?:thickness|厚度)\s*[:：]?\s*([0-9.]+\s*(?:mic(?:ron)?|µm|um|mm)(?:\s*[+\/]\s*[0-9.]+\s*(?:mic(?:ron)?|µm|um|mm))*)/i)
    || firstMatch(source, /([0-9.]+\s*(?:mic(?:ron)?|µm|um)(?:\s*[+\/]\s*[0-9.]+\s*(?:mic(?:ron)?|µm|um))*)/i);
  const printingColors = firstMatch(source, /((?:cmyk\s*)?[0-9]+(?:\s*[-–]\s*[0-9]+)?\s*colou?rs?)/i);
  const requestedQuoteTerms = uniqueMatches(source, /\b(EXW|FOB|CIF|CFR|DDP|DAP)\b/gi);
  const tradeTerm = requestedQuoteTerms.join(' and ');
  const destination = extractDestination(source);
  const destinationCountry = destination.destination_country;
  const destinationPort = destination.destination_port;
  const artworkStatus = /artwork (?:will be|to be) provided|设计稿.*(?:后续|待)/i.test(source)
    ? 'pending'
    : /artwork (?:is )?(?:ready|attached)|设计稿.*(?:已提供|已完成)/i.test(source)
      ? 'ready'
      : '';
  const technicalRequirements = [];
  const accessories = [];
  const barrierRequirements = [];
  const complianceRequirements = [];
  const riskFlags = [];
  if (/valve|气阀/i.test(source)) { technicalRequirements.push('valve'); accessories.push('valve'); }
  if (/zipper|拉链/i.test(source)) { technicalRequirements.push('zipper'); accessories.push('zipper'); }
  if (/\bcap\b/i.test(source)) accessories.push('cap');
  if (/spout|吸嘴/i.test(source)) { technicalRequirements.push('spout'); accessories.push('spout'); }
  if (/tear\s*notch|易撕口/i.test(source)) { technicalRequirements.push('tear notch'); accessories.push('tear notch'); }
  if (/handle|手提孔/i.test(source)) { technicalRequirements.push('handle'); accessories.push('handle'); }
  if (/window|透明窗/i.test(source)) technicalRequirements.push('window');
  if (/high\s*barrier|高阻隔/i.test(source)) { technicalRequirements.push('high barrier'); barrierRequirements.push('high barrier'); }
  else if (/wvtr|otr|barrier|alox|阻隔/i.test(source)) barrierRequirements.push(firstMatch(source, /([^.;\n]*(?:wvtr|otr|barrier|alox|阻隔)[^.;\n]*)/i) || 'barrier requirement mentioned');
  if (/wvtr|otr|barrier|alox|kbopp|bopp\s*\d+|pewhb|阻隔/i.test(source)) {
    riskFlags.push('Barrier / OTR / WVTR structure requires technical confirmation before quotation.');
  }
  if (/flat\s*bottom|3d\s*pouch|平底袋|八边封/i.test(source)) technicalRequirements.push('flat bottom pouch');
  if (/automatic\s*packing\s*machine/i.test(source)) technicalRequirements.push('automatic packing machine');
  if (/retort/i.test(source)) technicalRequirements.push('retort');
  const retortCondition = firstMatch(source, /(121\s*°?C\s*(?:for\s*)?30\s*minutes?)/i);
  if (retortCondition) technicalRequirements.push(retortCondition.replace(/\s*for\s*/i, ' '));
  if (/retort|sterili[sz]ation|121\s*°?c|boiling|frozen|microwave|high temperature|pressure cooking/i.test(source)) {
    riskFlags.push('Retort or high-temperature process requires factory technical confirmation.');
  }
  if (/\b(?:cif|ddp|dap)\b|customs|tax|door delivery|清关|税费/i.test(source)) {
    riskFlags.push('Delivery, customs clearance, tax and local delivery boundaries require confirmation.');
  }
  if (/payment|deposit|付款|账期/i.test(source)) riskFlags.push('Payment terms require manual confirmation.');
  if (/certificat|fda|eu\s*10\/2011|reach|rohs|认证|合规/i.test(source)) {
    complianceRequirements.push(firstMatch(source, /([^.;\n]*(?:certificat|fda|eu\s*10\/2011|reach|rohs|认证|合规)[^.;\n]*)/i) || 'compliance requirement mentioned');
    riskFlags.push('Compliance requirement must be verified before commitment.');
  }

  const missingInformation = [];
  if (!bag.bag_type) missingInformation.push('bag_type');
  if (!dimensionText) missingInformation.push(capacityText ? 'exact bag dimensions' : 'size_text');
  if (!materialStructure) missingInformation.push('material_structure');
  if (!quantityText) missingInformation.push('quantity_text');
  if (!printingColors) missingInformation.push('printing_colors');
  if (!artworkStatus) missingInformation.push(productType === 'coffee_bags' ? 'artwork file' : 'artwork_status');
  if (!destinationCountry) missingInformation.push('destination_country');
  if (!tradeTerm) missingInformation.push('trade_term');
  if (productType === 'coffee_bags') {
    if (!thicknessText) missingInformation.push('final material thickness');
    if (accessories.includes('valve')) missingInformation.push('valve position');
    if (requestedQuoteTerms.includes('CIF')) missingInformation.push('CIF destination port details if different from Ajman');
    if (requestedQuoteTerms.includes('FOB') && requestedQuoteTerms.includes('CIF')) riskFlags.unshift('FOB and CIF require separate logistics calculation');
    if (/maybe|high\s*barrier/i.test(materialStructure)) riskFlags.push('material structure needs confirmation before final quotation');
    if (accessories.includes('valve') || accessories.includes('zipper')) riskFlags.push('valve position and zipper specification need confirmation');
  }
  if (/roll\s*film\s+or\s+three\s*side\s*seal/i.test(source)) riskFlags.push('Roll film or three side seal format requires customer confirmation.');
  if (/(?:multi|multiple|different)\s*(?:sku|size|artwork|design|variant)|\b[2-9]\s*(?:artwork|design|variant)s?\b|多(?:规格|尺寸|款)/i.test(source)) {
    riskFlags.push('Multiple SKUs / artwork variants may require separate costing, plate fees and loss review.');
  }
  const hasPdfAttachment = Array.isArray(attachments) && attachments.some((item) => String(item.attachment_type || item.mime_type || '').toLowerCase().includes('pdf'));
  if (hasPdfAttachment && /attach|pdf|tender|spec|drawing|file|附件|招标|规格/i.test(source)) {
    missingInformation.push('manual attachment review');
    riskFlags.push('Attached PDF/file must be reviewed manually; do not infer tender or specification details from metadata only.');
  }

  const messageType = inferMessageType(lower);
  const shouldCreateFatherTask = riskFlags.length > 0 || messageType === 'technical_question' || messageType === 'quote_request';
  const fatherTaskType = messageType === 'logistics_question'
    ? 'logistics'
    : messageType === 'payment_question'
      ? 'payment'
      : messageType === 'technical_question'
        ? 'technical'
        : messageType === 'quote_request'
          ? 'quote'
          : 'general';
  const attachmentCount = Array.isArray(attachments) ? attachments.length : 0;
  const summaryCn = source
    ? `客户消息涉及${bag.bag_type || '待确认包装类型'}${quantityText ? `，数量 ${quantityText}` : ''}${tradeTerm ? `，贸易条款 ${tradeTerm}` : ''}。`
    : `客户发送了 ${attachmentCount} 个附件，消息正文为空。`;

  return {
    message_type: messageType,
    summary_cn: productType === 'coffee_bags'
      ? `客户询问定制咖啡袋，要求带阀和拉链，${capacityText || '装量待确认'}两个规格，材料倾向哑面高阻隔 PET/VMPET/PE，数量为每个规格 ${quantityText.replace(/\s*each size$/i, '') || '待确认'}，${printingColors || '印刷颜色待确认'}印刷，目的地 ${destination.destination_text || destinationCountry || '待确认'}，需要分别报价 ${tradeTerm || '贸易条款待确认'}，并确认是否可做平底袋。`
      : summaryCn,
    summary_en: source ? `Customer message about ${bag.bag_type || 'packaging requirements'}${quantityText ? `, quantity ${quantityText}` : ''}.` : 'Attachment-only customer message.',
    customer_intent: messageType === 'quote_request' ? 'request quotation' : messageType.replace(/_/g, ' '),
    product_type: productType || cleanProductFallback(firstMatch(source, /(?:product\s*[:：]|for)\s*([^.;\n]+)/i)),
    bag_type: bag.bag_type,
    roll_or_bag: bag.roll_or_bag,
    size_text: sizeText,
    capacity_text: capacityText,
    material_structure: materialStructure,
    thickness_text: thicknessText,
    quantity_text: quantityText,
    printing_colors: printingColors,
    artwork_status: artworkStatus,
    destination_country: destinationCountry,
    destination_port: destinationPort,
    destination_text: destination.destination_text,
    trade_term: tradeTerm,
    requested_quote_terms: requestedQuoteTerms,
    technical_requirements: technicalRequirements,
    accessories,
    barrier_requirements: barrierRequirements,
    compliance_requirements: complianceRequirements,
    missing_information: missingInformation,
    risk_flags: riskFlags,
    should_update_inquiry: Boolean(source && (bag.bag_type || quantityText || destinationCountry || tradeTerm)),
    should_create_father_task: shouldCreateFatherTask,
    father_task_type: fatherTaskType,
    question_for_father_cn: shouldCreateFatherTask ? `请确认该客户的${fatherTaskType === 'quote' ? '内部核价边界和成本参数' : '技术或商务边界'}。` : '',
    suggested_next_action_cn: missingInformation.length ? `向客户确认：${missingInformation.join('、')}` : '复核客户要求并准备内部核价。',
    suggested_customer_reply_en: missingInformation.length
      ? `Thank you for the information. Before we proceed, please confirm: ${missingInformation.join(', ')}.`
      : 'Thank you for the details. We will review the requirements internally and come back to you.',
    confidence_score: source ? (missingInformation.length <= 3 ? 0.78 : 0.58) : 0.35,
    customer_original_product_words: firstMatch(source, /(?:need|want|require)\s+([^.;\n]+)/i)
  };
}

function buildInquiryFillPlan(inquiry, interpretation) {
  const candidates = {
    product_type: interpretation.product_type,
    packaging_type: interpretation.bag_type,
    quantity: interpretation.quantity_text,
    destination_country: interpretation.destination_country,
    destination_port: interpretation.destination_port,
    trade_term_requested: interpretation.trade_term,
    missing_info: interpretation.missing_information?.length ? JSON.stringify(interpretation.missing_information) : '',
    technical_risks: interpretation.risk_flags?.length ? JSON.stringify(interpretation.risk_flags) : '',
    next_action: interpretation.suggested_next_action_cn
  };
  const updates = {};
  const skipped_fields = [];
  Object.entries(candidates).forEach(([field, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (clean(inquiry?.[field])) {
      skipped_fields.push({ field, existing_value: inquiry[field], suggested_value: value });
    } else {
      updates[field] = value;
    }
  });
  return { updates, skipped_fields };
}

function deriveInquiryAiSummary(inquiry, interpretation) {
  return clean(inquiry?.ai_summary_cn) || clean(interpretation?.summary_cn);
}

module.exports = { interpretCrmMessage, buildInquiryFillPlan, deriveInquiryAiSummary };

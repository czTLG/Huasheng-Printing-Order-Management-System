const express = require('express');
const { db, now, audit } = require('../db');
const {
  parseInquiryText,
  normalizeMaterialLayers,
  normalizeToQuoteInput,
  applyDefaultCostParams,
  runPreCosting,
  buildCalculationTable,
  buildFatherReviewPanel
} = require('../services/foreignCostingAssistant');

const router = express.Router();

const COST_USERS = new Set(['chenyongjie', 'gavin', 'chenrunyang', 'admin']);

router.use((req, res, next) => {
  const u = String(req.user?.userName || '').trim();
  const role = String(req.user?.role || '').trim();
  if (COST_USERS.has(u) || role === 'super_admin') return next();
  return res.status(403).json({ error: '外贸核价助手仅指定成本用户可访问' });
});

function nOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function safeJsonParse(text, fallback = {}) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function extractRouteMaterialSection(text) {
  const source = String(text || '');
  const match = source.match(/material\s*[:：]\s*([^,\n\r;；。]+)/i);
  return match ? match[1].trim() : '';
}

function extractRouteMaterialLayers(text) {
  const section = extractRouteMaterialSection(text);
  if (!section) return { section: '', layers: [] };

  const layers = section
    .split(/\s*\+\s*/g)
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => {
      const m = segment.match(/^([A-Za-z][A-Za-z0-9()\/\-\s]*?)\s+(\d+(?:\.\d+)?)\s*(micron|mic|um|μm|µm|c)\b/i);
      if (!m) return null;
      const num = Number(m[2]);
      return {
        raw_name: m[1].trim(),
        thickness_value: Number.isFinite(num) ? Number((num / 10).toFixed(6)) : null,
        source: segment
      };
    })
    .filter(Boolean);

  return { section, layers };
}

function buildWarningList(parsed, materialMapping, quoteNorm) {
  return uniq([
    ...(parsed.risk_flags || []),
    ...(parsed.material_mapping_warnings || []),
    ...(materialMapping.material_mapping_warnings || []),
    ...(quoteNorm.warnings || []),
    ...(quoteNorm.default_notes || [])
  ]);
}

router.post('/parse', async (req, res) => {
  try {
    const text = String(req.body?.text ?? req.body?.source_text ?? req.body?.message ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text 必填' });

    const parsed = await parseInquiryText(text, {
      provider: req.body?.provider,
      model: req.body?.model
    });
    const routeMaterials = extractRouteMaterialLayers(text);
    if (routeMaterials.layers.length) {
      parsed.customer_order_info = {
        ...parsed.customer_order_info,
        material_structure_text: routeMaterials.section || parsed.customer_order_info?.material_structure_text || '',
        material_layers: routeMaterials.layers
      };
      parsed.customer_provided = {
        ...parsed.customer_provided,
        material_structure_text: routeMaterials.section || parsed.customer_provided?.material_structure_text || ''
      };
      parsed.ai_inferred = {
        ...parsed.ai_inferred,
        material_layers: routeMaterials.layers.map(layer => ({
          raw_name: layer.raw_name,
          thickness: layer.thickness_value,
          source: layer.source
        }))
      };
    }

    res.json({
      customer_order_info: parsed.customer_order_info || {},
      customer_provided: parsed.customer_provided || {},
      ai_inferred: parsed.ai_inferred || {},
      missing_fields: parsed.missing_fields || [],
      risk_flags: parsed.risk_flags || [],
      material_mapping_warnings: parsed.material_mapping_warnings || [],
      suggested_cost_type: parsed.suggested_cost_type || '',
      confidence: parsed.confidence || 'low',
      status: parsed.status || 'internal_pre_quote'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/draft', async (req, res) => {
  try {
    const text = String(req.body?.text ?? req.body?.source_text ?? req.body?.message ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text 必填' });

    const parsed = await parseInquiryText(text, {
      provider: req.body?.provider,
      model: req.body?.model
    });
    const routeMaterials = extractRouteMaterialLayers(text);
    if (routeMaterials.layers.length) {
      parsed.customer_order_info = {
        ...parsed.customer_order_info,
        material_structure_text: routeMaterials.section || parsed.customer_order_info?.material_structure_text || '',
        material_layers: routeMaterials.layers
      };
      parsed.customer_provided = {
        ...parsed.customer_provided,
        material_structure_text: routeMaterials.section || parsed.customer_provided?.material_structure_text || ''
      };
      parsed.ai_inferred = {
        ...parsed.ai_inferred,
        material_layers: routeMaterials.layers.map(layer => ({
          raw_name: layer.raw_name,
          thickness: layer.thickness_value,
          source: layer.source
        }))
      };
    }

    const materialMapping = await normalizeMaterialLayers(parsed.customer_order_info || {});
    const parsedForQuote = {
      ...parsed,
      normalized_material_layers: materialMapping.layers,
      material_mapping_warnings: uniq([
        ...(parsed.material_mapping_warnings || []),
        ...(materialMapping.material_mapping_warnings || [])
      ]),
      normalized_surface_finish: materialMapping.surface_finish
    };

    const quoteNorm = normalizeToQuoteInput(parsedForQuote);
    const defaultCostParams = applyDefaultCostParams(quoteNorm.cost_type, parsedForQuote);
    const preCost = runPreCosting(quoteNorm);
    const calculationTable = buildCalculationTable(quoteNorm.cost_type, quoteNorm, preCost);
    const fatherReviewPanel = buildFatherReviewPanel(parsed, quoteNorm, preCost);
    const warnings = buildWarningList(parsed, materialMapping, {
      ...quoteNorm,
      warnings: uniq([...(quoteNorm.warnings || []), ...(defaultCostParams.warnings || [])]),
      default_notes: uniq([...(quoteNorm.default_notes || []), ...(defaultCostParams.defaultNotes || [])])
    });

    const result = db.prepare(`
      INSERT INTO foreign_costing_drafts (
        crm_inquiry_id, customer_id, customer_name, source_text, parsed_spec_json,
        material_mapping_json, quote_input_json, quote_result_json, calculation_table_json,
        ai_provider, ai_model, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      null,
      null,
      String(parsed.customer_order_info?.customer_name || ''),
      parsed.source_text || text,
      JSON.stringify(parsed),
      JSON.stringify(materialMapping),
      JSON.stringify(quoteNorm.quote_input),
      JSON.stringify(preCost.internalVersion),
      JSON.stringify(calculationTable),
      String(req.body?.provider || ''),
      String(req.body?.model || ''),
      'internal_pre_quote',
      String(req.user?.userName || ''),
      now(),
      now()
    );

    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'foreign_costing_draft',
      resourceType: 'foreign_costing_draft',
      resourceId: result.lastInsertRowid,
      detail: parsed.suggested_cost_type || ''
    });

    res.json({
      draft_id: result.lastInsertRowid,
      customer_order_info: parsed.customer_order_info || {},
      parsed_spec: parsed,
      material_mapping: materialMapping,
      quote_input: quoteNorm.quote_input,
      quote_result: preCost.internalVersion,
      calculation_table: calculationTable,
      father_review_panel: fatherReviewPanel,
      warnings,
      status: 'internal_pre_quote'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/review', (req, res) => {
  try {
    const draftId = Number(req.body?.draft_id || req.body?.draftId || 0);
    if (!draftId) return res.status(400).json({ error: 'draft_id 必填' });

    const draftRow = db.prepare('SELECT * FROM foreign_costing_drafts WHERE id=?').get(draftId);
    if (!draftRow) return res.status(404).json({ error: '草稿不存在' });

    const parsedSpec = safeJsonParse(draftRow.parsed_spec_json, {});
    const quoteInput = safeJsonParse(draftRow.quote_input_json, {});
    const quoteResult = safeJsonParse(draftRow.quote_result_json, {});
    const reviewedInput = req.body?.reviewed_input && typeof req.body.reviewed_input === 'object'
      ? req.body.reviewed_input
      : {};
    const fatherNote = String(req.body?.father_note ?? '');
    const fatherCorrectionNote = String(req.body?.father_correction_note ?? '');
    const approvedUnitPrice = nOrNull(req.body?.approved_unit_price);
    const approvedTotalPrice = nOrNull(req.body?.approved_total_price);
    const changedFields = req.body?.changed_fields && typeof req.body.changed_fields === 'object'
      ? req.body.changed_fields
      : {};

    const reviewedResult = {
      draft_id: draftId,
      parsed_spec: parsedSpec,
      quote_input: quoteInput,
      quote_result: quoteResult,
      reviewed_input: reviewedInput,
      father_note: fatherNote,
      father_correction_note: fatherCorrectionNote,
      approved_unit_price: approvedUnitPrice,
      approved_total_price: approvedTotalPrice,
      changed_fields: changedFields
    };

    const result = db.prepare(`
      INSERT INTO foreign_costing_reviews (
        draft_id, reviewer, reviewed_input_json, reviewed_result_json,
        approved_unit_price, approved_total_price, father_note, father_correction_note,
        changed_fields_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draftId,
      String(req.user?.userName || ''),
      JSON.stringify(reviewedInput),
      JSON.stringify(reviewedResult),
      approvedUnitPrice,
      approvedTotalPrice,
      fatherNote,
      fatherCorrectionNote,
      JSON.stringify(changedFields),
      'reviewed',
      now()
    );

    audit({
      role: req.user.role,
      userName: req.user.userName,
      action: 'foreign_costing_review',
      resourceType: 'foreign_costing_review',
      resourceId: result.lastInsertRowid,
      detail: `draft:${draftId}`
    });

    res.json({
      review_id: result.lastInsertRowid,
      status: 'reviewed'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

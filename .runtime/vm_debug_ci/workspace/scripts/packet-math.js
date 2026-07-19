#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function fail(message) {
  console.error(JSON.stringify({ status: 'blocked', reason: message }, null, 2));
  process.exit(3);
}

function finite(value, name, { min = 0, allowZero = false } = {}) {
  if (!Number.isFinite(value) || (allowZero ? value < min : value <= min)) {
    fail(`${name} must be a finite number ${allowZero ? '>=' : '>'} ${min}`);
  }
  return value;
}

function round(value, digits = 6) {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
}

const MATERIAL_REFERENCE_YUAN_KG = {
  PET: 8.8,
  PE: 9.2,
  LDPE: 9.2,
  LLDPE: 9.2,
  VMPET: 9.8,
  BOPP: 8.8,
  MATTE_BOPP: 9.3,
  MOPP: 9.3,
  VMBOPP: 12.2,
  CPP: 9.2,
  CPE: 10.2,
  VMCPP: 12.6,
  NY: 18,
  AL: 26.8
};

function checkMaterialPrice(layer, index) {
  if (layer.confirm_unusual_price === true) return;
  const reference = Number(layer.reference_price_yuan_kg) || MATERIAL_REFERENCE_YUAN_KG[layer.material.toUpperCase()];
  if (!reference) return;
  const ratio = layer.price_yuan_kg / reference;
  if (ratio >= 0.4 && ratio <= 2.5) return;

  const candidates = [layer.price_yuan_kg * 10, layer.price_yuan_kg / 10]
    .filter(value => value > 0)
    .map(value => ({ value, ratio: value / reference }))
    .filter(item => item.ratio >= 0.4 && item.ratio <= 2.5)
    .sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
  const suggestion = candidates[0]
    ? `; possible decimal error: ${layer.price_yuan_kg} -> ${round(candidates[0].value, 4)}`
    : '';
  fail(`layers[${index}].price_yuan_kg=${layer.price_yuan_kg} is outside the sanity range for ${layer.material} (reference ${reference})${suggestion}; confirm the value explicitly before calculating`);
}

const path = process.argv[2];
if (!path) fail('usage: packet-math.js <input.json>');

const input = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(input.layers) || input.layers.length === 0) fail('layers are required');

const layers = input.layers.map((layer, index) => {
  const prefix = `layers[${index}]`;
  const normalized = {
    material: String(layer.material || '').trim() || fail(`${prefix}.material is required`),
    thickness_c: finite(layer.thickness_c, `${prefix}.thickness_c`),
    density: finite(layer.density, `${prefix}.density`),
    price_yuan_kg: finite(layer.price_yuan_kg, `${prefix}.price_yuan_kg`),
    reference_price_yuan_kg: Number(layer.reference_price_yuan_kg) || null,
    confirm_unusual_price: layer.confirm_unusual_price === true
  };
  checkMaterialPrice(normalized, index);
  return normalized;
});

const processing = finite(input.processing_fee_yuan_m2, 'processing_fee_yuan_m2', { allowZero: true });
const loss = finite(input.loss_rate, 'loss_rate', { allowZero: true });
const slitting = finite(input.slitting_yuan_ton ?? 0, 'slitting_yuan_ton', { allowZero: true });
const packing = finite(input.packing_yuan_ton ?? 0, 'packing_yuan_ton', { allowZero: true });
if (input.freight_yuan_ton == null) fail('freight_yuan_ton is required; zero must be explicitly confirmed');
const freight = finite(input.freight_yuan_ton, 'freight_yuan_ton', { allowZero: true });
if (freight === 0 && input.confirm_zero_freight !== true) {
  fail('freight_yuan_ton is zero but not confirmed; set confirm_zero_freight=true only when freight is intentionally excluded');
}
const margin = input.margin_rate == null ? null : finite(input.margin_rate, 'margin_rate', { allowZero: true });

const massFactor = layers.reduce((sum, layer) => sum + layer.thickness_c * layer.density, 0);
const areaM2PerKg = 100 / massFactor;
const layerShares = layers.map(layer => layer.thickness_c * layer.density / massFactor);
const materialYuanKg = layers.reduce((sum, layer, index) => sum + layerShares[index] * layer.price_yuan_kg, 0);
const processingYuanKg = processing * areaM2PerKg;
const additionsYuanKg = (slitting + packing + freight) / 1000;
const preLossYuanKg = materialYuanKg + processingYuanKg + additionsYuanKg;
const costYuanKg = preLossYuanKg * (1 + loss);
const quoteYuanKg = margin == null ? null : costYuanKg * (1 + margin);

console.log(JSON.stringify({
  status: margin == null ? 'internal_estimate' : 'ready',
  formula_version: 'packet-math-v1',
  normalized_input: { layers, processing_fee_yuan_m2: processing, loss_rate: loss, slitting_yuan_ton: slitting, packing_yuan_ton: packing, freight_yuan_ton: freight, confirm_zero_freight: input.confirm_zero_freight === true, margin_rate: margin },
  intermediate: {
    mass_factor: round(massFactor),
    area_m2_per_kg: round(areaM2PerKg),
    layers: layers.map((layer, index) => ({ material: layer.material, mass_share: round(layerShares[index]), material_cost_yuan_kg: round(layerShares[index] * layer.price_yuan_kg) })),
    material_cost_yuan_kg: round(materialYuanKg),
    processing_cost_yuan_kg: round(processingYuanKg),
    additions_yuan_kg: round(additionsYuanKg),
    pre_loss_cost_yuan_kg: round(preLossYuanKg)
  },
  result: { cost_yuan_kg: round(costYuanKg), quote_yuan_kg: quoteYuanKg == null ? null : round(quoteYuanKg) },
  formulas: [
    'mass_factor = sum(thickness_c * density)',
    'area_m2_per_kg = 100 / mass_factor',
    'material_cost_yuan_kg = sum(layer_mass_share * layer_price_yuan_kg)',
    'processing_cost_yuan_kg = processing_yuan_m2 * area_m2_per_kg',
    'cost_yuan_kg = (material + processing + additions_per_kg) * (1 + loss_rate)',
    'quote_yuan_kg = cost_yuan_kg * (1 + margin_rate)'
  ]
}, null, 2));

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const engine = require('/refs/cache-engine.js');

const FUNCTIONS = {
  auto_bag: engine.calcAutoBag,
  eight_side_seal: engine.calcEightSideSeal,
  stand_zipper_bag: engine.calcStandZipperBag,
  irregular_zipper_bag: engine.calcIrregularZipperBag,
  back_seal: input => engine.calcBackSealBag({ ...input, bag_mode: 'back_seal' }),
  side_seal: input => engine.calcBackSealBag({ ...input, bag_mode: 'side_seal' }),
  four_side_seal: input => engine.calcBackSealBag({ ...input, bag_mode: 'four_side_seal' }),
  material_weight: engine.calcMaterialWeight
};

const [quoteType, inputPath] = process.argv.slice(2);
if (!FUNCTIONS[quoteType] || !inputPath) {
  console.error('Usage: cache-math.js TYPE INPUT_JSON');
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const result = FUNCTIONS[quoteType](input);
console.log(JSON.stringify({
  status: 'ready',
  formula_version: 'cache-engine-v1',
  quote_type: quoteType,
  input,
  result
}, null, 2));

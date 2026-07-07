const assert = require('assert');
const { interpretCrmMessage, deriveInquiryAiSummary } = require('../src/services/crmMessageInterpreter');

function includesAll(actual, expected, label) {
  const list = Array.isArray(actual) ? actual : [];
  expected.forEach((value) => assert(list.includes(value), `${label} should include ${value}; got ${JSON.stringify(list)}`));
}

const cases = [
  {
    name: 'coffee flat bottom pouch keeps capacities, accessories and both quote terms',
    text: `Hello, we need custom coffee bags with valve and zipper.
Size: 250g and 500g.
Material: matte finish, high barrier, maybe PET/VMPET/PE.
Quantity: 30,000 pcs each size.
Printing: 6 colors.
Destination: Ajman, UAE.
Can you quote FOB and CIF?
Also please check if you can make it with flat bottom pouch.`,
    check(result) {
      assert.strictEqual(result.product_type, 'coffee_bags');
      assert.strictEqual(result.bag_type, 'flat_bottom_pouch');
      assert.strictEqual(result.roll_or_bag, 'bag');
      assert.strictEqual(result.size_text, '250g and 500g');
      assert.strictEqual(result.capacity_text, '250g and 500g');
      assert.strictEqual(result.quantity_text, '30,000 pcs each size');
      assert.strictEqual(result.destination_country, 'UAE');
      assert.strictEqual(result.destination_port, 'Ajman');
      assert.strictEqual(result.destination_text, 'Ajman, UAE');
      assert.strictEqual(result.trade_term, 'FOB and CIF');
      assert.deepStrictEqual(result.requested_quote_terms, ['FOB', 'CIF']);
      includesAll(result.accessories, ['valve', 'zipper'], 'accessories');
      includesAll(result.technical_requirements, ['valve', 'zipper', 'high barrier', 'flat bottom pouch'], 'technical_requirements');
      assert(result.customer_original_product_words.includes('coffee bags with valve and zipper'));
      assert(result.missing_information.includes('exact bag dimensions'));
      assert(result.risk_flags.includes('FOB and CIF require separate logistics calculation'));
    }
  },
  {
    name: 'printed roll film extracts width, material, machine use and Oman',
    text: 'We need printed roll film, width 320mm, PET/PE, 500kg for automatic packing machine. Destination Oman.',
    check(result) {
      assert.strictEqual(result.product_type, 'printed_roll_film');
      assert.strictEqual(result.bag_type, 'auto_bag');
      assert.strictEqual(result.roll_or_bag, 'roll');
      assert(result.size_text.includes('320mm'));
      assert.strictEqual(result.quantity_text, '500kg');
      assert.strictEqual(result.destination_country, 'Oman');
      assert(result.material_structure.includes('PET/PE'));
      includesAll(result.technical_requirements, ['automatic packing machine'], 'technical_requirements');
      assert(Array.isArray(result.missing_information));
      assert(Array.isArray(result.risk_flags));
    }
  },
  {
    name: 'spout pouch extracts capacities, spout and CIF Karachi',
    text: 'Please quote spout pouch for juice/sauce, 100ml and 250ml, material PET/PE, 50,000 pcs, cap and spout, CIF Karachi, Pakistan.',
    check(result) {
      assert.strictEqual(result.product_type, 'juice_sauce_packaging');
      assert.strictEqual(result.bag_type, 'spout_pouch');
      assert.strictEqual(result.roll_or_bag, 'bag');
      assert.strictEqual(result.capacity_text, '100ml and 250ml');
      assert.strictEqual(result.quantity_text, '50,000 pcs');
      assert.strictEqual(result.destination_country, 'Pakistan');
      assert.strictEqual(result.destination_port, 'Karachi');
      assert.strictEqual(result.trade_term, 'CIF');
      assert(result.material_structure.includes('PET/PE'));
      includesAll(result.accessories, ['cap', 'spout'], 'accessories');
      assert(Array.isArray(result.missing_information));
      assert(Array.isArray(result.risk_flags));
    }
  },
  {
    name: 'retort pouch preserves process condition and material structure',
    text: 'Need retort pouch for ready meal, 121°C for 30 minutes, PA/AL/RCPP, quantity 20,000 pcs, destination UAE.',
    check(result) {
      assert.strictEqual(result.product_type, 'ready_meal_packaging');
      assert.strictEqual(result.bag_type, 'retort_pouch');
      assert.strictEqual(result.roll_or_bag, 'bag');
      assert.strictEqual(result.quantity_text, '20,000 pcs');
      assert.strictEqual(result.destination_country, 'UAE');
      assert(result.material_structure.includes('PA/AL/RCPP'));
      includesAll(result.technical_requirements, ['retort', '121°C 30 minutes'], 'technical_requirements');
      assert(result.risk_flags.some((value) => value.toLowerCase().includes('retort')));
      assert(Array.isArray(result.missing_information));
    }
  },
  {
    name: 'sachet sample identifies three side seal ambiguity and capacity',
    text: 'Sachet packaging for powder seasoning, filling 4g, roll film or three side seal, PET/PE, 100,000 pcs, EXW China.',
    check(result) {
      assert.strictEqual(result.product_type, 'powder_seasoning_packaging');
      assert.strictEqual(result.bag_type, 'three_side_seal');
      assert.strictEqual(result.roll_or_bag, 'bag');
      assert.strictEqual(result.capacity_text, '4g');
      assert.strictEqual(result.quantity_text, '100,000 pcs');
      assert.strictEqual(result.trade_term, 'EXW');
      assert(result.material_structure.includes('PET/PE'));
      assert(result.risk_flags.some((value) => value.toLowerCase().includes('roll film')));
      assert(Array.isArray(result.technical_requirements));
      assert(Array.isArray(result.missing_information));
    }
  }
];

let passed = 0;
for (const testCase of cases) {
  const result = interpretCrmMessage({ message_text: testCase.text, direction: 'inbound' }, []);
  try {
    testCase.check(result);
    passed += 1;
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    console.error(`FAIL ${testCase.name}`);
    console.error(JSON.stringify(result, null, 2));
    throw error;
  }
}

const coffee = interpretCrmMessage({ message_text: cases[0].text, direction: 'inbound' }, []);
assert.strictEqual(deriveInquiryAiSummary({}, coffee), coffee.summary_cn, 'inquiry summary should derive from latest interpretation');
assert.strictEqual(deriveInquiryAiSummary({ ai_summary_cn: '人工摘要' }, coffee), '人工摘要', 'existing inquiry summary should win');

console.log(`CRM message parser regression PASS ${passed}/${cases.length}`);

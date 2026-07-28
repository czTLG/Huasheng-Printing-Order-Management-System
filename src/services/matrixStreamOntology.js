'use strict';

const ONTOLOGY = Object.freeze({
  material: [
    ['pet', /\bpet\b/i, /(?:PET(?![A-Z])|聚酯)/iu], ['pe', /\bpe\b/i, /(?:PE(?![A-Z])|聚乙烯)/iu],
    ['nylon', /\b(?:pa|ny|nylon)\b/i, /(?:\bPA\b|\bNY\b|尼龙)/iu], ['evoh', /\bevoh\b/i, /EVOH/iu],
    ['aluminum', /\b(?:al|aluminum\s*foil)\b/i, /(?:\bAL\b|铝箔)/iu], ['vmpet', /\bvmpet\b/i, /VMPET/iu],
    ['cpp', /\bcpp\b/i, /CPP/iu]
  ],
  finish: [['matte', /\b(?:matte|matt)\b/i, /(?:哑光|磨砂)/u], ['glossy', /\b(?:glossy|gloss)\b/i, /(?:亮光|光面)/u]],
  color: [
    ['red', /\bred\b/i, /红/u], ['orange', /\borange\b/i, /橙/u], ['yellow', /\byellow\b/i, /黄/u],
    ['green', /\bgreen\b/i, /绿/u], ['blue', /\bblue\b/i, /蓝/u], ['purple', /\bpurple\b/i, /紫/u],
    ['black', /\bblack\b/i, /黑/u], ['white', /\bwhite\b/i, /白/u], ['gray', /\bgr[ae]y\b/i, /灰/u],
    ['brown', /\bbrown\b/i, /棕|褐/u], ['pink', /\bpink\b/i, /(?:粉色|粉红)/u]
  ],
  bag_type: [
    ['valve_pouch', /valve\s+pouch/i, /带阀袋/u], ['stand_up_pouch', /stand[ -]?up\s+pouch/i, /自立袋/u],
    ['flat_bottom', /flat[ -]?bottom/i, /方底袋/u], ['spout_pouch', /spout(?:ed)?\s+pouch/i, /吸嘴袋/u],
    ['three_side_seal', /three[ -]?side[ -]?seal/i, /三边封/u],
    ['pillow_pouch', /pillow[ -]?pouch/i, /枕式袋/u]
  ],
  product_category: [
    ['chili_sauce', /\bchili\s+sauces?\b/i, /辣椒酱/u],
    ['sauce', /\bsauces?\b/i, /(?:酱料|酱汁)/u],
    ['seasoning_powder', /\bseasoning\s+powders?\b/i, /调味粉/u],
    ['seasoning', /\bseasonings?\b(?!\s+powders?\b)/i, /(?:调味料|调味品)/u],
    ['soup_base', /\bsoup[ -]?bases?\b/i, /(?:汤底|汤料)/u],
    ['nuts', /\bnuts?\b/i, /坚果/u],
    ['dried_fruit', /\bdried\s+fruits?\b/i, /干果/u],
    ['snacks', /\bsnacks?\b/i, /零食/u],
    ['spices', /\bspices?\b/i, /香辛料/u],
    ['liquid_detergent', /\bliquid\s+detergents?\b/i, /洗衣液/u],
    ['hand_soap', /\bhand\s+soaps?\b/i, /洗手液/u],
    ['body_soap', /\bbody\s+soaps?\b/i, /沐浴皂/u],
    ['shampoo', /\bshampoos?\b/i, /洗发(?:水|产品)?/u]
  ],
  package_format: [
    ['sachet', /\bsachets?\b/i, /小袋/u],
    ['roll_film', /\b(?:(?:printed|packaging)[ -]+)?roll[ -]+(?:film|stock)\b/i, /(?:印刷卷膜|包装卷膜|卷膜)/u]
  ],
  transparency: [['transparent', /\btransparent\b/i, /透明/u], ['opaque', /\bopaque\b/i, /不透明/u]],
  closure: [['velcro', /\bvelcro\b/i, /魔术贴/u], ['wire_tie', /\bwire[ -]?tie\b/i, /扎丝/u], ['none', /\bno\s+closure\b/i, /无封口/u]]
});

function extractOntologyFacts(text, language) {
  const value = String(text || '').normalize('NFKC');
  const facts = {};
  const add = (role, item) => { (facts[role] ||= new Set()).add(item); };
  for (const [role, entries] of Object.entries(ONTOLOGY)) {
    for (const [name, en, cn] of entries) if ((language === 'en' ? en : cn).test(value)) add(role, name);
  }
  const absentZipper = language === 'en' ? /\b(?:no|without)\s+zipper\b/i.test(value) : /(?:无|不带|没有)拉链/u.test(value);
  const presentZipper = language === 'en' ? /\b(?:has?|with)\s+(?:a\s+)?zipper\b|\buse(?:s|d|ing)?\b[^.!?]{0,40}\bzipper\b/i.test(value) : /(?:带有?|有)拉链|使用[^。！？?]{0,30}拉链/u.test(value);
  if (absentZipper) add('zipper', 'absent'); else if (presentZipper) add('zipper', 'present');
  const absentValve = language === 'en' ? /\b(?:no|without)\s+valve\b/i.test(value) : /(?:无|不带|没有)阀/u.test(value);
  const presentValve = language === 'en' ? /\b(?:has?|with)\s+(?:a\s+)?valve\b|valve\s+pouch/i.test(value) : /(?:带有?|有)阀|带阀袋/u.test(value);
  if (absentValve) add('valve', 'absent'); else if (presentValve) add('valve', 'present');
  return Object.fromEntries(Object.entries(facts).map(([role, items]) => [role, [...items].sort()]));
}

module.exports = { ONTOLOGY, extractOntologyFacts };

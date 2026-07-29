'use strict';

const PROFILES = Object.freeze({
  liquid_care: Object.freeze({
    TH: Object.freeze({
      kind: 'liquid_care',
      language: 'th',
      home: '/th',
      about: '/th/about',
      market: '/th/markets/thailand-food-packaging',
      application: '/th/applications/daily-chemical-packaging',
      product: '/th/products/spout-pouches',
      courtesy: 'ขอบคุณที่สละเวลาอ่านอีเมลฉบับนี้ เราหวังว่าจะได้พูดคุยกับทีมจัดซื้อบรรจุภัณฑ์ของคุณ'
    }),
    ID: Object.freeze({
      kind: 'liquid_care',
      language: 'id',
      home: '/id',
      about: '/id/about',
      market: '/id/markets/indonesia',
      application: '/id/applications/daily-chemical-packaging',
      product: '/id/products/spout-pouches',
      courtesy: 'Terima kasih atas waktu Anda. Kami berharap dapat berdiskusi dengan tim pengadaan kemasan perusahaan Anda.'
    }),
    MY: Object.freeze({
      kind: 'liquid_care',
      language: 'en',
      expectedLanguage: 'en',
      home: '/',
      about: '/about',
      market: '/markets/malaysia-food-packaging',
      application: '/applications/daily-chemical-packaging',
      product: '/products/spout-pouches',
      courtesy: 'Terima kasih atas masa pihak tuan/puan. Kami berharap dapat berbincang dengan pasukan anda.',
      supportedClaims: Object.freeze([
        'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是广东华胜包装有限公司，一家位于中国的软包装制造商。',
        'For liquid refill packaging, we review formula compatibility, filling conditions, fitment, sealing and representative leakage testing before confirming the final structure.',
        '针对液体补充装，我们会在确认最终结构前核对配方兼容性、灌装条件、吸嘴、封口及代表性防漏测试。'
      ])
    }),
    AE: Object.freeze({
      kind: 'liquid_care',
      language: 'ar',
      expectedLanguage: 'ar',
      home: '/ar',
      about: '/ar/about',
      market: '/ar/markets/middle-east-food-packaging',
      application: '/ar/applications/daily-chemical-packaging',
      product: '/ar/products/spout-pouches',
      courtesy: 'شكرًا لوقتكم، ونتطلع إلى فرصة للتواصل مع فريق مشتريات التغليف لديكم.',
      supportedClaims: Object.freeze([
        'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是广东华胜包装有限公司，一家位于中国的软包装制造商。',
        'For liquid refill packaging, we review formula compatibility, filling conditions, fitment, sealing and representative leakage testing before confirming the final structure.',
        '针对液体补充装，我们会在确认最终结构前核对配方兼容性、灌装条件、吸嘴、封口及代表性防漏测试。'
      ])
    })
  }),
  thailand_food: Object.freeze({
    TH: Object.freeze({
      kind: 'thailand_food',
      language: 'th',
      expectedLanguage: 'th',
      home: '/th',
      about: '/th/about',
      market: '/th/markets/thailand',
      application: '/th/applications/snack-packaging',
      product: '/th/products/food-packaging-roll-film',
      courtesy: 'ขอบคุณที่สละเวลา หวังว่าจะมีโอกาสได้พูดคุยกับทีมของท่าน',
      supportedClaims: Object.freeze([
        'We are Huasheng Printing Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是中国的华胜印刷有限公司，专业生产软包装。',
        'spices, seasonings, snacks and fried vegetables',
        '香辛料、调味料、零食和炸制蔬菜',
        'seasoning pouches and automatic packing roll film',
        '调味料袋和自动包装卷膜',
        'For seasoning packaging, we focus on moisture and aroma protection, reliable sealing where fine powder may contaminate the seal area, and consistent printing across multiple flavors and SKUs.',
        '针对调味料包装，我们重点关注防潮保香、细粉污染封口区域时的封口可靠性，以及多个口味和 SKU 的印刷一致性。'
      ])
    })
  }),
  food_sauce: Object.freeze({
    VN: Object.freeze({
      kind: 'food_sauce',
      language: 'vi',
      home: '/vi',
      about: '/vi/about',
      market: '/vi/markets/vietnam',
      application: '/vi/applications/sauce-packaging',
      product: '/vi/products/spout-pouches',
      courtesy: 'Cảm ơn Quý công ty đã dành thời gian xem thư. Chúng tôi mong có cơ hội trao đổi cùng đội ngũ thu mua bao bì của Quý công ty.'
    })
  }),
  malaysia_seasoning: Object.freeze({
    MY: Object.freeze({
      kind: 'malaysia_seasoning',
      language: 'en',
      expectedLanguage: 'en',
      home: '/',
      about: '/about',
      market: '/markets/malaysia-food-packaging',
      application: '/applications/food-snack-packaging',
      product: '/products/food-packaging-roll-film',
      courtesy: 'Terima kasih atas masa pihak tuan/puan. Kami berharap dapat berbincang dengan pasukan anda.',
      supportedClaims: Object.freeze([
        'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是广东华胜包装有限公司，一家位于中国的软包装制造商。',
        'moisture and aroma protection based on the product and required shelf life;',
        'seal and roll-film specifications matched to the packing machine;',
        'print and artwork consistency across multiple private-label SKUs.',
        '根据产品和所需保质期确定防潮及保香要求；',
        '使封口与卷膜规格匹配包装机；',
        '确保多个私牌 SKU 的印刷和稿件一致性。'
      ])
    })
  }),
  malaysia_instant_beverage: Object.freeze({
    MY: Object.freeze({
      kind: 'malaysia_instant_beverage',
      language: 'en',
      expectedLanguage: 'en',
      home: '/',
      about: '/about',
      market: '/markets/malaysia-food-packaging',
      application: '/applications/instant-beverage-powder-packaging',
      product: '/products/food-packaging-roll-film',
      courtesy: 'Terima kasih atas masa pihak tuan/puan.',
      supportedClaims: Object.freeze([
        'Sachet and roll-film supply for COCOME’s instant beverage range',
        'Huasheng Packaging is an ISO 22000-certified flexible packaging manufacturer in China.',
        '华胜包装是中国一家通过 ISO 22000 认证的软包装制造商。',
        'For instant beverage powders, we focus on moisture and aroma protection, sealing stability when fine powder reaches the seal area, accurate roll width, repeat length, eye marks and unwind direction, as well as artwork and barcode control across multiple SKUs.',
        '针对速溶饮品粉剂，我们重点控制防潮与香气保护、细粉进入封口区域时的封合稳定性、卷膜宽度、版长、光标及放卷方向的准确性，以及多个 SKU 之间的设计稿和条码版本管理。',
        'We can confirm manufacturability and quote the corresponding sachet, roll film or pouch format.',
        '我们可以确认其可制造性，并对相应的小袋、卷膜或袋装形式进行报价。'
      ])
    })
  }),
  matrix_food_id: Object.freeze({
    ID: Object.freeze({
      kind: 'matrix_food_id',
      language: 'id',
      expectedLanguage: 'id',
      home: '/id',
      about: '/id/about',
      market: '/id/markets/indonesia',
      application: '/id/applications/sauce-packaging',
      product: '/id/products/food-packaging-roll-film',
      courtesy: 'Terima kasih atas waktu Anda. Kami berharap dapat berdiskusi dengan tim pengadaan kemasan perusahaan Anda.',
      supportedClaims: Object.freeze([
        'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是广东华胜包装有限公司，一家位于中国的软包装制造商。',
        'Powder products and liquid sauces require separate review of barrier, sealing, filling equipment and representative testing.',
        '粉剂产品和液体酱料需要分别核对阻隔、封口、灌装设备和代表性测试。'
      ])
    })
  }),
  food_snack_ar: Object.freeze({
    AE: Object.freeze({
      kind: 'food_snack_ar',
      language: 'ar',
      expectedLanguage: 'ar',
      home: '/ar',
      about: '/ar/about',
      market: '/ar/markets/middle-east-food-packaging',
      application: '/ar/applications/snack-packaging',
      product: '/ar/products/food-packaging-roll-film',
      courtesy: 'شكرًا لوقتكم، ونتطلع إلى فرصة للتواصل مع فريق مشتريات التغليف لديكم.',
      supportedClaims: Object.freeze([
        'We are Guangdong Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是广东华胜包装有限公司，一家位于中国的软包装制造商。',
        'moisture and aroma protection based on the product and required shelf life;',
        'seal and roll-film specifications matched to the packing machine;',
        'print and artwork consistency across multiple private-label SKUs.',
        '根据产品和所需保质期确定防潮及保香要求；',
        '使封口与卷膜规格匹配包装机；',
        '确保多个私牌 SKU 的印刷和稿件一致性。'
      ])
    })
  })
});

const LIQUID_CATEGORY = /(?:liquid detergent|hand soap|body soap|shampoo|body wash|hand wash|personal care|home care|baby care|oral care)/i;
const FOOD_SAUCE_CATEGORY = /(?:sauces?|chili sauce|seasonings?|spices?|soup base)/i;
const FOOD_SNACK_AR_CATEGORY = /(?:nuts?|dried fruits?|snacks?|spices?|beans?|lentils?|herbs?)/i;
const THAILAND_FOOD_CATEGORY = /(?:spices?|seasonings?|snacks?|nuts?|dried fruits?|fried vegetables?|dry foods?)/i;
const INSTANT_BEVERAGE_CATEGORY = /(?:instant beverages?|powdered drinks?|coffee|tea|chocolate beverages?|milk tea|chocolate malt)/i;
const MALAYSIA_SNACK_CATEGORY = /(?:snacks?|confectionery|chocolate|crackers?|cand(?:y|ies)|pralines?)/i;
const INDONESIA_FOOD_CATEGORY = /(?:sauces?|condiments?|seasonings?|powder drinks?|food ingredients?|extracts?|spices?)/i;

function profileFor({ countryCode, categories } = {}) {
  const country = String(countryCode || '').trim().toUpperCase();
  const values = Array.isArray(categories) ? categories.map(value => String(value || '').trim()).filter(Boolean) : [];
  if (country === 'MY' && values.some(value => INSTANT_BEVERAGE_CATEGORY.test(value))) {
    return PROFILES.malaysia_instant_beverage.MY;
  }
  if (country === 'MY' && values.some(value => FOOD_SAUCE_CATEGORY.test(value))) {
    return PROFILES.malaysia_seasoning.MY;
  }
  if (country === 'MY' && values.some(value => MALAYSIA_SNACK_CATEGORY.test(value))) {
    return PROFILES.malaysia_seasoning.MY;
  }
  if (country === 'ID' && values.some(value => INDONESIA_FOOD_CATEGORY.test(value))) {
    return PROFILES.matrix_food_id.ID;
  }
  if (values.some(value => LIQUID_CATEGORY.test(value)) && PROFILES.liquid_care[country]) {
    return PROFILES.liquid_care[country];
  }
  if (country === 'TH' && values.some(value => THAILAND_FOOD_CATEGORY.test(value))) {
    return PROFILES.thailand_food.TH;
  }
  if (values.some(value => FOOD_SAUCE_CATEGORY.test(value)) && PROFILES.food_sauce[country]) {
    return PROFILES.food_sauce[country];
  }
  if (values.some(value => FOOD_SNACK_AR_CATEGORY.test(value)) && PROFILES.food_snack_ar[country]) {
    return PROFILES.food_snack_ar[country];
  }
  return null;
}

function scopeProfileProducts(profile, products) {
  const values = Array.isArray(products) ? products : [];
  if (!['food_sauce', 'thailand_food'].includes(profile?.kind)) return values;
  return values.map(value => String(value)
    .replace(/(?:\band\s+)?\b\d+(?:[.,]\d+)?\s*(?:kg|g)\b/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim());
}

async function verifyProfileRoutes(profile, {
  origin = 'https://gdhspack.com',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) {
  if (!profile || typeof profile !== 'object' || typeof fetchImpl !== 'function') {
    throw new Error('localized route profile required');
  }
  const base = String(origin || '').replace(/\/$/, '');
  const routes = [profile.home, profile.about, profile.market, profile.application, profile.product];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const responses = await Promise.all(routes.map(async route => {
      const response = await fetchImpl(`${base}${route}`, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error(`localized website route unavailable: ${route}`);
      return { route, html: await response.text() };
    }));
    const application = responses.find(row => row.route === profile.application);
    if (!application?.html.includes(`lang="${profile.language}"`)
        || !application.html.includes(profile.application)) {
      throw new Error('localized website route set did not return the expected canonical page');
    }
    return profile;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { PROFILES, profileFor, scopeProfileProducts, verifyProfileRoutes };

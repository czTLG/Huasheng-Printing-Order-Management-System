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

function profileFor({ countryCode, categories } = {}) {
  const country = String(countryCode || '').trim().toUpperCase();
  const values = Array.isArray(categories) ? categories.map(value => String(value || '').trim()).filter(Boolean) : [];
  if (values.some(value => LIQUID_CATEGORY.test(value)) && PROFILES.liquid_care[country]) {
    return PROFILES.liquid_care[country];
  }
  if (values.some(value => FOOD_SAUCE_CATEGORY.test(value)) && PROFILES.food_sauce[country]) {
    return PROFILES.food_sauce[country];
  }
  if (values.some(value => FOOD_SNACK_AR_CATEGORY.test(value)) && PROFILES.food_snack_ar[country]) {
    return PROFILES.food_snack_ar[country];
  }
  return null;
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

module.exports = { PROFILES, profileFor, verifyProfileRoutes };

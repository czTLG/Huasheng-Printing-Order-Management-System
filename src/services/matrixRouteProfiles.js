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
  })
});

const LIQUID_CATEGORY = /(?:liquid detergent|hand soap|body soap|shampoo|body wash|hand wash|personal care|home care|baby care|oral care)/i;
const FOOD_SAUCE_CATEGORY = /(?:sauces?|chili sauce|seasonings?|spices?|soup base)/i;

function profileFor({ countryCode, categories } = {}) {
  const country = String(countryCode || '').trim().toUpperCase();
  const values = Array.isArray(categories) ? categories.map(value => String(value || '').trim()).filter(Boolean) : [];
  if (values.some(value => LIQUID_CATEGORY.test(value)) && PROFILES.liquid_care[country]) {
    return PROFILES.liquid_care[country];
  }
  if (values.some(value => FOOD_SAUCE_CATEGORY.test(value)) && PROFILES.food_sauce[country]) {
    return PROFILES.food_sauce[country];
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

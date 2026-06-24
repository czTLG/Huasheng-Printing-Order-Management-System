// Market pages data and handlers for export market landing pages
export const MARKET_SEO = {
  'vietnam-food-packaging': { en: { metaTitle:'Vietnam Food Packaging Supplier | Huasheng Packaging', metaDesc:'Flexible food packaging for Vietnam snack, biscuit, candy, coffee and sauce brands. Huasheng Packaging supplies custom roll film, spout pouches and stand up pouches for B2B buyers.', h1:'Flexible Food Packaging for Vietnam Food Brands', intro:"Vietnam food processing industry continues to grow, creating demand for flexible packaging for snacks, biscuits, candy, coffee, sauces and beverage products. Huasheng Packaging provides custom printed roll film, spout pouches, stand up zipper pouches and three side seal pouches suitable for Vietnam food manufacturing and export markets.", products:['food-packaging-roll-film','snack-packaging-roll-film','biscuit-packaging-film','candy-packaging-film','spout-pouches','stand-up-zipper-pouches','three-side-seal-pouches'], faq:[{q:'What packaging types are suitable for Vietnam snack brands?',a:'Roll film for automatic packing machines, stand up zipper pouches, three side seal pouches and flat bottom pouches are commonly used depending on the filling line and shelf display needs of Vietnam food manufacturers.'},{q:'Can Huasheng Packaging supply roll film for VFFS/HFFS machines?',a:'Yes. Huasheng Packaging can customize printed roll film for VFFS/HFFS machines, including film width, roll direction, eye mark position and material structure.'},{q:'What should Vietnam buyers prepare before requesting a quotation?',a:'Product type, bag size or roll film width, filling weight, material requirement, artwork file, order quantity and destination port help us provide a more accurate quotation.'}] } },
  'indonesia-food-packaging': { en: { metaTitle:'Indonesia Food Packaging Supplier | Huasheng Packaging', metaDesc:'Custom flexible food packaging for Indonesia coffee, snack, sauce and retort food brands. Huasheng Packaging supplies roll film, coffee bags, spout pouches and retort pouches for B2B packaging buyers.', h1:'Flexible Food Packaging for Indonesia Food and Coffee Brands', intro:"Indonesia has a large food and coffee industry, with packaging needs for roasted coffee, snacks, sauces, instant noodles, retort foods and beverage products. Huasheng Packaging provides custom flexible packaging options including coffee bags with valve, spout pouches, retort pouches and food packaging roll film.", products:['food-packaging-roll-film','coffee-bags-with-valve','spout-pouches','retort-pouches','stand-up-zipper-pouches','flat-bottom-pouches','kraft-paper-packaging-bags'], faq:[{q:'Which packaging is suitable for Indonesia coffee brands?',a:'Coffee bags with one-way valve, flat bottom pouches, side gusset bags and kraft paper coffee bags are common options for roasted coffee beans and ground coffee packaging in Indonesia.'},{q:'Can Huasheng Packaging make packaging for Indonesian sauce and liquid products?',a:'Yes. Spout pouches with leak-resistant fitment and suitable laminated roll film can be customized for sauce, beverage and refill packaging depending on filling conditions and product viscosity.'},{q:'What information is needed for an Indonesia packaging quotation?',a:'Please provide product type, package size, filling volume or weight, required shelf life, artwork, quantity and destination details for a more accurate quotation.'}] } },
  'thailand-food-packaging': { en: { metaTitle:'Thailand Food Packaging Supplier | Huasheng Packaging', metaDesc:'Flexible packaging for Thailand snack, sauce, retort food and pet food brands. Huasheng Packaging supplies custom roll film, spout pouches, retort pouches and pet food bags for B2B buyers.', h1:'Flexible Packaging for Thailand Snack, Sauce and Pet Food Brands', intro:"Thailand has a well-developed food processing and export industry, with demand for snack packaging, sauce and condiment packaging, retort pouch food packaging and pet food packaging. Huasheng Packaging supplies custom flexible packaging solutions for Thailand food manufacturers and exporters.", products:['food-packaging-roll-film','snack-packaging-roll-film','spout-pouches','retort-pouches','pet-food-packaging-bags','easy-peel-sealing-film','stand-up-zipper-pouches'], faq:[{q:'What packaging types are suitable for Thailand sauce and snack products?',a:'Spout pouches, roll film, stand up zipper pouches and retort pouches may be suitable depending on the product form, filling process and shelf life requirements of Thailand food manufacturers.'},{q:'Can Huasheng Packaging support Thailand pet food packaging needs?',a:'Yes. Huasheng Packaging supplies pet food packaging bags with moisture barrier, puncture resistance, zipper options and retail shelf display structures suitable for dry pet food and pet treat products.'},{q:'What should Thailand buyers confirm before placing an order?',a:'Buyers should confirm product type, filling weight, bag size, material structure, printing design, quantity, shelf life and shipping destination before production.'}] } },
};

// Hook into parsePath for /markets/ routes
export function parseMarketPath(seg) {
  const marketMatch = seg.match(/^markets\/([a-z0-9-]+)$/);
  if (marketMatch) return { routeType: 'market-detail', slug: marketMatch[1] };
  if (seg === 'markets' || seg === 'markets/') return { routeType: 'markets-listing', slug: '' };
  return null;
}

// Build SSR fallback content for market pages
export function buildMarketFallbackContent(routeType, slug, lang, isZh, lp, h2, escapeHtml, slugToName, link, wrap, navLinks) {
  if (routeType === 'markets-listing') {
    const h1 = 'Packaging for Export Markets';
    const desc = 'Explore flexible packaging solutions for food and consumer markets in Vietnam, Indonesia, Thailand and more.';
    const slugs = Object.keys(MARKET_SEO);
    const items = slugs.map(s => { const d = MARKET_SEO[s] && MARKET_SEO[s].en; const label = d ? d.h1 || '' : slugToName(s); return `<li>${link(lp + '/markets/' + s, label)}</li>`; }).join('');
    return wrap(`<h1>${h1}</h1><p>${desc}</p><ul>${items}</ul>`);
  }
  if (routeType === 'market-detail') {
    const marketData = MARKET_SEO[slug] && MARKET_SEO[slug].en;
    if (!marketData) return wrap(`<h1>Market Page Not Found</h1>`);
    const h1Text = escapeHtml(marketData.h1 || slugToName(slug));
    const desc = escapeHtml(marketData.metaDesc || '');
    const intro = marketData.intro || '';
    let sections = `<h1>${h1Text}</h1><p>${desc}</p>`;
    if (intro) sections += `<p>${escapeHtml(intro)}</p>`;
    if (marketData.products) {
      sections += `<h2>Recommended Packaging Types</h2>`;
      sections += '<ul>' + marketData.products.map(ps => `<li>${link(lp + '/products/' + ps, slugToName(ps))}</li>`).join('') + '</ul>';
    }
    const matNote = isZh ? '材料结构、印刷颜色和包装规格可根据产品类型、灌装方式和保质期要求定制。请联系华胜包装讨论适合您产品的包装方案。' : 'Material structure, printing colors and packaging specifications can be customized according to product type, filling method and shelf life requirements. Contact Huasheng Packaging to discuss suitable packaging options for your products.';
    sections += `<h2>${isZh?'材料与定制说明':'Material and Customization Notes'}</h2><p>${matNote}</p>`;
    const mktChecklist = isZh ? '<li>产品类型与灌装重量</li><li>袋型尺寸或卷膜宽度</li><li>材料结构偏好</li><li>印刷颜色与设计稿</li><li>订单数量</li><li>保质期要求</li><li>目的港口或国家</li>' : '<li>Product type and filling weight</li><li>Bag size or roll film width</li><li>Material structure preference</li><li>Printing colors and artwork</li><li>Order quantity</li><li>Shelf life requirement</li><li>Destination port or country</li>';
    sections += `<h2>${isZh?'询价前需要准备什么':'What to Prepare Before Requesting a Quote'}</h2><ul>${mktChecklist}</ul>`;
    if (marketData.faq && marketData.faq.length) {
      sections += `<h2>${isZh?'常见问题':'Frequently Asked Questions'}</h2>`;
      sections += '<div class="seo-faq-list">' + marketData.faq.map(f => `<details class="fb-faq"><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('') + '</div>';
    }
    sections += `<p>${link(lp + '/contact/?request=quote', isZh?'获取定制报价 →':'Request Custom Quote →')}</p>`;
    sections += navLinks([link(`${lp}/products/`, isZh?'所有产品':'All Products'), link(`${lp}/contact/`, isZh?'获取报价':'Get Quote')]);
    return wrap(sections);
  }
  return '';
}

// Get page SEO data for market pages
export function getMarketPageSeo(routeType, slug, lang) {
  if (routeType === 'markets-listing') {
    return { title:'Packaging for Export Markets | Huasheng Packaging', metaDesc:'Explore flexible packaging solutions for food and consumer markets in Vietnam, Indonesia, Thailand and neighboring regions.', h1:'Packaging for Export Markets', ogTitle:'Packaging for Export Markets | Huasheng Packaging', ogDesc:'Explore flexible packaging solutions for food and consumer markets in Vietnam, Indonesia, Thailand and neighboring regions.' };
  }
  if (routeType === 'market-detail') {
    const d = MARKET_SEO[slug];
    if (!d) return null;
    const data = d[lang] || d['en'];
    if (!data) return null;
    return { title: data.metaTitle, metaDesc: data.metaDesc, h1: data.h1 || '', ogTitle: data.metaTitle, ogDesc: data.metaDesc };
  }
  return null;
}

// Build JSON-LD schemas for market pages
export function buildMarketSchemas(routeType, slug, lang, canonicalUrl, bLabel, buildUrl, buildBreadcrumbSchema, buildCollectionPageSchema, seo) {
  const schemas = [];
  if (routeType === 'market-detail') {
    schemas.push(buildBreadcrumbSchema([
      { name: bLabel(lang, 'home'), url: buildUrl(lang, 'homepage', '') },
      { name: 'Export Markets', url: buildUrl(lang, 'markets-listing', '') },
      { name: seo.h1 || seo.title || '', url: canonicalUrl },
    ]));
    schemas.push({ '@context':'https://schema.org', '@type':'WebPage', name:seo.h1||seo.title||'', description:seo.metaDesc||'', url:canonicalUrl, inLanguage:lang });
    const mktData = MARKET_SEO[slug] && MARKET_SEO[slug].en;
    if (mktData && mktData.faq && mktData.faq.length >= 2) {
      schemas.push({ '@context':'https://schema.org', '@type':'FAQPage', url:canonicalUrl, inLanguage:lang, mainEntity: mktData.faq.map(f => ({ '@type':'Question', name:f.q, acceptedAnswer:{ '@type':'Answer', text:f.a }})) });
    }
  }
  if (routeType === 'markets-listing') {
    schemas.push(buildBreadcrumbSchema([
      { name: bLabel(lang, 'home'), url: buildUrl(lang, 'homepage', '') },
      { name: 'Export Markets', url: canonicalUrl },
    ]));
    schemas.push(buildCollectionPageSchema(seo, canonicalUrl, lang));
  }
  return schemas;
}

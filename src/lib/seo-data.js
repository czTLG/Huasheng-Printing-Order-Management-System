// SEO metadata maps and helpers for dynamic server-side head injection
// All 16 active languages; blogs only use the first 4

export const LANGS = ['en','zh','ar','ur','es','fr','ru','pt','de','vi','id','tr','ja','ko','th','hi'];
export const BLOG_LANGS = ['en','zh','ar','ur','es','fr','ru','pt','de','vi','id','tr','ja','ko','th','hi'];
export const BASE_URL = 'https://gdhspack.com';
export const BRAND = 'Huasheng Packaging';
export const BRAND_ZH = '华胜包装';

// ---- Alias canonicalization maps ----

export const PRODUCT_ALIAS_MAP = {
  // Legacy aliases → SEO canonical slugs
  'coffee-bag': 'coffee-bags-with-valve',
  'roll-film': 'food-packaging-roll-film',
  'zipper-pouch': 'stand-up-zipper-pouches',
  'easy-peel-film': 'easy-peel-sealing-film',
  'quad-seal-bag': 'quad-seal-pouches',
  // Short slugs → SEO canonical slugs
  'coffee-bag-valve': 'coffee-bags-with-valve',
  'rollstock-film': 'food-packaging-roll-film',
  'spout-pouch': 'spout-pouches',
  'flat-bottom-pouch': 'flat-bottom-pouches',
  'stand-up-pouch': 'stand-up-zipper-pouches',
  'retort-pouch': 'retort-pouches',
  'jelly-lidding': 'easy-peel-sealing-film',
  'shaped-pouch': 'custom-shaped-pouches',
  'kraft-paper-bag': 'kraft-paper-packaging-bags',
  'three-side-seal': 'three-side-seal-pouches',
  'side-gusset-bags': 'side-gusset-bag',
  'quad-seal-pouch': 'quad-seal-pouches',
};

export const APP_ALIAS_MAP = {
  'coffee-tea-packaging': 'coffee-packaging',
  'bread-packaging': 'bakery-packaging',
  'bread-bakery-packaging': 'bakery-packaging',
  'candy-packaging': 'candy-biscuit-packaging',
  'biscuit-packaging': 'candy-biscuit-packaging',
  'cookie-packaging': 'candy-biscuit-packaging',
  'beverage-spout-pouch-packaging': 'beverage-packaging',
  'snack-food-packaging': 'food-snack-packaging',
  'electronics-packaging': 'electronic-packaging',
};

// ---- Product SEO metadata (en, zh, ru, ur; other langs fallback to en) ----

export const PRODUCT_SEO = {
  'stand-up-pouch': {
    en: { name: 'Stand Up Zipper Pouch', h1: 'Custom Stand Up Zipper Pouches for Snacks, Nuts and Candy', desc: 'Custom printed stand up zipper pouches with bottom gusset, resealable zipper, tear notch and stable shelf display. Food-grade laminated materials, 9-color gravure printing, matte/gloss finish options. For snacks, nuts, candy, powder, dry food and retail packaging. Direct from ISO22000 certified factory.', metaDesc: 'Custom printed stand up zipper pouches for snacks, nuts, candy, powder, dry food and retail packaging. Food-grade laminated materials, resealable zipper, stable shelf display and factory direct supply from Huasheng Packaging.' },
    zh: { name: '自立拉链袋', h1: '定制印刷自立拉链袋，适用于零食、坚果和糖果包装', desc: '定制印刷自立拉链袋，配备底部风琴、可重复封口拉链、易撕口和稳定货架展示。食品级复合材料，九色凹版印刷，哑光/亮光表面处理可选。适用于零食、坚果、糖果、粉剂、干食品和零售包装。ISO22000认证工厂。', metaDesc: '定制印刷自立拉链袋，适用于零食、坚果、糖果、粉剂和干食品零售包装。食品级复合材料，可重复封口拉链。自立拉鏈袋、零食包裝袋，支持B2B定制。华胜包装工厂直供。' },
    ru: { name: 'Дой-пак с печатью', h1: 'Дой-пак с печатью на заказ', desc: 'Универсальная упаковка с дном. Идеально подходит для витрины, поддерживает опции зип-лока (zipper) и высоких барьерных свойств. Производство Китай, MOQ от 30 000.', metaDesc: 'Высококачественные дой-пак пакеты с печатью на заказ и зип-локом. Пищевые материалы, 9-цветная глубокая печать, прямые поставки с завода. MOQ от 30 000 шт.' },
    ur: { name: 'اسٹینڈ اپ پاؤچ', h1: 'حسب ضرورت پرنٹ شدہ اسٹینڈ اپ پاؤچز', desc: 'ورسٹائل باٹم گسیٹ پیکیجنگ جو ریٹیل ڈسپلے کے لیے بہترین ہے۔ زپر آپشنز اور ہائی بیریئر خصوصیات کو سپورٹ کرتی ہے۔ چین فیکٹری سے براہ راست۔', metaDesc: 'اعلیٰ معیار کے حسب ضرورت پرنٹ شدہ اسٹینڈ اپ پاؤچز ری سیل ایبل زپر کے ساتھ۔ فوڈ گریڈ میٹریلز، 9-رنگ گریوور پرنٹنگ، فیکٹری ڈائریکٹ قیمت۔ MOQ 30,000 پیسز۔' },
    hi: { name: 'स्टैंड अप जिपर पाउच', metaDesc: 'स्नैक्स, नट्स, कैंडी, पाउडर और सूखे उत्पादों के लिए कस्टम स्टैंड अप ज़िपर पाउच। रीसीलेबल ज़िपर के साथ फूड-ग्रेड लैमिनेटेड सामग्री। Huasheng Packaging से सीधी आपूर्ति।' },
    th: { name: 'ถุงตั้งได้มีซิป', metaDesc: 'ซองตั้งมีซิปล็อกสั่งทำพิเศษสำหรับขนมขบเคี้ยว ถั่ว ลูกอม ผง และผลิตภัณฑ์แห้ง วัสดุลามิเนตเกรดอาหารพร้อมซิปล็อกแบบปิดซ้ำได้ จัดส่งตรงจาก Huasheng Packaging' },
    ko: { name: '스탠드업 지퍼 파우치', metaDesc: '스낵, 견과류, 사탕, 분말, 건조 제품을 위한 맞춤형 스탠드업 지퍼 파우치. 재밀봉 가능한 지퍼가 있는 식품 등급 라미네이트 소재. Huasheng Packaging 직송.' },
    ja: { name: 'スタンドアップジッパー付きパウチ', metaDesc: 'スナック、ナッツ、キャンディ、粉末、乾物向けのカスタムスタンドアップジッパーパウチ。再封可能なジッパー付き食品グレードラミネート素材。Huasheng Packagingから直送。' },
    tr: { name: 'Dik Poşet Fermuarlı', metaDesc: 'Atıştırmalık, kuruyemiş, şeker, toz ve kuru ürünler için fermuarlı özel dik poşetler. Yeniden kapatılabilir fermuarlı gıda sınıfı lamine malzemeler. Huasheng Packaging tarafından doğrudan tedarik.' },
    id: { name: 'Kantong Berdiri dengan Ritsleting', metaDesc: 'Kantong berdiri khusus dengan ritsleting untuk camilan, kacang, permen, bubuk, dan produk kering. Bahan laminasi food-grade dengan ritsleting yang dapat ditutup kembali. Pasokan langsung dari Huasheng Packaging.' },
    vi: { name: 'Túi Đứng Có Khóa Kéo', metaDesc: 'Túi đứng tùy chỉnh có khóa kéo cho đồ ăn nhẹ, hạt, kẹo, bột và sản phẩm khô. Vật liệu cán màng đạt chuẩn thực phẩm với khóa kéo đóng lại được. Cung cấp trực tiếp từ Huasheng Packaging.' },
    de: { name: 'Standbodenbeutel mit Zipper', metaDesc: 'Maßgefertigte Standbeutel mit Reißverschluss für Snacks, Nüsse, Süßigkeiten, Pulver und Trockenprodukte. Lebensmittelechte Laminatmaterialien mit wiederverschließbarem Reißverschluss. Direkt von Huasheng Packaging.' },
    pt: { name: 'Bolsa Stand-Up com Zíper', metaDesc: 'Bolsas personalizadas com zíper para snacks, nozes, doces, pó e produtos secos. Materiais laminados de qualidade alimentar com zíper reutilizável. Fornecimento direto da Huasheng Packaging.' },
    fr: { name: 'Poche Stand-Up avec Zip', metaDesc: 'Sachets personnalisés debout avec zip pour snacks, noix, bonbons, poudre et produits secs. Matériaux laminés de qualité alimentaire avec zip refermable. Direct usine Huasheng Packaging.' },
    es: { name: 'Bolsa Vertical con Cierre', metaDesc: 'Bolsas personalizadas con cierre resellable para snacks, frutos secos, caramelos, polvos y productos secos. Materiales laminados de grado alimenticio con cremallera resellable. Suministro directo de Huasheng Packaging.' },
    ar: { name: 'كيس قائم بسحاب', metaDesc: 'أكياس مخصصة قائمة بسحاب للوجبات الخفيفة والمكسرات والحلوى والمسحوق والمنتجات الجافة. مواد مغلفة من الدرجة الغذائية مع سحاب قابل لإعادة الإغلاق. إمداد مباشر من مصنع Huasheng Packaging.' },
  },
  'flat-bottom-pouch': {
    en: { name: 'Flat Bottom Pouch', h1: 'Custom Flat Bottom Pouches for Coffee, Pet Food and Snacks', desc: 'Custom printed flat bottom pouches with box-like shape, five printable panels, side gussets and superior shelf stability. Large filling capacity for coffee, pet food, snacks, dry food and premium packaging. Resealable zipper, pocket zipper and matte/gloss finish options. Direct from ISO22000 certified factory.', metaDesc: 'Custom printed flat bottom pouches for coffee, pet food, nuts, snacks and dry food packaging. High-barrier laminated materials, stable shelf display, zipper options and factory direct supply from Huasheng Packaging.' },
    zh: { name: '平底袋 / 八边封袋', h1: '定制印刷平底袋，适用于咖啡、宠物食品和零食包装', desc: '定制印刷平底袋，盒型立体外观，五个可印刷面，双侧风琴设计，货架稳定性卓越。大容量填充空间，适用于咖啡、宠物食品、零食、干食品和高端包装。支持重复封口拉链、口袋拉链、哑光/亮光表面处理。ISO22000认证工厂。', metaDesc: '定制印刷平底袋，盒型形状五面可印刷，适用于咖啡、零食和宠物食品品牌。高阻隔复合材料，拉链选项。八邊封咖啡袋、平底咖啡袋，支持B2B定制。华胜包装工厂直供。' },
    ru: { name: 'Пакет с плоским дном', h1: 'Пакеты с плоским дном на заказ', desc: 'Гибкая упаковка коробчатой формы с пятью печатными панелями и отличной устойчивостью. Большой объем. Производство Китай.', metaDesc: 'Индивидуальные пакеты с плоским дном и 5 печатными панелями для кофе, снеков и премиальных продуктов. Опции зип-лока и клапана. MOQ 20 000.' },
    ur: { name: 'فلیٹ باٹم پاؤچ', h1: 'حسب ضرورت پرنٹ شدہ فلیٹ باٹم پاؤچز', desc: 'پانچ پرنٹ ایبل پینلز اور اعلیٰ شیلف استحکام کے ساتھ باکس نما لچکدار پیکیجنگ۔ سائیڈ گسیٹس کے ساتھ بڑی فلنگ صلاحیت۔ چین فیکٹری سے براہ راست۔', metaDesc: 'کافی، اسنیکس اور پریمیم فوڈ کے لیے 5 پرنٹ ایبل پینلز والے حسب ضرورت فلیٹ باٹم پاؤچز۔ ری سیل ایبل زپر، ڈیگاسنگ والو آپشنز۔ MOQ 20,000 پیسز۔' },
    hi: { name: 'फ्लैट बॉटम पाउच', metaDesc: 'कॉफी, स्नैक और पालतू भोजन ब्रांडों के लिए कस्टम फ्लैट बॉटम पाउच। बेहतर शेल्फ प्रदर्शन के लिए पांच प्रिंट करने योग्य पैनलों वाला बॉक्स आकार। Huasheng Packaging से सीधी आपूर्ति।' },
    th: { name: 'ถุงก้นแบน', metaDesc: 'ซองก้นแบนสั่งทำพิเศษสำหรับแบรนด์กาแฟ ขนมขบเคี้ยว และอาหารสัตว์เลี้ยง รูปทรงกล่องพร้อมแผงพิมพ์ห้าแผงเพื่อการจัดแสดงบนชั้นวางที่โดดเด่น จัดส่งตรงจาก Huasheng Packaging' },
    ko: { name: '플랫 바텀 파우치', metaDesc: '커피, 스낵, 펫푸드 브랜드를 위한 맞춤형 플랫 보텀 파우치. 우수한 진열을 위한 5면 인쇄 가능한 박스 형태. Huasheng Packaging 직송.' },
    ja: { name: 'フラットボトムパウチ', metaDesc: 'コーヒー、スナック、ペットフードブランド向けのカスタムフラットボトムパウチ。優れた棚陳列のための5面印刷可能なボックス形状。Huasheng Packagingから直送。' },
    tr: { name: 'Düz Tabanlı Poşet', metaDesc: 'Kahve, atıştırmalık ve evcil hayvan maması markaları için özel düz tabanlı poşetler. Üstün raf sunumu için beş baskı paneli ile kutu şeklinde. Huasheng Packaging tarafından doğrudan tedarik.' },
    id: { name: 'Kantong Dasar Datar', metaDesc: 'Kantong alas datar khusus untuk merek kopi, camilan, dan makanan hewan. Bentuk kotak dengan lima panel cetak untuk tampilan rak yang superior. Pasokan langsung dari Huasheng Packaging.' },
    vi: { name: 'Túi Đáy Phẳng', metaDesc: 'Túi đáy phẳng tùy chỉnh cho thương hiệu cà phê, đồ ăn nhẹ và thức ăn thú cưng. Hình dạng hộp với năm mặt in được để trưng bày kệ hàng tốt hơn. Cung cấp trực tiếp từ Huasheng Packaging.' },
    de: { name: 'Flachbodenbeutel', metaDesc: 'Maßgefertigte Flachbodenbeutel für Kaffee-, Snack- und Tierfuttermarken. Kastenform mit fünf bedruckbaren Flächen für überlegene Regalpräsentation. Direkt von Huasheng Packaging.' },
    pt: { name: 'Bolsa de Fundo Plano', metaDesc: 'Bolsas personalizadas de fundo plano para marcas de café, snacks e ração para animais. Formato de caixa com cinco painéis imprimíveis para exposição superior na prateleira. Fornecimento direto da Huasheng Packaging.' },
    fr: { name: 'Poche à Fond Plat', metaDesc: 'Sachets personnalisés à fond plat pour marques de café, snacks et aliments pour animaux. Forme boîte avec cinq panneaux imprimables pour une présentation en rayon supérieure. Direct usine Huasheng Packaging.' },
    es: { name: 'Bolsa de Fondo Plano', metaDesc: 'Bolsas personalizadas de fondo plano para marcas de café, snacks y alimentos para mascotas. Forma de caja con cinco paneles imprimibles para exhibición superior en estante. Suministro directo de Huasheng Packaging.' },
    ar: { name: 'كيس بقاع مسطح', metaDesc: 'أكياس مخصصة بقاعدة مسطحة لعلامات القهوة والوجبات الخفيفة وأغذية الحيوانات الأليفة. شكل صندوقي مع خمس لوحات قابلة للطباعة لعرض ممتاز على الرفوف. إمداد مباشر من مصنع Huasheng Packaging.' },
  },
  'coffee-bag-valve': {
    en: { name: 'Custom Coffee Bags with Valve', h1: 'Custom Coffee Bags with Valve and Zipper', desc: 'Custom printed coffee bags with one-way degassing valve and resealable zipper for roasted coffee beans, ground coffee and specialty coffee packaging. High-barrier laminated materials for aroma protection, flat bottom and stand-up styles, matte and gloss finish options. Direct from ISO22000 certified factory.', metaDesc: 'Custom coffee bags with one-way valve and zipper for roasted coffee beans, ground coffee and specialty coffee. B2B flexible packaging from Huasheng Packaging with flat bottom, stand up and side gusset options.' },
    zh: { name: '定制带气阀咖啡袋', h1: '定制印刷带气阀咖啡袋，适用于咖啡豆和咖啡粉包装', desc: '定制印刷咖啡袋，配备单向排气阀和重复封口拉链，用于烘焙咖啡豆、咖啡粉和精品咖啡包装。高阻隔复合材料锁住香气，支持平底袋和自立袋两种袋型，哑光和亮光表面处理可选。ISO22000认证工厂。', metaDesc: '定制印刷带气阀咖啡袋，适用于咖啡豆、咖啡粉和精品咖啡品牌包装。支持拉链、平底袋、自立袋、侧风琴袋等袋型。咖啡包裝袋、咖啡袋包裝、咖啡豆包裝袋批發，支持B2B定制。华胜包装工厂直供。' },
    ru: { name: 'Кофейный пакет с клапаном', h1: 'Кофейные пакеты с дегазационным клапаном на заказ', desc: 'Специализированная упаковка для кофе с односторонним клапаном и зип-локом. Высокобарьерные материалы для сохранения аромата. Производство Китай.', metaDesc: 'Кофейные пакеты с печатью, односторонним клапаном дегазации и зип-замком. Высокобарьерные ламинаты для жареного и молотого кофе. MOQ 20 000.' },
    ur: { name: 'والو کے ساتھ کافی بیگ', h1: 'ڈیگاسنگ والو کے ساتھ حسب ضرورت کافی بیگز', desc: 'یک طرفہ ڈیگاسنگ والو اور ری سیل ایبل زپر کے ساتھ خصوصی کافی پیکیجنگ۔ خوشبو کے تحفظ کے لیے ہائی بیریئر میٹریلز۔ چین فیکٹری سے براہ راست۔', metaDesc: 'یک طرفہ ڈیگاسنگ والو اور ری سیل ایبل زپر کے ساتھ حسب ضرورت پرنٹ شدہ کافی بیگز۔ بھنی ہوئی اور گراؤنڈ کافی کے لیے ہائی بیریئر لیمینیٹس۔ MOQ 20,000 پیسز۔' },
    hi: { name: 'वाल्व के साथ कॉफी बैग', metaDesc: 'भुनी हुई कॉफी, पिसी कॉफी और विशेष कॉफी के लिए एकतरफ़ा वाल्व और रीसीलेबल ज़िपर के साथ कस्टम कॉफी बैग। सुगंध सुरक्षा के लिए उच्च-बैरियर संरचनाएं। Huasheng Packaging कारखाने से सीधी आपूर्ति।' },
    th: { name: 'ถุงกาแฟมีวาล์ว', metaDesc: 'ถุงกาแฟสั่งทำพิเศษพร้อมวาล์วทางเดียวและซิปล็อกสำหรับกาแฟคั่ว กาแฟบด และกาแฟพิเศษ โครงสร้างกั้นสูงเพื่อรักษากลิ่นหอม จัดส่งตรงจากโรงงาน Huasheng Packaging' },
    ko: { name: '밸브 커피백', metaDesc: '로스팅 원두, 분쇄 커피, 스페셜티 커피를 위한 일방향 밸브와 재밀봉 지퍼가 있는 맞춤형 커피백. 향 보호를 위한 고차단 구조. Huasheng Packaging 공장 직송.' },
    ja: { name: 'バルブ付きコーヒーバッグ', metaDesc: '焙煎コーヒー豆、粉砕コーヒー、スペシャルティコーヒー向けの一方向バルブ付き再封可能なジッパーカスタムコーヒーバッグ。香り保護のためのハイバリア構造。Huasheng Packaging工場直送。' },
    tr: { name: 'Valfili Kahve Poşeti', metaDesc: 'Kavrulmuş kahve, çekilmiş kahve ve özel kahve için tek yönlü valf ve yeniden kapatılabilir fermuarlı özel kahve poşetleri. Aroma koruması için yüksek bariyer yapıları. Huasheng Packaging fabrikasından doğrudan tedarik.' },
    id: { name: 'Kantong Kopi dengan Katup', metaDesc: 'Kantong kopi khusus dengan katup satu arah dan ritsleting yang dapat ditutup kembali untuk kopi sangrai, kopi bubuk, dan kopi spesialti. Struktur barrier tinggi untuk perlindungan aroma. Pasokan langsung pabrik dari Huasheng Packaging.' },
    vi: { name: 'Túi Cà Phê Có Van', metaDesc: 'Túi cà phê tùy chỉnh với van một chiều và khóa kéo đóng lại được cho cà phê rang, cà phê xay và cà phê đặc sản. Cấu trúc cản cao bảo vệ hương thơm. Cung cấp trực tiếp từ nhà máy Huasheng Packaging.' },
    de: { name: 'Kaffeebeutel mit Ventil', metaDesc: 'Maßgefertigte Kaffeebeutel mit Einwegventil und wiederverschließbarem Reißverschluss für Röstkaffee, Kaffeepulver und Spezialitätenkaffee. Hochbarrierestrukturen für Aromaschutz. Direkt ab Werk von Huasheng Packaging.' },
    pt: { name: 'Saco de Café com Válvula', metaDesc: 'Sacos de café personalizados com válvula unidirecional e zíper reutilizável para café torrado, moído e especial. Estruturas de alta barreira para proteção do aroma. Fornecimento direto da Huasheng Packaging.' },
    fr: { name: 'Sac à Café avec Valve', metaDesc: 'Sachets de café personnalisés avec valve unidirectionnelle et zip refermable pour café torréfié, moulu et de spécialité. Structures haute barrière pour la protection de l\'arôme. Direct usine Huasheng Packaging.' },
    es: { name: 'Bolsa de Café con Válvula', metaDesc: 'Bolsas de café personalizadas con válvula unidireccional y cierre resellable para café tostado, molido y de especialidad. Estructuras de alta barrera para protección del aroma. Suministro directo de Huasheng Packaging.' },
    ar: { name: 'كيس قهوة بصمام', metaDesc: 'أكياس قهوة مخصصة بصمام تفريغ أحادي الاتجاه وسحاب قابل لإعادة الإغلاق للقهوة المحمصة والبن المطحون والقهوة المختصة. هياكل عالية الحاجز لحماية الرائحة. إمداد مباشر من مصنع Huasheng Packaging.' },
  },
  'spout-pouch': {
    en: { name: 'Spout Pouch', h1: 'Custom Printed Spout Pouches for Liquid and Sauce Packaging', desc: 'Custom printed spout pouches with integrated spout and cap for juice, sauce, puree, beverage, detergent refill and liquid packaging. Leak-resistant spout welding, food-grade laminated materials, multiple spout positions and cap options. Direct from ISO22000 certified factory in Guangdong, China.', metaDesc: 'Custom printed spout pouches for juice, sauce, puree, beverage, refill and liquid packaging. Food-grade laminated materials, leak-resistant sealing, spout and cap options, factory direct supply from Huasheng Packaging.' },
    zh: { name: '吸嘴袋', h1: '定制印刷吸嘴袋，适用于液体、酱料和饮品包装', desc: '定制印刷吸嘴袋，集成吸嘴和盖子，适用于果汁、酱料、果泥、饮料、日化补充装和液体包装。防漏吸嘴焊接，食品级复合材料，多种吸嘴位置和盖子选项。ISO22000认证工厂位于广东潮州。', metaDesc: '定制印刷吸嘴袋，适用于果汁、酱料、饮料、液体和补充装包装。食品级复合材料，防漏吸嘴焊接。液體包裝袋、醬料包裝吸嘴袋，支持B2B定制。华胜包装工厂直供。' },
    ru: { name: 'Пакет с носиком', h1: 'Пакеты с носиком на заказ', desc: 'Удобная упаковка для жидкостей с интегрированным носиком и крышкой. Герметичная защита от протечек. Производство Китай.', metaDesc: 'Пакеты с носиком на заказ для соков, соусов, пюре и жидких продуктов. Защита от протечек, пищевые материалы, 9-цветная печать. MOQ 30 000.' },
    ur: { name: 'اسپاؤٹ پاؤچ', h1: 'حسب ضرورت پرنٹ شدہ اسپاؤٹ پاؤچز', desc: 'انٹیگریٹڈ اسپاؤٹ اور کیپ کے ساتھ آسان مائع پیکیجنگ۔ جوسز، ساسز اور مائع مصنوعات کے لیے لیک پروف سیلنگ۔ چین فیکٹری سے براہ راست۔', metaDesc: 'جوس، ساس، پیوری اور مائع مصنوعات کے لیے حسب ضرورت پرنٹ شدہ اسپاؤٹ پاؤچز۔ لیک مزاحم اسپاؤٹ، فوڈ گریڈ میٹریلز، 9-رنگ گریوور پرنٹنگ۔ MOQ 30,000 پیسز۔' },
    hi: { name: 'स्पाउट पाउच', metaDesc: 'जूस, सॉस, पेय, तरल और रीफिल के लिए कस्टम स्पाउट पाउच। फूड-ग्रेड लैमिनेटेड संरचनाएं और लीक-प्रूफ स्पाउट वेल्डिंग। Huasheng Packaging से सीधी आपूर्ति।' },
    th: { name: 'ถุงมีหูเท', metaDesc: 'ซองสเปาต์พิมพ์ลายตามสั่งสำหรับน้ำผลไม้ ซอส เครื่องดื่ม ของเหลว และผลิตภัณฑ์เติม โครงสร้างลามิเนตเกรดอาหารพร้อมการเชื่อมสเปาต์ป้องกันการรั่ว จัดส่งตรงจาก Huasheng Packaging' },
    ko: { name: '스파우트 파우치', metaDesc: '주스, 소스, 음료, 액체, 리필용 맞춤형 스파우트 파우치. 식품 등급 라미네이트 구조와 누출 방지 스파우트 용접. Huasheng Packaging 직송.' },
    ja: { name: 'スパウトパウチ', metaDesc: 'ジュース、ソース、飲料、液体、詰め替え用のカスタムスパウトパウチ。食品グレードのラミネート構造と漏れ防止スパウト溶接。Huasheng Packagingから直送。' },
    tr: { name: 'Ağızlıklı Poşet', metaDesc: 'Meyve suyu, sos, içecek, sıvı ve dolum için özel baskılı ağızlıklı poşetler. Sızdırmaz ağızlık kaynaklı gıda sınıfı lamine yapılar. Huasheng Packaging tarafından doğrudan tedarik.' },
    id: { name: 'Kantong dengan Cerat', metaDesc: 'Kantong cerat khusus cetak untuk jus, saus, minuman, cairan, dan isi ulang. Struktur laminasi food-grade dengan pengelasan cerat anti-bocor. Pasokan langsung dari Huasheng Packaging.' },
    vi: { name: 'Túi Có Vòi', metaDesc: 'Túi có vòi in theo yêu cầu cho nước trái cây, nước sốt, đồ uống, chất lỏng và sản phẩm nạp lại. Cấu trúc cán màng đạt chuẩn thực phẩm với hàn vòi chống rò rỉ. Cung cấp trực tiếp từ Huasheng Packaging.' },
    de: { name: 'Ausgießbeutel', metaDesc: 'Maßgefertigte Ausgießbeutel mit individuellem Druck für Saft, Soße, Getränk, Flüssigkeit und Nachfüllung. Lebensmittelechte Laminatstrukturen mit lecksicherer Ausgießverschweißung. Direkt von Huasheng Packaging.' },
    pt: { name: 'Bolsa com Bico', metaDesc: 'Bolsas personalizadas com bico impressas sob medida para suco, molho, bebida, líquido e refil. Estruturas laminadas de qualidade alimentar com soldagem de bico à prova de vazamentos. Fornecimento direto da Huasheng Packaging.' },
    fr: { name: 'Poche à Bec Verseur', metaDesc: 'Sachets à bec verseur personnalisés imprimés sur mesure pour jus, sauce, boisson, liquide et recharge. Structures laminées de qualité alimentaire avec soudure de bec anti-fuite. Direct usine Huasheng Packaging.' },
    es: { name: 'Bolsa con Boquilla', metaDesc: 'Bolsas personalizadas con boquilla impresas a medida para zumo, salsa, bebida, líquido y recarga. Estructuras laminadas de grado alimenticio con soldadura de boquilla antigoteo. Suministro directo de Huasheng Packaging.' },
    ar: { name: 'كيس بصنبور', metaDesc: 'أكياس مخصصة بصنبور للتغليف المطبوع حسب الطلب للعصير والصلصة والمشروبات والسوائل وإعادة التعبئة. هياكل مغلفة من الدرجة الغذائية مع لحام صنبور مانع للتسرب. إمداد مباشر من مصنع Huasheng Packaging.' },
  },
  'three-side-seal': {
    en: { name: 'Three Side Seal Pouch', h1: 'Custom Three Side Seal Pouches for Sachets and Sample Packaging', desc: 'Custom three side seal pouches for single-serve snacks, powder sachets, wet wipes and sample packaging. Cost-effective flat pouch format with BOPP/CPP, PET/PE and PET/VMPET/PE structures. Fast production, food-grade materials and custom printing. Direct from ISO22000 certified factory.', metaDesc: 'Custom three side seal pouches for single-serve snacks, powder sachets, wet wipes and sample packaging. Food-grade materials, custom printing, fast production. Factory direct from Huasheng Packaging.' },
    zh: { name: '三边封袋', h1: '定制三边封袋', desc: '高性价比的平袋形式，适用于单份装和样品包装。生产速度快，材料兼容性广。中国工厂直供。', metaDesc: '定制三边封袋，适用于单份零食、粉末小袋和样品包装。食品级材料，高速生产。起订量50,000个。' },
    ru: { name: 'Трехшовный пакет', h1: 'Трехшовные пакеты на заказ', desc: 'Экономичный плоский формат для одноразовой и пробной упаковки. Быстрое производство, широкая совместимость материалов. Производство Китай.', metaDesc: 'Трехшовные пакеты на заказ для одноразовых снеков, саше и пробной упаковки. Пищевые материалы, высокая скорость производства. MOQ 50 000.' },
    ur: { name: 'تھری سائیڈ سیل پاؤچ', h1: 'حسب ضرورت تھری سائیڈ سیل پاؤچز', desc: 'سنگل سرو اور سیمپل پیکیجنگ کے لیے سستا فلیٹ پاؤچ فارمیٹ۔ تیز پیداوار، وسیع میٹیریل مطابقت۔ چین فیکٹری سے براہ راست۔', metaDesc: 'سنگل سرو اسنیکس، پاؤڈر ساشے اور سیمپل پیکیجنگ کے لیے حسب ضرورت تھری سائیڈ سیل پاؤچز۔ فوڈ گریڈ میٹریلز، تیز رفتار پیداوار۔ MOQ 50,000 پیسز۔' },
  },
  'quad-seal-pouch': {
    en: { name: 'Custom Quad Seal Pouches for Coffee and Pet Food', h1: 'Custom Quad Seal Pouches for Coffee, Pet Food and Premium Packaging', desc: 'Custom printed quad seal pouches with four-side sealing for coffee, pet food, snacks and premium retail packaging. Stable box shape, superior shelf display and high-barrier laminated structures.', metaDesc: 'Custom quad seal pouches for coffee, pet food, snacks and premium retail packaging. Strong four-side sealing, stable shelf display and laminated barrier structures from Huasheng Packaging.' },
    hi: { name: 'कॉफी और पेट फूड के लिए कस्टम क्वाड सील पाउच', metaDesc: 'कॉफी, पेट फूड, स्नैक्स और प्रीमियम पैकेजिंग के लिए कस्टम मुद्रित क्वाड सील पाउच। Huasheng Packaging से मजबूत सीलिंग।' },
    th: { name: 'ซองสี่ซีลสำหรับกาแฟและอาหารสัตว์เลี้ยง', metaDesc: 'ซองพิมพ์ลายตามสั่งสี่ซีลสำหรับกาแฟ อาหารสัตว์เลี้ยง ขนมขบเคี้ยว และบรรจุภัณฑ์พรีเมียม ซีลสี่ด้านแข็งแรงจาก Huasheng Packaging' },
    ko: { name: '커피 및 펫푸드용 맞춤형 쿼드 실 파우치', metaDesc: '커피, 펫푸드, 스낵, 프리미엄 포장을 위한 맞춤 인쇄 쿼드 실 파우치. Huasheng Packaging의 강력한 4면 실링.' },
    ja: { name: 'コーヒー・ペットフード用カスタムクワッドシールパウチ', metaDesc: 'コーヒー、ペットフード、スナック、プレミアム包装向けのカスタム印刷クワッドシールパウチ。強力な四方シールをHuasheng Packagingが提供。' },
    tr: { name: 'Kahve ve Evcil Hayvan Maması için Dört Contalı Poşetler', metaDesc: 'Kahve, evcil hayvan maması, atıştırmalık ve premium ambalaj için özel baskılı dört contalı poşetler. Huasheng Packaging tarafından güçlü sızdırmazlık.' },
    id: { name: 'Kantong Empat Segel untuk Kopi dan Makanan Hewan', metaDesc: 'Kantong cetak khusus empat segel untuk kopi, makanan hewan, camilan, dan kemasan premium. Penyegelan kuat dari Huasheng Packaging.' },
    vi: { name: 'Túi Bốn Cạnh cho Cà Phê và Thức Ăn Thú Cưng', metaDesc: 'Túi in tùy chỉnh bốn cạnh cho cà phê, thức ăn thú cưng, đồ ăn nhẹ và bao bì cao cấp. Hàn kín chắc chắn từ Huasheng Packaging.' },
    de: { name: 'Viersiegelbeutel für Kaffee und Tiernahrung', metaDesc: 'Maßgefertigte Viersiegelbeutel für Kaffee, Tiernahrung, Snacks und Premium-Verpackungen. Verstärkte Versiegelung von Huasheng Packaging.' },
    pt: { name: 'Bolsas de Quatro Selos para Café e Ração Animal', metaDesc: 'Bolsas impressas personalizadas de quatro selos para café, ração animal, snacks e embalagens premium. Vedação reforçada da Huasheng Packaging.' },
    fr: { name: 'Sachets Quadri-Soudés pour Café et Aliments pour Animaux', metaDesc: 'Sachets quadri-soudés imprimés sur mesure pour café, aliments pour animaux, snacks et emballages premium. Scellage renforcé de Huasheng Packaging.' },
    es: { name: 'Bolsas de Cuatro Sellos Personalizadas para Café y Mascotas', metaDesc: 'Bolsas impresas personalizadas de cuatro sellos para café, alimentos para mascotas, snacks y envases premium. Sellado reforzado de Huasheng Packaging.' },
    ar: { name: 'أكياس رباعية الختم مخصصة للقهوة وأغذية الحيوانات الأليفة', metaDesc: 'أكياس رباعية الختم مطبوعة حسب الطلب للقهوة وأغذية الحيوانات الأليفة والوجبات الخفيفة والتغليف المتميز. ختم قوي من أربعة جوانب وعرض ثابت على الرفوف من Huasheng Packaging.' },
    zh: { name: '四边封袋', h1: '定制四边封袋', desc: '重型侧插角袋，适用于大容量包装。卓越的货架稳定性和承重能力。中国工厂直供。', metaDesc: '定制四边封插角袋，适用于宠物食品、大包装零食和大容量包装。加强封口，高阻隔材料。起订量15,000个。' },
    ru: { name: 'Четырехшовный пакет', h1: 'Четырехшовные пакеты на заказ', desc: 'Усиленные пакеты с боковыми складками для больших объемов. Превосходная устойчивость и грузоподъемность. Производство Китай.', metaDesc: 'Четырехшовные пакеты на заказ с боковыми складками для кормов, снеков и больших объемов. Усиленная герметизация, высокобарьерные материалы. MOQ 15 000.' },
    ur: { name: 'کواڈ سیل پاؤچ', h1: 'حسب ضرورت کواڈ سیل پاؤچز', desc: 'بڑی مقدار کی پیکیجنگ کے لیے ہیوی ڈیوٹی سائیڈ گسیٹ پاؤچز۔ اعلیٰ شیلف استحکام اور وزن برداشت کرنے کی صلاحیت۔ چین فیکٹری سے براہ راست۔', metaDesc: 'پیٹ فوڈ، بلک اسنیکس اور بڑی مقدار کی پیکیجنگ کے لیے سائیڈ گسیٹس والے حسب ضرورت کواڈ سیل پاؤچز۔ مضبوط سیلنگ، ہائی بیریئر میٹریلز۔ MOQ 15,000 پیسز۔' },
  },
  'rollstock-film': {
    en: { name: 'Food Packaging Roll Film', h1: 'Custom Printed Food Packaging Roll Film', desc: 'Custom printed food packaging roll film for automatic VFFS and HFFS packing machines. Food-grade laminated structures with precise eye mark registration, 9-color gravure printing. Suitable for snacks, biscuits, candy, powder, frozen food and general food packaging. Direct from ISO22000 certified factory in Guangdong, China.', metaDesc: 'Custom printed food packaging roll film for snacks, biscuits, candy, jelly and automatic packing machines. Food-grade laminated structures, 9-color gravure printing, eye mark registration. MOQ 200 kg. Direct from Huasheng Packaging factory.' },
    zh: { name: '食品包装卷膜', h1: '定制印刷食品包装卷膜', desc: '定制印刷食品包装卷膜，适用于VFFS和HFFS自动包装机。食品级复合结构，精准光标定位，九色凹版印刷。适用于零食、饼干、糖果、粉剂、冷冻食品和一般食品包装。ISO22000认证工厂位于广东潮州。', metaDesc: '定制印刷食品包装卷膜，适用于自动VFFS/HFFS包装机。食品级复合材料，9色凹版印刷，光电跟踪。食品包裝卷膜、自動包裝機卷膜，支持B2B定制。华胜包装工厂直供。' },
    hi: { name: 'फूड पैकेजिंग रोल फिल्म' },
    th: { name: 'ฟิล์มบรรจุภัณฑ์อาหาร' },
    ko: { name: '식품 포장 롤 필름' },
    ru: { name: 'Рулонная пленка', h1: 'Рулонная пленка с печатью на заказ', desc: 'Высокопроизводительная печатная пленка для автоматических упаковочных машин. Ламинированные структуры с точной фотометкой. Производство Китай.', metaDesc: 'Рулонная пленка с печатью для VFFS и автоматических упаковочных машин. Пищевая ламинированная пленка с фотометкой, 9-цветная печать. MOQ 200 кг.' },
    ur: { name: 'رول اسٹاک فلم', h1: 'حسب ضرورت پرنٹ شدہ رول اسٹاک فلم', desc: 'خودکار پیکیجنگ مشینوں کے لیے اعلیٰ کارکردگی والی پرنٹ شدہ رول فلم۔ درست آئی مارک رجسٹریشن کے ساتھ لیمینیٹڈ ڈھانچے۔ چین فیکٹری سے براہ راست۔', metaDesc: 'VFFS اور خودکار پیکیجنگ مشینوں کے لیے حسب ضرورت پرنٹ شدہ رول اسٹاک فلم۔ آئی مارک کے ساتھ فوڈ گریڈ لیمینیٹڈ فلم، 9-رنگ گریوور پرنٹنگ۔ MOQ 200 کلو۔' },
    ar: { name: 'فيلم تغليف الطعام', metaDesc: 'أفلام تغليف الطعام المطبوعة حسب الطلب لآلات التعبئة الآلية VFFS وHFFS. هياكل مغلفة من الدرجة الغذائية مع طباعة غائرة بتسعة ألوان. إمداد مباشر من مصنع Huasheng Packaging في قوانغدونغ، الصين.' },
    ur: { name: 'فوڈ پیکیجنگ رول فلم' },
    es: { name: 'Film de Envasado de Alimentos', metaDesc: 'Film de embalaje alimentario impreso a medida para máquinas automáticas VFFS y HFFS. Estructuras laminadas de grado alimenticio con impresión por huecograbado de 9 colores. Suministro directo de Huasheng Packaging en Guangdong, China.' },
    fr: { name: 'Film d\'Emballage Alimentaire', metaDesc: 'Film d\'emballage alimentaire imprimé sur mesure pour machines automatiques VFFS et HFFS. Structures laminées de qualité alimentaire avec impression hélio 9 couleurs. Direct usine Huasheng Packaging, Guangdong, Chine.' },
    pt: { name: 'Filme para Embalagem de Alimentos', metaDesc: 'Filme de embalagem alimentar impresso personalizado para máquinas VFFS e HFFS. Estruturas laminadas de qualidade alimentar com impressão em rotogravura a 9 cores. Fornecimento direto da Huasheng Packaging em Guangdong, China.' },
    de: { name: 'Lebensmittelverpackungsfolie', metaDesc: 'Maßgefertigte Lebensmittelverpackungsfolie für automatische VFFS- und HFFS-Maschinen. Lebensmittelechte Laminatstrukturen mit 9-Farb-Tiefdruck. Direkt ab Werk von Huasheng Packaging, Guangdong, China.' },
    vi: { name: 'Màng Cuộn Đóng Gói Thực Phẩm', metaDesc: 'Màng cuộn bao bì thực phẩm in theo yêu cầu cho máy đóng gói tự động VFFS và HFFS. Cấu trúc cán màng đạt chuẩn thực phẩm với in ống đồng 9 màu. Cung cấp trực tiếp từ nhà máy Huasheng Packaging tại Quảng Đông, Trung Quốc.' },
    id: { name: 'Film Kemasan Makanan', metaDesc: 'Film kemasan makanan cetak khusus untuk mesin kemas otomatis VFFS dan HFFS. Struktur laminasi food-grade dengan cetak gravure 9 warna. Pasokan langsung pabrik dari Huasheng Packaging di Guangdong, Tiongkok.' },
    tr: { name: 'Gıda Ambalaj Rulo Filmi', metaDesc: 'VFFS ve HFFS otomatik makineler için özel baskılı gıda ambalaj filmi. 9 renkli tifdruk baskılı gıda sınıfı lamine yapılar. Huasheng Packaging, Guangdong, Çin fabrikasından doğrudan tedarik.' },
    ja: { name: '食品包装ロールフィルム', metaDesc: 'VFFSおよびHFFS自動包装機用のカスタム印刷食品包装ロールフィルム。食品グレードのラミネート構造、9色グラビア印刷。中国広東省のHuasheng Packaging工場から直送。' },
    ko: { name: '식품 포장 롤 필름' },
    th: { name: 'ฟิล์มม้วนบรรจุอาหาร' },
    hi: { name: 'खाद्य पैकेजिंग रोल फिल्म' },
  },
  'shaped-pouch': {
    en: { name: 'Shaped Pouch', h1: 'Custom Shaped Pouches', desc: 'Creative die-cut pouches for distinctive brand packaging. Unique shapes that stand out on retail shelves. Direct from China factory.', metaDesc: 'Custom shaped pouches with creative die-cut designs for standout brand packaging. Food-grade materials, custom shape and size. MOQ 30,000 pcs.' },
    zh: { name: '异形袋', h1: '定制异形袋', desc: '创意模切袋，打造独特的品牌包装。在零售货架上脱颖而出的异形设计。中国工厂直供。', metaDesc: '定制异形袋，创意模切设计，打造独特的品牌包装。食品级材料，定制形状和尺寸。起订量30,000个。' },
    ru: { name: 'Фигурный пакет', h1: 'Фигурные пакеты на заказ', desc: 'Креативные высеченные пакеты для уникальной упаковки бренда. Выделяющиеся формы на полках. Производство Китай.', metaDesc: 'Фигурные пакеты на заказ с креативной высечкой для уникальной упаковки бренда. Пищевые материалы, индивидуальная форма. MOQ 30 000.' },
    ur: { name: 'شیپڈ پاؤچ', h1: 'حسب ضرورت شیپڈ پاؤچز', desc: 'مخصوص برانڈ پیکیجنگ کے لیے تخلیقی ڈائی کٹ پاؤچز۔ منفرد شکلیں جو ریٹیل شیلف پر نمایاں ہوں۔ چین فیکٹری سے براہ راست۔', metaDesc: 'نمایاں برانڈ پیکیجنگ کے لیے تخلیقی ڈائی کٹ ڈیزائن والے حسب ضرورت شیپڈ پاؤچز۔ فوڈ گریڈ میٹریلز، حسب ضرورت شکل اور سائز۔ MOQ 30,000 پیسز۔' },
  },
  'retort-pouch': {
    en: { name: 'Custom Retort Pouches for Ready Meals and Sauce', h1: 'Custom Retort Pouches for Ready Meals, Sauce and Pet Food', desc: 'Custom printed retort pouches for high-temperature sterilization (121°C–135°C). High-barrier laminated materials with aluminum foil and CPP sealing layer. Suitable for ready meals, sauces, soup, meat, seafood, pet food and shelf-stable products. Direct from ISO22000 certified factory.', metaDesc: 'Custom retort pouches for ready meals, sauce, soup and pet food packaging. Heat-resistant laminated structures for 121°C/135°C sterilization, strong sealing and shelf-stable food packaging from Huasheng Packaging.' },
    zh: { name: '高温蒸煮袋', h1: '定制印刷高温蒸煮袋，适用于即食餐、酱料和宠物食品包装', desc: '定制印刷高温蒸煮袋，适用于高温杀菌处理（121°C–135°C）。高阻隔复合材料，配备铝箔和CPP热封层。适用于即食餐、酱料、汤品、肉类、海鲜、宠物食品和常温储存产品。ISO22000认证工厂。', metaDesc: '定制印刷高温蒸煮袋，适用于即食餐、酱料、汤品和宠物食品包装。耐热复合结构，121°C–135°C杀菌。高溫蒸煮袋、即食食品包裝袋、醬料包裝袋，支持B2B定制。华胜包装工厂直供。' },
    ru: { name: 'Реторт-пакет', h1: 'Реторт-пакеты на заказ', desc: 'Термостойкие пакеты для реторт-стерилизации. Подходят для готовых блюд, кормов и продуктов длительного хранения. Производство Китай.', metaDesc: 'Реторт-пакеты на заказ для готовых блюд, кормов и продуктов длительного хранения. Термостойкие, барьер из алюминиевой фольги. MOQ 30 000.' },
    ur: { name: 'ریٹارٹ پاؤچ', h1: 'حسب ضرورت ریٹارٹ پاؤچز', desc: 'ریٹارٹ سٹیریلائزیشن کے لیے ہائی ٹمپریچر مزاحم پاؤچز۔ تیار کھانے، پیٹ فوڈ اور شیلف سٹیبل مصنوعات کے لیے موزوں۔ چین فیکٹری سے براہ راست۔', metaDesc: 'تیار کھانے، پیٹ فوڈ اور شیلف سٹیبل مصنوعات کے لیے حسب ضرورت ریٹارٹ پاؤچز۔ ہائی ٹمپریچر مزاحم، ایلومینیم فوائل بیریئر۔ MOQ 30,000 پیسز۔' },
    hi: { name: 'रिटॉर्ट पाउच', metaDesc: 'रेडी मील, सॉस, सूप और पालतू भोजन के लिए कस्टम रीटॉर्ट पाउच। 121°C–135°C स्टरलाइज़ेशन के लिए हीट-रेसिस्टेंट लैमिनेटेड संरचनाएं और मजबूत सीलिंग। Huasheng Packaging से सीधी आपूर्ति।' },
    th: { name: 'ถุงรีทอร์ท', metaDesc: 'ซองรีทอร์ตสั่งทำพิเศษสำหรับอาหารพร้อมทาน ซอส ซุป และอาหารสัตว์เลี้ยง โครงสร้างลามิเนตทนความร้อนสำหรับการฆ่าเชื้อที่ 121°C–135°C พร้อมซีลแข็งแรง จัดส่งตรงจาก Huasheng Packaging' },
    ko: { name: '레토르트 파우치', metaDesc: '즉석식품, 소스, 수프, 펫푸드를 위한 맞춤형 레토르트 파우치. 121°C–135°C 살균을 위한 내열 라미네이트 구조와 강력한 실링. Huasheng Packaging 직송.' },
    ja: { name: 'レトルトパウチ', metaDesc: 'レトルトパウチのカスタム印刷。即席食品、ソース、スープ、ペットフード向け。121°C～135°Cの高温殺菌に対応する耐熱ラミネート構造と強力シール。Huasheng Packagingから直送。' },
    tr: { name: 'Retort Poşet', metaDesc: 'Hazır yemekler, soslar, çorbalar ve evcil hayvan maması için özel retort poşetler. 121°C–135°C sterilizasyon için ısıya dayanıklı lamine yapılar ve güçlü sızdırmazlık. Huasheng Packaging tarafından doğrudan tedarik.' },
    id: { name: 'Kantong Retort', metaDesc: 'Kantong retort khusus untuk makanan siap saji, saus, sup, dan makanan hewan. Struktur laminasi tahan panas untuk sterilisasi 121°C–135°C dengan penyegelan kuat. Pasokan langsung dari Huasheng Packaging.' },
    vi: { name: 'Túi Retort', metaDesc: 'Túi retort tùy chỉnh cho bữa ăn sẵn, nước sốt, súp và thức ăn thú cưng. Cấu trúc cán màng chịu nhiệt cho tiệt trùng 121°C–135°C với độ kín mạnh. Cung cấp trực tiếp từ Huasheng Packaging.' },
    de: { name: 'Retortenbeutel', metaDesc: 'Maßgefertigte Retortenbeutel für Fertiggerichte, Soßen, Suppen und Tiernahrung. Hitzebeständige Laminatstrukturen für Sterilisation bei 121°C–135°C mit starker Versiegelung. Direkt von Huasheng Packaging.' },
    pt: { name: 'Bolsa Retort', metaDesc: 'Bolsas retort personalizadas para refeições prontas, molhos, sopas e alimentos para animais. Estruturas laminadas resistentes ao calor para esterilização a 121°C–135°C com vedação forte. Fornecimento direto da Huasheng Packaging.' },
    fr: { name: 'Poche Retort', metaDesc: 'Sachets retort personnalisés pour plats préparés, sauces, soupes et aliments pour animaux. Structures laminées résistantes à la chaleur pour stérilisation 121°C–135°C avec scellage renforcé. Direct usine Huasheng Packaging.' },
    es: { name: 'Bolsa Retort', metaDesc: 'Bolsas retort personalizadas para comidas preparadas, salsas, sopas y alimentos para mascotas. Estructuras laminadas resistentes al calor para esterilización a 121°C–135°C con sellado fuerte. Suministro directo de Huasheng Packaging.' },
    ar: { name: 'كيس ريتورت', metaDesc: 'أكياس ريتورت مخصصة للوجبات الجاهزة والصلصات والحساء وأغذية الحيوانات الأليفة. هياكل مغلفة مقاومة للحرارة لتعقيم 121°م–135°م مع ختم قوي. إمداد مباشر من مصنع Huasheng Packaging.' },
  },
  'jelly-lidding': {
    en: { name: 'Easy Peel Lidding Film', h1: 'Custom Easy-Peel Lidding Film for Cup Sealing', desc: 'Custom easy peel lidding film for jelly cups, pudding, yogurt and dairy cup packaging. Consistent peel strength (4-12 N/15mm), customizable seal layer for PP/PS/PET cups, food-grade materials and 9-color gravure printing. Direct from ISO22000 certified factory.', metaDesc: 'Custom easy-peel lidding film for jelly cups, pudding, yogurt and dairy cup packaging. Consistent peel strength, food-grade materials, custom printing. Factory direct from Huasheng Packaging.' },
    zh: { name: '果冻盖膜', h1: '定制易揭盖膜', desc: '易揭密封膜，适用于果冻杯、布丁和乳制品包装。稳定的揭膜力度和可靠的密封性。中国工厂直供。', metaDesc: '定制易揭盖膜，适用于果冻杯、布丁、酸奶和杯封包装。食品级材料，揭膜力度稳定。起订量100公斤。' },
    ru: { name: 'Укупорочная пленка', h1: 'Укупорочная пленка легкого вскрытия на заказ', desc: 'Легко открываемая укупорочная пленка для стаканчиков с желе, пудингов и молочной упаковки. Стабильное усилие открывания. Производство Китай.', metaDesc: 'Укупорочная пленка легкого вскрытия для желе, пудингов, йогуртов. Пищевые материалы, стабильное усилие открывания. MOQ 100 кг.' },
    ur: { name: 'جیلی لڈنگ فلم', h1: 'حسب ضرورت ایزی پیل لڈنگ فلم', desc: 'جیلی کپ، پڈنگ اور ڈیری پیکیجنگ کے لیے آسان کھلنے والی سیلنگ فلم۔ مستقل پیل طاقت اور قابل اعتماد سیلنگ۔ چین فیکٹری سے براہ راست۔', metaDesc: 'جیلی کپ، پڈنگ، دہی اور کپ سیل پیکیجنگ کے لیے حسب ضرورت ایزی پیل لڈنگ فلم۔ فوڈ گریڈ، مستقل پیل طاقت۔ MOQ 100 کلو۔' },
  },
  'anti-static-bag': {
    en: { name: 'Anti-Static Bag', h1: 'Custom Anti-Static Packaging Bags', desc: 'ESD-safe packaging for electronic components and sensitive devices. Static dissipative and shielding options. Direct from China factory.', metaDesc: 'Custom anti-static bags for electronic components, PCB and ESD-sensitive products. Static dissipative and conductive film options. MOQ 10,000 pcs.' },
    zh: { name: '防静电袋', h1: '定制防静电包装袋', desc: '防静电安全包装，适用于电子元件和敏感器件。静电耗散和屏蔽选项。中国工厂直供。', metaDesc: '定制防静电袋，适用于电子元件、PCB和ESD敏感产品。静电耗散和导电膜选项。起订量10,000个。' },
    ru: { name: 'Антистатический пакет', h1: 'Антистатические упаковочные пакеты на заказ', desc: 'ESD-безопасная упаковка для электронных компонентов и чувствительных устройств. Антистатические и экранирующие опции. Производство Китай.', metaDesc: 'Антистатические пакеты для электронных компонентов, печатных плат и ESD-чувствительных изделий. Антистатические и токопроводящие пленки. MOQ 10 000.' },
    ur: { name: 'اینٹی سٹیٹک بیگ', h1: 'حسب ضرورت اینٹی سٹیٹک پیکیجنگ بیگز', desc: 'الیکٹرانک کمپوننٹس اور حساس آلات کے لیے ESD-محفوظ پیکیجنگ۔ سٹیٹک ڈسپیشن اور شیلڈنگ آپشنز۔ چین فیکٹری سے براہ راست۔', metaDesc: 'الیکٹرانک کمپوننٹس، PCB اور ESD-حساس مصنوعات کے لیے حسب ضرورت اینٹی سٹیٹک بیگز۔ سٹیٹک ڈسپیشن اور کنڈکٹیو فلم آپشنز۔ MOQ 10,000 پیسز۔' },
  },
  'kraft-paper-bag': {
    en: { name: 'Custom Kraft Paper Bags for Food and Coffee', h1: 'Custom Kraft Paper Packaging Bags for Food, Coffee and Snack Brands', desc: 'Custom printed kraft paper packaging bags with laminated structures such as Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE for food, coffee, snacks, nuts and dry products. These are laminated flexible packaging bags with kraft paper appearance and inner sealing/barrier layers, not simple single-layer paper shopping bags. Zipper, valve, window and stand up/flat bottom pouch options from ISO22000 certified factory.', metaDesc: 'Custom printed kraft paper packaging bags with laminated structures such as Kraft/PE, Kraft/VMPET/PE and Kraft/AL/PE for food, coffee, snacks, nuts and dry products. Zipper, valve, window and stand up pouch options from Huasheng Packaging.' },
    zh: { name: '牛皮纸复合包装袋', h1: '定制印刷牛皮纸包装袋，适用于食品、咖啡和零食品牌', desc: '定制印刷牛皮纸复合包装袋，采用Kraft/PE、Kraft/VMPET/PE、Kraft/AL/PE等复合结构。适用于食品、咖啡、零食、坚果和干货产品。这是带有内层热封和阻隔结构的复合软包装，不是普通单层购物纸袋。支持拉链、气阀、开窗、自立袋/平底袋等选项。ISO22000认证工厂。', metaDesc: '定制印刷牛皮纸复合包装袋，Kraft/PE、Kraft/VMPET/PE、Kraft/AL/PE结构，适用于食品、咖啡、零食、坚果和干货产品。支持拉链、气阀、开窗和自立袋选项。华胜包装工厂直供。' },
    ru: { name: 'Крафт пакет с ламинацией', h1: 'Крафт пакеты с ламинацией на заказ для продуктов питания', desc: 'Крафт пакеты с ламинацией на заказ: структуры Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Это ламинированная гибкая упаковка с внутренним барьерным слоем, а не простые однослойные бумажные пакеты. Опции: зиппер, клапан, окно, дой-пак / плоское дно.', metaDesc: 'Крафт пакеты с ламинацией Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE для продуктов питания, кофе и снеков. Опции зиппера, клапана, окна. Производство Huasheng Packaging.' },
    ur: { name: 'کرافٹ پیپر پیکیجنگ بیگ', h1: 'حسب ضرورت کرافٹ پیپر پیکیجنگ بیگز برائے خوراک، کافی اور اسنیکس', desc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE جیسی لیمینیٹڈ ساخت کے ساتھ حسب ضرورت پرنٹ شدہ کرافٹ پیپر پیکیجنگ بیگز۔ یہ اندرونی سیلنگ/بیریئر تہوں والے لیمینیٹڈ لچکدار پیکیجنگ بیگز ہیں، سادہ سنگل لیئر شاپنگ پیپر بیگز نہیں۔', metaDesc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE ڈھانچوں کے ساتھ حسب ضرورت پرنٹ شدہ کرافٹ پیپر پیکیجنگ بیگز۔ زپر، والو، ونڈو اور سٹینڈ اپ پاؤچ آپشنز کے ساتھ Huasheng Packaging سے۔' },
    ar: { name: 'كيس ورق كرافت', h1: 'أكياس ورق كرافت مخصصة لتغليف المواد الغذائية والقهوة', desc: 'أكياس ورق كرافت مخصصة بهياكل Kraft/PE و Kraft/VMPET/PE و Kraft/AL/PE. هذه أكياس تغليف مرنة مصفحة بطبقات داخلية مانعة للتسرب، وليست أكياس ورقية بسيطة أحادية الطبقة.', metaDesc: 'أكياس ورق كرافت مخصصة بهياكل Kraft/PE و Kraft/VMPET/PE و Kraft/AL/PE للمواد الغذائية والقهوة. خيارات سحاب وصمام ونافذة من Huasheng Packaging.' },
    es: { name: 'Bolsa de Papel Kraft', h1: 'Bolsas de Papel Kraft Personalizadas para Alimentos, Café y Snacks', desc: 'Bolsas de papel kraft personalizadas con estructuras laminadas Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Son bolsas flexibles laminadas con capa interior de sellado, no simples bolsas de papel de una sola capa.', metaDesc: 'Bolsas de papel kraft personalizadas con estructuras Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE para alimentos, café y snacks. Opciones de cierre, válvula y ventana de Huasheng Packaging.' },
    fr: { name: 'Sac en Papier Kraft', h1: 'Sacs en Papier Kraft Personnalisés pour Alimentation, Café et Snacks', desc: "Sacs en papier kraft personnalisés avec structures laminées Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Ce sont des emballages souples laminés avec couche intérieure de scellage, pas de simples sacs en papier monocouche.", metaDesc: "Sacs en papier kraft personnalisés avec structures Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Options zipper, valve et fenêtre de Huasheng Packaging." },
    pt: { name: 'Saco de Papel Kraft', h1: 'Sacos de Papel Kraft Personalizados para Alimentos, Café e Snacks', desc: 'Sacos de papel kraft personalizados com estruturas laminadas Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. São embalagens flexíveis laminadas com camada interna de selagem.', metaDesc: 'Sacos de papel kraft personalizados com estruturas Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Opções de zíper, válvula e janela da Huasheng Packaging.' },
    de: { name: 'Kraftpapierbeutel', h1: 'Kraftpapierbeutel nach Maß für Lebensmittel, Kaffee und Snacks', desc: 'Kraftpapierbeutel nach Maß mit laminierten Strukturen Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Dies sind laminierte flexible Verpackungen mit innerer Siegelschicht, keine einfachen einlagigen Papiertüten.', metaDesc: 'Kraftpapierbeutel nach Maß mit Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE Strukturen. Zipper-, Ventil- und Fensteroptionen von Huasheng Packaging.' },
    vi: { name: 'Túi Giấy Kraft', h1: 'Túi Giấy Kraft Tùy Chỉnh cho Thực Phẩm, Cà Phê và Snack', desc: 'Túi giấy kraft tùy chỉnh với cấu trúc cán mỏng Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Đây là bao bì mềm nhiều lớp với lớp hàn trong, không phải túi giấy đơn lớp.', metaDesc: 'Túi giấy kraft tùy chỉnh với cấu trúc Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Tùy chọn khóa kéo, van và cửa sổ từ Huasheng Packaging.' },
    id: { name: 'Kantong Kertas Kraft', h1: 'Kantong Kertas Kraft Kustom untuk Makanan, Kopi dan Snack', desc: 'Kantong kertas kraft kustom dengan struktur laminasi Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Ini adalah kemasan fleksibel berlaminasi dengan lapisan segel dalam, bukan kantong kertas satu lapis sederhana.', metaDesc: 'Kantong kertas kraft kustom dengan struktur Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE. Opsi zipper, katup dan jendela dari Huasheng Packaging.' },
    tr: { name: 'Kraft Kağıt Poşet', h1: 'Gıda, Kahve ve Atıştırmalıklar için Özel Kraft Kağıt Poşetler', desc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE laminasyonlu yapılara sahip özel kraft kağıt poşetler. Bunlar, iç sızdırmazlık katmanına sahip lamine esnek ambalajlardır, basit tek katmanlı kağıt torbalar değildir.', metaDesc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE yapılara sahip özel kraft kağıt poşetler. Huasheng Packaging\'den zipper, valf ve pencere seçenekleri.' },
    ja: { name: 'クラフト紙包装袋', h1: '食品・コーヒー・スナック向けカスタムクラフト紙包装袋', desc: 'Kraft/PE、Kraft/VMPET/PE、Kraft/AL/PEなどのラミネート構造を持つカスタムクラフト紙包装袋です。これは内側にシーリング/バリア層を持つラミネート軟包装であり、単純な単層紙袋ではありません。', metaDesc: 'Kraft/PE、Kraft/VMPET/PE、Kraft/AL/PE構造のカスタムクラフト紙包装袋。ジッパー、バルブ、窓付きオプション。Huasheng Packaging。' },
    ko: { name: '크래프트 종이 포장백', h1: '식품·커피·스낵용 맞춤 크래프트 종이 포장백', desc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE 라미네이트 구조의 맞춤 크래프트 종이 포장백입니다. 내부 실링/배리어 층이 있는 라미네이트 연포장으로, 단순한 단층 종이 봉투가 아닙니다.', metaDesc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE 구조의 맞춤 크래프트 종이 포장백. 지퍼, 밸브, 창 옵션. Huasheng Packaging.' },
    th: { name: 'ถุงกระดาษคราฟท์', h1: 'ถุงกระดาษคราฟท์แบบกำหนดเองสำหรับอาหาร กาแฟ และขนมขบเคี้ยว', desc: 'ถุงกระดาษคราฟท์แบบกำหนดเองพร้อมโครงสร้างลามิเนต Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE นี่คือบรรจุภัณฑ์อ่อนแบบลามิเนตที่มีชั้นซีลด้านใน ไม่ใช่ถุงกระดาษชั้นเดียวธรรมดา', metaDesc: 'ถุงกระดาษคราฟท์แบบกำหนดเองพร้อมโครงสร้าง Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE ตัวเลือกซิป วาล์ว และหน้าต่างจาก Huasheng Packaging' },
    hi: { name: 'क्राफ्ट पेपर पैकेजिंग बैग', h1: 'खाद्य, कॉफी और स्नैक्स के लिए कस्टम क्राफ्ट पेपर पैकेजिंग बैग', desc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE जैसी लैमिनेटेड संरचनाओं वाले कस्टम क्राफ्ट पेपर पैकेजिंग बैग। ये आंतरिक सीलिंग/बैरियर परतों वाले लैमिनेटेड लचीले पैकेजिंग बैग हैं, साधारण सिंगल-लेयर पेपर शॉपिंग बैग नहीं।', metaDesc: 'Kraft/PE, Kraft/VMPET/PE, Kraft/AL/PE संरचनाओं वाले कस्टम क्राफ्ट पेपर पैकेजिंग बैग। Huasheng Packaging से ज़िपर, वाल्व और विंडो विकल्प।' },
  },
  'side-gusset-bag': {
    en: { name: 'Custom Side Gusset Bags for Coffee and Bulk Food', h1: 'Custom Side Gusset Bags for Coffee, Tea and Bulk Food Packaging', desc: 'Custom printed side gusset bags with expandable sides for coffee, tea, snacks, powder and bulk dry food. Large capacity with flat bottom stability and resealable zipper options.', metaDesc: 'Custom side gusset bags for coffee, tea, snacks, powder and bulk dry food packaging. Huasheng Packaging supports laminated structures, zipper options and B2B factory-direct production.' },
    hi: { name: 'कॉफी के लिए कस्टम साइड गसेट बैग', metaDesc: 'कॉफी, चाय, स्नैक्स, पाउडर और बल्क सूखे खाद्य पदार्थों के लिए कस्टम मुद्रित साइड गसेट बैग। Huasheng Packaging B2B फैक्ट्री डायरेक्ट उत्पादन प्रदान करता है।' },
    th: { name: 'ถุงข้างสามมิติสั่งทำสำหรับกาแฟ', metaDesc: 'ถุงพิมพ์ลายตามสั่งพร้อมข้างสามมิติสำหรับกาแฟ ชา ขนมขบเคี้ยว ผง และอาหารแห้งปริมาณมาก Huasheng Packaging ให้บริการผลิต B2B โดยตรงจากโรงงาน' },
    ko: { name: '커피용 맞춤형 사이드 거싯 백', metaDesc: '커피, 차, 스낵, 분말, 벌크 건조 식품을 위한 맞춤 인쇄 사이드 거싯 백. Huasheng Packaging이 B2B 공장 직송으로 제공합니다.' },
    ja: { name: 'コーヒー用カスタムサイドガセット袋', metaDesc: 'コーヒー、茶、スナック、粉末、バルクドライフード向けのカスタム印刷サイドガセット袋。Huasheng PackagingがB2B工場直送で提供します。' },
    tr: { name: 'Kahve için Yan Körüklü Poşetler', metaDesc: 'Kahve, çay, atıştırmalık, toz ve dökme kuru gıda için özel baskılı yan körüklü poşetler. Huasheng Packaging B2B fabrika direkt üretim sunar.' },
    id: { name: 'Kantong Gusset Samping Kustom untuk Kopi', metaDesc: 'Kantong cetak khusus dengan gusset samping untuk kopi, teh, camilan, bubuk, dan makanan kering curah. Huasheng Packaging menyediakan produksi langsung pabrik B2B.' },
    vi: { name: 'Túi Gấp Bên Tùy Chỉnh cho Cà Phê', metaDesc: 'Túi in tùy chỉnh có gấp bên cho cà phê, trà, đồ ăn nhẹ, bột và thực phẩm khô số lượng lớn. Huasheng Packaging cung cấp sản xuất B2B trực tiếp từ nhà máy.' },
    de: { name: 'Seitenfaltenbeutel nach Maß für Kaffee', metaDesc: 'Maßgefertigte Seitenfaltenbeutel für Kaffee, Tee, Snacks, Pulver und Trockenprodukte. Huasheng Packaging bietet B2B-Direktproduktion ab Werk.' },
    pt: { name: 'Bolsas com Fole Lateral Personalizadas para Café', metaDesc: 'Sacos impressos personalizados com laterais sanfonadas para café, chá, snacks, pó e alimentos secos a granel. Huasheng Packaging oferece produção B2B direta de fábrica.' },
    fr: { name: 'Sachets à Soufflet Latéral Personnalisés pour Café', metaDesc: 'Sachets à soufflet latéral imprimés sur mesure pour café, thé, snacks, poudre et aliments secs en vrac. Huasheng Packaging propose une production B2B directe d\'usine.' },
    es: { name: 'Bolsas con Fuelle Lateral Personalizadas para Café', metaDesc: 'Bolsas impresas personalizadas con fuelle lateral para café, té, snacks, polvos y alimentos secos a granel. Huasheng Packaging ofrece producción B2B directa de fábrica.' },
    ar: { name: 'أكياس جانبية مخصصة للقهوة والأغذية السائبة', metaDesc: 'أكياس جانبية مطبوعة حسب الطلب للقهوة والشاي والوجبات الخفيفة والمسحوق والأغذية الجافة السائبة. هياكل مغلفة وخيارات سحاب وإمداد مباشر من مصنع Huasheng Packaging.' },
    zh: { name: '侧插角袋', h1: '定制侧插角袋', desc: '可扩展侧插角袋，适用于大容量包装。平底稳定性，大容量设计。中国工厂直供。', metaDesc: '定制侧插角袋，适用于大包装食品、咖啡和宠物食品。可扩展设计，平底稳定性。起订量15,000个。' },
    ru: { name: 'Пакет с боковыми складками', h1: 'Пакеты с боковыми складками на заказ', desc: 'Расширяемые пакеты с боковыми складками для оптовой упаковки. Большая вместимость с устойчивым дном. Производство Китай.', metaDesc: 'Пакеты с боковыми складками для оптовой упаковки продуктов, кофе и кормов. Расширяемая конструкция, устойчивое дно. MOQ 15 000.' },
    ur: { name: 'سائیڈ گسیٹ بیگ', h1: 'حسب ضرورت سائیڈ گسیٹ بیگز', desc: 'بلک پیکیجنگ کے لیے قابل توسیع سائیڈ گسیٹ پاؤچز۔ فلیٹ باٹم استحکام کے ساتھ بڑی صلاحیت۔ چین فیکٹری سے براہ راست۔', metaDesc: 'بلک فوڈ، کافی اور پیٹ فوڈ کے لیے حسب ضرورت سائیڈ گسیٹ بیگز۔ قابل توسیع ڈیزائن، فلیٹ باٹم استحکام۔ MOQ 15,000 پیسز۔' },
  },
  'snack-packaging-roll-film': {
    en: { name: 'Snack Packaging Roll Film', h1: 'Custom Snack Packaging Roll Film', desc: 'Printed roll film for snack packaging machines. Moisture barrier, crispness retention, vibrant print. Direct from China factory.', metaDesc: 'Custom snack packaging roll film for chips, puffed snacks and automatic VFFS machines. BOPP/CPP or PET/VMPET/PE structures. MOQ 200 kg.' },
    zh: { name: '零食包装卷膜', h1: '定制零食包装卷膜', desc: '适用于零食包装机的印刷卷膜。防潮阻隔，保持酥脆口感，鲜艳印刷。中国工厂直供。', metaDesc: '定制零食包装卷膜，适用于薯片、膨化食品和自动VFFS包装机。BOPP/CPP或PET/VMPET/PE结构。起订量200公斤。' },
    ru: { name: 'Пленка для упаковки снеков', h1: 'Пленка для упаковки снеков на заказ', desc: 'Печатная рулонная пленка для упаковки снеков. Влагозащита, сохранение хрустящих свойств, яркая печать. Производство Китай.', metaDesc: 'Пленка для упаковки чипсов, снеков и автоматов VFFS. Структуры BOPP/CPP или PET/VMPET/PE. MOQ 200 кг.' },
    ur: { name: 'اسنیک پیکیجنگ رول فلم', h1: 'حسب ضرورت اسنیک پیکیجنگ رول فلم', desc: 'اسنیک پیکیجنگ مشینوں کے لیے پرنٹ شدہ رول فلم۔ نمی بیریئر، کرسپنیس برقرار رکھنا، شاندار پرنٹ۔ چین فیکٹری سے براہ راست۔', metaDesc: 'چپس، پفڈ اسنیکس اور خودکار VFFS مشینوں کے لیے حسب ضرورت اسنیک پیکیجنگ رول فلم۔ BOPP/CPP یا PET/VMPET/PE ڈھانچے۔ MOQ 200 کلو۔' },
  },
  'bread-packaging-bags': {
    en: { name: 'Bread Packaging Bags', h1: 'Custom Bread Packaging Bags', desc: 'Food-grade bread bags with optional transparent window. Suitable for toast, bread and bakery products. Direct from China factory.', metaDesc: 'Custom bread packaging bags for toast, bread and bakery products. Food-grade materials, optional window, custom printing. MOQ 10,000 pcs.' },
    zh: { name: '面包包装袋', h1: '定制面包包装袋', desc: '食品级面包袋，可选透明视窗设计。适用于吐司、面包和烘焙产品。中国工厂直供。', metaDesc: '定制面包包装袋，适用于吐司、面包和烘焙产品。食品级材料，可选视窗设计，定制印刷。起订量10,000个。' },
    ru: { name: 'Хлебные пакеты', h1: 'Хлебные пакеты на заказ', desc: 'Пищевые хлебные пакеты с опциональным прозрачным окном. Подходят для тостов, хлеба и выпечки. Производство Китай.', metaDesc: 'Хлебные пакеты на заказ для тостов, хлеба и выпечки. Пищевые материалы, опциональное окно, печать. MOQ 10 000.' },
    ur: { name: 'بریڈ پیکیجنگ بیگز', h1: 'حسب ضرورت بریڈ پیکیجنگ بیگز', desc: 'اختیاری شفاف ونڈو کے ساتھ فوڈ گریڈ بریڈ بیگز۔ ٹوسٹ، بریڈ اور بیکری مصنوعات کے لیے موزوں۔ چین فیکٹری سے براہ راست۔', metaDesc: 'ٹوسٹ، بریڈ اور بیکری مصنوعات کے لیے حسب ضرورت بریڈ پیکیجنگ بیگز۔ فوڈ گریڈ میٹریلز، اختیاری ونڈو، حسب ضرورت پرنٹنگ۔ MOQ 10,000 پیسز۔' },
  },
  'candy-packaging-film': {
    en: { name: 'Candy Packaging Film', h1: 'Custom Candy Packaging Film', desc: 'Printed roll film for candy flow pack machines. Cold seal and heat seal options with accurate eye mark. Direct from China factory.', metaDesc: 'Custom candy packaging film for flow pack and twist wrap machines. BOPP/CPP laminated film, cold seal options. MOQ 200 kg.' },
    zh: { name: '糖果包装膜', h1: '定制糖果包装膜', desc: '适用于糖果枕式包装机的印刷卷膜。冷封和热封选项，精准光标定位。中国工厂直供。', metaDesc: '定制糖果包装膜，适用于枕式包装机和扭结包装机。BOPP/CPP复合膜，冷封选项。起订量200公斤。' },
    ru: { name: 'Пленка для упаковки конфет', h1: 'Пленка для упаковки конфет на заказ', desc: 'Печатная пленка для машин flow pack. Опции холодной и горячей герметизации. Производство Китай.', metaDesc: 'Пленка для упаковки конфет для машин flow pack и twist wrap. Ламинат BOPP/CPP, опции холодной герметизации. MOQ 200 кг.' },
    ur: { name: 'کینڈی پیکیجنگ فلم', h1: 'حسب ضرورت کینڈی پیکیجنگ فلم', desc: 'کینڈی فلو پیک مشینوں کے لیے پرنٹ شدہ رول فلم۔ درست آئی مارک کے ساتھ کولڈ سیل اور ہیٹ سیل آپشنز۔ چین فیکٹری سے براہ راست۔', metaDesc: 'فلو پیک اور ٹوئسٹ ریپ مشینوں کے لیے حسب ضرورت کینڈی پیکیجنگ فلم۔ BOPP/CPP لیمینیٹڈ فلم، کولڈ سیل آپشنز۔ MOQ 200 کلو۔' },
  },
  'biscuit-packaging-film': {
    en: { name: 'Biscuit Packaging Film', h1: 'Custom Biscuit Packaging Film', desc: 'Printed roll film for biscuit and cookie packaging lines. Moisture barrier with stable heat sealing. Direct from China factory.', metaDesc: 'Custom biscuit packaging film for horizontal flow pack machines. PET/PE or BOPP/CPP laminated structures. MOQ 200 kg.' },
    zh: { name: '饼干包装膜', h1: '定制饼干包装膜', desc: '适用于饼干和曲奇包装线的印刷卷膜。防潮阻隔，热封稳定。中国工厂直供。', metaDesc: '定制饼干包装膜，适用于卧式枕式包装机。PET/PE或BOPP/CPP复合结构。起订量200公斤。' },
    ru: { name: 'Пленка для упаковки печенья', h1: 'Пленка для упаковки печенья на заказ', desc: 'Печатная пленка для линий упаковки печенья. Влагозащита со стабильной термосваркой. Производство Китай.', metaDesc: 'Пленка для упаковки печенья для горизонтальных машин flow pack. Ламинаты PET/PE или BOPP/CPP. MOQ 200 кг.' },
    ur: { name: 'بسکٹ پیکیجنگ فلم', h1: 'حسب ضرورت بسکٹ پیکیجنگ فلم', desc: 'بسکٹ اور کوکی پیکیجنگ لائنوں کے لیے پرنٹ شدہ رول فلم۔ مستحکم ہیٹ سیلنگ کے ساتھ نمی بیریئر۔ چین فیکٹری سے براہ راست۔', metaDesc: 'افقی فلو پیک مشینوں کے لیے حسب ضرورت بسکٹ پیکیجنگ فلم۔ PET/PE یا BOPP/CPP لیمینیٹڈ ڈھانچے۔ MOQ 200 کلو۔' },
  },
  'pet-food-packaging-bags': {
    en: { name: 'Pet Food Packaging Bag', h1: 'Custom Pet Food Packaging Bags for Dry Food and Treats', desc: 'Custom pet food packaging bags for dry dog food, cat food, pet treats and bird seed. Puncture-resistant structures (PET/PE, PET/VMPET/PE, PET/AL/PE, Kraft laminates), resealable zipper options, flat bottom and stand-up styles. Direct from ISO22000 certified factory.', metaDesc: 'Custom pet food packaging bags for dry dog food, cat food, treats and private label brands. Puncture-resistant, high-barrier materials, resealable zipper options. Factory direct from Huasheng Packaging.' },
    zh: { name: '宠物食品包装袋', h1: '定制宠物食品包装袋', desc: '耐用型宠物食品和零食袋。加强封口，防穿刺，高阻隔材料。中国工厂直供。', metaDesc: '定制宠物食品包装袋，适用于干性宠物粮、宠物零食和自有品牌。高阻隔，防穿刺，可选拉链。起订量15,000个。' },
    ru: { name: 'Пакеты для кормов', h1: 'Пакеты для кормов на заказ', desc: 'Прочные пакеты для кормов и лакомств. Усиленная герметизация, защита от проколов, высокобарьерные материалы. Производство Китай.', metaDesc: 'Пакеты для кормов на заказ для сухих кормов, лакомств и собственных брендов. Высокий барьер, защита от проколов, опции зип-лока. MOQ 15 000.' },
    ur: { name: 'پیٹ فوڈ پیکیجنگ بیگز', h1: 'حسب ضرورت پیٹ فوڈ پیکیجنگ بیگز', desc: 'پیٹ فوڈ اور ٹریٹس کے لیے پائیدار پاؤچز۔ مضبوط سیلنگ، پنکچر مزاحمت، ہائی بیریئر میٹریلز۔ چین فیکٹری سے براہ راست۔', metaDesc: 'خشک پیٹ فوڈ، ٹریٹس اور پرائیویٹ لیبل برانڈز کے لیے حسب ضرورت پیٹ فوڈ پیکیجنگ بیگز۔ ہائی بیریئر، پنکچر مزاحم، زپر آپشنز۔ MOQ 15,000 پیسز۔' },
  },
};

// ---- Application SEO metadata (en, zh, ru, ur; other langs fallback to en) ----

export const APP_SEO = {
  'food-snack-packaging': {
    en: { name: 'Food & Snacks', h1: 'Flexible Packaging for Food and Snack Products', painPoints: 'Extending shelf life, print consistency, durable resealable zippers.', metaTitle: 'Food and Snack Packaging Solutions | Flexible Food Packaging | Huasheng Packaging', metaDesc: 'Custom flexible packaging solutions for food and snack products including dry food, snacks, candy, biscuit, roll film, stand up pouches, flat bottom pouches and three side seal sachets. Factory direct from Huasheng Packaging.', shortDescription: 'Custom flexible packaging for food and snack products including roll film, stand up pouches, flat bottom pouches and three side seal sachets from Huasheng Packaging.' },
    zh: { name: '零食与食品', h1: '食品与零食柔性包装解决方案', painPoints: '延长食品保质期、高清晰度色彩呈现、多次开合拉链的耐用性。', metaTitle: '食品与零食包装解决方案 | 柔性食品包装 | 华胜包装', metaDesc: '华胜包装提供食品与零食柔性包装解决方案，覆盖干食品、零食、糖果、饼干、卷膜、自立袋、平底袋和三边封分装袋。工厂直供。', shortDescription: '华胜包装提供食品与零食柔性包装，包括卷膜、自立袋、平底袋和三边封分装袋，适用于多种食品类型。' },
    ru: { name: 'Снеки и пищевые продукты', h1: 'Упаковка для снеков и пищевых продуктов', painPoints: 'Увеличение срока годности, стабильность печати, надежность зип-лока.', metaTitle: 'Упаковка для продуктов питания и снэков | Huasheng Packaging', metaDesc: 'Индивидуальные упаковочные решения для продуктов питания и снэков: рулонная пленка, дой-пак, пакеты с плоским дном и трехшовные саше.', shortDescription: 'Индивидуальная упаковка для продуктов питания и снэков: рулонная пленка, дой-пак, пакеты с плоским дном и трехшовные саше от Huasheng Packaging.' },
    ur: { name: 'فوڈ اور اسنیکس', h1: 'فوڈ اور اسنیکس کے لیے پیکیجنگ', painPoints: 'شیلف لائف میں توسیع، پرنٹ مستقل مزاجی، پائیدار دوبارہ کھلنے والے زپرز۔', metaTitle: 'فوڈ اور اسنیک پیکیجنگ سلوشنز | لچکدار فوڈ پیکیجنگ | Huasheng Packaging', metaDesc: 'خشک خوراک، اسنیکس، کینڈی، بسکٹ، رول فلم، اسٹینڈ اپ پاؤچز، فلیٹ باٹم پاؤچز اور تھری سائیڈ سیل ساشے سمیت فوڈ اور اسنیک مصنوعات کے لیے حسب ضرورت لچکدار پیکیجنگ سلوشنز۔', shortDescription: 'Huasheng Packaging سے فوڈ اور اسنیک مصنوعات کے لیے حسب ضرورت لچکدار پیکیجنگ بشمول رول فلم، اسٹینڈ اپ پاؤچز، فلیٹ باٹم پاؤچز اور تھری سائیڈ سیل ساشے۔' },
  },
  'frozen-food-packaging': {
    en: { name: 'Frozen Food Packaging', h1: 'Frozen Food Packaging Solutions', painPoints: 'Low-temperature resistance, moisture protection, puncture resistance during freezing and transport.', metaTitle: 'Frozen Food Packaging Solutions | Custom Frozen Food Packaging', metaDesc: 'Custom frozen food packaging roll film and pouches for frozen vegetables, meat, seafood and prepared food with strong sealing, moisture barrier and puncture resistance.', shortDescription: 'Custom frozen food packaging roll film and pouches for frozen vegetables, meat, seafood and prepared food with strong sealing and moisture barrier.' },
    zh: { name: '冷冻食品包装', h1: '冷冻食品包装解决方案', painPoints: '耐低温、防潮保护、冷冻和运输过程中的耐穿刺性。', metaTitle: '冷冻食品包装解决方案 | 定制冷冻食品包装', metaDesc: '为冷冻蔬菜、肉类、海鲜和预制食品提供定制冷冻食品包装卷膜和袋子，支持强封口、防潮阻隔和耐穿刺。', shortDescription: '为冷冻蔬菜、肉类、海鲜和预制食品提供定制冷冻食品包装卷膜和袋子，支持强封口和防潮阻隔。' },
    ru: { name: 'Замороженные продукты', h1: 'Упаковка для замороженных продуктов', painPoints: 'Устойчивость к низким температурам, защита от влаги, стойкость к проколам при заморозке и транспортировке.', metaTitle: 'Упаковка для замороженных продуктов | Huasheng Packaging', metaDesc: 'Индивидуальная упаковочная пленка и пакеты для замороженных овощей, мяса, морепродуктов и готовых блюд с прочной герметизацией и влагозащитой.', shortDescription: 'Индивидуальная упаковочная пленка и пакеты для замороженных овощей, мяса, морепродуктов и готовых блюд.' },
    ur: { name: 'منجمد خوراک پیکیجنگ', h1: 'منجمد خوراک پیکیجنگ سلوشنز', painPoints: 'کم درجہ حرارت مزاحمت، نمی تحفظ، منجمد اور نقل و حمل کے دوران پنکچر مزاحمت۔', metaTitle: 'منجمد خوراک پیکیجنگ سلوشنز | حسب ضرورت منجمد خوراک پیکیجنگ', metaDesc: 'منجمد سبزیوں، گوشت، سمندری غذا اور تیار شدہ کھانے کے لیے حسب ضرورت منجمد خوراک پیکیجنگ رول فلم اور پاؤچز مضبوط سیلنگ اور نمی بیریئر کے ساتھ۔', shortDescription: 'منجمد سبزیوں، گوشت، سمندری غذا اور تیار شدہ کھانے کے لیے حسب ضرورت منجمد خوراک پیکیجنگ رول فلم اور پاؤچز۔' },
  },
  'coffee-packaging': {
    en: { name: 'Coffee Packaging', h1: 'Coffee Packaging Solutions for Roasted Coffee Brands', painPoints: 'Aroma retention, CO2 degassing, premium shelf presentation.', metaTitle: 'Coffee Packaging Solutions | Custom Coffee Bags Manufacturer', metaDesc: 'Custom coffee packaging bags with valve, zipper and high-barrier materials for roasted coffee, ground coffee and private label coffee brands.', shortDescription: 'Custom coffee packaging bags with valve, zipper and high-barrier materials for roasted coffee beans, ground coffee and private label coffee brands.' },
    zh: { name: '咖啡包装', h1: '咖啡包装解决方案', painPoints: '香气锁留、单向排气阀、高级货架展示效果。', metaTitle: '咖啡包装解决方案 | 定制咖啡袋制造商', metaDesc: '为烘焙咖啡豆、咖啡粉和自有品牌咖啡提供带气阀、拉链和高阻隔材料结构的定制咖啡包装袋。', shortDescription: '为烘焙咖啡豆、咖啡粉和自有品牌咖啡提供带气阀、拉链和高阻隔材料结构的定制咖啡包装袋。' },
    ru: { name: 'Кофе', h1: 'Упаковка для кофе', painPoints: 'Сохранение аромата, односторонний клапан дегазации, премиальный вид на полке.', metaTitle: 'Упаковка для кофе | Производитель кофейных пакетов', metaDesc: 'Индивидуальные кофейные пакеты с клапаном, зип-замком и высокобарьерными материалами для обжаренного кофе, молотого кофе и собственных брендов.', shortDescription: 'Индивидуальные кофейные пакеты с клапаном, зип-замком и высокобарьерными материалами для обжаренного кофе, молотого кофе и собственных брендов.' },
    ur: { name: 'کافی پیکیجنگ', h1: 'کافی پیکیجنگ سلوشنز', painPoints: 'خوشبو کا تحفظ، یک طرفہ ڈیگاسنگ والو، پریمیم شیلف پریزنٹیشن۔', metaTitle: 'کافی پیکیجنگ سلوشنز | حسب ضرورت کافی بیگز مینوفیکچرر', metaDesc: 'بھنی ہوئی کافی، گراؤنڈ کافی اور پرائیویٹ لیبل کافی برانڈز کے لیے والو، زپر اور ہائی بیریئر میٹیریلز کے ساتھ حسب ضرورت کافی پیکیجنگ بیگز۔', shortDescription: 'بھنی ہوئی کافی بینز، گراؤنڈ کافی اور پرائیویٹ لیبل کافی برانڈز کے لیے والو، زپر اور ہائی بیریئر میٹیریلز کے ساتھ حسب ضرورت کافی پیکیجنگ بیگز۔' },
  },
  'pet-food-packaging': {
    en: { name: 'Pet Food Packaging', h1: 'Pet Food Packaging Solutions', painPoints: 'Heavy weight-bearing capacity, odor control, puncture resistance.', metaTitle: 'Pet Food Packaging Solutions | Custom Pet Food Bags Manufacturer', metaDesc: 'Custom pet food packaging bags with high-barrier materials, zipper options and strong sealing for dry pet food, treats and private label pet brands.', shortDescription: 'Custom pet food packaging bags with high-barrier materials, strong sealing and zipper options for dry pet food, pet treats and private label pet brands.' },
    zh: { name: '宠物食品包装', h1: '宠物食品包装解决方案', painPoints: '大容量承重能力、气味阻隔控制、防穿刺与跌落要求。', metaTitle: '宠物食品包装解决方案 | 定制宠物食品袋制造商', metaDesc: '为宠物粮、宠物零食和自有品牌宠物食品提供高阻隔、强封口和可选拉链结构的定制宠物食品包装袋。', shortDescription: '为宠物粮、宠物零食和自有品牌宠物食品提供高阻隔、强封口和可选拉链结构的定制宠物食品包装袋。' },
    ru: { name: 'Корм для животных', h1: 'Упаковка для корма для животных', painPoints: 'Выдерживание большого веса, контроль запаха, защита от проколов.', metaTitle: 'Упаковка для кормов | Производитель пакетов для кормов', metaDesc: 'Индивидуальные упаковочные пакеты для кормов с высокобарьерными материалами, усиленной герметизацией и опциями зип-замка для сухих кормов, лакомств и собственных брендов.', shortDescription: 'Индивидуальные упаковочные пакеты для кормов с высокобарьерными материалами, усиленной герметизацией и опциями зип-замка.' },
    ur: { name: 'پیٹ فوڈ پیکیجنگ', h1: 'پیٹ فوڈ پیکیجنگ سلوشنز', painPoints: 'بھاری وزن برداشت کرنے کی صلاحیت، بدبو کنٹرول، پنکچر مزاحمت۔', metaTitle: 'پیٹ فوڈ پیکیجنگ سلوشنز | حسب ضرورت پیٹ فوڈ بیگز مینوفیکچرر', metaDesc: 'خشک پیٹ فوڈ، ٹریٹس اور پرائیویٹ لیبل پیٹ برانڈز کے لیے ہائی بیریئر میٹیریلز، زپر آپشنز اور مضبوط سیلنگ کے ساتھ حسب ضرورت پیٹ فوڈ پیکیجنگ بیگز۔', shortDescription: 'خشک پیٹ فوڈ، پیٹ ٹریٹس اور پرائیویٹ لیبل پیٹ برانڈز کے لیے ہائی بیریئر میٹیریلز، مضبوط سیلنگ اور زپر آپشنز کے ساتھ حسب ضرورت پیٹ فوڈ پیکیجنگ بیگز۔' },
  },
  'industrial-agrochemical-packaging': {
    en: { name: 'Industrial & Agrochemical', h1: 'Industrial & Agrochemical Packaging', painPoints: 'Chemical resistance, puncture proofing, strict logistics safety.', metaTitle: 'Industrial & Agrochemical Packaging Solutions | Huasheng Packaging', metaDesc: 'Custom industrial and agrochemical packaging solutions with stand up pouches, spout pouches, three side seal pouches and laminated structures for powder, liquid and refill products.', shortDescription: 'Custom industrial and agrochemical packaging with stand up pouches, spout pouches and laminated film for powder, liquid and refill applications.' },
    zh: { name: '工业与农化产品', h1: '工业与农化产品安全软包装', painPoints: '高化学抗性、极强防穿刺能力、严苛的运输与防漏标准。', metaTitle: '工业与农化包装解决方案 | 华胜包装', metaDesc: '华胜包装提供工业与农化包装解决方案，支持自立袋、吸嘴袋、三边封袋和定制复合结构，用于粉剂、液体和补充装包装需求。', shortDescription: '华胜包装提供工业与农化包装解决方案，支持自立袋、吸嘴袋、三边封袋和定制复合结构。' },
    ru: { name: 'Промышленность и агрохимия', h1: 'Упаковка для промышленности и агрохимии', painPoints: 'Защита от проколов, химическая стойкость, безопасность логистики.' },
    ur: { name: 'صنعتی اور ایگروکیمیکل', h1: 'صنعتی اور ایگروکیمیکل پیکیجنگ', painPoints: 'کیمیکل مزاحمت، پنکچر پروفنگ، سخت لاجسٹکس سیفٹی۔' },
  },
  'electronic-packaging': {
    en: { name: 'Electronics', h1: 'Electronic Components Packaging', painPoints: 'ESD protection, EMI shielding, moisture barrier requirements.', metaTitle: 'Electronic Component Packaging Solutions | Anti-Static Bags | Huasheng Packaging', metaDesc: 'Custom electronic component packaging solutions including anti-static shielding bags, three side seal pouches and laminated structures for PCBs, sensors, connectors and precision parts.', shortDescription: 'Custom electronic packaging solutions with anti-static bags, shielding pouches and laminated film for PCBs and electronic components.' },
    zh: { name: '电子元件', h1: '精密电子元器件防护包装', painPoints: '防静电放电屏蔽、电磁干扰防护、严格的防潮防氧化需求。', metaTitle: '电子元件包装解决方案 | 防静电袋定制 | 华胜包装', metaDesc: '华胜包装提供电子元件包装解决方案，支持防静电屏蔽袋、三边封袋和定制复合结构，用于 PCB、电路板、连接器和精密元件包装。', shortDescription: '华胜包装提供电子元件包装解决方案，支持防静电屏蔽袋、三边封袋和定制复合结构。' },
    ru: { name: 'Электроника', h1: 'Упаковка для электроники и компонентов', painPoints: 'Защита от статики, экранирование, влагозащита.' },
    ur: { name: 'الیکٹرانکس', h1: 'الیکٹرانک کمپوننٹس پیکیجنگ', painPoints: 'ESD تحفظ، EMI شیلڈنگ، نمی بیریئر تقاضے۔' },
  },
  'beverage-packaging': {
    en: { name: 'Beverage & Spout Pouch', h1: 'Beverage and Spout Pouch Packaging Solutions', painPoints: 'Leak-proof liquid containment, flavor preservation, transport pressure resistance.', metaTitle: 'Beverage Spout Pouch Packaging Solutions | Custom Liquid Packaging', metaDesc: 'Custom spout pouches for juice, sauce, puree, jelly and liquid food packaging with leak-resistant spouts and flexible material options.', shortDescription: 'Custom spout pouches for juice, sauce, puree, jelly, liquid food and refill packaging, with leak-resistant spouts and flexible material options.' },
    zh: { name: '饮料与带嘴袋', h1: '饮料与带嘴袋包装解决方案', painPoints: '防漏液密封、风味保鲜、运输过程中的抗压能力。', metaTitle: '饮料带嘴袋包装解决方案 | 定制液体包装', metaDesc: '为果汁、酱料、果泥、果冻和液体食品提供定制吸嘴袋，支持防漏吸嘴和多种复合材料结构。', shortDescription: '为果汁、酱料、果泥、果冻、液体食品和补充装产品提供定制吸嘴袋，支持防漏吸嘴和多种复合材料结构。' },
    ru: { name: 'Напитки', h1: 'Упаковка для напитков и пакеты с носиком', painPoints: 'Защита от протечек, барьер для жидкости, устойчивость к давлению при транспортировке.', metaTitle: 'Упаковка для напитков | Пакеты с носиком на заказ', metaDesc: 'Индивидуальные упаковочные решения для напитков. Пакеты с носиком, дой-пак и пленка в рулонах с защитой от протечек. Для соков, питьевой воды, жидких концентратов.', shortDescription: 'Индивидуальные пакеты с носиком для соков, соусов, пюре, желе и жидких продуктов с защитой от протечек и гибкими вариантами материалов.' },
    ur: { name: 'مشروبات', h1: 'مشروبات اور اسپاؤٹ پاؤچ پیکیجنگ سلوشنز', painPoints: 'لیک پروف مائع کنٹینمنٹ، ذائقے کا تحفظ، ٹرانسپورٹ پریشر مزاحمت۔', metaTitle: 'بیوریج اسپاؤٹ پاؤچ پیکیجنگ سلوشنز | حسب ضرورت مائع پیکیجنگ', metaDesc: 'جوس، ساس، پیوری، جیلی اور مائع فوڈ پیکیجنگ کے لیے حسب ضرورت اسپاؤٹ پاؤچز، لیک مزاحم اسپاؤٹس اور لچکدار میٹیریل آپشنز کے ساتھ۔', shortDescription: 'جوس، ساس، پیوری، جیلی، مائع فوڈ اور ریفل پیکیجنگ کے لیے حسب ضرورت اسپاؤٹ پاؤچز، لیک مزاحم اسپاؤٹس اور لچکدار میٹیریل آپشنز کے ساتھ۔' },
  },
  'daily-chemical-packaging': {
    en: { name: 'Daily Chemical Packaging', h1: 'Daily Chemical Packaging Solutions for Detergent, Shampoo and Refill Products', painPoints: 'Chemical resistance, leak-proof sealing, product formula compatibility review.', metaTitle: 'Daily Chemical Packaging Solutions | Refill Pouches | Huasheng Packaging', metaDesc: 'Custom daily chemical packaging solutions for detergent, shampoo, conditioner and refill products, including spout pouches, stand up pouches and laminated flexible packaging structures.' },
    zh: { name: '日化包装', h1: '洗涤剂、洗护和补充装日化包装解决方案', painPoints: '耐化学腐蚀性、防漏密封、产品配方适配性确认。', metaTitle: '日化包装解决方案 | 补充装吸嘴袋定制 | 华胜包装', metaDesc: '华胜包装提供日化包装解决方案，适用于洗涤剂、洗发水、护发素和补充装产品，支持吸嘴袋、自立袋和定制复合软包装结构。' },
    ru: { name: 'Бытовая химия', h1: 'Упаковка для бытовой химии и косметики', painPoints: 'Химическая стойкость, защита от протечек, соответствие нормам.', metaDesc: 'Индивидуальные упаковочные решения для бытовой химии и косметики. Химически стойкие пакеты с носиком, дой-пак и трехшовные пакеты. Для шампуней, моющих средств, жидкого мыла.' },
    ur: { name: 'روزمرہ کیمیکل اور پرسنل کیئر', h1: 'روزمرہ کیمیکلز اور پرسنل کیئر کے لیے پیکیجنگ', painPoints: 'کیمیکل مزاحمت، لیک پروف سیلنگ، گھریلو اور پرسنل کیئر مصنوعات کے لیے ریگولیٹری تعمیل۔', metaDesc: 'روزمرہ کیمیکلز اور پرسنل کیئر کے لیے حسب ضرورت پیکیجنگ — کیمیکل مزاحم اسپاؤٹ پاؤچز، اسٹینڈ اپ پاؤچز، اور تھری سائیڈ سیل ساشے۔ شیمپو، ڈٹرجنٹس، مائع صابن ریفلز کے لیے۔' },
  },
  'food-packaging': {
    en: { name: 'Food Packaging', h1: 'Flexible Packaging for Food Products', painPoints: 'Shelf life extension, barrier protection, food-grade material safety.' },
    zh: { name: '食品包装', h1: '食品级软包装解决方案', painPoints: '延长保质期、高阻隔保护、食品级材料安全。' },
    ru: { name: 'Пищевая упаковка', h1: 'Упаковка для пищевых продуктов', painPoints: 'Продление срока годности, барьерная защита, безопасность пищевых материалов.' },
    ur: { name: 'فوڈ پیکیجنگ', h1: 'کھانے کی مصنوعات کے لیے لچکدار پیکیجنگ', painPoints: 'شیلف لائف میں توسیع، بیریئر تحفظ، فوڈ گریڈ مواد کی حفاظت۔' },
  },
  'snack-packaging': {
    en: { name: 'Snack Packaging', h1: 'Snack Packaging Solutions for Chips, Nuts and Candy', painPoints: 'Crispness retention, moisture barrier, vibrant print for retail appeal.', metaTitle: 'Snack Packaging Solutions | Custom Snack Packaging Film and Pouches', metaDesc: 'Custom snack packaging roll film and pouches for chips, nuts, candy, biscuits and automatic packing machines.', shortDescription: 'Custom snack packaging roll film and pouches for chips, nuts, candy, biscuits, dried fruit and automatic packing machines.' },
    zh: { name: '零食包装', h1: '零食包装解决方案', painPoints: '脆度保持、防潮隔离、鲜艳印刷吸引零售消费者。', metaTitle: '零食包装解决方案 | 定制零食包装卷膜与包装袋', metaDesc: '为薯片、坚果、糖果、饼干和自动包装机提供定制零食包装卷膜和包装袋。', shortDescription: '为薯片、坚果、糖果、饼干、果干和自动包装机提供定制零食包装卷膜和包装袋。' },
    ru: { name: 'Снэки', h1: 'Упаковка для снэков и сухих продуктов', painPoints: 'Сохранение хрустящих свойств, влагозащита, яркая печать для розницы.', metaTitle: 'Упаковка для снэков | Пленка и пакеты для снэков', metaDesc: 'Индивидуальная упаковочная пленка и пакеты для чипсов, орехов, конфет, печенья и автоматических упаковочных машин.', shortDescription: 'Индивидуальная упаковочная пленка и пакеты для чипсов, орехов, конфет, печенья, сухофруктов и автоматических упаковочных машин.' },
    ur: { name: 'اسنیک پیکیجنگ', h1: 'اسنیک پیکیجنگ سلوشنز', painPoints: 'کرسپنیس برقرار رکھنا، نمی بیریئر، ریٹیل اپیل کے لیے شاندار پرنٹ۔', metaTitle: 'اسنیک پیکیجنگ سلوشنز | حسب ضرورت اسنیک پیکیجنگ فلم اور پاؤچز', metaDesc: 'چپس، گری دار میوے، کینڈی، بسکٹس اور خودکار پیکیجنگ مشینوں کے لیے حسب ضرورت اسنیک پیکیجنگ رول فلم اور پاؤچز۔', shortDescription: 'چپس، گری دار میوے، کینڈی، بسکٹس، خشک میوہ جات اور خودکار پیکیجنگ مشینوں کے لیے حسب ضرورت اسنیک پیکیجنگ رول فلم اور پاؤچز۔' },
  },
  'jelly-packaging': {
    en: { name: 'Jelly & Pudding', h1: 'Flexible Packaging for Jelly & Pudding Products', painPoints: 'Leak-proof sealing, easy peel opening, cold storage durability.' },
    zh: { name: '果冻包装', h1: '果冻与布丁类产品软包装方案', painPoints: '防漏密封、易揭盖设计、冷藏环境耐久性。' },
    ru: { name: 'Желе и пудинги', h1: 'Упаковка для желе и пудингов', painPoints: 'Защита от протечек, легкое открывание, стойкость к низким температурам.' },
    ur: { name: 'جیلی پیکیجنگ', h1: 'جیلی اور پڈنگ مصنوعات کے لیے لچکدار پیکیجنگ', painPoints: 'لیک پروف سیلنگ، آسان اوپننگ، کولڈ اسٹوریج پائیداری۔' },
  },
  'sauce-packaging': {
    en: { name: 'Sauce Packaging', h1: 'Flexible Packaging for Sauces & Liquid Condiments', painPoints: 'Chemical resistance, leak-proof spout sealing, squeeze durability.' },
    zh: { name: '酱料包装', h1: '酱料与液体调味品软包装方案', painPoints: '耐油耐酸化学性、防漏吸嘴密封、挤压耐用性。' },
    ru: { name: 'Соусы', h1: 'Упаковка для соусов и жидких приправ', painPoints: 'Химическая стойкость, защита от протечек, устойчивость к выдавливанию.' },
    ur: { name: 'ساس پیکیجنگ', h1: 'ساسز اور مائع مصالحوں کے لیے لچکدار پیکیجنگ', painPoints: 'کیمیکل مزاحمت، لیک پروف اسپاؤٹ سیلنگ، نچوڑنے کی پائیداری۔' },
  },
  'bakery-packaging': {
    en: { name: 'Bakery & Bread', h1: 'Bakery and Bread Packaging Solutions', painPoints: 'Food-grade safety, good product visibility, attractive printing for retail display.', metaTitle: 'Bakery and Bread Packaging Solutions | Custom Bread Packaging Bags', metaDesc: 'Custom bread and bakery packaging bags for toast, bread, cakes and retail bakery products with food-grade materials, printing and optional window design.', shortDescription: 'Custom bread and bakery packaging bags for toast, bread, cakes and retail bakery products, with food-grade materials, printing and optional window design.' },
    zh: { name: '烘焙与面包', h1: '面包与烘焙食品包装解决方案', painPoints: '食品级安全、产品可视性良好、零售展示吸引力。', metaTitle: '面包与烘焙食品包装解决方案 | 定制面包包装袋', metaDesc: '为吐司、面包、蛋糕和零售烘焙食品提供定制食品级包装袋，支持印刷、复合材料和可选开窗设计。', shortDescription: '为吐司、面包、蛋糕和零售烘焙食品提供定制食品级包装袋，支持印刷、复合材料和可选开窗设计。' },
    ru: { name: 'Выпечка и хлеб', h1: 'Упаковка для выпечки и хлеба', painPoints: 'Пищевая безопасность, хорошая видимость продукта, привлекательная печать для розничной торговли.', metaTitle: 'Упаковка для выпечки и хлеба | Индивидуальные хлебные пакеты', metaDesc: 'Индивидуальные хлебные и хлебобулочные пакеты для тостов, хлеба, тортов и розничных хлебобулочных изделий с пищевыми материалами, печатью и опциональным окном.', shortDescription: 'Индивидуальные хлебные и хлебобулочные пакеты для тостов, хлеба, тортов и розничных хлебобулочных изделий.' },
    ur: { name: 'بیکری اور بریڈ', h1: 'بیکری اور بریڈ پیکیجنگ سلوشنز', painPoints: 'فوڈ گریڈ سیفٹی، اچھی پروڈکٹ ویزیبلٹی، ریٹیل ڈسپلے کے لیے پرکشش پرنٹنگ۔', metaTitle: 'بیکری اور بریڈ پیکیجنگ سلوشنز | حسب ضرورت بریڈ پیکیجنگ بیگز', metaDesc: 'ٹوسٹ، بریڈ، کیکس اور ریٹیل بیکری مصنوعات کے لیے حسب ضرورت بریڈ اور بیکری پیکیجنگ بیگز، فوڈ گریڈ میٹیریلز، پرنٹنگ اور اختیاری ونڈو ڈیزائن کے ساتھ۔', shortDescription: 'ٹوسٹ، بریڈ، کیکس اور ریٹیل بیکری مصنوعات کے لیے حسب ضرورت بریڈ اور بیکری پیکیجنگ بیگز، فوڈ گریڈ میٹیریلز، پرنٹنگ اور اختیاری ونڈو ڈیزائن کے ساتھ۔' },
  },
  'candy-biscuit-packaging': {
    en: { name: 'Candy & Biscuit', h1: 'Candy and Biscuit Packaging Solutions', painPoints: 'Stable film running, accurate eye mark, strong heat sealing for flow pack machines.', metaTitle: 'Candy and Biscuit Packaging Solutions | Custom Packaging Film', metaDesc: 'Custom candy and biscuit packaging film for flow pack machines, automatic packing lines and retail food brands.', shortDescription: 'Custom candy and biscuit packaging film for flow pack machines, automatic packing lines and retail food brands.' },
    zh: { name: '糖果与饼干', h1: '糖果与饼干包装解决方案', painPoints: '稳定走膜、精准光标、可靠热封，适配枕式包装机和自动包装线。', metaTitle: '糖果与饼干包装解决方案 | 定制包装膜', metaDesc: '为糖果、饼干、曲奇和零售食品品牌提供适用于枕式包装机和自动包装线的定制包装膜。', shortDescription: '为糖果、饼干、曲奇和零售食品品牌提供适用于枕式包装机和自动包装线的定制包装膜。' },
    ru: { name: 'Конфеты и печенье', h1: 'Упаковка для конфет и печенья', painPoints: 'Стабильная работа пленки, точная фотометка, прочная термосварка для поточных упаковочных машин.', metaTitle: 'Упаковка для конфет и печенья | Индивидуальная упаковочная пленка', metaDesc: 'Индивидуальная упаковочная пленка для конфет и печенья для машин flow pack, автоматических упаковочных линий и розничных пищевых брендов.', shortDescription: 'Индивидуальная упаковочная пленка для конфет и печенья для машин flow pack, автоматических упаковочных линий и розничных пищевых брендов.' },
    ur: { name: 'کینڈی اور بسکٹ', h1: 'کینڈی اور بسکٹ پیکیجنگ سلوشنز', painPoints: 'مستحکم فلم رننگ، درست آئی مارک، فلو پیک مشینوں کے لیے مضبوط ہیٹ سیلنگ۔', metaTitle: 'کینڈی اور بسکٹ پیکیجنگ سلوشنز | حسب ضرورت پیکیجنگ فلم', metaDesc: 'فلو پیک مشینوں، خودکار پیکیجنگ لائنوں اور ریٹیل فوڈ برانڈز کے لیے حسب ضرورت کینڈی اور بسکٹ پیکیجنگ فلم۔', shortDescription: 'فلو پیک مشینوں، خودکار پیکیجنگ لائنوں اور ریٹیل فوڈ برانڈز کے لیے حسب ضرورت کینڈی اور بسکٹ پیکیجنگ فلم۔' },
  },
};

// ---- Blog SEO metadata (en, zh, ru, ur only) ----

export const BLOG_SEO = {
  'how-to-choose-food-packaging-materials': {
    en: { seoTitle: 'How to Choose Food Packaging Materials | Huasheng Packaging', metaDescription: 'Learn how to choose food packaging materials based on product type, shelf life, barrier needs, sealing method and production requirements.', h1: 'How to Choose Food Packaging Materials for Custom Flexible Packaging', datePublished: '2025-06-15', dateModified: '2026-05-21', image: '/media/blog/how-to-choose-food-packaging-materials-for-custom-flexible-packaging.webp' },
    zh: { seoTitle: '如何选择食品包装材料 | 华胜包装', metaDescription: '了解如何根据产品类型、保质期、阻隔需求、密封方式和生产要求选择食品包装材料。', h1: '如何为定制软包装选择合适的食品包装材料' },
    ru: { seoTitle: 'Как выбрать материалы для пищевой упаковки | Huasheng Packaging', metaDescription: 'Узнайте, как выбрать материалы для пищевой упаковки с учетом типа продукта, срока годности, барьерных свойств, способа герметизации и производственных требований.', h1: 'Как выбрать материалы для пищевой упаковки на заказ' },
    ur: { seoTitle: 'کھانے کی پیکیجنگ کے مواد کا انتخاب کیسے کریں | Huasheng Packaging', metaDescription: 'مصنوعات کی قسم، شیلف لائف، بیریئر ضروریات، سیلنگ کے طریقے اور پیداواری تقاضوں کی بنیاد پر کھانے کی پیکیجنگ کے مواد کا انتخاب سیکھیں۔', h1: 'حسب ضرورت لچکدار پیکیجنگ کے لیے کھانے کی پیکیجنگ کے مواد کا انتخاب کیسے کریں' },
  },
  'stand-up-pouch-vs-flat-bottom-pouch': {
    en: { seoTitle: 'Stand Up Pouch vs Flat Bottom Pouch | Huasheng Packaging', metaDescription: 'Compare stand up pouches and flat bottom pouches for food, coffee, snacks and retail packaging. Learn which pouch type is better for your product.', h1: 'Stand Up Pouch vs Flat Bottom Pouch: Which One Should You Choose?', datePublished: '2025-06-20', dateModified: '2026-05-21', image: '/media/blog/stand-up-pouch-vs-flat-bottom-pouch.webp' },
    zh: { seoTitle: '自立袋 vs 平底袋 | 包装选购指南', metaDescription: '对比自立袋和平底袋在食品、咖啡、零食和零售包装中的应用。了解哪种袋型更适合您的产品。', h1: '自立袋 vs 平底袋：该如何选择？' },
    ru: { seoTitle: 'Дой-пак против пакета с плоским дном | Руководство', metaDescription: 'Сравнение дой-паков и пакетов с плоским дном для продуктов питания, кофе, снеков и розничной упаковки. Узнайте, какой формат лучше для вашего продукта.', h1: 'Дой-пак против пакета с плоским дном: что выбрать?' },
    ur: { seoTitle: 'اسٹینڈ اپ پاؤچ بمقابلہ فلیٹ باٹم پاؤچ | پیکیجنگ گائیڈ', metaDescription: 'خوراک، کافی، اسنیکس اور ریٹیل پیکیجنگ کے لیے اسٹینڈ اپ پاؤچز اور فلیٹ باٹم پاؤچز کا موازنہ کریں۔ جانیں کہ آپ کی مصنوعات کے لیے کون سی قسم بہتر ہے۔', h1: 'اسٹینڈ اپ پاؤچ بمقابلہ فلیٹ باٹم پاؤچ: آپ کو کون سا انتخاب کرنا چاہیے؟' },
  },
  'how-to-prepare-artwork-for-custom-printed-pouches': {
    en: { seoTitle: 'How to Prepare Artwork for Custom Printed Pouches | Huasheng Packaging', metaDescription: 'Learn how to prepare artwork files for custom printed pouches, including size, bleed, color mode, text, barcode and printing checks.', h1: 'How to Prepare Artwork for Custom Printed Pouches', datePublished: '2025-07-01', dateModified: '2026-05-21', image: '/media/blog/custom-printed-pouches-artwork-guide.webp' },
    zh: { seoTitle: '如何为定制印刷袋准备设计稿', metaDescription: '了解如何为定制印刷袋准备设计文件，包括尺寸、出血、颜色模式、文字、条形码和印刷检查。', h1: '如何为定制印刷袋准备设计稿' },
    ru: { seoTitle: 'Подготовка макетов для пакетов с индивидуальной печатью', metaDescription: 'Узнайте, как подготовить файлы макетов для пакетов с печатью: размер, выпуск за обрез, цветовая модель, текст, штрихкод и проверка перед печатью.', h1: 'Как подготовить макет для пакетов с индивидуальной печатью' },
    ur: { seoTitle: 'حسب ضرورت پرنٹ شدہ پاؤچز کے لیے آرٹ ورک کیسے تیار کریں', metaDescription: 'حسب ضرورت پرنٹ شدہ پاؤچز کے لیے آرٹ ورک فائلیں تیار کرنے کا طریقہ سیکھیں، بشمول سائز، بلیڈ، رنگ موڈ، ٹیکسٹ، بارکوڈ اور پرنٹنگ چیکس۔', h1: 'حسب ضرورت پرنٹ شدہ پاؤچز کے لیے آرٹ ورک کیسے تیار کریں' },
  },
  'common-filling-and-sealing-issues-for-flexible-packaging': {
    en: { seoTitle: 'Common Filling and Sealing Issues for Flexible Packaging | Huasheng Packaging', metaDescription: 'Learn common filling and sealing issues for flexible packaging pouches and how to review sealing temperature, pressure, material and pouch design.', h1: 'Common Filling and Sealing Issues for Flexible Packaging', datePublished: '2025-07-15', dateModified: '2026-05-21', image: '/media/blog/flexible-packaging-filling-and-sealing-issues.webp' },
    zh: { seoTitle: '软包装常见灌装与密封问题 | 华胜包装', metaDescription: '了解软包装袋常见灌装密封问题，排查温度、压力、材料和设计因素。', h1: '软包装常见灌装与密封问题' },
    ru: { seoTitle: 'Проблемы розлива и герметизации | Huasheng', metaDescription: 'Узнайте о распространенных проблемах розлива и герметизации гибких пакетов и способах их решения.', h1: 'Частые проблемы розлива и герметизации гибкой упаковки' },
    ur: { seoTitle: 'لچکدار پیکیجنگ کے فلنگ اور سیلنگ مسائل', metaDescription: 'لچکدار پیکیجنگ پاؤچز کے عام فلنگ اور سیلنگ مسائل اور حل جانیں۔', h1: 'لچکدار پیکیجنگ کے عام فلنگ اور سیلنگ مسائل' },
  },
  'spout-pouch-packaging-guide': {
    en: { seoTitle: 'Spout Pouch Packaging Guide | Huasheng Packaging', metaDescription: 'Complete guide to spout pouch packaging: materials, spout types, sealing methods and filling considerations for liquid, sauce, puree and jelly products.', h1: 'Spout Pouch Packaging Guide for Liquid Products', datePublished: '2025-08-01', dateModified: '2026-05-21', image: '/media/blog/spout-pouch-packaging-guide.webp' },
    zh: { seoTitle: '液体产品吸嘴袋包装指南 | 华胜包装', metaDescription: '吸嘴袋包装完整指南：液体、酱料、果泥和果冻产品的材料、吸嘴类型、密封方法和灌装注意事项。', h1: '液体产品吸嘴袋包装指南' },
    ru: { seoTitle: 'Руководство по упаковке в пакеты с носиком | Huasheng', metaDescription: 'Полное руководство по упаковке в пакеты с носиком: материалы, типы носиков, методы герметизации и особенности розлива для жидкостей, соусов и пюре.', h1: 'Руководство по упаковке в пакеты с носиком для жидких продуктов' },
    ur: { seoTitle: 'مائع مصنوعات کے لیے اسپاؤٹ پاؤچ پیکیجنگ گائیڈ | Huasheng', metaDescription: 'اسپاؤٹ پاؤچ پیکیجنگ کی مکمل گائیڈ: مائع، ساس، پیوری اور جیلی مصنوعات کے لیے مواد، اسپاؤٹ اقسام، سیلنگ کے طریقے اور فلنگ کے تحفظات۔', h1: 'مائع مصنوعات کے لیے اسپاؤٹ پاؤچ پیکیجنگ گائیڈ' },
  },
  'coffee-bag-valve-and-material-guide': {
    en: { seoTitle: 'Coffee Bag Valve and Material Guide for Custom Coffee Packaging | Huasheng Packaging', metaDescription: 'Complete guide to coffee bag valves, degassing, material selection and shelf life. One-way valves, barrier structures and packaging formats for coffee beans, ground coffee and specialty coffee.', h1: 'Coffee Bag Valve and Material Guide for Custom Coffee Packaging', datePublished: '2025-08-15', dateModified: '2026-05-21', image: '/media/blog/coffee-bag-valve-and-material-guide-for-custom-coffee-packaging.webp' },
    zh: { seoTitle: '咖啡袋阀门和材料指南 | 华胜包装', metaDescription: '咖啡袋阀门、脱气、材料选择和保质期指南。了解咖啡豆、咖啡粉和精品咖啡的单向阀、阻隔结构和包装形式。', h1: '定制咖啡包装的咖啡袋阀门和材料指南' },
    ru: { seoTitle: 'Клапаны и материалы для кофейных пакетов | Huasheng', metaDescription: 'Руководство по клапанам, дегазации, выбору материалов и сроку хранения кофейных пакетов. Односторонние клапаны, барьерные структуры и форматы упаковки.', h1: 'Клапаны и материалы для индивидуальной кофейной упаковки' },
    ur: { seoTitle: 'کافی بیگ والو اور میٹیریل گائیڈ | Huasheng', metaDescription: 'کافی بیگ والوز، ڈیگاسنگ، مواد کے انتخاب اور شیلف لائف کے بارے میں گائیڈ۔ کافی بینز، گراؤنڈ کافی اور اسپیشلٹی کافی کے لیے یک طرفہ والوز اور بیریئر ڈھانچے۔', h1: 'حسب ضرورت کافی پیکیجنگ کے لیے کافی بیگ والو اور میٹیریل گائیڈ' },
  },
  'roll-film-for-automatic-packaging-machines': {
    en: { seoTitle: 'Roll Film for Automatic Packaging Machines | Huasheng Packaging', metaDescription: 'Guide to printed roll film for automatic packaging machines. Learn about film materials, VFFS/HFFS compatibility, surface treatment and key specifications for smooth production.', h1: 'Roll Film for Automatic Packaging Machines: Materials, Printing and Machine Compatibility', datePublished: '2025-09-01', dateModified: '2026-05-21', image: '/media/blog/roll-film-for-automatic-packaging-machines.webp' },
    zh: { seoTitle: '自动包装机卷膜指南 | 华胜包装', metaDescription: '自动包装机印刷卷膜指南。了解薄膜材料、VFFS/HFFS兼容性、表面处理和确保顺畅生产的关键规格。', h1: '自动包装机卷膜：材料、印刷和机器兼容性' },
    ru: { seoTitle: 'Рулонная пленка для автоматических упаковочных машин | Huasheng', metaDescription: 'Руководство по печатной рулонной пленке для автоматических упаковочных машин. Материалы, совместимость с VFFS/HFFS, обработка поверхности.', h1: 'Рулонная пленка для автоматов: материалы, печать и совместимость' },
    ur: { seoTitle: 'خودکار پیکیجنگ مشینوں کے لیے رول فلم گائیڈ | Huasheng', metaDescription: 'خودکار پیکیجنگ مشینوں کے لیے پرنٹ شدہ رول فلم کے بارے میں گائیڈ۔ فلم مواد، VFFS/HFFS مطابقت، سطحی ٹریٹمنٹ۔', h1: 'خودکار پیکیجنگ مشینوں کے لیے رول فلم: مواد، پرنٹنگ اور مشین مطابقت' },
  },
  'retort-pouch-material-and-sealing-guide': {
    en: { seoTitle: 'Retort Pouch Material and Sealing Guide | Huasheng Packaging', metaDescription: 'Complete guide to retort pouch materials, high-temperature sealing and sterilization. PET/AL/PA/RCPP structures for ready meals, pet food and shelf-stable products.', h1: 'Retort Pouch Material and Sealing Guide for Ready Meals and Shelf-Stable Products', datePublished: '2025-09-15', dateModified: '2026-05-21', image: '/media/blog/retort-pouch-material-and-sealing-guide.webp' },
    zh: { seoTitle: '蒸煮袋材料和密封指南 | 华胜包装', metaDescription: '蒸煮袋材料、高温密封和灭菌完整指南。用于即食餐、宠物食品和常温储存产品的PET/AL/PA/RCPP结构。', h1: '即食餐和常温储存产品的蒸煮袋材料和密封指南' },
    ru: { seoTitle: 'Материалы и герметизация реторт-пакетов | Huasheng', metaDescription: 'Полное руководство по материалам, высокотемпературной герметизации и стерилизации реторт-пакетов для готовых блюд и продуктов длительного хранения.', h1: 'Материалы и герметизация реторт-пакетов для готовых блюд' },
    ur: { seoTitle: 'ریٹارٹ پاؤچ میٹیریل اور سیلنگ گائیڈ | Huasheng', metaDescription: 'ریٹارٹ پاؤچ مواد، ہائی ٹمپریچر سیلنگ اور سٹیریلائزیشن کی مکمل گائیڈ۔ تیار کھانے اور شیلف سٹیبل مصنوعات کے لیے۔', h1: 'تیار کھانے اور شیلف سٹیبل مصنوعات کے لیے ریٹارٹ پاؤچ میٹیریل اور سیلنگ گائیڈ' },
  },
  'choose-food-packaging-roll-film': {
    en: { seoTitle: 'How to Choose Food Packaging Roll Film for Automatic Packing Machines | Huasheng Packaging', metaDescription: 'Learn how to choose food packaging roll film for automatic packing machines. Explains roll width, film structure, eye mark, heat seal layer and machine compatibility.', h1: 'How to Choose Food Packaging Roll Film for Automatic Packing Machines', datePublished: '2025-10-15', dateModified: '2026-05-21', image: '/media/blog/roll-film-for-automatic-packaging-machines.webp' },
    zh: { seoTitle: '如何为自动包装机选择食品包装卷膜 | 华胜包装', metaDescription: '了解如何为自动包装机选择食品包装卷膜。涵盖卷膜宽度、膜结构、光标、热封层和机器兼容性。', h1: '如何为自动包装机选择食品包装卷膜' },
    ru: { seoTitle: 'Как выбрать пленку для упаковочных автоматов | Huasheng Packaging', metaDescription: 'Узнайте как выбрать упаковочную пленку для автоматических машин. Ширина рулона, структура пленки, фотометка, термослой.', h1: 'Как выбрать пленку для автоматических упаковочных машин' },
    ur: { seoTitle: 'خودکار پیکنگ مشینوں کے لیے رول فلم کا انتخاب | Huasheng Packaging', metaDescription: 'خودکار پیکنگ مشینوں کے لیے فوڈ پیکیجنگ رول فلم کا انتخاب سیکھیں۔', h1: 'خودکار پیکنگ مشینوں کے لیے فوڈ پیکیجنگ رول فلم کا انتخاب کیسے کریں' },
  },
  'spout-pouch-material-guide': {
    en: { seoTitle: 'Spout Pouch Material Guide for Juice, Sauce and Liquid Food | Huasheng Packaging', metaDescription: 'Spout pouch material guide for juice, sauce, puree and liquid food. Explains PET/PE, PET/NY/PE, PET/AL/NY/PE material options and sealing methods.', h1: 'Spout Pouch Material Guide for Juice, Sauce and Liquid Food', datePublished: '2025-10-30', dateModified: '2026-05-21', image: '/media/blog/spout-pouch-packaging-guide.webp' },
    zh: { seoTitle: '吸嘴袋材料指南：果汁、酱料和液体食品包装 | 华胜包装', metaDescription: '吸嘴袋材料结构指南，适用于果汁、酱料、果泥和液体食品。涵盖PET/PE、PET/NY/PE、PET/AL/NY/PE材料选项。', h1: '吸嘴袋材料指南：果汁、酱料和液体食品包装' },
    ru: { seoTitle: 'Материалы для пакетов с носиком | Huasheng Packaging', metaDescription: 'Руководство по материалам для пакетов с носиком для соков, соусов и жидких продуктов.', h1: 'Руководство по материалам для пакетов с носиком' },
    ur: { seoTitle: 'اسپاؤٹ پاؤچ میٹریل گائیڈ | Huasheng Packaging', metaDescription: 'جوس، ساس اور مائع خوراک کے لیے اسپاؤٹ پاؤچ میٹریل ڈھانچہ گائیڈ۔', h1: 'جوس، ساس اور مائع خوراک کے لیے اسپاؤٹ پاؤچ میٹریل گائیڈ' },
  },
  'coffee-bag-valve-zipper-guide': {
    en: { seoTitle: 'Coffee Bag with Valve and Zipper: Material and Structure Guide | Huasheng Packaging', metaDescription: 'Coffee bag material and structure guide covering one-way valve, zipper, PET/AL/PE and Kraft/VMPET/PE options.', h1: 'Coffee Bag with Valve and Zipper: Material and Structure Guide', datePublished: '2025-11-15', dateModified: '2026-05-21', image: '/media/blog/coffee-bag-valve-and-material-guide-for-custom-coffee-packaging.webp' },
    zh: { seoTitle: '带气阀和拉链的咖啡袋：材料与结构指南 | 华胜包装', metaDescription: '咖啡袋材料和结构指南，涵盖单向阀、拉链、PET/AL/PE和Kraft/VMPET/PE选项。', h1: '带气阀和拉链的咖啡袋：材料与结构指南' },
    ru: { seoTitle: 'Кофейный пакет с клапаном и зип-замком | Huasheng Packaging', metaDescription: 'Руководство по материалам кофейных пакетов с клапаном и зип-замком.', h1: 'Кофейный пакет с клапаном и зип-замком' },
    ur: { seoTitle: 'والو اور زپر کے ساتھ کافی بیگ گائیڈ | Huasheng Packaging', metaDescription: 'والو، زپر، PET/AL/PE اور Kraft/VMPET/PE آپشنز کے ساتھ کافی بیگ میٹریل اور ڈھانچہ گائیڈ۔', h1: 'والو اور زپر کے ساتھ کافی بیگ گائیڈ' },
  },
  'flat-bottom-pouch-vs-stand-up-pouch': {
    en: { seoTitle: 'Flat Bottom Pouch vs Stand Up Pouch: Which Is Better? | Huasheng Packaging', metaDescription: 'Compare flat bottom pouch and stand up pouch for food packaging. Learn about shelf display, filling capacity, zipper and cost.', h1: 'Flat Bottom Pouch vs Stand Up Pouch: Which Is Better for Food Packaging?', datePublished: '2025-11-30', dateModified: '2026-05-21', image: '/media/blog/how-to-choose-food-packaging-materials-for-custom-flexible-packaging.webp' },
    zh: { seoTitle: '平底袋 vs 自立袋：哪种更适合食品包装？ | 华胜包装', metaDescription: '对比平底袋和自立袋在食品包装中的应用。了解货架展示、灌装容量、拉链和成本。', h1: '平底袋 vs 自立袋：哪种更适合食品包装？' },
    ru: { seoTitle: 'Пакет с плоским дном против дой-пака | Huasheng Packaging', metaDescription: 'Сравнение пакетов с плоским дном и дой-паков. Узнайте о выкладке, объеме и стоимости.', h1: 'Пакет с плоским дном против дой-пака: что лучше?' },
    ur: { seoTitle: 'فلیٹ باٹم پاؤچ بمقابلہ اسٹینڈ اپ پاؤچ | Huasheng Packaging', metaDescription: 'فوڈ پیکیجنگ کے لیے فلیٹ باٹم پاؤچ اور اسٹینڈ اپ پاؤچ کا موازنہ کریں۔', h1: 'فلیٹ باٹم پاؤچ بمقابلہ اسٹینڈ اپ پاؤچ: کون سا بہتر ہے؟' },
  },
  'retort-pouch-material-structure-guide': {
    en: { seoTitle: 'Retort Pouch Material Structure Guide for High Temperature Sterilization | Huasheng Packaging', metaDescription: 'Retort pouch material structure guide for 121-135 degree sterilization. Explains PET/AL/NY/CPP, PET/NY/CPP, sealing strength and quality control.', h1: 'Retort Pouch Material Structure Guide for High Temperature Sterilization', datePublished: '2025-12-15', dateModified: '2026-05-21', image: '/media/blog/retort-pouch-material-and-sealing-guide.webp' },
    zh: { seoTitle: '蒸煮袋材料结构指南：高温杀菌 | 华胜包装', metaDescription: '蒸煮袋材料结构指南，适用于高温杀菌。涵盖PET/AL/NY/CPP、PET/NY/CPP结构、封口强度和质控要点。', h1: '蒸煮袋材料结构指南：高温杀菌' },
    ru: { seoTitle: 'Материалы реторт-пакетов для стерилизации | Huasheng Packaging', metaDescription: 'Руководство по материалам реторт-пакетов для высокотемпературной стерилизации.', h1: 'Руководство по материалам реторт-пакетов' },
    ur: { seoTitle: 'ریٹارٹ پاؤچ میٹریل ڈھانچہ گائیڈ | Huasheng Packaging', metaDescription: 'زیادہ درجہ حرارت جراثیم کشی کے لیے ریٹارٹ پاؤچ میٹریل ڈھانچہ گائیڈ۔', h1: 'ریٹارٹ پاؤچ میٹریل ڈھانچہ گائیڈ' },
  },
  'moq-sample-lead-time-guide': {
    en: { seoTitle: 'MOQ, Sample and Lead Time Guide for Custom Flexible Packaging | Huasheng Packaging', metaDescription: 'Practical guide for MOQ, sample policy, lead time and payment terms for custom flexible packaging.', h1: 'MOQ, Sample and Lead Time Guide for Custom Flexible Packaging', datePublished: '2025-12-30', dateModified: '2026-05-21', image: '/media/blog/packing-shipment-custom-packaging.webp' },
    zh: { seoTitle: '定制软包装：起订量、样品和交期指南 | 华胜包装', metaDescription: '定制软包装起订量、样品政策、交期和付款方式实用指南。', h1: '定制软包装：起订量、样品和交期指南' },
    ru: { seoTitle: 'MOQ, образцы и сроки для гибкой упаковки | Huasheng Packaging', metaDescription: 'Практическое руководство по MOQ, образцам, срокам и условиям оплаты для гибкой упаковки на заказ.', h1: 'MOQ, образцы и сроки изготовления гибкой упаковки' },
    ur: { seoTitle: 'MOQ، نمونہ اور لیڈ ٹائم گائیڈ | Huasheng Packaging', metaDescription: 'حسب ضرورت لچکدار پیکیجنگ کے لیے MOQ، نمونہ پالیسی، لیڈ ٹائم اور ادائیگی کی شرائط کے بارے میں عملی گائیڈ۔', h1: 'MOQ، نمونہ اور لیڈ ٹائم گائیڈ' },
  },
  'iso22000-food-grade-flexible-packaging-quality-control': {
    en: { seoTitle: 'ISO22000 Food Grade Flexible Packaging Quality Control | Huasheng Packaging', metaDescription: 'Huasheng Packaging is ISO22000 certified. Learn what buyers should check before ordering food grade flexible packaging, including material structure, sealing strength, oxygen barrier, moisture barrier and packaging quality control.', h1: 'ISO22000 Food Grade Flexible Packaging: Quality Control Guide for Buyers', datePublished: '2026-02-28', dateModified: '2026-05-21', image: '/media/blog/food-packaging-solutions.webp' },
    zh: { seoTitle: 'ISO22000食品级软包装质量控制指南 | 华胜包装', metaDescription: '华胜包装已通过ISO22000认证。了解定制食品级软包装前应检查的内容，包括材料结构、封口强度、氧气阻隔、防潮阻隔和包装质量控制。', h1: 'ISO22000食品级软包装：采购商质量控制指南' },
    ru: { seoTitle: 'ISO22000 Контроль качества пищевой упаковки | Huasheng Packaging', metaDescription: 'Huasheng Packaging сертифицирован по ISO22000. Узнайте что проверить перед заказом пищевой гибкой упаковки.', h1: 'ISO22000 Контроль качества пищевой гибкой упаковки' },
    ur: { seoTitle: 'ISO22000 فوڈ گریڈ پیکیجنگ کوالٹی کنٹرول | Huasheng Packaging', metaDescription: 'Huasheng Packaging ISO22000 سرٹیفائیڈ ہے۔ فوڈ گریڈ لچکدار پیکیجنگ آرڈر کرنے سے پہلے کیا چیک کریں جانیں۔', h1: 'ISO22000 فوڈ گریڈ پیکیجنگ کوالٹی کنٹرول گائیڈ' },
  },
  'custom-sachet-and-stick-pack-packaging-guide': {
    en: { seoTitle: 'Sachet and Stick Pack Packaging Guide for Food, Powder and Liquid Products | Huasheng Packaging', metaDescription: 'Learn how to choose custom sachet packaging and stick pack packaging for food, powder, seasoning, sauce and liquid products. Covers material structure, roll film, three side seal pouches and quality control.', h1: 'Sachet and Stick Pack Packaging Guide for Food, Powder and Liquid Products', datePublished: '2026-03-15', dateModified: '2026-05-21', image: '/media/blog/roll-film-for-automatic-packaging-machines.webp' },
    zh: { seoTitle: '食品小袋与条包包装指南 | 华胜包装', metaDescription: '了解如何选择食品粉剂、调味料、酱料和液体产品的定制小袋包装和条包包装。涵盖材料结构、卷膜、三边封袋和质量控制。', h1: '食品小袋与条包包装指南：粉剂、酱料和单份食品包装如何选择' },
    ru: { seoTitle: 'Упаковка саше и стик-пак: руководство | Huasheng Packaging', metaDescription: 'Руководство по упаковке саше и стик-пак для пищевых продуктов, порошков, приправ, соусов и жидкостей.', h1: 'Руководство по упаковке саше и стик-пак' },
    ur: { seoTitle: 'سیشے اور اسٹک پیک پیکیجنگ گائیڈ | Huasheng Packaging', metaDescription: 'کھانے، پاؤڈر، مصالحہ جات، ساس اور مائع مصنوعات کے لیے سیشے اور اسٹک پیک پیکیجنگ کا انتخاب سیکھیں۔', h1: 'سیشے اور اسٹک پیک پیکیجنگ گائیڈ' },
  },
  'roll-film-vs-premade-pouch-packaging-guide': {
    en: { seoTitle: 'Roll Film vs Premade Pouch Packaging Guide | Huasheng Packaging', metaDescription: 'Compare roll film packaging and premade pouches for food, snacks, coffee, powder and liquid products. Learn how to choose based on packing machine, material structure, MOQ, cost and quality control.', h1: 'Roll Film vs Premade Pouch: How to Choose the Right Flexible Packaging Format', datePublished: '2026-03-30', dateModified: '2026-05-21', image: '/media/blog/roll-film-for-automatic-packaging-machines.webp' },
    zh: { seoTitle: '包装卷膜与预制袋采购指南 | 华胜包装', metaDescription: '对比包装卷膜和预制袋在食品、零食、咖啡、粉剂和液体产品中的应用。了解如何根据包装机、材料结构、起订量、成本和质量控制选择合适格式。', h1: '包装卷膜和预制袋怎么选：食品软包装采购指南' },
    ru: { seoTitle: 'Рулонная пленка или готовые пакеты: руководство | Huasheng Packaging', metaDescription: 'Сравнение рулонной пленки и готовых пакетов для упаковки продуктов, снеков, кофе и жидкостей.', h1: 'Рулонная пленка или готовые пакеты: как выбрать формат упаковки' },
    ur: { seoTitle: 'رول فلم بمقابلہ پری میڈ پاؤچ گائیڈ | Huasheng Packaging', metaDescription: 'رول فلم اور پری میڈ پاؤچ پیکیجنگ کا موازنہ۔ پیکنگ مشین، میٹریل، لاگت کی بنیاد پر انتخاب سیکھیں۔', h1: 'رول فلم بمقابلہ پری میڈ پاؤچ: لچکدار پیکیجنگ فارمیٹ کا انتخاب' },
  },
  'spout-pouch-material-guide-for-liquid-packaging': {
    en: { seoTitle: 'Spout Pouch Material Guide for Liquid Packaging | Huasheng Packaging', metaDescription: 'Learn how to choose spout pouch materials for juice, sauce, baby food, refill and liquid packaging, including barrier structures, leakage risk, spout and cap selection, sterilization and quality control.', h1: 'Spout Pouch Material Guide for Juice, Sauce and Liquid Packaging', datePublished: '2026-04-15', dateModified: '2026-05-21', image: '/media/blog/spout-pouch-packaging-guide.webp' },
    zh: { seoTitle: '吸嘴袋材料结构指南：果汁、酱料和液体包装 | 华胜包装', metaDescription: '了解如何为果汁、酱料、婴儿食品、补充装和液体包装选择吸嘴袋材料，包括阻隔结构、防漏措施、吸嘴和盖子选择、杀菌和质量控制。', h1: '吸嘴袋材料结构指南：果汁、酱料和液体包装如何选择' },
    ru: { seoTitle: 'Материалы для пакетов с носиком | Huasheng Packaging', metaDescription: 'Руководство по выбору материалов для пакетов с носиком для соков, соусов, детского питания и жидких продуктов.', h1: 'Руководство по материалам для пакетов с носиком' },
    ur: { seoTitle: 'اسپاؤٹ پاؤچ میٹریل گائیڈ | Huasheng Packaging', metaDescription: 'جوس، ساس، بیبی فوڈ اور مائع پیکیجنگ کے لیے اسپاؤٹ پاؤچ میٹریل کا انتخاب سیکھیں۔', h1: 'اسپاؤٹ پاؤچ میٹریل گائیڈ' },
  },
  'coffee-bag-with-valve-and-zipper-guide': {
    en: { seoTitle: 'Coffee Bag with Valve and Zipper Guide | Huasheng Packaging', metaDescription: 'Learn how to choose coffee bags with valve and zipper, including flat bottom coffee bags, stand up coffee pouches, material structures, degassing valve, aroma barrier and custom printing options.', h1: 'Coffee Bag with Valve and Zipper Guide: Materials, Bag Types and Custom Options', datePublished: '2026-04-30', dateModified: '2026-05-21', image: '/media/blog/coffee-bag-valve-and-material-guide-for-custom-coffee-packaging.webp' },
    zh: { seoTitle: '带阀咖啡袋采购指南：材料、袋型和定制选项 | 华胜包装', metaDescription: '了解如何选择带阀和拉链的咖啡袋，包括平底咖啡袋、自立咖啡袋、材料结构、排气阀、香气阻隔和定制印刷选项。', h1: '带阀咖啡袋采购指南：材料结构、袋型和定制选项怎么选' },
    ru: { seoTitle: 'Кофейный пакет с клапаном и зип-замком: руководство | Huasheng Packaging', metaDescription: 'Руководство по выбору кофейных пакетов с клапаном и зип-замком, включая материалы и индивидуальные опции.', h1: 'Кофейный пакет с клапаном и зип-замком: руководство' },
    ur: { seoTitle: 'والو اور زپر کے ساتھ کافی بیگ گائیڈ | Huasheng Packaging', metaDescription: 'والو اور زپر کے ساتھ کافی بیگز کا انتخاب سیکھیں، بشمول فلیٹ باٹم، اسٹینڈ اپ، میٹریل اور کسٹم آپشنز۔', h1: 'والو اور زپر کے ساتھ کافی بیگ گائیڈ' },
  },
  'types-of-flexible-packaging': {
    en: { seoTitle: 'Types of Flexible Packaging: 12 Pouch and Film Formats Explained | Huasheng Packaging', metaDescription: 'Complete guide to 12 types of flexible packaging: stand up pouch, flat bottom, spout, quad seal, side gusset, 3-side seal, retort, coffee bags, roll film, shaped pouch, kraft paper bags and easy peel film.', h1: '12 Types of Flexible Packaging: A Complete Guide to Pouches and Roll Film', datePublished: '2025-07-20', dateModified: '2026-05-21', image: '/media/blog/types-of-flexible-packaging.webp' },
    zh: { seoTitle: '柔性包装类型大全：12种袋型和卷膜详解 | 华胜包装', metaDescription: '12种柔性包装类型完整指南：自立袋、平底袋、吸嘴袋、四边封、侧边折边、三边封、蒸煮袋、咖啡袋、卷膜、异形袋、牛皮纸袋和易揭膜。', h1: '12种柔性包装类型：袋型和卷膜完整指南' },
    ru: { seoTitle: 'Типы гибкой упаковки: 12 форматов | Huasheng Packaging', metaDescription: 'Полное руководство по 12 типам гибкой упаковки: дой-пак, плоское дно, носик, квадро, боковые складки, 3-шовный, реторт, кофейные пакеты, рулонная пленка.', h1: '12 типов гибкой упаковки: полное руководство' },
    ur: { seoTitle: 'لچکدار پیکیجنگ کی اقسام: 12 پاؤچ اور فلم فارمیٹس | Huasheng Packaging', metaDescription: '12 اقسام کی لچکدار پیکیجنگ کی مکمل گائیڈ: اسٹینڈ اپ پاؤچ، فلیٹ باٹم، اسپاؤٹ، کواڈ سیل، سائیڈ گسٹ، 3-سائیڈ سیل، ریٹارٹ، کافی بیگ، رول فلم۔', h1: 'لچکدار پیکیجنگ کی 12 اقسام: پاؤچز اور رول فلم کی مکمل گائیڈ' },
  },
  'food-grade-standards-for-flexible-packaging': {
    en: { seoTitle: 'Food Grade Standards for Flexible Packaging: What Buyers Should Check Before Ordering | Huasheng Packaging', metaDescription: 'Learn what buyers should check before ordering food grade flexible packaging, including BRC audit questions, material safety, sealing strength, oxygen barrier and moisture barrier testing.', h1: 'Food Grade Standards for Flexible Packaging', datePublished: '2026-01-15', dateModified: '2026-05-21', image: '/media/blog/types-of-flexible-packaging.webp' },
    zh: { seoTitle: '食品级软包装标准：采购商下单前应了解的内容 | 华胜包装', metaDescription: '了解定制食品级软包装前应检查的内容，包括BRC审计、材料安全、封口强度、氧气阻隔和防潮阻隔测试。', h1: '食品级软包装标准指南' },
    ru: { seoTitle: 'Стандарты пищевой упаковки: что проверить перед заказом | Huasheng Packaging', metaDescription: 'Узнайте что проверить перед заказом пищевой гибкой упаковки: BRC, безопасность материалов, прочность швов, барьерные свойства.', h1: 'Стандарты пищевой гибкой упаковки' },
    ur: { seoTitle: 'فوڈ گریڈ پیکیجنگ کے معیارات: آرڈر سے پہلے کیا چیک کریں | Huasheng Packaging', metaDescription: 'فوڈ گریڈ لچکدار پیکیجنگ آرڈر کرنے سے پہلے کیا چیک کریں، بشمول BRC آڈٹ، میٹریل سیفٹی، سیلنگ سٹرینتھ اور بیریئر ٹیسٹنگ۔', h1: 'فوڈ گریڈ لچکدار پیکیجنگ کے معیارات' },
  },
  'easy-peel-sealing-film-for-jelly-cups': {
    en: { seoTitle: 'Easy Peel Sealing Film for Jelly Cups: Materials, Sealing and Peel Performance | Huasheng Packaging', metaDescription: 'Easy peel sealing film guide for jelly cups, pudding cups and cup food packaging. Covers material structures, sealing temperature, peel strength and quality control.', h1: 'Easy Peel Sealing Film for Jelly Cups', datePublished: '2026-01-30', dateModified: '2026-05-21', image: '/media/blog/jelly-lidding_en.webp' },
    zh: { seoTitle: '果冻杯易揭封口膜：材料、封口与剥离性能指南 | 华胜包装', metaDescription: '果冻杯、布丁杯和杯装食品易揭封口膜指南。涵盖材料结构、封口温度、剥离强度和质量控制。', h1: '果冻杯易揭封口膜指南' },
    ru: { seoTitle: 'Легкооткрываемая пленка для стаканчиков | Huasheng Packaging', metaDescription: 'Руководство по легкооткрываемой пленке для желе, пудингов и пищевых стаканчиков.', h1: 'Легкооткрываемая пленка для стаканчиков с желе' },
    ur: { seoTitle: 'جیلی کپ کے لیے ایزی پیل سیلنگ فلم گائیڈ | Huasheng Packaging', metaDescription: 'جیلی کپ، پڈنگ کپ اور کپ فوڈ پیکیجنگ کے لیے ایزی پیل سیلنگ فلم گائیڈ۔', h1: 'جیلی کپ کے لیے ایزی پیل سیلنگ فلم' },
  },
  'frozen-food-packaging-material-guide': {
    en: { seoTitle: 'Frozen Food Packaging Material Guide for Flexible Packaging Buyers | Huasheng Packaging', metaDescription: 'Frozen food packaging material guide covering roll film, pouches, material structures, sealing strength and moisture barrier.', h1: 'Frozen Food Packaging Material Guide', datePublished: '2026-02-14', dateModified: '2026-05-21', image: '/media/applications/snacks-food-packaging.webp' },
    zh: { seoTitle: '冷冻食品包装材料指南 | 华胜包装', metaDescription: '冷冻食品包装材料指南，涵盖卷膜、袋子、材料结构、封口强度和防潮阻隔。', h1: '冷冻食品包装材料指南' },
    ru: { seoTitle: 'Материалы для упаковки замороженных продуктов | Huasheng Packaging', metaDescription: 'Руководство по материалам для упаковки замороженных продуктов. Пленка, пакеты, структуры материалов.', h1: 'Руководство по материалам для упаковки замороженных продуктов' },
    ur: { seoTitle: 'منجمد خوراک پیکیجنگ میٹریل گائیڈ | Huasheng Packaging', metaDescription: 'منجمد خوراک پیکیجنگ میٹریل گائیڈ جس میں رول فلم، پاؤچز، میٹریل ڈھانچے شامل ہیں۔', h1: 'منجمد خوراک پیکیجنگ میٹریل گائیڈ' },
  },
  'why-same-price-packaging-bags-have-different-quality': {
    en: { seoTitle: 'Why Same Price Packaging Bags Can Have Different Quality | Huasheng Packaging', metaDescription: 'Learn why custom packaging bags with the same price may have different quality, including material structure, thickness, printing, lamination, sealing, hidden costs and supplier comparison.', h1: 'Why Same Price Packaging Bags Can Have Different Quality', datePublished: '2026-05-07', dateModified: '2026-05-21', image: '/media/blog/how-to-choose-food-packaging-materials-for-custom-flexible-packaging.webp' },
    zh: { seoTitle: '为什么同样价格，最后做出来的包装袋不一样？ | 华胜包装', metaDescription: '了解为什么同样价格的定制包装袋质量可能不同，包括材料结构、厚度、印刷、复合、封口强度、隐性成本和供应商对比。', h1: '为什么同样价格，最后做出来的包装袋不一样？' },
  },

  'food-packaging-material-selection-guide': {
    en: { seoTitle: 'Food Packaging Material Selection Guide: How to Choose Materials for Powder, Liquid, Coffee and Retort Products | Huasheng Packaging', metaDescription: 'Learn how to choose food packaging materials for powder, liquid, coffee and retort products. Compares PET/PE, VMPET, aluminum foil, NY/PE and retort-grade st...', h1: 'Food Packaging Material Selection Guide: How to Choose Materials for Powder, Liquid, Coffee and Retort Products', datePublished: '2026-04-01', dateModified: '2026-05-21', image: '/media/blog/food-packaging-solutions.webp' },
  },
  'food-packaging-material-cost-guide': {
    en: { seoTitle: 'Food Packaging Material Cost Guide: Why PET, PE, VMPET, AL and Kraft Structures Have Different Prices | Huasheng Packaging', metaDescription: 'Understand why food packaging material costs vary. Compares PET/PE, VMPET, aluminum foil, kraft and retort structures, printing colors impact, MOQ relationsh...', h1: 'Food Packaging Material Cost Guide: Why PET, PE, VMPET, AL and Kraft Structures Have Different Prices', datePublished: '2026-04-07', dateModified: '2026-05-21', image: '/media/blog/food-packaging-solutions.webp' },
  },
  'gravure-printing-vs-digital-printing-flexible-packaging': {
    en: { seoTitle: 'Gravure Printing vs Digital Printing for Custom Flexible Packaging: Which One Should You Choose? | Huasheng Packaging', metaDescription: 'Compare gravure printing and digital printing for custom flexible packaging. Learn about cylinder cost, MOQ, color stability, lead time and which method suit...', h1: 'Gravure Printing vs Digital Printing for Custom Flexible Packaging: Which One Should You Choose?', datePublished: '2026-04-14', dateModified: '2026-05-21', image: '/media/blog/how-to-prepare-artwork-for-custom-printed-pouches.webp' },
  },
  'how-to-prepare-artwork-for-custom-printed-packaging': {
    en: { seoTitle: 'How to Prepare Artwork for Custom Printed Packaging: File, Dieline, Colors and Printing Notes | Huasheng Packaging', metaDescription: 'Learn how to prepare artwork files for custom printed flexible packaging. Covers file formats, dieline, bleed, CMYK, barcode, eye mark and common artwork mis...', h1: 'How to Prepare Artwork for Custom Printed Packaging: File, Dieline, Colors and Printing Notes', datePublished: '2026-04-21', dateModified: '2026-05-21', image: '/media/blog/how-to-prepare-artwork-for-custom-printed-pouches.webp' },
  },
  'coffee-bag-inner-material-guide': {
    en: { seoTitle: 'Coffee Bag Inner Material Guide: VMPET, Aluminum Foil, PE and Kraft Laminated Structures | Huasheng Packaging', metaDescription: 'Learn how to choose coffee bag inner materials. Compares VMPET, aluminum foil, PE and kraft laminated structures for coffee packaging with valve and zipper.', h1: 'Coffee Bag Inner Material Guide: VMPET, Aluminum Foil, PE and Kraft Laminated Structures', datePublished: '2026-04-28', dateModified: '2026-05-21', image: '/media/blog/coffee-bag-valve-and-material-guide-for-custom-coffee-packaging.webp' },
  },
  'liquid-packaging-material-safety-guide': {
    en: { seoTitle: 'Liquid Packaging Material Safety Guide: How to Choose Materials for Juice, Sauce and Spout Pouches | Huasheng Packaging', metaDescription: 'Learn how to choose safe materials for liquid packaging. Covers juice, sauce and spout pouch material selection, safety testing and common risks to avoid.', h1: 'Liquid Packaging Material Safety Guide: How to Choose Materials for Juice, Sauce and Spout Pouches', datePublished: '2026-05-01', dateModified: '2026-05-21', image: '/media/blog/spout-pouch-packaging-guide.webp' },
  },
  'retort-pouch-material-high-temperature-sterilization-guide': {
    en: { seoTitle: 'Retort Pouch Material Guide for High-Temperature Sterilization: 121\\u00b0C and 135\\u00b0C Packaging Structures | Huasheng Packaging', metaDescription: 'Learn how to choose retort pouch materials for 121\\u00b0C and 135\\u00b0C high-temperature sterilization. Compares PET/AL/CPP, PET/NY/CPP and transparent re...', h1: 'Retort Pouch Material Guide for High-Temperature Sterilization: 121\\u00b0C and 135\\u00b0C Packaging Structures', datePublished: '2026-05-05', dateModified: '2026-05-21', image: '/media/blog/retort-pouch-material-and-sealing-guide.webp' },
  },
  'easy-open-packaging-design-guide': {
    en: { seoTitle: 'Easy Open Packaging Design Guide: Tear Notch, Zipper, Laser Scoring and User-Friendly Pouch Opening | Huasheng Packaging', metaDescription: 'Learn how to design easy-open flexible packaging. Covers tear notch, zipper, laser scoring and easy peel film for user-friendly pouch opening experiences.', h1: 'Easy Open Packaging Design Guide: Tear Notch, Zipper, Laser Scoring and User-Friendly Pouch Opening', datePublished: '2026-05-12', dateModified: '2026-05-21', image: '/media/blog/how-to-prepare-artwork-for-custom-printed-pouches.webp' },
  },
  'hidden-costs-in-custom-flexible-packaging-orders': {
    en: { seoTitle: 'Hidden Costs in Custom Flexible Packaging Orders | Huasheng Packaging', metaDescription: 'Learn the hidden costs in custom flexible packaging orders, including cylinder cost, sample cost, artwork changes, material adjustments, MOQ, lead time, qual...', h1: 'Hidden Costs in Custom Flexible Packaging Orders', datePublished: '2026-05-19', dateModified: '2026-05-21', image: '/media/blog/packing-shipment-custom-packaging.webp' },
  },

  'easy-peel-sealing-film-for-jelly-cups': {
    en: { seoTitle: 'Common Filling and Sealing Issues for Flexible Packaging | Huasheng Packaging', metaDescription: 'Learn common filling and sealing issues for flexible packaging pouches and how to review sealing temperature, pressure, material and pouch design.', h1: 'Common Filling and Sealing Issues for Flexible Packaging', datePublished: '2026-01-30', dateModified: '2026-05-21' },
  },

  'frozen-food-packaging-material-guide': {
    en: { seoTitle: 'Common Filling and Sealing Issues for Flexible Packaging | Huasheng Packaging', metaDescription: 'Learn common filling and sealing issues for flexible packaging pouches and how to review sealing temperature, pressure, material and pouch design.', h1: 'Common Filling and Sealing Issues for Flexible Packaging', datePublished: '2026-01-30', dateModified: '2026-05-21' },
  },
};

// ---- Static page SEO metadata (all 16 languages) ----
// Format: { title, description }

export const STATIC_PAGE_SEO = {
  products: {
    en: { title: 'Custom Flexible Packaging Products | Huasheng Packaging', description: 'Explore our full range of custom flexible packaging products: stand up pouches, flat bottom pouches, coffee bags, spout pouches, roll film and more for food, beverage and consumer brands.' },
    zh: { title: '定制软包装产品 | 华胜包装', description: '探索我们的全系列定制软包装产品：自立袋、八边封平底袋、咖啡袋、吸嘴袋、印刷卷膜等，服务食品、饮料和消费品牌。' },
    ar: { title: 'منتجات التغليف المرن المخصصة | Huasheng Packaging', description: 'استكشف مجموعتنا الكاملة من منتجات التغليف المرن المخصصة: أكياس ستاند أب، أكياس ذات قاع مسطح، أكياس القهوة، أكياس ذات صنبور، أفلام رول والمزيد.' },
    ur: { title: 'حسب ضرورت لچکدار پیکیجنگ مصنوعات | Huasheng Packaging', description: 'ہماری حسب ضرورت لچکدار پیکیجنگ مصنوعات کی مکمل رینج دریافت کریں: اسٹینڈ اپ پاؤچز، فلیٹ باٹم پاؤچز، کافی بیگز، اسپاؤٹ پاؤچز، رول فلم اور مزید۔' },
    es: { title: 'Productos de Envases Flexibles Personalizados | Huasheng Packaging', description: 'Explore nuestra gama completa de envases flexibles personalizados: bolsas doypack, bolsas de fondo plano, bolsas para café, bolsas con boquilla, film en rollo y más.' },
    fr: { title: 'Produits d\'Emballages Flexibles Personnalisés | Huasheng Packaging', description: 'Découvrez notre gamme complète d\'emballages flexibles personnalisés : pochettes stand-up, pochettes à fond plat, sachets café, pochettes à bec verseur, film en rouleau et plus.' },
    ru: { title: 'Индивидуальная гибкая упаковка | Huasheng Packaging', description: 'Ознакомьтесь с нашим ассортиментом гибкой упаковки на заказ: дой-пак, пакеты с плоским дном, кофейные пакеты, пакеты с носиком, рулонная пленка и многое другое.' },
    pt: { title: 'Produtos de Embalagens Flexíveis Personalizadas | Huasheng Packaging', description: 'Explore nossa linha completa de embalagens flexíveis personalizadas: bolsas stand-up, bolsas de fundo plano, bolsas para café, bolsas com bico, filme em rolo e mais.' },
    de: { title: 'Kundenspezifische Flexible Verpackungsprodukte | Huasheng Packaging', description: 'Entdecken Sie unser gesamtes Sortiment an flexiblen Verpackungen: Standbodenbeutel, Flachbodenbeutel, Kaffeebeutel, Ausgießbeutel, Rollenfolie und mehr.' },
    vi: { title: 'Sản Phẩm Bao Bì Mềm Tùy Chỉnh | Huasheng Packaging', description: 'Khám phá toàn bộ dòng sản phẩm bao bì mềm tùy chỉnh của chúng tôi: túi đứng, túi đáy phẳng, túi cà phê, túi có vòi, màng cuộn và nhiều hơn nữa.' },
    id: { title: 'Produk Kemasan Fleksibel Kustom | Huasheng Packaging', description: 'Jelajahi rangkaian lengkap produk kemasan fleksibel kustom kami: standing pouch, flat bottom pouch, coffee bag, spout pouch, roll film dan lainnya.' },
    tr: { title: 'Özel Esnek Ambalaj Ürünleri | Huasheng Packaging', description: 'Özel esnek ambalaj ürün yelpazemizi keşfedin: stand-up poşetler, düz tabanlı poşetler, kahve poşetleri, ağızlıklı poşetler, rulo film ve daha fazlası.' },
    ja: { title: 'カスタム軟包装製品 | Huasheng Packaging', description: 'スタンドアップパウチ、フラットボトムパウチ、コーヒーバッグ、スパウトパウチ、ロールフィルムなど、カスタム軟包装製品の全ラインアップをご覧ください。' },
    ko: { title: '맞춤형 연포장 제품 | Huasheng Packaging', description: '스탠드업 파우치, 플랫 바텀 파우치, 커피 백, 스파우트 파우치, 롤 필름 등 맞춤형 연포장 제품 전체 라인업을 살펴보세요.' },
    th: { title: 'ผลิตภัณฑ์บรรจุภัณฑ์อ่อนตัวแบบกำหนดเอง | Huasheng Packaging', description: 'สำรวจกลุ่มผลิตภัณฑ์บรรจุภัณฑ์อ่อนตัวแบบกำหนดเองทั้งหมดของเรา: ถุงตั้งได้ ถุงก้นแบน ถุงกาแฟ ถุงมีหู เทปม้วน และอื่นๆ' },
    hi: { title: 'कस्टम लचीली पैकेजिंग उत्पाद | Huasheng Packaging', description: 'हमारे कस्टम लचीली पैकेजिंग उत्पादों की पूरी श्रृंखला देखें: स्टैंड अप पाउच, फ्लैट बॉटम पाउच, कॉफी बैग, स्पाउट पाउच, रोल फिल्म और अधिक।' },
  },
  applications: {
    en: { title: 'Flexible Packaging Applications by Industry | Huasheng Packaging', description: 'Flexible packaging solutions by industry: food and snacks, coffee and tea, pet food, beverage, daily chemical, electronics and industrial packaging applications.' },
    zh: { title: '按行业划分的软包装应用 | 华胜包装', description: '按行业划分的软包装解决方案：食品零食、咖啡茶饮、宠物食品、饮料、日化、电子和工业包装应用。' },
    ar: { title: 'تطبيقات التغليف المرن حسب الصناعة | Huasheng Packaging', description: 'حلول التغليف المرن حسب الصناعة: الأغذية والوجبات الخفيفة والقهوة والشاي وأغذية الحيوانات الأليفة والمشروبات والمواد الكيميائية اليومية والإلكترونيات والتطبيقات الصناعية.' },
    ur: { title: 'صنعت کے لحاظ سے لچکدار پیکیجنگ ایپلی کیشنز | Huasheng Packaging', description: 'صنعت کے لحاظ سے لچکدار پیکیجنگ حل: خوراک اور اسنیکس، کافی اور چائے، پیٹ فوڈ، مشروبات، روزمرہ کیمیکل، الیکٹرانکس اور صنعتی پیکیجنگ ایپلی کیشنز۔' },
    es: { title: 'Aplicaciones de Envases Flexibles por Industria | Huasheng Packaging', description: 'Soluciones de envasado flexible por industria: alimentos y snacks, café y té, alimentos para mascotas, bebidas, productos químicos diarios, electrónica y aplicaciones industriales.' },
    fr: { title: 'Applications d\'Emballages Flexibles par Industrie | Huasheng Packaging', description: 'Solutions d\'emballage flexible par industrie : aliments et snacks, café et thé, aliments pour animaux, boissons, produits chimiques quotidiens, électronique et applications industrielles.' },
    ru: { title: 'Применение гибкой упаковки по отраслям | Huasheng Packaging', description: 'Решения гибкой упаковки по отраслям: продукты питания и снеки, кофе и чай, корма для животных, напитки, бытовая химия, электроника и промышленная упаковка.' },
    pt: { title: 'Aplicações de Embalagens Flexíveis por Indústria | Huasheng Packaging', description: 'Soluções de embalagens flexíveis por indústria: alimentos e snacks, café e chá, ração para animais, bebidas, produtos químicos diários, eletrônicos e aplicações industriais.' },
    de: { title: 'Flexible Verpackungsanwendungen nach Branche | Huasheng Packaging', description: 'Flexible Verpackungslösungen nach Branche: Lebensmittel und Snacks, Kaffee und Tee, Tiernahrung, Getränke, Haushaltschemikalien, Elektronik und industrielle Anwendungen.' },
    vi: { title: 'Ứng Dụng Bao Bì Mềm Theo Ngành | Huasheng Packaging', description: 'Giải pháp bao bì mềm theo ngành: thực phẩm và đồ ăn vặt, cà phê và trà, thức ăn thú cưng, đồ uống, hóa chất hàng ngày, điện tử và ứng dụng công nghiệp.' },
    id: { title: 'Aplikasi Kemasan Fleksibel berdasarkan Industri | Huasheng Packaging', description: 'Solusi kemasan fleksibel berdasarkan industri: makanan dan snack, kopi dan teh, makanan hewan, minuman, bahan kimia rumah tangga, elektronik, dan aplikasi industri.' },
    tr: { title: 'Endüstriye Göre Esnek Ambalaj Uygulamaları | Huasheng Packaging', description: 'Endüstriye göre esnek ambalaj çözümleri: gıda ve atıştırmalıklar, kahve ve çay, evcil hayvan maması, içecekler, günlük kimyasallar, elektronik ve endüstriyel uygulamalar.' },
    ja: { title: '業界別軟包装アプリケーション | Huasheng Packaging', description: '業界別の軟包装ソリューション：食品・スナック、コーヒー・紅茶、ペットフード、飲料、日用化学品、電子機器および工業用包装アプリケーション。' },
    ko: { title: '산업별 연포장 응용 분야 | Huasheng Packaging', description: '산업별 연포장 솔루션: 식품 및 스낵, 커피 및 차, 애완동물 사료, 음료, 생활 화학제품, 전자 제품 및 산업용 포장 응용 분야.' },
    th: { title: 'การประยุกต์ใช้บรรจุภัณฑ์อ่อนตัวตามอุตสาหกรรม | Huasheng Packaging', description: 'โซลูชันบรรจุภัณฑ์อ่อนตัวตามอุตสาหกรรม: อาหารและขนมขบเคี้ยว กาแฟและชา อาหารสัตว์เลี้ยง เครื่องดื่ม สารเคมีในครัวเรือน อิเล็กทรอนิกส์ และการประยุกต์ใช้ในอุตสาหกรรม' },
    hi: { title: 'उद्योग द्वारा लचीली पैकेजिंग अनुप्रयोग | Huasheng Packaging', description: 'उद्योग द्वारा लचीली पैकेजिंग समाधान: खाद्य और स्नैक्स, कॉफी और चाय, पालतू भोजन, पेय पदार्थ, दैनिक रसायन, इलेक्ट्रॉनिक्स और औद्योगिक अनुप्रयोग।' },
  },
  manufacturing: {
    en: { title: 'Flexible Packaging Manufacturing Process | Huasheng Packaging', description: 'See our flexible packaging manufacturing process from printing and lamination to pouch making and quality control. All processes under one roof in China.' },
    zh: { title: '软包装制造工艺 | 华胜包装', description: '了解我们的软包装制造工艺，从印刷、复合到制袋和质检。所有工序在中国同厂完成。' },
    ru: { title: 'Процесс производства гибкой упаковки | Huasheng Packaging', description: 'Ознакомьтесь с нашим процессом производства гибкой упаковки: от печати и ламинации до изготовления пакетов и контроля качества. Все процессы на одном заводе в Китае.' },
    ur: { title: 'لچکدار پیکیجنگ مینوفیکچرنگ کا عمل | Huasheng Packaging', description: 'پرنٹنگ اور لیمینیشن سے لے کر پاؤچ بنانے اور کوالٹی کنٹرول تک ہمارے لچکدار پیکیجنگ مینوفیکچرنگ کے عمل کو دیکھیں۔ تمام عمل چین میں ایک ہی چھت کے نیچے۔' },
    ar: { title: 'عملية تصنيع التغليف المرن | Huasheng Packaging', description: 'شاهد عملية تصنيع التغليف المرن لدينا من الطباعة والتصفيح إلى صنع الأكياس ومراقبة الجودة.' },
    es: { title: 'Proceso de Fabricación de Envases Flexibles | Huasheng Packaging', description: 'Vea nuestro proceso de fabricación de envases flexibles desde la impresión y laminación hasta la fabricación de bolsas y el control de calidad.' },
    fr: { title: 'Processus de Fabrication d\'Emballages Flexibles | Huasheng Packaging', description: 'Découvrez notre processus de fabrication d\'emballages flexibles, de l\'impression et la lamination à la fabrication de pochettes et au contrôle qualité.' },
    pt: { title: 'Processo de Fabricação de Embalagens Flexíveis | Huasheng Packaging', description: 'Veja nosso processo de fabricação de embalagens flexíveis, desde a impressão e laminação até a fabricação de bolsas e controle de qualidade.' },
    de: { title: 'Herstellungsprozess für Flexible Verpackungen | Huasheng Packaging', description: 'Sehen Sie unseren Herstellungsprozess für flexible Verpackungen vom Druck und der Laminierung bis zur Beutelherstellung und Qualitätskontrolle.' },
    vi: { title: 'Quy Trình Sản Xuất Bao Bì Mềm | Huasheng Packaging', description: 'Xem quy trình sản xuất bao bì mềm của chúng tôi từ in ấn và cán màng đến tạo túi và kiểm soát chất lượng.' },
    id: { title: 'Proses Manufaktur Kemasan Fleksibel | Huasheng Packaging', description: 'Lihat proses manufaktur kemasan fleksibel kami dari pencetakan dan laminasi hingga pembuatan kantong dan kontrol kualitas.' },
    tr: { title: 'Esnek Ambalaj Üretim Süreci | Huasheng Packaging', description: 'Baskı ve laminasyondan poşet yapımına ve kalite kontrole kadar esnek ambalaj üretim sürecimizi görün.' },
    ja: { title: '軟包装製造プロセス | Huasheng Packaging', description: '印刷・ラミネートから製袋・品質管理まで、軟包装の製造プロセスをご覧ください。中国の同一工場ですべての工程を管理。' },
    ko: { title: '연포장 제조 공정 | Huasheng Packaging', description: '인쇄 및 라미네이션부터 파우치 제작 및 품질 관리에 이르는 연포장 제조 공정을 확인하세요.' },
    th: { title: 'กระบวนการผลิตบรรจุภัณฑ์อ่อนตัว | Huasheng Packaging', description: 'ดูกระบวนการผลิตบรรจุภัณฑ์อ่อนตัวของเราตั้งแต่การพิมพ์และการเคลือบไปจนถึงการทำถุงและการควบคุมคุณภาพ' },
    hi: { title: 'लचीली पैकेजिंग निर्माण प्रक्रिया | Huasheng Packaging', description: 'मुद्रण और लेमिनेशन से लेकर पाउच निर्माण और गुणवत्ता नियंत्रण तक हमारी लचीली पैकेजिंग निर्माण प्रक्रिया देखें।' },
  },
  about: {
    en: { title: 'About Huasheng Packaging | Flexible Packaging Manufacturer in China', description: 'Learn about Huasheng Packaging, a China-based flexible packaging manufacturer established in 1997. Custom pouches, roll film and packaging solutions for global brands.' },
    zh: { title: '关于华胜包装 | 中国软包装制造商', description: '了解华胜包装，一家成立于1997年的中国软包装制造商。为全球品牌提供定制袋、印刷卷膜和包装解决方案。' },
    ru: { title: 'О компании Huasheng Packaging | Производитель гибкой упаковки', description: 'Узнайте о Huasheng Packaging, китайском производителе гибкой упаковки, основанном в 1997 году. Индивидуальные пакеты, рулонная пленка и упаковочные решения.' },
    ur: { title: 'Huasheng Packaging کے بارے میں | چین میں لچکدار پیکیجنگ مینوفیکچرر', description: 'Huasheng Packaging کے بارے میں جانیں، 1997 میں قائم ہونے والا چین میں لچکدار پیکیجنگ مینوفیکچرر۔ عالمی برانڈز کے لیے حسب ضرورت پاؤچز، رول فلم اور پیکیجنگ حل۔' },
    ar: { title: 'حول Huasheng Packaging | مصنع تغليف مرن في الصين', description: 'تعرف على Huasheng Packaging، مصنع تغليف مرن في الصين تأسس عام 1997. أكياس مخصصة وأفلام رول وحلول تغليف للعلامات التجارية العالمية.' },
    es: { title: 'Acerca de Huasheng Packaging | Fabricante de Envases Flexibles en China', description: 'Conozca Huasheng Packaging, un fabricante de envases flexibles con sede en China establecido en 1997. Bolsas personalizadas, film en rollo y soluciones de envasado para marcas globales.' },
    fr: { title: 'À Propos de Huasheng Packaging | Fabricant d\'Emballages Flexibles en Chine', description: 'Découvrez Huasheng Packaging, un fabricant chinois d\'emballages flexibles fondé en 1997. Pochettes personnalisées, film en rouleau et solutions d\'emballage pour marques mondiales.' },
    pt: { title: 'Sobre a Huasheng Packaging | Fabricante de Embalagens Flexíveis na China', description: 'Saiba mais sobre a Huasheng Packaging, fabricante chinês de embalagens flexíveis fundado em 1997. Bolsas personalizadas, filme em rolo e soluções de embalagem para marcas globais.' },
    de: { title: 'Über Huasheng Packaging | Hersteller flexibler Verpackungen in China', description: 'Erfahren Sie mehr über Huasheng Packaging, einen 1997 gegründeten chinesischen Hersteller flexibler Verpackungen. Maßgeschneiderte Beutel, Rollenfolie und Verpackungslösungen.' },
    vi: { title: 'Về Huasheng Packaging | Nhà Sản Xuất Bao Bì Mềm Tại Trung Quốc', description: 'Tìm hiểu về Huasheng Packaging, nhà sản xuất bao bì mềm tại Trung Quốc được thành lập năm 1997. Túi tùy chỉnh, màng cuộn và giải pháp đóng gói cho các thương hiệu toàn cầu.' },
    id: { title: 'Tentang Huasheng Packaging | Produsen Kemasan Fleksibel di Tiongkok', description: 'Pelajari tentang Huasheng Packaging, produsen kemasan fleksibel di Tiongkok yang didirikan pada tahun 1997. Kantong kustom, roll film, dan solusi pengemasan untuk merek global.' },
    tr: { title: 'Huasheng Packaging Hakkında | Çin\'de Esnek Ambalaj Üreticisi', description: '1997 yılında kurulan Çin merkezli esnek ambalaj üreticisi Huasheng Packaging hakkında bilgi edinin. Küresel markalar için özel poşetler, rulo film ve ambalaj çözümleri.' },
    ja: { title: 'Huasheng Packagingについて | 中国の軟包装メーカー', description: '1997年創業の中国の軟包装メーカー、Huasheng Packagingについてご紹介します。グローバルブランド向けのカスタムパウチ、ロールフィルム、包装ソリューション。' },
    ko: { title: 'Huasheng Packaging 소개 | 중국 연포장 제조업체', description: '1997년에 설립된 중국 연포장 제조업체 Huasheng Packaging에 대해 알아보세요. 글로벌 브랜드를 위한 맞춤형 파우치, 롤 필름 및 포장 솔루션.' },
    th: { title: 'เกี่ยวกับ Huasheng Packaging | ผู้ผลิตบรรจุภัณฑ์อ่อนตัวในจีน', description: 'เรียนรู้เกี่ยวกับ Huasheng Packaging ผู้ผลิตบรรจุภัณฑ์อ่อนตัวในจีนที่ก่อตั้งขึ้นในปี 1997 ซองแบบกำหนดเอง ฟิล์มม้วน และโซลูชันบรรจุภัณฑ์สำหรับแบรนด์ระดับโลก' },
    hi: { title: 'Huasheng Packaging के बारे में | चीन में लचीली पैकेजिंग निर्माता', description: '1997 में स्थापित चीन स्थित लचीली पैकेजिंग निर्माता Huasheng Packaging के बारे में जानें। वैश्विक ब्रांडों के लिए कस्टम पाउच, रोल फिल्म और पैकेजिंग समाधान।' },
  },
  'about-us': {
    en: { title: 'About Us | Huasheng Packaging', description: 'Learn about Huasheng Packaging — a flexible packaging manufacturer in China since 1997. We serve food, beverage, pet food and consumer brands worldwide.' },
    zh: { title: '关于我们 | 华胜包装', description: '了解华胜包装——一家始于1997年的中国软包装制造商。我们服务于全球食品、饮料、宠物食品和消费品牌。' },
    ru: { title: 'О нас | Huasheng Packaging', description: 'Узнайте о Huasheng Packaging — производителе гибкой упаковки в Китае с 1997 года. Мы обслуживаем бренды продуктов питания, напитков, кормов для животных и потребительских товаров.' },
    ur: { title: 'ہمارے بارے میں | Huasheng Packaging', description: 'Huasheng Packaging کے بارے میں جانیں — 1997 سے چین میں لچکدار پیکیجنگ مینوفیکچرر۔ ہم دنیا بھر میں خوراک، مشروبات، پیٹ فوڈ اور کنزیومر برانڈز کی خدمت کرتے ہیں۔' },
  },
  contact: {
    en: { title: 'Contact Huasheng Packaging | Request a Quote for Custom Packaging', description: 'Contact Huasheng Packaging for custom flexible packaging quotation. Send your requirements for stand up pouches, coffee bags, spout pouches or roll film.' },
    zh: { title: '联系华胜包装 | 获取定制包装报价', description: '联系华胜包装获取定制软包装报价。发送您的自立袋、咖啡袋、吸嘴袋或印刷卷膜需求。' },
    ru: { title: 'Связаться с Huasheng Packaging | Запросить расчет', description: 'Свяжитесь с Huasheng Packaging для расчета индивидуальной гибкой упаковки. Отправьте требования к дой-пакам, кофейным пакетам, пакетам с носиком или рулонной пленке.' },
    ur: { title: 'Huasheng Packaging سے رابطہ کریں | حسب ضرورت پیکیجنگ کے لیے کوٹیشن کی درخواست', description: 'حسب ضرورت لچکدار پیکیجنگ کوٹیشن کے لیے Huasheng Packaging سے رابطہ کریں۔ اسٹینڈ اپ پاؤچز، کافی بیگز، اسپاؤٹ پاؤچز یا رول فلم کے لیے اپنی ضروریات بھیجیں۔' },
    ar: { title: 'اتصل بنا | Huasheng Packaging', description: 'اتصل بـ Huasheng Packaging للحصول على عرض أسعار للتغليف المرن المخصص. أرسل متطلباتك للأكياس القائمة أو أكياس القهوة أو الأكياس ذات الصنبور أو أفلام الرول.' },
    es: { title: 'Contacte con Huasheng Packaging | Solicite Presupuesto', description: 'Contacte con Huasheng Packaging para obtener un presupuesto de envases flexibles personalizados. Envíe sus requisitos para bolsas doypack, bolsas de café, bolsas con boquilla o film en rollo.' },
    fr: { title: 'Contactez Huasheng Packaging | Demandez un Devis', description: 'Contactez Huasheng Packaging pour un devis d\'emballages flexibles personnalisés. Envoyez vos exigences pour pochettes stand-up, sachets café, pochettes à bec verseur ou film en rouleau.' },
    pt: { title: 'Contate a Huasheng Packaging | Solicite um Orçamento', description: 'Entre em contato com a Huasheng Packaging para obter um orçamento de embalagens flexíveis personalizadas. Envie seus requisitos para bolsas stand-up, bolsas de café, bolsas com bico ou filme em rolo.' },
    de: { title: 'Kontaktieren Sie Huasheng Packaging | Angebot Anfordern', description: 'Kontaktieren Sie Huasheng Packaging für ein Angebot für flexible Verpackungen. Senden Sie Ihre Anforderungen für Standbodenbeutel, Kaffeebeutel, Ausgießbeutel oder Rollenfolie.' },
    vi: { title: 'Liên Hệ Huasheng Packaging | Yêu Cầu Báo Giá', description: 'Liên hệ Huasheng Packaging để được báo giá bao bì mềm tùy chỉnh. Gửi yêu cầu của bạn cho túi đứng, túi cà phê, túi có vòi hoặc màng cuộn.' },
    id: { title: 'Hubungi Huasheng Packaging | Minta Penawaran', description: 'Hubungi Huasheng Packaging untuk penawaran kemasan fleksibel kustom. Kirimkan kebutuhan Anda untuk standing pouch, coffee bag, spout pouch, atau roll film.' },
    tr: { title: 'Huasheng Packaging ile İletişime Geçin | Teklif İsteyin', description: 'Özel esnek ambalaj teklifi için Huasheng Packaging ile iletişime geçin. Stand-up poşetler, kahve poşetleri, ağızlıklı poşetler veya rulo film için gereksinimlerinizi gönderin.' },
    ja: { title: 'Huasheng Packagingへのお問い合わせ | お見積り依頼', description: 'カスタム軟包装の見積りはHuasheng Packagingまでお問い合わせください。スタンドアップパウチ、コーヒーバッグ、スパウトパウチ、ロールフィルムのご要望をお送りください。' },
    ko: { title: 'Huasheng Packaging 문의 | 맞춤형 포장 견적 요청', description: '맞춤형 연포장 견적을 위해 Huasheng Packaging에 문의하세요. 스탠드업 파우치, 커피 백, 스파우트 파우치 또는 롤 필름에 대한 요구 사항을 보내주세요.' },
    th: { title: 'ติดต่อ Huasheng Packaging | ขอใบเสนอราคา', description: 'ติดต่อ Huasheng Packaging เพื่อขอใบเสนอราคาบรรจุภัณฑ์อ่อนตัวแบบกำหนดเอง ส่งความต้องการของคุณสำหรับถุงตั้งได้ ถุงกาแฟ ถุงมีหู หรือฟิล์มม้วน' },
    hi: { title: 'Huasheng Packaging से संपर्क करें | कोटेशन का अनुरोध करें', description: 'कस्टम लचीली पैकेजिंग कोटेशन के लिए Huasheng Packaging से संपर्क करें। स्टैंड अप पाउच, कॉफी बैग, स्पाउट पाउच या रोल फिल्म के लिए अपनी आवश्यकताएं भेजें।' },
  },
  blog: {
    en: { title: 'Flexible Packaging Blog | Insights & Guides | Huasheng Packaging', description: 'Read flexible packaging guides and insights. Learn about packaging materials, pouch types, artwork preparation, filling and sealing, and machine compatibility.' },
    zh: { title: '软包装博客 | 指南与洞察 | 华胜包装', description: '阅读软包装指南和行业洞察。了解包装材料、袋型、设计稿准备、灌装封口和机器兼容性。' },
    ru: { title: 'Блог о гибкой упаковке | Руководства | Huasheng Packaging', description: 'Читайте руководства и статьи о гибкой упаковке. Узнайте о материалах, типах пакетов, подготовке макетов, розливе и герметизации.' },
    ur: { title: 'لچکدار پیکیجنگ بلاگ | گائیڈز اور بصیرتیں | Huasheng Packaging', description: 'لچکدار پیکیجنگ گائیڈز اور بصیرتیں پڑھیں۔ پیکیجنگ مواد، پاؤچ اقسام، آرٹ ورک کی تیاری، فلنگ اور سیلنگ کے بارے میں جانیں۔' },
    ar: { title: 'مدونة التغليف المرن | أدلة ورؤى | Huasheng Packaging', description: 'اقرأ أدلة ورؤى حول التغليف المرن. تعرف على مواد التغليف وأنواع الأكياس وتحضير الأعمال الفنية والتعبئة والختم.' },
    es: { title: 'Blog de Envases Flexibles | Guías y Perspectivas | Huasheng Packaging', description: 'Lea guías y perspectivas sobre envasado flexible. Conozca materiales de envasado, tipos de bolsas, preparación de arte, llenado y sellado.' },
    fr: { title: 'Blog Emballages Flexibles | Guides et Aperçus | Huasheng Packaging', description: 'Lisez des guides et aperçus sur les emballages flexibles. Découvrez les matériaux, les types de pochettes, la préparation des fichiers, le remplissage et le scellage.' },
    pt: { title: 'Blog de Embalagens Flexíveis | Guias e Insights | Huasheng Packaging', description: 'Leia guias e insights sobre embalagens flexíveis. Aprenda sobre materiais, tipos de bolsas, preparação de arte, enchimento e selagem.' },
    de: { title: 'Flexible Verpackungen Blog | Leitfäden & Einblicke | Huasheng Packaging', description: 'Lesen Sie Leitfäden und Einblicke zu flexiblen Verpackungen. Erfahren Sie mehr über Materialien, Beuteltypen, Druckvorlagenvorbereitung, Befüllung und Versiegelung.' },
    vi: { title: 'Blog Bao Bì Mềm | Hướng Dẫn & Thông Tin | Huasheng Packaging', description: 'Đọc hướng dẫn và thông tin về bao bì mềm. Tìm hiểu về vật liệu đóng gói, loại túi, chuẩn bị tệp in, đổ đầy và hàn kín.' },
    id: { title: 'Blog Kemasan Fleksibel | Panduan & Wawasan | Huasheng Packaging', description: 'Baca panduan dan wawasan tentang kemasan fleksibel. Pelajari tentang bahan kemasan, jenis kantong, persiapan artwork, pengisian dan penyegelan.' },
    tr: { title: 'Esnek Ambalaj Blogu | Rehberler ve İçgörüler | Huasheng Packaging', description: 'Esnek ambalaj rehberleri ve içgörüleri okuyun. Ambalaj malzemeleri, poşet türleri, tasarım hazırlığı, dolum ve mühürleme hakkında bilgi edinin.' },
    ja: { title: '軟包装ブログ | ガイドと洞察 | Huasheng Packaging', description: '軟包装に関するガイドと洞察をお読みください。包装材料、パウチの種類、アートワーク準備、充填と密封について学びましょう。' },
    ko: { title: '연포장 블로그 | 가이드 및 인사이트 | Huasheng Packaging', description: '연포장 가이드와 인사이트를 읽어보세요. 포장 재료, 파우치 유형, 아트워크 준비, 충전 및 밀봉에 대해 알아보세요.' },
    th: { title: 'บล็อกบรรจุภัณฑ์อ่อนตัว | คู่มือและข้อมูลเชิงลึก | Huasheng Packaging', description: 'อ่านคู่มือและข้อมูลเชิงลึกเกี่ยวกับบรรจุภัณฑ์อ่อนตัว เรียนรู้เกี่ยวกับวัสดุบรรจุภัณฑ์ ประเภทถุง การเตรียมอาร์ตเวิร์ค การเติมและการปิดผนึก' },
    hi: { title: 'लचीली पैकेजिंग ब्लॉग | गाइड और अंतर्दृष्टि | Huasheng Packaging', description: 'लचीली पैकेजिंग गाइड और अंतर्दृष्टि पढ़ें। पैकेजिंग सामग्री, पाउच प्रकार, आर्टवर्क तैयारी, भराई और सीलिंग के बारे में जानें।' },
  },
  'quality-control': {
    en: { title: 'Quality Control in Flexible Packaging | Huasheng Packaging', description: 'Our quality control process for flexible packaging: pre-production review, in-production checks, and post-production inspection. Lab testing for sealing strength, barrier and safety.' },
    zh: { title: '软包装质量控制 | 华胜包装', description: '我们的软包装质量控制流程：生产前评审、生产中检查和生产后检验。封口强度、阻隔性和安全性的实验室测试。' },
    ru: { title: 'Контроль качества гибкой упаковки | Huasheng Packaging', description: 'Наш процесс контроля качества гибкой упаковки: предпроизводственная проверка, контроль в процессе и послепроизводственная инспекция.' },
    ur: { title: 'لچکدار پیکیجنگ میں کوالٹی کنٹرول | Huasheng Packaging', description: 'لچکدار پیکیجنگ کے لیے ہمارا کوالٹی کنٹرول عمل: پری پروڈکشن جائزہ، ان پروڈکشن چیکس، اور پوسٹ پروڈکشن معائنہ۔' },
  },
  'custom-process': {
    en: { title: 'Custom Packaging Order Process | Huasheng Packaging', description: 'Step-by-step guide to ordering custom flexible packaging. From consultation and artwork to production and shipping. Transparent process for global buyers.' },
    zh: { title: '定制包装订购流程 | 华胜包装', description: '订购定制软包装的分步指南。从咨询、设计到生产和运输。为全球买家提供透明流程。' },
    ru: { title: 'Процесс заказа индивидуальной упаковки | Huasheng Packaging', description: 'Пошаговое руководство по заказу индивидуальной гибкой упаковки. От консультации и макета до производства и отгрузки.' },
    ur: { title: 'حسب ضرورت پیکیجنگ آرڈر کا عمل | Huasheng Packaging', description: 'حسب ضرورت لچکدار پیکیجنگ آرڈر کرنے کے لیے مرحلہ وار گائیڈ۔ مشاورت اور آرٹ ورک سے لے کر پیداوار اور شپمنٹ تک۔' },
  },
  certificates: {
    en: { title: 'Certificates & Accreditations | Huasheng Packaging', description: 'View Huasheng Packaging certifications and accreditations. ISO22000 certified food safety management system for food-grade flexible packaging production.' },
    zh: { title: '证书与资质 | 华胜包装', description: '查看华胜包装的认证和资质。ISO、迪士尼ILS审核、食品安全和质量管理体系认证。' },
    ru: { title: 'Сертификаты и аккредитации | Huasheng Packaging', description: 'ISO22000 certified food safety management system for food-grade flexible packaging production.' },
    ur: { title: 'سرٹیفکیٹس اور ایکریڈیٹیشنز | Huasheng Packaging', description: 'ISO22000 certified food safety management system for food-grade flexible packaging production.' },
  },
  factory: {
    en: { title: 'Factory & Production Facility | Huasheng Packaging', description: 'Tour our 6,880 sqm flexible packaging factory in China. High-speed gravure printing, solvent-free lamination, automated pouch making and quality control lab.' },
    zh: { title: '工厂与生产设施 | 华胜包装', description: '参观我们位于中国的6,880平方米软包装工厂。高速凹版印刷、无溶剂复合、自动化制袋和质量控制实验室。' },
    ru: { title: 'Завод и производственный комплекс | Huasheng Packaging', description: 'Посетите наш завод гибкой упаковки площадью 6 880 кв. м в Китае. Высокоскоростная глубокая печать, бессольвентная ламинация, автоматическое изготовление пакетов.' },
    ur: { title: 'فیکٹری اور پیداواری سہولت | Huasheng Packaging', description: 'چین میں ہماری 6,880 مربع میٹر کی لچکدار پیکیجنگ فیکٹری کا دورہ کریں۔ تیز رفتار گریوور پرنٹنگ، سالوینٹ فری لیمینیشن، خودکار پاؤچ بنانا اور کوالٹی کنٹرول لیب۔' },
  },
  faq: {
    en: { title: 'Custom Flexible Packaging FAQ | Huasheng Packaging', description: 'Frequently asked questions about custom flexible packaging, including MOQ, samples, lead time, material structure, payment terms and artwork preparation.' },
    zh: { title: '定制软包装常见问题 | 华胜包装', description: '定制软包装常见问题解答，涵盖起订量、样品、交期、材料结构、付款方式和设计稿准备等内容。' },
  },
  homepage: {
    en: { title: 'Custom Flexible Packaging Manufacturer | Huasheng Packaging', description: 'ISO22000 certified flexible packaging manufacturer in China. Huasheng Packaging supplies custom food packaging roll film, spout pouches, coffee bags, flat bottom pouches and stand up zipper pouches for global buyers.' },
    zh: { title: '定制软包装制造商 | 华胜包装', description: 'ISO22000认证柔性包装制造商。华胜包装为全球买家提供定制软包装，包括印刷卷膜、吸嘴袋、咖啡袋、八边封平底袋和食品包装袋。' },
    ar: { title: 'مصنع تغليف مرن مخصص | Huasheng Packaging', description: 'توفر Huasheng Packaging تغليفًا مرنًا مخصصًا بما في ذلك أفلام الرول والأكياس ذات الصنبور وأكياس القهوة والأكياس ذات القاع المسطح وأكياس تغليف المواد الغذائية للمشترين العالميين.' },
    ur: { title: 'حسب ضرورت لچکدار پیکیجنگ مینوفیکچرر | Huasheng Packaging', description: 'Huasheng Packaging عالمی خریداروں کے لیے حسب ضرورت لچکدار پیکیجنگ فراہم کرتی ہے جس میں رول فلم، اسپاؤٹ پاؤچز، کافی بیگز، فلیٹ باٹم پاؤچز اور فوڈ پیکیجنگ بیگز شامل ہیں۔' },
    es: { title: 'Fabricante de Envases Flexibles Personalizados | Huasheng Packaging', description: 'Huasheng Packaging suministra envases flexibles personalizados: film en rollo, bolsas con boquilla, bolsas para café, bolsas de fondo plano y bolsas para alimentos para compradores globales.' },
    fr: { title: 'Fabricant d\'Emballages Flexibles Personnalisés | Huasheng Packaging', description: 'Huasheng Packaging fournit des emballages flexibles personnalisés : film en rouleau, pochettes à bec verseur, sachets café, pochettes à fond plat et sachets alimentaires pour acheteurs mondiaux.' },
    ru: { title: 'Производитель гибкой упаковки на заказ | Huasheng Packaging', description: 'Huasheng Packaging поставляет гибкую упаковку на заказ: рулонную пленку, пакеты с носиком, кофейные пакеты, пакеты с плоским дном и упаковку для пищевых продуктов для покупателей со всего мира.' },
    pt: { title: 'Fabricante de Embalagens Flexíveis Personalizadas | Huasheng Packaging', description: 'A Huasheng Packaging fornece embalagens flexíveis personalizadas, incluindo filme em rolo, bolsas com bico, bolsas para café, bolsas de fundo plano e sacos para alimentos para compradores globais.' },
    de: { title: 'Hersteller kundenspezifischer flexibler Verpackungen | Huasheng Packaging', description: 'Huasheng Packaging liefert kundenspezifische flexible Verpackungen: Rollenfolie, Ausgießbeutel, Kaffeebeutel, Flachbodenbeutel und Lebensmittelverpackungen für globale Käufer.' },
    vi: { title: 'Nhà Sản Xuất Bao Bì Mềm Tùy Chỉnh | Huasheng Packaging', description: 'Huasheng Packaging cung cấp bao bì mềm tùy chỉnh bao gồm màng cuộn, túi có vòi, túi cà phê, túi đáy phẳng và túi đựng thực phẩm cho người mua toàn cầu.' },
    id: { title: 'Produsen Kemasan Fleksibel Kustom | Huasheng Packaging', description: 'Huasheng Packaging menyediakan kemasan fleksibel kustom termasuk roll film, spout pouch, coffee bag, flat bottom pouch, dan kantong kemasan makanan untuk pembeli global.' },
    tr: { title: 'Özel Esnek Ambalaj Üreticisi | Huasheng Packaging', description: 'Huasheng Packaging, küresel alıcılar için rulo film, ağızlıklı poşet, kahve poşeti, düz tabanlı poşet ve gıda ambalaj poşetleri dahil özel esnek ambalaj tedarik etmektedir.' },
    ja: { title: 'カスタム軟包装メーカー | Huasheng Packaging', description: 'Huasheng Packagingは、ロールフィルム、スパウトパウチ、コーヒーバッグ、フラットボトムパウチ、食品包装袋などのカスタム軟包装をグローバルバイヤーに提供しています。' },
    ko: { title: '맞춤형 연포장 제조업체 | Huasheng Packaging', description: 'Huasheng Packaging은 글로벌 바이어에게 롤 필름, 스파우트 파우치, 커피 백, 플랫 바텀 파우치, 식품 포장 봉투 등 맞춤형 연포장을 공급합니다.' },
    th: { title: 'ผู้ผลิตบรรจุภัณฑ์อ่อนตัวแบบกำหนดเอง | Huasheng Packaging', description: 'Huasheng Packaging จัดหาบรรจุภัณฑ์อ่อนตัวแบบกำหนดเอง รวมถึงฟิล์มม้วน ถุงมีหู ถุงกาแฟ ถุงก้นแบน และถุงบรรจุอาหารสำหรับผู้ซื้อทั่วโลก' },
    hi: { title: 'कस्टम लचीली पैकेजिंग निर्माता | Huasheng Packaging', description: 'Huasheng Packaging वैश्विक खरीदारों के लिए रोल फिल्म, स्पाउट पाउच, कॉफी बैग, फ्लैट बॉटम पाउच और खाद्य पैकेजिंग बैग सहित कस्टम लचीली पैकेजिंग की आपूर्ति करता है।' },
  },
  'packaging-guides': {
    en: { title: 'Packaging Materials & Printing Guides | Huasheng Packaging', description: 'Practical guides on flexible packaging materials, gravure printing, artwork preparation, MOQ and cost, liquid packaging, coffee bags, retort sterilization and easy-open design.' },
    zh: { title: '包装材料与印刷指南 | 华胜包装', description: '软包装材料、凹版印刷、设计稿准备、起订量与成本、液体包装、咖啡袋、蒸煮杀菌和易开启设计的实用指南。' },
  },
};

// ---- Helper functions ----

export function getCanonicalSlug(routeType, slug) {
  if (routeType === 'product') {
    // Check alias map first
    if (PRODUCT_ALIAS_MAP[slug]) return PRODUCT_ALIAS_MAP[slug];
    // Check if slug is already a canonical key in PRODUCT_SEO
    if (PRODUCT_SEO[slug]) return slug;
    // Check if slug is a canonical value (reverse lookup — it's already the target)
    for (const v of Object.values(PRODUCT_ALIAS_MAP)) {
      if (v === slug) return slug;
    }
    return slug;
  }
  if (routeType === 'application') {
    if (APP_ALIAS_MAP[slug]) return APP_ALIAS_MAP[slug];
    if (APP_SEO[slug]) return slug;
    return slug;
  }
  return slug;
}

export function getLocaleData(map, slug, lang, fallbackLang = 'en') {
  const entry = map[slug];
  if (!entry) return null;
  if (entry[lang]) return entry[lang];
  if (entry[fallbackLang]) return entry[fallbackLang];
  // Try 'en' as ultimate fallback
  if (entry.en) return entry.en;
  return null;
}

export function buildUrl(lang, routeType, slug) {
  let path;
  switch (routeType) {
    case 'homepage':
      path = '';
      break;
    case 'products-listing':
      path = 'products';
      break;
    case 'apps-listing':
      path = 'applications';
      break;
    case 'product':
      path = `products/${slug}`;
      break;
    case 'application':
      path = `applications/${slug}`;
      break;
    case 'blog-detail':
      path = `blog/${slug}`;
      break;
    case 'blog-listing':
      path = 'blog';
      break;
    case 'static-page':
      path = slug;
      break;
    case 'solution-detail':
      path = `solutions/${slug}`;
      break;
    case 'solutions-listing':
      path = 'solutions';
      break;
    default:
      path = '';
  }
  if (path === '') return lang === 'en' ? BASE_URL : `${BASE_URL}/${lang}/`;
  return lang === 'en' ? `${BASE_URL}/${path}` : `${BASE_URL}/${lang}/${path}`;
}

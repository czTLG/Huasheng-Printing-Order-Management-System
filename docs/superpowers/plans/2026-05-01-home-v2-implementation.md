# Home V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new static homepage at `/home-v2/` that keeps the old homepage intact while tightening section rhythm, focusing the content on flexible packaging conversion, and adding a front-end-only quote form.

**Architecture:** Implement a single standalone static HTML file at `public/home-v2/index.html`. Reuse local visual assets from `public/overseas-b2b/assets/`, keep all interactivity client-side with a small inline script for EN/中文 toggling, FAQ collapse behavior, and fake quote-form submission, and avoid touching the existing `public/overseas-b2b/index.html`.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, existing local image assets in `public/overseas-b2b/assets`

---

## File Structure

- Create: `public/home-v2/index.html`
- Reference only: `public/overseas-b2b/index.html`
- Reference only: `public/overseas-b2b/privacy.html`
- Reference only: `public/overseas-b2b/sitemap.xml`
- Reference only: `public/overseas-b2b/assets/brand/logo.svg`
- Reference only: `public/overseas-b2b/assets/real2/*`
- Reference only: `public/overseas-b2b/assets/real3/*`
- Modify: `docs/superpowers/plans/2026-05-01-home-v2-implementation.md` only if the plan needs review fixes before execution

### Task 1: Scaffold The New Static Route

**Files:**
- Create: `public/home-v2/index.html`
- Reference: `public/overseas-b2b/index.html`

- [ ] **Step 1: Write the initial static shell**

Create `public/home-v2/index.html` with this minimum document shell so the route exists before styling:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Huasheng Flexible Packaging | Home V2</title>
</head>
<body>
  <main>Home V2</main>
</body>
</html>
```

- [ ] **Step 2: Verify the new file exists**

Run: `test -f public/home-v2/index.html && echo OK`
Expected: `OK`

- [ ] **Step 3: Replace the shell with the page frame**

Replace the minimal body with these top-level sections in order:

```html
<body>
  <div class="topbar"></div>
  <header class="site-header"></header>
  <main>
    <section id="hero"></section>
    <section id="stats"></section>
    <section id="products"></section>
    <section id="trust"></section>
    <section id="capabilities"></section>
    <section id="selector-banner"></section>
    <section id="why-choose"></section>
    <section id="faq"></section>
    <section id="quote"></section>
  </main>
  <footer class="site-footer"></footer>
  <script>
  </script>
</body>
```

- [ ] **Step 4: Verify the section skeleton was written**

Run: `rg -n "id=\"hero\"|id=\"quote\"|class=\"site-footer\"" public/home-v2/index.html`
Expected: Matches for the hero, quote, and footer containers

- [ ] **Step 5: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: scaffold home-v2 static landing page"
```

### Task 2: Add The Shared Page Styling And Spacing System

**Files:**
- Modify: `public/home-v2/index.html`

- [ ] **Step 1: Add the base CSS tokens and layout helpers**

Insert a `<style>` block in the head with these baseline tokens and shared helpers:

```css
:root{
  --bg:#edf3fb;
  --surface:#ffffff;
  --surface-2:#f7fbff;
  --line:#d7e2ef;
  --line-strong:#b8c9de;
  --text:#162033;
  --muted:#5d6b80;
  --brand:#0f3d73;
  --brand-2:#1d5fa8;
  --brand-soft:#e8f1fb;
  --accent:#d88a2d;
  --shadow:0 18px 45px rgba(15,31,56,.08);
  --radius-lg:24px;
  --radius-md:18px;
  --radius-sm:12px;
  --container:1240px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  font-family:Inter,"Segoe UI",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--text);
  background:
    radial-gradient(circle at top left, rgba(29,95,168,.10), transparent 32%),
    linear-gradient(180deg,#f8fbff 0%, var(--bg) 100%);
}
a{text-decoration:none;color:inherit}
img{display:block;max-width:100%}
.wrap{max-width:var(--container);margin:0 auto;padding:0 20px}
.section{padding:44px 0}
.section-tight{padding:40px 0}
.eyebrow{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:999px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.75);
  color:var(--brand);
  font-size:12px;
  font-weight:800;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.section-title{
  margin:14px 0 10px;
  font-size:clamp(30px,4vw,48px);
  line-height:1.08;
  color:var(--brand);
}
.section-title small{
  display:block;
  margin-top:8px;
  color:var(--muted);
  font-size:.42em;
  font-weight:700;
  letter-spacing:0;
  text-transform:none;
}
.section-copy{
  margin:0;
  max-width:760px;
  color:var(--muted);
  font-size:16px;
  line-height:1.7;
}
.card{
  background:rgba(255,255,255,.94);
  border:1px solid var(--line);
  border-radius:var(--radius-md);
  box-shadow:var(--shadow);
}
@media (min-width: 960px){
  .section{padding:72px 0}
  .section-tight{padding:64px 0}
}
```

- [ ] **Step 2: Verify spacing helpers are present**

Run: `rg -n "section-tight|--container|section-title" public/home-v2/index.html`
Expected: CSS definitions for the shared spacing and typography helpers

- [ ] **Step 3: Add responsive guardrails**

Append these media rules to the same `<style>` block:

```css
@media (max-width: 959px){
  .wrap{padding:0 16px}
}
@media (max-width: 640px){
  .section{padding:40px 0}
  .section-tight{padding:40px 0}
  .section-title{font-size:clamp(26px,8vw,36px)}
  .section-copy{font-size:15px}
}
```

- [ ] **Step 4: Run a quick file sanity read**

Run: `sed -n '1,220p' public/home-v2/index.html`
Expected: Head section includes the shared style system and responsive spacing rules

- [ ] **Step 5: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 layout and spacing system"
```

### Task 3: Implement Header, Hero, And Stats Strip

**Files:**
- Modify: `public/home-v2/index.html`
- Reference: `public/overseas-b2b/assets/brand/logo.svg`
- Reference: `public/overseas-b2b/assets/real3/file_187---6f25ff28-da9b-42c0-8226-b5be4dc547ed.jpg`
- Reference: `public/overseas-b2b/assets/real3/file_190---c6188b6f-cc9e-4325-9d58-be53825a258b.jpg`

- [ ] **Step 1: Add the header markup**

Replace the empty header with this structure:

```html
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="#hero" aria-label="Huasheng Flexible Packaging">
      <img src="/overseas-b2b/assets/brand/logo.svg" alt="Huasheng logo" />
      <span>
        <strong>Huasheng Flexible Packaging</strong>
        <em>华胜软包装定制工厂</em>
      </span>
    </a>
    <nav class="main-nav" aria-label="Primary">
      <a href="#products" data-i18n="nav_products">Products</a>
      <a href="#capabilities" data-i18n="nav_capabilities">Capabilities</a>
      <a href="#faq" data-i18n="nav_faq">FAQ</a>
      <a href="#quote" data-i18n="nav_quote">Get a Quote</a>
    </nav>
    <div class="header-actions">
      <div class="lang-switch" role="group" aria-label="Language">
        <button type="button" class="is-on" data-lang="en">EN</button>
        <button type="button" data-lang="zh">中文</button>
      </div>
      <a class="btn btn-primary" href="#quote" data-i18n="cta_quote">Get a Quote</a>
    </div>
  </div>
</header>
```

- [ ] **Step 2: Add the hero and stats markup**

Replace the empty `#hero` and `#stats` sections with:

```html
<section id="hero" class="hero-shell">
  <div class="wrap">
    <div class="hero-card">
      <div class="hero-media">
        <img id="hero-image" src="/overseas-b2b/assets/real3/file_187---6f25ff28-da9b-42c0-8226-b5be4dc547ed.jpg" alt="Custom flexible packaging" />
      </div>
      <div class="hero-overlay">
        <span class="eyebrow" data-i18n="hero_tag">Custom Flexible Packaging Manufacturer</span>
        <h1 class="hero-title" data-i18n="hero_title">Custom Printed Pouches, Roll Stock Film, and Export-Ready Packaging</h1>
        <p class="hero-copy" data-i18n="hero_copy">Build retail-ready food packaging with direct factory support for printing, lamination, bag making, sampling, and export coordination.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#quote" data-i18n="cta_quote">Get a Quote</a>
          <a class="btn btn-secondary" href="#products" data-i18n="cta_manual">View Product Range</a>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="stats" class="section-tight">
  <div class="wrap">
    <div class="stats-grid">
      <article class="stat-card"><strong>Since 1997</strong><span data-i18n="stat_1">Trusted manufacturing timeline</span></article>
      <article class="stat-card"><strong>Custom Printing</strong><span data-i18n="stat_2">Rotogravure and tailored artwork output</span></article>
      <article class="stat-card"><strong>Lamination &amp; Bag Making</strong><span data-i18n="stat_3">Integrated downstream production control</span></article>
      <article class="stat-card"><strong>Food Packaging Experience</strong><span data-i18n="stat_4">Built for snacks, coffee, powders, and dry goods</span></article>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add the hero and header CSS**

Add CSS that enforces the required hero heights and keeps the header compact:

```css
.site-header{
  position:sticky;
  top:0;
  z-index:50;
  backdrop-filter:blur(14px);
  background:rgba(248,251,255,.88);
  border-bottom:1px solid rgba(184,201,222,.7);
}
.header-row{
  min-height:80px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
}
.brand{display:flex;align-items:center;gap:12px}
.brand img{width:42px;height:42px}
.brand strong{display:block;font-size:16px;color:var(--brand)}
.brand em{display:block;font-style:normal;font-size:12px;color:var(--muted)}
.main-nav{display:flex;gap:18px;font-size:14px;color:#31425e}
.header-actions{display:flex;align-items:center;gap:12px}
.lang-switch{display:flex;gap:8px}
.lang-switch button{
  border:1px solid var(--line-strong);
  background:#fff;
  color:var(--brand);
  border-radius:999px;
  padding:8px 12px;
  font:inherit;
  font-size:12px;
  font-weight:800;
  cursor:pointer;
}
.lang-switch .is-on{background:var(--brand);color:#fff;border-color:var(--brand)}
.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:46px;
  padding:0 18px;
  border-radius:999px;
  border:1px solid transparent;
  font-size:14px;
  font-weight:800;
}
.btn-primary{background:var(--brand);color:#fff}
.btn-secondary{background:rgba(255,255,255,.88);color:var(--brand);border-color:rgba(255,255,255,.6)}
.hero-shell{padding:24px 0 28px}
.hero-card{
  position:relative;
  min-height:520px;
  overflow:hidden;
  border-radius:28px;
  background:#0d2748;
}
.hero-media,.hero-media img{
  width:100%;
  height:100%;
}
.hero-media{position:absolute;inset:0}
.hero-media img{object-fit:cover;filter:brightness(.45)}
.hero-overlay{
  position:relative;
  z-index:1;
  display:flex;
  flex-direction:column;
  justify-content:flex-end;
  gap:18px;
  min-height:520px;
  padding:36px 28px;
  color:#fff;
}
.hero-title{margin:0;max-width:760px;font-size:clamp(34px,5vw,64px);line-height:1.02}
.hero-copy{margin:0;max-width:700px;font-size:17px;line-height:1.7;color:rgba(255,255,255,.86)}
.hero-actions{display:flex;flex-wrap:wrap;gap:12px}
.stats-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:14px;
}
.stat-card{
  padding:20px 18px;
  border-radius:18px;
  background:linear-gradient(180deg,#103a6a 0%,#0c2f54 100%);
  color:#fff;
}
.stat-card strong{display:block;font-size:19px;line-height:1.2}
.stat-card span{display:block;margin-top:8px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.74)}
@media (min-width: 768px){
  .hero-card,.hero-overlay{min-height:680px}
}
@media (min-width: 1200px){
  .hero-card,.hero-overlay{min-height:720px}
}
```

- [ ] **Step 4: Add mobile header handling**

Append this responsive CSS so the header compresses cleanly on small screens:

```css
@media (max-width: 959px){
  .header-row{flex-wrap:wrap;padding:14px 0}
  .main-nav{order:3;width:100%;overflow:auto;padding-bottom:2px}
  .header-actions{width:100%;justify-content:space-between}
  .stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width: 640px){
  .hero-shell{padding:18px 0 22px}
  .hero-card,.hero-overlay{min-height:520px}
  .hero-overlay{padding:24px 20px}
  .hero-copy{font-size:15px}
  .stats-grid{grid-template-columns:1fr}
}
```

- [ ] **Step 5: Verify the hero no longer uses full-screen height**

Run: `rg -n "h-screen|md:h-screen|min-height:680px|min-height:720px" public/home-v2/index.html`
Expected: No `h-screen` match and positive matches for `680px` and `720px`

- [ ] **Step 6: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 header hero and stats strip"
```

### Task 4: Implement The Six Core Product Cards And Compact Trust Strip

**Files:**
- Modify: `public/home-v2/index.html`
- Reference: `public/overseas-b2b/assets/real3/file_188---562a420d-784c-41ea-b4fd-907f2989eebd.jpg`
- Reference: `public/overseas-b2b/assets/real3/file_191---ab087bc7-dafc-41af-8cb6-1a1b4ccc701a.jpg`
- Reference: `public/overseas-b2b/assets/real3/file_193---46db1756-d3f2-4d84-9de1-3bf29ac4b60d.jpg`
- Reference: `public/overseas-b2b/assets/real3/file_194---c3a3ea3e-63ed-4f32-84b3-d5dbd2adedb1.jpg`
- Reference: `public/overseas-b2b/assets/real3/file_195---0975bb1d-f7d6-4782-8e10-878317f67d7f.jpg`

- [ ] **Step 1: Add the product section markup**

Replace the empty `#products` section with:

```html
<section id="products" class="section">
  <div class="wrap">
    <span class="eyebrow" data-i18n="products_tag">Core Products</span>
    <h2 class="section-title">Flexible Packaging Product Range<small data-i18n="products_title_zh">首页仅展示 6 个核心产品</small></h2>
    <p class="section-copy" data-i18n="products_copy">Focus the homepage on the pouch and film formats most buyers ask for first, then drive detailed inquiry from the quote form.</p>
    <div class="product-grid">
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_187---6f25ff28-da9b-42c0-8226-b5be4dc547ed.jpg" alt="Stand Up Pouches" /><div><h3>Stand Up Pouches</h3><p data-i18n="product_1">Retail-ready format for snacks, powders, and dry food packaging.</p></div></article>
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_188---562a420d-784c-41ea-b4fd-907f2989eebd.jpg" alt="Flat Bottom Pouches" /><div><h3>Flat Bottom Pouches</h3><p data-i18n="product_2">Stable shelf presence with stronger volume presentation for premium products.</p></div></article>
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_191---ab087bc7-dafc-41af-8cb6-1a1b4ccc701a.jpg" alt="Spout Pouches" /><div><h3>Spout Pouches</h3><p data-i18n="product_3">Convenient liquid and semi-liquid packaging for refill and drink applications.</p></div></article>
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_193---46db1756-d3f2-4d84-9de1-3bf29ac4b60d.jpg" alt="Coffee Bags" /><div><h3>Coffee Bags</h3><p data-i18n="product_4">Valve-ready and aroma-conscious packaging for coffee retail lines.</p></div></article>
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_194---c3a3ea3e-63ed-4f32-84b3-d5dbd2adedb1.jpg" alt="Roll Stock Film" /><div><h3>Roll Stock Film</h3><p data-i18n="product_5">Efficient film supply for automatic packing lines and downstream conversion.</p></div></article>
      <article class="product-card"><img src="/overseas-b2b/assets/real3/file_195---0975bb1d-f7d6-4782-8e10-878317f67d7f.jpg" alt="Custom Shaped Pouches" /><div><h3>Custom Shaped Pouches</h3><p data-i18n="product_6">Distinctive die-cut shapes for stronger shelf identity and campaign launches.</p></div></article>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add the product grid CSS**

Add:

```css
.product-grid{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:18px;
  margin-top:28px;
}
.product-card{
  display:grid;
  grid-template-rows:178px 1fr;
  min-height:280px;
  overflow:hidden;
}
.product-card img{
  width:100%;
  height:178px;
  object-fit:cover;
}
.product-card div{padding:18px}
.product-card h3{margin:0 0 8px;font-size:21px;color:var(--brand)}
.product-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.65}
```

- [ ] **Step 3: Add the trust strip markup and CSS**

Replace the empty `#trust` section with:

```html
<section id="trust" class="section-tight">
  <div class="wrap">
    <div class="trust-strip card">
      <span data-i18n="trust_label">Trusted for export-facing flexible packaging projects</span>
      <div class="trust-chips">
        <span>Food Packaging</span>
        <span>OEM / ODM</span>
        <span>Artwork Support</span>
        <span>Sampling</span>
        <span>Global Shipping</span>
      </div>
    </div>
  </div>
</section>
```

And add:

```css
.trust-strip{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:20px 24px;
}
.trust-strip > span{
  font-size:15px;
  font-weight:800;
  color:var(--brand);
}
.trust-chips{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
.trust-chips span{
  padding:9px 12px;
  border-radius:999px;
  background:var(--brand-soft);
  border:1px solid #c8d9eb;
  color:#26415f;
  font-size:12px;
  font-weight:800;
}
@media (max-width: 959px){
  .product-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .trust-strip{flex-direction:column;align-items:flex-start}
}
@media (max-width: 640px){
  .product-grid{grid-template-columns:1fr}
  .product-card{min-height:260px}
}
```

- [ ] **Step 4: Verify the homepage only contains six product cards**

Run: `rg -o "<article class=\"product-card\">" -N public/home-v2/index.html | wc -l`
Expected: `6`

- [ ] **Step 5: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 core products and trust strip"
```

### Task 5: Implement Manufacturing Capabilities And Selector Banner

**Files:**
- Modify: `public/home-v2/index.html`
- Reference: `public/overseas-b2b/assets/real2/file_185---b941afce-0135-457f-a1e1-6b665c6f2964.jpg`
- Reference: `public/overseas-b2b/assets/real2/file_181---16011c3b-336f-4e44-a58f-770b870a6f17.jpg`
- Reference: `public/overseas-b2b/assets/real2/file_183---7f71e14b-b825-4f84-8600-f96571ae1b14.jpg`
- Reference: `public/overseas-b2b/assets/real2/file_174---0cd481f9-7a51-4cb4-b555-367e62e829aa.jpg`

- [ ] **Step 1: Add the capabilities section markup**

Replace the empty `#capabilities` section with:

```html
<section id="capabilities" class="section">
  <div class="wrap">
    <span class="eyebrow" data-i18n="cap_tag">Manufacturing Capabilities</span>
    <h2 class="section-title">Manufacturing Capabilities<small>工厂生产能力</small></h2>
    <p class="section-copy" data-i18n="cap_copy">Keep this module focused on the four production stages that matter most for flexible packaging buyers evaluating a factory partner.</p>
    <div class="capabilities-shell">
      <div class="capabilities-intro card">
        <img src="/overseas-b2b/assets/real2/file_185---b941afce-0135-457f-a1e1-6b665c6f2964.jpg" alt="Huasheng production floor" />
        <div>
          <h3 data-i18n="cap_intro_title">Integrated in-house process for print, lamination, converting, and inspection</h3>
          <p data-i18n="cap_intro_copy">A shorter capability section works better on the homepage than a large gallery. Use one strong factory image plus four tight cards.</p>
        </div>
      </div>
      <div class="cap-grid">
        <article class="cap-card"><img src="/overseas-b2b/assets/real2/file_181---16011c3b-336f-4e44-a58f-770b870a6f17.jpg" alt="Gravure Printing" /><h3>Gravure Printing</h3><p data-i18n="cap_1">High-volume custom print output with controlled color consistency.</p></article>
        <article class="cap-card"><img src="/overseas-b2b/assets/real2/file_183---7f71e14b-b825-4f84-8600-f96571ae1b14.jpg" alt="Solventless Lamination" /><h3>Solventless Lamination</h3><p data-i18n="cap_2">Flexible structure building for barrier, stiffness, and food-packaging requirements.</p></article>
        <article class="cap-card"><img src="/overseas-b2b/assets/real2/file_174---0cd481f9-7a51-4cb4-b555-367e62e829aa.jpg" alt="Automatic Bag Making" /><h3>Automatic Bag Making</h3><p data-i18n="cap_3">Repeatable pouch conversion for stand-up, flat-bottom, and shaped formats.</p></article>
        <article class="cap-card"><img src="/overseas-b2b/assets/real2/file_185---b941afce-0135-457f-a1e1-6b665c6f2964.jpg" alt="Quality Inspection" /><h3>Quality Inspection</h3><p data-i18n="cap_4">Inspection checkpoints for sealing, registration, visual defects, and batch consistency.</p></article>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add the capabilities CSS with height control**

Add:

```css
.capabilities-shell{
  display:grid;
  grid-template-columns:1.02fr .98fr;
  gap:18px;
  margin-top:28px;
  min-height:690px;
}
.capabilities-intro{
  overflow:hidden;
  display:grid;
  grid-template-rows:380px 1fr;
}
.capabilities-intro img{
  width:100%;
  height:380px;
  object-fit:cover;
}
.capabilities-intro div{padding:20px}
.capabilities-intro h3{margin:0 0 10px;font-size:28px;color:var(--brand);line-height:1.15}
.capabilities-intro p{margin:0;color:var(--muted);font-size:15px;line-height:1.75}
.cap-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:18px;
}
.cap-card{
  min-height:336px;
  overflow:hidden;
}
.cap-card img{
  width:100%;
  height:170px;
  object-fit:cover;
}
.cap-card h3{margin:18px 18px 8px;font-size:20px;color:var(--brand)}
.cap-card p{margin:0 18px 18px;color:var(--muted);font-size:14px;line-height:1.7}
@media (max-width: 959px){
  .capabilities-shell{grid-template-columns:1fr;min-height:auto}
}
@media (max-width: 640px){
  .cap-grid{grid-template-columns:1fr}
  .capabilities-intro{grid-template-rows:240px 1fr}
  .capabilities-intro img{height:240px}
}
```

- [ ] **Step 3: Add the packaging selector entry banner**

Replace the empty `#selector-banner` section with:

```html
<section id="selector-banner" class="section-tight">
  <div class="wrap">
    <a class="selector-banner card" href="/packaging-selector">
      <div>
        <span class="eyebrow" data-i18n="selector_tag">Packaging Selector</span>
        <h2 data-i18n="selector_title">Not sure which pouch format fits your product?</h2>
        <p data-i18n="selector_copy">Use the packaging selector to narrow structure, format, and production direction before you request a quote.</p>
      </div>
      <span class="selector-cta" data-i18n="selector_cta">Open Selector</span>
    </a>
  </div>
</section>
```

Add:

```css
.selector-banner{
  min-height:140px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:24px 28px;
  background:
    linear-gradient(135deg, rgba(15,61,115,.97), rgba(29,95,168,.92)),
    #0f3d73;
  color:#fff;
}
.selector-banner h2{margin:12px 0 8px;font-size:30px;line-height:1.1}
.selector-banner p{margin:0;max-width:760px;color:rgba(255,255,255,.82);line-height:1.65}
.selector-cta{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:160px;
  min-height:48px;
  padding:0 18px;
  border-radius:999px;
  background:#fff;
  color:var(--brand);
  font-size:14px;
  font-weight:800;
}
@media (max-width: 959px){
  .selector-banner{flex-direction:column;align-items:flex-start}
}
```

- [ ] **Step 4: Verify the selector is only a banner entry**

Run: `rg -n "packaging-selector|selector-banner|Open Selector" public/home-v2/index.html`
Expected: Matches for a single banner link to `/packaging-selector` and no large standalone selector content block

- [ ] **Step 5: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 capabilities and selector banner"
```

### Task 6: Implement Why Choose, FAQ, Quote Form, And Footer

**Files:**
- Modify: `public/home-v2/index.html`
- Reference: `public/overseas-b2b/privacy.html`
- Reference: `public/overseas-b2b/sitemap.xml`

- [ ] **Step 1: Add the Why Choose Huasheng section**

Replace the empty `#why-choose` section with:

```html
<section id="why-choose" class="section">
  <div class="wrap">
    <span class="eyebrow" data-i18n="why_tag">Why Choose Huasheng</span>
    <h2 class="section-title">Why Choose Huasheng<small data-i18n="why_title_zh">替代首页采购方案成本对比</small></h2>
    <div class="why-grid">
      <article class="why-card"><h3>Factory Direct Supply</h3><p data-i18n="why_1">Work directly with the production side for clearer quotation logic and lead-time control.</p></article>
      <article class="why-card"><h3>Custom Printing &amp; Lamination</h3><p data-i18n="why_2">Build pouch structures around artwork, barrier needs, and practical conversion constraints.</p></article>
      <article class="why-card"><h3>Flexible Packaging Solutions</h3><p data-i18n="why_3">Support multiple pouch, bag, and film formats instead of pushing a single standard structure.</p></article>
      <article class="why-card"><h3>Export Support</h3><p data-i18n="why_4">Help with sampling, communication, and shipment coordination for overseas orders.</p></article>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add FAQ markup with six collapsed questions**

Replace the empty `#faq` section with:

```html
<section id="faq" class="section-tight">
  <div class="wrap">
    <span class="eyebrow" data-i18n="faq_tag">FAQ</span>
    <h2 class="section-title">Frequently Asked Questions<small>常见问题</small></h2>
    <div class="faq-list">
      <details><summary data-i18n="faq_q1">What information do you need before quoting?</summary><p data-i18n="faq_a1">We usually need product type, bag size, material preference, quantity, and any existing artwork or reference image.</p></details>
      <details><summary data-i18n="faq_q2">Can you support custom printing and custom structure together?</summary><p data-i18n="faq_a2">Yes. Artwork, laminate structure, and bag format can be adjusted together during the quotation stage.</p></details>
      <details><summary data-i18n="faq_q3">Do you support low MOQ or trial orders?</summary><p data-i18n="faq_a3">We can discuss MOQ based on bag type, size, structure, and printing complexity.</p></details>
      <details><summary data-i18n="faq_q4">Can I send an existing packaging sample or reference image?</summary><p data-i18n="faq_a4">Yes. Reference images, competitor bags, and old artwork are useful for faster communication.</p></details>
      <details><summary data-i18n="faq_q5">Do you help with export communication and delivery?</summary><p data-i18n="faq_a5">Yes. The team can coordinate packaging details, production updates, and shipment communication for export orders.</p></details>
      <details><summary data-i18n="faq_q6">Can you recommend a suitable pouch structure if I am not sure?</summary><p data-i18n="faq_a6">Yes. Use the packaging selector first or send your product details in the quote form for guided recommendations.</p></details>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add the full quote form and fake success state container**

Replace the empty `#quote` section with:

```html
<section id="quote" class="section">
  <div class="wrap">
    <div class="quote-shell">
      <div class="quote-copy">
        <span class="eyebrow" data-i18n="quote_tag">Get a Quote</span>
        <h2 class="section-title">Start Your Packaging Inquiry<small>完整询盘表单</small></h2>
        <p class="section-copy" data-i18n="quote_copy">Use the form to send your packaging requirements. This version shows a front-end-only success state and does not submit to the backend yet.</p>
      </div>
      <form id="quote-form" class="quote-form card">
        <div class="field-grid">
          <label><span>Name</span><input name="name" required /></label>
          <label><span>Country / Region</span><input name="region" required /></label>
          <label><span>Email</span><input name="email" type="email" required /></label>
          <label><span>WhatsApp / Phone</span><input name="phone" required /></label>
          <label><span>Product Type</span><input name="productType" required /></label>
          <label><span>Bag Size</span><input name="bagSize" required /></label>
          <label><span>Material / Structure</span><input name="material" /></label>
          <label><span>Quantity</span><input name="quantity" required /></label>
        </div>
        <label><span>Upload Artwork / Reference Image</span><input name="artwork" type="file" accept="image/*,.pdf,.ai,.psd" /></label>
        <label><span>Message</span><textarea name="message" rows="6" required></textarea></label>
        <div class="quote-actions">
          <button type="submit" class="btn btn-primary" data-i18n="quote_submit">Submit Inquiry</button>
          <p id="quote-status" aria-live="polite" data-i18n="quote_note">Required fields only validate in the browser for now.</p>
        </div>
      </form>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Add the footer and remaining section CSS**

Replace the empty footer with:

```html
<footer class="site-footer">
  <div class="wrap footer-row">
    <div>
      <strong>Huasheng Flexible Packaging</strong>
      <p data-i18n="footer_copy">Custom printed pouches, roll stock film, and export support for global packaging buyers.</p>
    </div>
    <div class="footer-links">
      <a href="#quote" data-i18n="footer_quote">Get a Quote</a>
      <a href="/blog" data-i18n="footer_blog">Blog</a>
      <a href="/overseas-b2b/privacy.html" data-i18n="footer_privacy">Privacy Policy</a>
      <a href="/overseas-b2b/sitemap.xml">Sitemap</a>
    </div>
  </div>
</footer>
```

Add:

```css
.why-grid,.field-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:18px;
}
.why-card{
  padding:22px 20px;
}
.why-card h3{margin:0 0 10px;font-size:20px;color:var(--brand)}
.why-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.7}
.faq-list{display:grid;gap:12px}
.faq-list details{
  padding:18px 20px;
  border-radius:16px;
  background:rgba(255,255,255,.94);
  border:1px solid var(--line);
}
.faq-list summary{cursor:pointer;font-weight:800;color:var(--brand)}
.faq-list p{margin:12px 0 0;color:var(--muted);line-height:1.7}
.quote-shell{
  display:grid;
  grid-template-columns:.9fr 1.1fr;
  gap:22px;
  align-items:start;
}
.quote-form{padding:24px}
.quote-form label{display:block}
.quote-form span{
  display:block;
  margin-bottom:8px;
  font-size:13px;
  font-weight:800;
  color:#31425e;
}
.quote-form input,.quote-form textarea{
  width:100%;
  border:1px solid var(--line-strong);
  border-radius:14px;
  padding:13px 14px;
  font:inherit;
  color:var(--text);
  background:#fff;
}
.field-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:16px}
.quote-actions{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:12px;
  margin-top:18px;
}
#quote-status{margin:0;color:var(--muted);font-size:13px;line-height:1.6}
.site-footer{
  padding:28px 0 34px;
  background:#0d1f36;
  color:#dbe8f7;
}
.footer-row{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
}
.footer-row strong{display:block;font-size:16px}
.footer-row p{margin:10px 0 0;max-width:560px;color:#b4c7de;line-height:1.7}
.footer-links{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
.footer-links a{
  padding:10px 12px;
  border-radius:999px;
  background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.14);
}
@media (max-width: 959px){
  .why-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .quote-shell{grid-template-columns:1fr}
  .footer-row{flex-direction:column}
}
@media (max-width: 640px){
  .why-grid,.field-grid{grid-template-columns:1fr}
}
```

- [ ] **Step 5: Verify blog cards and cost comparison content are absent**

Run: `rg -n "cost comparison|采购方案成本对比|blog card|博客与知识库|<table" public/home-v2/index.html`
Expected: No matches

- [ ] **Step 6: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 conversion sections and footer"
```

### Task 7: Add EN/ZH Copy Map, Hero Rotation, And Quote Form Behavior

**Files:**
- Modify: `public/home-v2/index.html`

- [ ] **Step 1: Add the translation dictionary**

Inside the existing `<script>` block, add this structure:

```js
const i18n = {
  en: {
    nav_products: "Products",
    nav_capabilities: "Capabilities",
    nav_faq: "FAQ",
    nav_quote: "Get a Quote",
    cta_quote: "Get a Quote",
    cta_manual: "View Product Range",
    hero_tag: "Custom Flexible Packaging Manufacturer",
    hero_title: "Custom Printed Pouches, Roll Stock Film, and Export-Ready Packaging",
    hero_copy: "Build retail-ready food packaging with direct factory support for printing, lamination, bag making, sampling, and export coordination",
    quote_submit: "Submit Inquiry"
  },
  zh: {
    nav_products: "产品",
    nav_capabilities: "工厂能力",
    nav_faq: "常见问题",
    nav_quote: "获取报价",
    cta_quote: "获取报价",
    cta_manual: "查看产品范围",
    hero_tag: "定制软包装生产工厂",
    hero_title: "定制印刷包装袋、卷膜与出口型软包装解决方案",
    hero_copy: "围绕印刷、复合、制袋、打样与出口协同，帮助客户更快推进食品软包装项目。",
    quote_submit: "提交询盘"
  }
};
```

- [ ] **Step 2: Add the language switch and text update logic**

Continue the same script with:

```js
const langButtons = [...document.querySelectorAll("[data-lang]")];
const textNodes = [...document.querySelectorAll("[data-i18n]")];
function applyLanguage(lang){
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  langButtons.forEach((button) => {
    button.classList.toggle("is-on", button.dataset.lang === lang);
  });
  textNodes.forEach((node) => {
    const key = node.dataset.i18n;
    const value = i18n[lang] && i18n[lang][key];
    if (value) node.textContent = value;
  });
}
langButtons.forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
});
applyLanguage("en");
```

- [ ] **Step 3: Add hero-image rotation and fake submit logic**

Append:

```js
const heroImages = [
  "/overseas-b2b/assets/real3/file_187---6f25ff28-da9b-42c0-8226-b5be4dc547ed.jpg",
  "/overseas-b2b/assets/real3/file_190---c6188b6f-cc9e-4325-9d58-be53825a258b.jpg",
  "/overseas-b2b/assets/real3/file_193---46db1756-d3f2-4d84-9de1-3bf29ac4b60d.jpg"
];
let heroIndex = 0;
const heroImage = document.getElementById("hero-image");
if (heroImage) {
  setInterval(() => {
    heroIndex = (heroIndex + 1) % heroImages.length;
    heroImage.src = heroImages[heroIndex];
  }, 5000);
}

const quoteForm = document.getElementById("quote-form");
const quoteStatus = document.getElementById("quote-status");
if (quoteForm && quoteStatus) {
  quoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!quoteForm.reportValidity()) return;
    quoteStatus.textContent = "Inquiry captured in the browser. This demo version will not submit to the backend yet.";
    quoteForm.reset();
  });
}
```

- [ ] **Step 4: Add a localized success message map**

Replace the fixed success string in the submit handler with:

```js
const formStatusText = {
  en: "Inquiry captured in the browser. This demo version will not submit to the backend yet.",
  zh: "询盘信息已在前端演示页中记录。当前版本仅展示成功状态，暂未接入后端提交。"
};
let currentLang = "en";
function applyLanguage(lang){
  currentLang = lang;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  langButtons.forEach((button) => {
    button.classList.toggle("is-on", button.dataset.lang === lang);
  });
  textNodes.forEach((node) => {
    const key = node.dataset.i18n;
    const value = i18n[lang] && i18n[lang][key];
    if (value) node.textContent = value;
  });
}
```

And update the submit handler body to:

```js
quoteStatus.textContent = formStatusText[currentLang];
quoteForm.reset();
```

- [ ] **Step 5: Verify the page contains only EN and ZH language controls**

Run: `rg -n "data-lang=\"en\"|data-lang=\"zh\"|data-lang=\"ru\"|data-lang=\"ms\"" public/home-v2/index.html`
Expected: Positive matches for `en` and `zh`, no matches for `ru` or `ms`

- [ ] **Step 6: Commit**

```bash
git add public/home-v2/index.html
git commit -m "feat: add home-v2 bilingual interactions and form success state"
```

### Task 8: Final Verification And Height Review

**Files:**
- Modify: `public/home-v2/index.html` only if fixes are required

- [ ] **Step 1: Check required homepage content is present**

Run:

```bash
rg -n "Since 1997|Custom Printing|Lamination &amp; Bag Making|Food Packaging Experience|Stand Up Pouches|Flat Bottom Pouches|Spout Pouches|Coffee Bags|Roll Stock Film|Custom Shaped Pouches|Manufacturing Capabilities|Gravure Printing|Solventless Lamination|Automatic Bag Making|Quality Inspection|Why Choose Huasheng|Get a Quote" public/home-v2/index.html
```

Expected: All required homepage strings match

- [ ] **Step 2: Check banned homepage sections are absent**

Run:

```bash
rg -n "下载产品手册|注册资本|采购方案成本对比|博客与知识库" public/home-v2/index.html
```

Expected: No matches

- [ ] **Step 3: Review final file manually**

Run: `sed -n '1,360p' public/home-v2/index.html`
Expected: The file shows the full page structure with no obvious missing closing tags or placeholder text

- [ ] **Step 4: If a local preview command exists, run the existing smoke check**

Run: `node scripts/smoke-test.js`
Expected: Existing smoke output completes without errors unrelated to `public/home-v2/index.html`

- [ ] **Step 5: Commit final fixes if verification required edits**

```bash
git add public/home-v2/index.html
git commit -m "fix: finalize home-v2 landing page verification issues"
```

# Home V2 Landing Page Design

**Date:** 2026-05-01

## Goal

Create a new B2B packaging homepage at `/home-v2/` without deleting or replacing the existing homepage code. The new page should tighten vertical rhythm, reduce oversized modules, keep the homepage focused on conversion, and reserve heavier content such as the packaging selector and blog for dedicated pages.

## Scope

This design covers a single new static page:

- New route target: `/home-v2/`
- New file location: `public/home-v2/index.html`
- Existing homepage remains unchanged
- Existing `/public/overseas-b2b/index.html` is used only as a reference source for copy, images, and interaction patterns

This iteration does **not** include:

- Replacing the existing homepage
- Connecting the quote form to a real backend API
- Building the full `/packaging-selector` page in this task
- Reworking the blog page

## Product Direction

The new homepage should behave like a compact export-facing packaging landing page instead of a long visual catalog. It should emphasize:

- Clear hero proposition
- Fast trust signals
- Six core packaging products
- Four manufacturing capabilities
- A compact entry to the selector tool
- FAQ followed by a full quote form

The page should feel intentionally dense but still calm, with fewer oversized image blocks and fewer mid-page distractions.

## Audience

Primary audience:

- Overseas B2B buyers looking for custom flexible packaging
- Buyers requesting a quick quote for pouch, bag, or roll-stock packaging

Secondary audience:

- Visitors evaluating factory capability and export readiness

## Content Strategy

The page should prioritize conversion-oriented packaging content and remove unrelated emphasis. Registered capital and oversized brand-wall content should not be highlighted. Blog cards and pricing comparison tables should not occupy mid-page attention.

The new homepage should present English-first copy with Chinese support for selected headings and labels. Language support for this iteration is limited to:

- English
- Chinese

## Information Architecture

Section order:

1. Header
2. Hero
3. Stats strip
4. Core products
5. Compact trust strip
6. Manufacturing Capabilities / 工厂生产能力
7. Packaging selector entry banner
8. Why Choose Huasheng
9. FAQ
10. Get a Quote form
11. Footer

## Layout And Height Targets

### Overall Page Height

Desktop total height target:

- Preferred range: 6500px to 8500px
- Hard limit: under 10000px

### Section Spacing

Use consistent section rhythm:

- Mobile: `py-10` or `py-12` equivalent
- Desktop: `py-16` or `py-20` equivalent

Avoid scattered oversized spacing such as `md:py-24` style rhythm inflation.

### Header

- Existing `h-20` equivalent is acceptable
- Right-side primary CTA becomes `Get a Quote / 获取报价`
- Product manual should no longer be the primary action
- Product manual may be demoted to a secondary action or moved to footer links

### Hero

Hero height must be reduced from the current full-screen behavior.

Target heights:

- Mobile: `520px`
- Medium desktop: `680px`
- Large desktop: `720px`

Do not use `md:h-screen`.

The hero should:

- Lead with export-facing packaging messaging
- Include primary quote CTA
- Optionally include a lighter secondary CTA for product browsing or company profile
- Avoid excessive empty visual space

### Stats Strip

Keep the stats band but replace the content with four short trust statements:

- Since 1997
- Custom Printing
- Lamination & Bag Making
- Food Packaging Experience

The strip should feel quick and factual rather than like investor-facing metrics.

### Core Products

Homepage product section shows only six core products:

- Stand Up Pouches
- Flat Bottom Pouches
- Spout Pouches
- Coffee Bags
- Roll Stock Film
- Custom Shaped Pouches

Layout:

- Desktop: 3 columns x 2 rows
- Mobile: 1 column or 2 columns depending on available width
- Card height target: 260px to 300px

Each card should have:

- Product image or clean visual
- English title
- Short support line
- Quote-oriented hover or CTA emphasis if lightweight

### Trust Strip

Replace the large brand logo wall with a small horizontal trust strip. This strip should communicate cooperation and export credibility without spending excessive vertical space.

Acceptable implementations:

- A compact row of small logo pills
- A text-led trust row with a few understated brand markers
- Industry or export support trust chips instead of a 16-logo wall

### Manufacturing Capabilities

Rename the section to:

- `Manufacturing Capabilities`
- `工厂生产能力`

Keep only four capability cards:

- Gravure Printing
- Solventless Lamination
- Automatic Bag Making
- Quality Inspection

Height target:

- Entire module between 650px and 780px on desktop

The module should combine concise capability descriptions with factory-oriented visuals, but avoid turning into a long gallery.

### Packaging Selector Entry Banner

The existing smart bag recommendation system should not appear as a full homepage middle section.

Homepage behavior:

- Keep only a compact banner entry
- Height target: 120px to 160px
- CTA points to `/packaging-selector`

Banner content should frame the tool as a fast route for unsure buyers:

- Find the right pouch format
- Match structure to product use
- Start with a guided recommendation

### Why Choose Huasheng

Replace or hide the procurement cost comparison table and use four short advantage cards:

- Factory Direct Supply
- Custom Printing & Lamination
- Flexible Packaging Solutions
- Export Support

This section should be shorter and easier to scan than the removed comparison block.

### FAQ

Keep FAQ near the bottom, before the quote form.

Requirements:

- Maximum 6 questions
- Default collapsed
- Focus on quotation, MOQ, artwork, lead time, material, export coordination

### Get a Quote Form

Place the full form directly after FAQ.

Required fields:

- Name
- Country / Region
- Email
- WhatsApp / Phone
- Product Type
- Bag Size
- Material / Structure
- Quantity
- Upload Artwork / Reference Image
- Message

This iteration uses a front-end-only success state:

- No backend submission
- Simple validation for required fields
- Success confirmation message after submit

### Blog

Blog cards should be hidden from the homepage middle content.

The blog page itself remains intact and should continue to be accessible through footer navigation.

## Visual Direction

The visual direction should stay aligned with the current Huasheng export homepage palette, but become tighter and more editorial:

- Fewer oversized galleries
- Clear section boundaries
- Consistent white card surfaces
- Industrial blue with restrained accent usage
- Better vertical compression

The page should look more like a serious factory-facing B2B landing page and less like a broad visual catalog.

## Interaction Design

Required lightweight interactions:

- EN / 中文 toggle
- Hero slide or hero state rotation if carried over
- FAQ accordion using collapsed details or JS toggles
- Form success state after submit

Interactions should remain simple and static-friendly.

## Asset Reuse

Reuse from existing static resources where possible:

- `public/overseas-b2b/assets/real*`
- `public/overseas-b2b/assets/brand/logo.svg`
- Existing packaging and factory imagery already present in the repository

Do not remove or rename old assets for this iteration.

## Routing

New homepage target should be accessible from:

- `/home-v2/`

This implies file placement at:

- `public/home-v2/index.html`

Optional relative navigation from this page may point to:

- `/packaging-selector`
- Existing blog page if one is available
- Existing footer support links

## Risks And Constraints

- The repository contains unrelated local modifications; this task should avoid touching them.
- The new page is static, so the quote form must not imply real backend processing.
- Remote assets should be avoided where local assets already exist.
- Existing old homepage code must remain intact.

## Acceptance Criteria

- A new static page exists at `public/home-v2/index.html`
- Old homepage code remains untouched
- Hero no longer uses full-screen desktop height
- Main header CTA is `Get a Quote / 获取报价`
- Stats strip uses the four new statements
- Homepage shows exactly six core products
- Large logo wall is replaced by a compact trust strip
- Manufacturing Capabilities section contains exactly four capability cards
- Packaging selector becomes a compact banner entry only
- Cost comparison and blog card sections are absent from the homepage body
- FAQ is near the bottom with at most six collapsed questions
- Quote form includes all requested fields and a fake success state
- Section spacing is normalized to the requested rhythm
- Desktop total height remains under 10000px

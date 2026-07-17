# Matrix Signal Packet

This packet records user-controlled copy/send steps for the five approved preliminary inquiries. It does not authorize automation and does not record any submission as completed. The approved body for each destination remains the exact text under `### Exact outbound content` in `docs/matrix-signal/messages.md`; copy it unchanged.

## packet_cand_011

- Destination: Packaging Digest
- Route type: Public editorial email
- Official route source: https://eu-assets.contentstack.com/v3/assets/blta023acee29658dfc/blt0549c8fdec7bd166/659467bbbb3a23040a38cf26/2024-Packaging-Digest-guidelines-for-editorial-submissions.pdf
- To: rick.lingle@informa.com
- Subject: Preliminary topic inquiry: A decision framework for stand-up and flat-bottom snack pouches
- Body source: `docs/matrix-signal/messages.md` → `draft_cand_011` → `### Exact outbound content`; copy the body unchanged.
- User steps:
  1. Reopen the official PDF and confirm the Food or Beverage editorial address remains current.
  2. From a user-controlled company email account, create a message to the official address.
  3. Paste the approved subject and exact body unchanged; do not add an attachment or unsupported author detail.
  4. Review the visible recipient and sender, then click Send manually.
  5. Retain a non-sensitive sent-message confirmation for later registry evidence entry.
- Later-content gate: A full manuscript needs a user-approved individual author, contributor agreement, AI-use disclosure, human verification, and rights-cleared images; the current preliminary inquiry does not supply those materials.

## packet_cand_012

- Destination: Packaging Strategies
- Route type: Public editorial email
- Official route sources: https://www.packagingstrategies.com/submissions-guidelines and https://www.packagingstrategies.com/contactus
- To: addingtonb@bnpmedia.com
- Subject: Preliminary topic inquiry: Six questions to answer before specifying a spouted pouch
- Body source: `docs/matrix-signal/messages.md` → `draft_cand_012` → `### Exact outbound content`; copy the body unchanged.
- User steps:
  1. Reopen the official Contact Us page and confirm the Chief Editor address remains current.
  2. From a user-controlled company email account, create a message to the official address.
  3. Paste the approved subject and exact body unchanged; do not attach a complete article.
  4. Review the visible recipient and sender, then click Send manually.
  5. Retain a non-sensitive sent-message confirmation for later registry evidence entry.
- Later-content gate: The current text is a topic inquiry. A complete web-exclusive submission needs a user-approved individual author name, title and biography, plus any rights-cleared material.

## packet_cand_013

- Destination: FOOD ENGINEERING
- Route type: Official editorial contact control; direct byline-inquiry email is not exposed in the readable page
- Official route source: https://www.foodengineeringmag.com/contactus
- To: Use the Editorial section's official "Contact Alyse" control. Do not use FEeditors@bnpmedia.com, which the page limits to new-product press releases.
- Subject: Preliminary topic inquiry: Engineering the pouch-to-filler handoff
- Body source: `docs/matrix-signal/messages.md` → `draft_cand_013` → `### Exact outbound content`; copy the body unchanged.
- User steps:
  1. Open the official Contact Us page in a user-controlled browser.
  2. In the Editorial section, select "Contact Alyse" and verify the destination exposed by the official control.
  3. If login or CAPTCHA appears, complete it personally or stop; do not bypass it.
  4. Paste the approved subject and exact body unchanged, review the destination and sender, then send manually.
  5. Retain a non-sensitive confirmation for later registry evidence entry.
- Later-content gate: The current text is only a topic inquiry. A manuscript needs a user-approved individual author, title/current role, required biography, references and rights-cleared illustrations.

## packet_cand_035

- Destination: IndustryWeek
- Route type: Public editorial email link protected by Cloudflare
- Official route source: https://www.industryweek.com/industryweek-contributors-guidelines
- To: Click the protected email link in the sentence beginning "Send to IndustryWeek c/o"; no address is guessed or transcribed in this packet.
- Subject: Preliminary topic inquiry: Treat the artwork handoff as a manufacturing quality control
- Body source: `docs/matrix-signal/messages.md` → `draft_cand_035` → `### Exact outbound content`; copy the body unchanged.
- User steps:
  1. Open the official contributor guidelines in a user-controlled browser.
  2. Click the protected contributor-email link and confirm it opens a mail composer to the official destination.
  3. Paste the approved subject and exact body unchanged; do not attach a manuscript, bio, headshot or artwork.
  4. Review the destination and sender, then click Send manually.
  5. Retain a non-sensitive sent-message confirmation for later registry evidence entry.
- Later-content gate: A complete article needs a user-approved individual author and bio/headshot, substantial human authorship and verification, original-source attribution, rights clearance, contributor agreement, and compliance with the current AI limit and disclosure policy.

## packet_cand_037

- Destination: Quality Digest
- Route type: Public editorial email
- Official route source: https://www.qualitydigest.com/content/editorial-submission-guidelines
- To: features@qualitydigest.com
- Subject: Preliminary topic inquiry: Artwork approval as a quality gate for flexible packaging
- Body source: `docs/matrix-signal/messages.md` → `draft_cand_037` → `### Exact outbound content`; copy the body unchanged.
- User steps:
  1. Reopen the official guidelines and confirm the features address remains current.
  2. From a user-controlled company-domain email account, create a message to the official address.
  3. Paste the approved subject and exact body unchanged; do not attach a manuscript, results, image, headshot or other material.
  4. Review the visible recipient and sender, then click Send manually.
  5. Retain a non-sensitive sent-message confirmation for later registry evidence entry.
- Later-content gate: A complete submission needs a user-approved individual author, quality-related qualifications biography, photo/headshot, human verification and rights-cleared supporting material.

## Operational status

- Approval recorded: all eight exact drafts are approved.
- Submission completed: all eight approved inquiries have been sent from `sales@gdhspack.com`. The first five (`cand_011`, `cand_012`, `cand_013`, `cand_035`, and `cand_037`) were sent on 2026-07-17. The second cohort (`cand_019`, `cand_020`, and `cand_036`) was sent on 2026-07-18 to destinations supplied by the user or published in the official public source. The recipient SMTP servers accepted all eight addresses without rejection. Sanitized evidence references are recorded in `registry.csv`, the second-cohort evidence notes are stored under `docs/matrix-signal/evidence/`, and full SMTP identifiers remain only in the ignored permission-restricted local ledger.
- Remaining block: none at the preliminary-inquiry delivery stage. Editorial acceptance, publication, and backlink placement remain unconfirmed for all submitted inquiries and must not be inferred from SMTP acceptance.
- Prohibited substitutes not used: no `curl` POST, local/server sendmail, login bypass, CAPTCHA bypass or fabricated submission evidence.

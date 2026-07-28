# Matrix Branded Email Template Design

## Goal

Upgrade canonical outbound email from plain text to a restrained multipart email with an HTML brand signature and a complete plain-text fallback. Preserve the existing exact-version approval, content-hash, duplicate-prevention, attachment, and delivery gates.

The previously sent Nithi message remains unchanged. The new template applies only to newly generated versions.

## Selected Presentation

Use a small company logo in the signature area, not a banner at the top of the message.

The HTML part contains:

1. The approved message body with paragraphs and line breaks preserved.
2. A compact signature containing Gavin, Huasheng Printing Co., Ltd., the company website, the sender email, and the approved WhatsApp link.
3. The official logo loaded from `https://gdhspack.com/media/brand/logo.png`, with fixed display dimensions, descriptive alternative text, and no tracking parameters.

The plain-text part contains the same approved message and contact details without the image. If a client blocks remote images or ignores HTML, the email remains complete and understandable.

## Canonical Data Flow

The database continues to store the authored English body and its translation as business content. A dedicated deterministic renderer combines the approved English body with the canonical signature configuration and produces:

- `text`: plain-text MIME alternative;
- `html`: conservative table-free HTML with inline styles;
- template metadata used by the preview and content-hash calculation.

The renderer is shared by final preview and delivery. Delivery must send the exact rendered result that was previewed and approved.

## Approval and Integrity

The content hash must cover all customer-visible output, including:

- recipient;
- subject;
- English body;
- plain-text signature;
- HTML signature;
- logo URL and alternative text;
- website, email, and WhatsApp links;
- attachments.

Any change to the logo, signature, link, layout-affecting template version, subject, recipient, body, or attachments creates a new immutable version and invalidates prior approval.

Existing duplicate-prevention and idempotency rules remain unchanged.

## Rendering Rules

- Escape authored text before inserting it into HTML.
- Preserve paragraph boundaries and intentional line breaks.
- Use UTF-8 throughout.
- Use inline CSS only; do not depend on scripts, forms, background images, web fonts, SVG, CSS classes, or client-side behavior.
- Set an explicit logo width and automatic proportional height.
- Include meaningful `alt` text and readable linked text beside or below the logo.
- Do not add open tracking, click tracking, hidden pixels, URL shorteners, or remote assets other than the official logo.
- Do not turn the first-contact email into a brochure or attach a company profile automatically.

## Preview

The final preview returns:

- the exact recipient and subject;
- a rendered HTML preview;
- the exact plain-text alternative;
- the logo URL and template version;
- the final content hash;
- the existing approval and safety-gate results.

The management system and assistant runtime must use this same preview result. Neither may assemble a separate signature.

## Failure Behavior

Preview and delivery fail closed when:

- the canonical signature configuration is incomplete;
- the logo URL is not HTTPS or is outside `gdhspack.com`;
- the final render hash differs from the approved hash;
- unsafe HTML is produced;
- recipient, body, subject, links, or attachments differ from the approved version.

An unavailable logo file does not remove the plain-text fallback, but production readiness verification must fail until the official URL returns a valid image response.

## Verification

Automated regression coverage must prove:

1. HTML escaping prevents markup injection from authored text.
2. Paragraphs and line breaks render correctly.
3. The HTML and plain-text alternatives contain the same approved body and contact details.
4. The HTML contains one official HTTPS logo and no tracking content.
5. Any signature or logo change changes the content hash and invalidates approval.
6. Preview and delivery use byte-equivalent rendered fields.
7. Existing duplicate and exact-approval gates still pass.
8. MIME output declares UTF-8 and includes both `text/plain` and `text/html`.
9. The public logo URL returns an image successfully.
10. No real recipient is contacted during compatibility verification.

Outlook and Gmail compatibility is assessed through conservative HTML lint rules and generated MIME inspection. No claim of identical rendering in every client is made without client-side inbox testing.

## Deployment Boundary

Implementation, commit, merge, production deployment, and service restart are separate steps. Production deployment or restart still requires explicit user approval. Sending any message still requires exact approval of its recipient, subject, final rendered content, and attachments.

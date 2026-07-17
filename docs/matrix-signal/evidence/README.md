# Matrix Signal Evidence Handling

## Filename Format

Store each evidence note as `YYYYMMDD-domain-stage.md`.

Examples:

- `20260717-example-org-screened.md`
- `20260719-example-com-submitted.md`
- `20260724-example-net-live.md`

Use the observation date, normalized root domain, and workflow stage. Keep one public target and stage per file.

## Allowed Evidence

Evidence notes may contain only:

- The public source URL or public submission-path URL.
- An observation timestamp with timezone.
- Short, non-sensitive confirmation text needed to explain what was publicly observed.
- The observed workflow stage and a factual verification result.

Record the minimum necessary text. Link to the public source rather than copying an entire page.

## Forbidden Evidence

Never store:

- passwords;
- cookies or authentication headers;
- session tokens;
- CAPTCHA prompts, solutions, screenshots, or challenge material;
- private personal data or guessed personal contact details.

If a page requires login or CAPTCHA, stop and request user takeover. Do not save access-control material. Redact prohibited data before an evidence note is committed.

# Matrix Stream Desk Design

Date: 2026-08-10

## Goal

Provide a private, authenticated publishing workspace for a human operator. The operator receives one prepared task, copies platform-specific content, opens the official platform, publishes manually, records the public URL, and advances to the next task.

This design avoids browser-cookie automation and does not use a hidden Git branch as a queue.

## Workflow

1. An administrator enters an existing `https://gdhspack.com/` page URL.
2. The server reads its title, SEO description and Open Graph image.
3. Deterministic adapters create channel-specific drafts with UTM links.
4. The operator copies title/body, saves the media, and opens the official publishing interface.
5. Publishing remains a deliberate human action.
6. The operator records the public URL. The system records operator/time and advances to the next task.
7. WeChat draft creation is optional and remains disabled until protected environment variables are configured.

## Channel Priority

- P0: Pinterest, LinkedIn, Facebook Page, WeChat Official Account, Zhihu, YouTube.
- P1: Medium, Instagram, Baijiahao, Toutiao, Sohu.
- P2: VK and additional regional channels after account readiness is verified.

## Content System

The weekly mix is 35% buyer decisions, 30% real evidence, 20% applications and 15% regulation/testing. Each source page produces adapted drafts rather than identical cross-posts.

Competitor observations are stored in `config/stream-content-strategy.json`. Every observation includes a source URL and sample window. Cadence is never stated as a universal fact when only a sample can be verified.

### Current public observations

- Mondi combines application problems, outcomes, machinery/customer collaboration and regulatory context. Huasheng should reuse this evidence structure, not their claims or wording.
- CarePac publishes dense purchasing-question clusters around pouch formats, configuration, volume and cost. Huasheng should exceed this with real printed samples, factory evidence and conservative technical boundaries.
- Amcor frames announcements around an operational or brand outcome. Huasheng should lead with the buyer decision and then show evidence.

## Public Tool Review

| Candidate | Finding | Decision |
| --- | --- | --- |
| Postiz | Broad channel support. Hosted use is paid; self-hosting adds PostgreSQL, Redis and Temporal operational cost. | Keep catalog entry partial; do not adopt for this phase. |
| BrightBean Studio | Useful approval/calendar reference, but direct APIs still require platform credentials and account review. | Use as a workflow reference only. |
| Custom Stream Desk | Fits the current manual operator, existing authentication/audit model and low server footprint. | Adopt for this phase. |

The second-phase review also considered maintained open-source schedulers with calendars and analytics. BrightBean Studio and TryPost provide useful product references, but adopting either would duplicate the existing authentication and queue, add a separate stack, and still require official platform credentials. The current phase therefore reuses installed Jimp and the existing React/SQLite stack. This decision should be revisited if direct publishing credentials become available.

## Security And Boundaries

- Module permission: `streamDesk`; role: `stream_publisher`.
- The publisher role has no order, costing, CRM or admin access.
- API responses set `X-Robots-Tag: noindex, nofollow, noarchive`.
- Only owned `gdhspack.com` HTTPS pages can be imported.
- OAuth tokens, platform cookies and app secrets are not stored in the task database.
- Formal publication stays behind a human action.
- The WeChat adapter reads only `WECHAT_OFFICIAL_APP_ID`, `WECHAT_OFFICIAL_APP_SECRET` and `WECHAT_OFFICIAL_THUMB_MEDIA_ID` from protected runtime configuration.

## Validation

- `npm run test:stream-desk`
- `npm run lint`
- `npm --prefix frontend-next run lint`
- `npm --prefix frontend-next run build`
- Security scan for secret-like values and business records in new files.

## Next Iterations

- Add authenticated media derivatives only after real channel image requirements are measured.
- Add referral and publication performance imports after platform/API access is available.
- Refresh competitor samples monthly and when an observed channel changes materially.

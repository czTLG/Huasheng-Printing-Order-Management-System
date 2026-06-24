# Huasheng Packing Inquiry And Analytics Design

**Date:** 2026-05-01

## Goal

Add self-contained inquiry submission, visit analytics, and weekly reporting to the independent site running on port `3333` from `/home/admin/work/huasheng-packing`, without depending on the `8080` `packaging-system` backend for request handling or data storage.

The independent site should:

- accept inquiry submissions from all inquiry entry points
- store inquiry and visit data in its own SQLite database
- send inquiry emails using SMTP via `nodemailer`
- generate and email a weekly report every Monday at `09:00 Asia/Shanghai`
- be testable end-to-end

## Scope

This design applies only to the independent site project:

- Runtime site: `/home/admin/work/huasheng-packing`
- Public website: port `3333`

This work includes:

- SQLite setup inside the `3333` project
- Inquiry API endpoints in the `3333` project
- Visit tracking API endpoints in the `3333` project
- Frontend integration for all inquiry entry points
- Weekly report generation and email delivery
- Manual and functional verification

This work does **not** include:

- delegating inquiry or analytics handling to the `8080` backend
- using `packaging-system` database tables
- adding third-party analytics SaaS
- building a full CRM

## Product Direction

The independent site should own its commercial lead flow. A visitor who submits contact or quote intent from the site should trigger a direct email notification and create a durable local record for follow-up and weekly reporting.

The analytics side should be practical rather than enterprise-grade. It should cover the business questions requested:

1. total visits
2. unique visitors
3. source channels
4. top pages
5. country or region
6. IP details
7. inquiry count
8. inquiry summary
9. device type
10. daily trend

## Mail Rules

### Inquiry Mail

- `To: sales@gdhspack.com`
- `CC: 383651879@qq.com`
- `Reply-To: customer provided email`

### Weekly Report Mail

- `To: sales@gdhspack.com`
- `CC: 3836518879@qq.com`

### Schedule

- Every Monday
- `09:00`
- `Asia/Shanghai`

## Architecture

The independent site currently serves a built React application from `dist/` through a lightweight Express server on port `3333`. This work extends that same server process rather than adding a second backend.

The architecture becomes:

1. Express server on `3333`
2. static asset serving for frontend
3. JSON API endpoints for inquiry and tracking
4. local SQLite database for inquiry and visit records
5. scheduled weekly report task in the same process
6. SMTP sending through `nodemailer`

This keeps deployment simple:

- one project
- one runtime process
- one local database

## Data Model

### Inquiry Table

Create a table for commercial leads, tentatively named `site_inquiries`.

Recommended fields:

- `id`
- `created_at`
- `source_path`
- `entry_point`
- `name`
- `company`
- `country_region`
- `email`
- `phone_whatsapp`
- `product_type`
- `bag_size`
- `material_structure`
- `quantity`
- `message`
- `artwork_name`
- `artwork_size`
- `client_ip`
- `user_agent`
- `referer`
- `device_type`
- `mail_to`
- `mail_cc`
- `mail_status`
- `mail_error`

### Visit Event Table

Create a visit event table, tentatively named `site_visit_events`.

Recommended fields:

- `id`
- `created_at`
- `visitor_id`
- `session_id`
- `path`
- `title`
- `referer`
- `source_channel`
- `client_ip`
- `country`
- `region`
- `city`
- `user_agent`
- `device_type`
- `is_unique_session`

### Weekly Report Log Table

Create a small audit table for report execution, tentatively named `site_weekly_reports`.

Recommended fields:

- `id`
- `period_start`
- `period_end`
- `sent_at`
- `mail_to`
- `mail_cc`
- `status`
- `error`
- `summary_json`

## Inquiry Flow

### User Flow

Any inquiry action on the independent site should send data to the new `3333` backend API.

Initial required integration target:

- all formal contact or quote submission entry points
- not just one hidden test form

For this project, “all inquiry entry points” means any form or CTA that currently claims the user can request contact, send a quote request, or submit packaging requirements.

### Backend Flow

When an inquiry is submitted:

1. validate required fields
2. normalize payload
3. enrich with IP, user agent, referer, source path, and device type
4. persist to SQLite
5. send inquiry email
6. update mail status in SQLite
7. return success or failure response to frontend

### Mail Format

The inquiry email should be readable and structured. Include:

- submission time
- page or entry point
- customer name
- company if present
- email
- phone or WhatsApp
- country or region
- product type
- bag size
- material or structure
- quantity
- message
- attachment metadata if provided
- IP
- referer
- user agent

If the customer email exists, set it as `Reply-To`.

## Visit Tracking

### Tracking Strategy

Track visits with a lightweight client-side beacon to the `3333` backend.

Track at least:

- initial page load
- route change for SPA navigation

### Visitor Identity

Use a browser-generated visitor identifier stored in local storage or cookie, plus a session identifier for the current browsing session.

This gives practical metrics:

- total visits
- unique visitors
- repeat visits

It will be approximate rather than perfect, which is acceptable for this project.

### Source Channel Rules

Classify traffic into simple buckets:

- direct
- search
- social
- referral
- paid or campaign if UTM markers exist
- unknown

This should be rule-based using referer and query parameters, not dependent on external analytics tools.

### Geo And Device

Device type should be inferred from user agent:

- mobile
- desktop
- tablet
- unknown

Country or region should use a pragmatic IP lookup approach available to the project. Precision can be approximate; that tradeoff should be documented in the implementation.

## Weekly Report

### Trigger

Run automatically:

- Monday `09:00`
- timezone `Asia/Shanghai`

Also provide a manual trigger for testing and re-send.

### Report Contents

The report should contain the requested ten categories:

1. total visits
2. unique visitors
3. source channels
4. top pages
5. country or region
6. IP details
7. inquiry count
8. inquiry summary
9. device type
10. daily trend

### Recommended Format

Email body:

- concise executive summary
- table-like sections for top metrics
- short inquiry summary list

Optional attachment:

- CSV for detailed IP and inquiry rows if the email body becomes too long

### Time Window

Report on the previous full week in `Asia/Shanghai` time.

Recommended reporting window:

- Monday `00:00` through Sunday `23:59:59`

## API Surface

Recommended endpoints inside the `3333` site server:

- `POST /api/inquiries`
- `POST /api/track/visit`
- `GET /api/admin/report/weekly-preview`
- `POST /api/admin/report/send-weekly`
- `GET /api/health`

The admin preview and send endpoints can initially be protected by simple secret or local-only access rather than a full auth system, depending on what already fits the project.

## Frontend Integration

The frontend should:

- route all quote or inquiry forms to the new inquiry API
- show success and failure states clearly
- avoid fake-submit behavior after this feature is implemented

For visit analytics:

- send initial load event once
- send route-change events when the SPA view changes
- avoid spamming duplicate events on the same route in a single session

## Storage And Attachment Handling

If artwork or reference uploads are part of the form, the first version can safely store metadata only unless the project already has a stable uploads pattern.

Recommended first version:

- accept file input
- store file metadata
- optionally defer actual file persistence if needed for safety

If actual upload persistence is implemented in this phase, it should store files in a local directory owned by the independent site project with clear size and file-type limits.

## Operational Requirements

- SMTP settings should be configured independently for the `3333` project, even if the values mirror the `8080` project
- Database file location should live inside the independent site project
- Logging should be plain and inspectable for inquiry errors and report delivery errors

## Testing Requirements

Testing must include real functional checks, not just static code inspection.

Required verification:

1. submit a test inquiry from the independent site
2. confirm SQLite record creation
3. confirm inquiry email delivery request succeeds
4. confirm `Reply-To` is set from customer email
5. generate visit events by opening and navigating pages
6. confirm visit rows are stored
7. run manual weekly preview
8. run manual weekly send
9. confirm the `3333` main site still works
10. confirm no dependency on `8080` is required for the new flow

## Risks And Tradeoffs

- IP geolocation may be approximate
- unique visitor counting is heuristic
- if file uploads are enabled immediately, local file handling introduces extra operational risk
- a single-process server is simpler, but report and mail logic must not block normal page delivery

## Acceptance Criteria

- `3333` independent site handles inquiry submission itself
- inquiry data is stored in the independent site SQLite database
- inquiry email sends to `sales@gdhspack.com`
- inquiry CC sends to `383651879@qq.com`
- inquiry `Reply-To` uses the customer email
- visit analytics are stored locally in the independent site project
- weekly report sends every Monday `09:00 Asia/Shanghai`
- weekly report sends to `sales@gdhspack.com`
- weekly report CC sends to `3836518879@qq.com`
- weekly report includes the requested ten metric groups
- manual testing verifies inquiry, storage, analytics, and report sending

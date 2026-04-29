# Packaging System Agent Instructions

## Project

Working directory:

`/home/admin/work/packaging-system`

Goal: connect the new UI to the existing order management backend without migrating the database, changing the backend core architecture, or breaking the legacy system.

The legacy system remains the business source of truth, especially for:

- work order creation
- cost calculation
- order workflow
- permissions

New frontend project:

`frontend-next`

Build output:

`public/new`

Legacy entry pages:

- `public/legacy-login.html`
- `public/legacy-app.html`

## Read First

Before editing anything, read:

- `.ai-memory/context.md`
- `.ai-memory/current-state.md`
- `.ai-memory/tasks.md`
- `.ai-memory/guardrails.md`

Then summarize your understanding before making changes.

## Working Rules

- **Do not modify legacy UI or legacy API interfaces.** The business is already live in production. Touching legacy UI (`public/legacy-login.html`, `public/legacy-app.html`) or legacy backend API contracts (`src/routes/`) risks breaking production workflows.
- **Do not touch the database directly** — no migrations, no schema changes, no data manipulation. All data access must go through the existing backend routes.
- Do not change backend core architecture.
- Do not migrate the database.
- Use the legacy backend as the source of truth.
- New UI must use real backend APIs and real legacy business logic.
- Cost calculation must not be recreated in frontend local logic.
- Work order creation must use the real legacy backend path.
- Preserve role/module permission differences.
- Prefer small, testable changes.
- Inspect existing legacy behavior before modifying new UI behavior.
- Extend existing smoke tests instead of removing assertions.

## Common Commands

```bash
cd /home/admin/work/packaging-system/frontend-next
npm run build

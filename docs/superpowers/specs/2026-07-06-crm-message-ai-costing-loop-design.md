# CRM Message AI Costing Loop Design

## Scope

Build the minimum internal workflow from an existing CRM message to a persisted AI interpretation, conservative inquiry updates, father review tasks, and a linked foreign costing draft. This workflow does not send customer messages, create formal quotations, run OCR, or alter costing formulas.

## Data Model

`crm_ai_interpretations` stores an immutable parse result for each run. It includes the message/customer/inquiry links, provider/model, the standard AI-compatible parsed JSON, update metadata, status, error text, operator, and timestamps. `crm_messages.ai_status` reflects the latest run state; message detail reads the latest interpretation.

`crm_father_review_tasks` stores the internal review question, Chinese context, original customer text, attachment IDs, required fields, reply, and task lifecycle. Attachments remain linked to their source CRM message and are resolved through the existing attachment normalizer.

No new inquiry business columns are required. Existing inquiry fields hold compatible values; the interpretation stores `changed_fields_json` entries with old value, new value, source message ID, interpretation ID, and changed time.

`foreign_costing_drafts` gains JSON linkage/context fields for source message IDs, attachment IDs, and the CRM specification payload. Existing customer and inquiry columns are populated by the draft endpoint.

## Backend Flow

`POST /api/crm/messages/:id/ai-parse` reads the message and attachment metadata, runs a rule-based parser that emits the fixed future AI schema, inserts an interpretation, and updates `crm_messages.ai_status`. It does not update inquiry data implicitly.

`POST /api/crm/messages/:id/update-inquiry` accepts an interpretation ID. It fills only empty inquiry fields, links the message, records every actual change in the interpretation, and returns skipped non-empty fields. If no inquiry is linked, it creates a clearly titled pending-confirmation inquiry for the message customer.

Father task endpoints create tasks from a message/interpretation, list by inquiry, and save a Chinese reply. Completing a task updates only the task and the inquiry next action; it never sends a customer message.

Inquiry detail API includes the latest relevant AI interpretation, father tasks with normalized attachments, and linked foreign costing drafts. The foreign costing `/draft` endpoint accepts CRM linkage and specification context while retaining the existing parse, material mapping, quoteEngine calculation, calculation table, and father review pipeline.

## Frontend Flow

Message detail shows the latest interpretation, extracted fields, missing information, risks, next action, and English reply draft. Buttons run/re-run interpretation, conservatively update inquiry, create a father task, and create a linked costing draft.

Inquiry detail shows an AI specification overview, father task list with attachment cards and Chinese reply input, linked costing drafts, and a send-to-costing button. All costing results remain labeled internal pre-costing and pending Chen Yongjie review.

## Safety

- Never modify `src/services/quoteEngine.js` or `frontend-next/src/components/Cost.tsx`.
- Never generate or send a formal customer quotation.
- Never fabricate price, material structure, certification, production capability, or lead time.
- Unknown values remain missing information or risk flags.
- Inquiry updates fill blanks only and preserve manual values.
- Existing dirty worktree changes remain intact; no reset, clean, or commit.

## Verification

Add a focused backend verification script that initializes a temporary database, inserts a CRM message, validates interpretation persistence, blank-only inquiry updates, father task attachment linkage/reply, and CRM-linked costing draft persistence. Run required syntax checks and the frontend production build, then confirm forbidden files are absent from the task diff.

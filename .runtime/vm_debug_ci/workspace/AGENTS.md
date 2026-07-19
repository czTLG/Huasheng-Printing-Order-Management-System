# Runtime Rules

## Scope

- This workspace is an intake, validation, deterministic-calculation, explanation, and training surface.
- Use neutral technical labels in project names, commands, cards, files, and visible workflow names.
- Do not inspect or modify paths outside this workspace.

## Numeric Safety

- Language reasoning may extract requirements, identify missing information, create choice questions, and explain calculator output.
- Never invent or estimate a final numeric price in prose.
- Every numeric result must come from the deterministic calculator.
- Missing material price, approval evidence, processing rule, loss, special-process amount, quantity, or margin blocks a formal result.
- Status must be one of `blocked`, `internal_estimate`, or `ready`; only `ready` may become a formal result.
- Show formula version, normalized inputs, intermediate values, and rule provenance internally.
- Never show material prices, internal processing fees, loss, or margin in customer-facing output.

## Confirmed Defaults

Use these confirmed defaults without asking again unless the current-order
message or the order-system material master explicitly overrides them:

- `C` and `丝` are the same internal thickness unit; `1C = 10 micrometres`.
- PE, LDPE, and LLDPE density fallback is `0.92 g/cm3`. CPE and every other
  named material must use the order-system material master when present.
- Normal printed roll-film loss defaults to `2%`.
- Normal roll-film slitting defaults to `400 yuan/ton`.
- Automatic-packaging roll-film freight defaults to `600 yuan/ton`. Use zero
  only when the user explicitly confirms freight is excluded.
- A density value supplied as `1.2`, `0.92`, etc. is understood as `g/cm3`;
  do not ask for the unit again.
- Current-order overrides take precedence over defaults but are not saved as
  standing knowledge without the separate `是 / 否` gate.
- When the user asks to match an existing order-system record, use every input
  stored on that record, including order-specific density, slitting, freight,
  packing, loss, and margin. A general default must never overwrite a stored
  order value.

Before asking for a material density or current reference price, invoke:

```bash
node --no-warnings /workspace/scripts/cache-index.js material MATERIAL_CODE
```

Use the returned `density_g_cm3` and `price_yuan_kg` without asking again. The
current message overrides the returned price for that case, but an omitted
density still comes from the material master. Normalize `ALOX` to `氧化铝`.
Only if the material is absent there, check `/refs/schema-ledger.md`,
`/opt/vm_debug_ci/references/rules.json`, and `/workspace/store/node-state.json`.

When the user mentions the order system, latest costing, a historical costing
record, a snapshot ID, or a costing user such as `chenyongjie`, first invoke:

```bash
node /workspace/scripts/cache-index.js latest chenyongjie
```

Use the returned snapshot as the highest-priority source for that comparison or
recalculation. Copy every applicable stored input into the calculator: layer
thicknesses, prices, densities, processing, slitting, freight, packing, loss,
and margin. Show the snapshot ID in the parameter card. Never replace a stored
snapshot value with a general default. If the user changes one field, preserve
all other snapshot fields exactly.

## Human Gates

- Current material prices and final margin require explicit owner confirmation for every formal result.
- Irregular shapes, antistatic structures, spouts, retort, microwave, acid/alkali, quantified barrier requirements, and unsupported external work remain blocked pending specialist confirmation.
- A candidate structure may be shown only after owner approval.

The owner or an allowed internal member may provide current order inputs directly
in chat. Treat an explicit numeric value in that message as approved for the
current internal calculation; do not ask for its date, source, or approval again.
Do not promote it to a standing rule unless the sender explicitly asks to save it.

Distinguish these intents:

- `核算成本`, `成本多少`, or a request for material/processing conversion: calculate internal cost without requiring margin.
- `报价`, `卖多少钱`, or customer-facing price: internal cost may be shown first, but final price requires margin.
- A direct owner correction replaces the earlier value for the current case. Do not reopen the resolved conflict.

## Interaction

Infer the user's intent from natural language. Do not require slash commands.

## Visible Output Guard

- Never show `提炼进度`, `蒸馏进度`, module completion percentages, or a
  confirmed/pending progress ledger unless the user explicitly asks for a
  distillation-status report.
- Never print `packet-form-v1` JSON, schemas, renderer payloads, normalized
  machine input, or internal state objects in a chat response.
- A renderer payload is an internal transport artifact. If no interactive
  renderer consumes it, discard it and ask the shortest plain-language
  question instead.
- Do not show `已齐 / 待批 / 待补 / 未形成` boilerplate for a direct internal
  calculation request.
- Do not request price evidence, validity dates, rule versions, or approval
  sources when an allowed internal member explicitly supplies the current-order
  number. Ask for audit evidence only when the user explicitly requests a
  formal audit trail.

When required information is missing, prefer a `packet-form-v1` choice request over a long prose checklist:

- Ask at most three highest-impact questions per card.
- Give two to four mutually exclusive options per question whenever possible.
- Put the recommended or most common option first and explain it in one short phrase.
- Separate customer facts from internal approvals; never mix them in one form.
- Do not ask for information that can be derived deterministically from confirmed inputs.
- If interactive rendering is unavailable, show the same choices as `1A 2B 3C` and ask for one-line answers.
- Do not repeat confirmed fields unless needed to distinguish an option.
- Free-text fallback is allowed only when fixed choices would be misleading.
- Ask only fields that mathematically affect the requested result. For roll-film
  cost per kg, do not ask dimensions, print colors, print sides, coverage, or a
  customer reply when layer thicknesses, densities, material prices, processing
  fee, loss, and per-ton additions are sufficient.
- If exactly one numeric input is missing, ask one direct sentence and stop.
- Never print the machine-readable `packet-form-v1` JSON to users. It is renderer
  input only. Until interactive rendering is enabled, show no more than three
  short lettered choices.

Any machine-readable form must conform to `/workspace/packet-form-v1.json`, but
it must never be printed in chat. Never put prices, material rates, processing
rates, loss, or margin in a customer-facing form.

When the user forwards an inquiry or asks for a fast result, respond in this order:

1. Confirmed fields and evidence.
2. Missing customer-facing fields.
3. Internal questions, highest impact first, preferably simple choices.
4. Readiness status and blocking reason.
5. Deterministic output only when ready.
6. Customer reply draft with internal values redacted.

For apprentice mode, ask the learner to identify type, normalize units, select rules, and predict the next step before revealing calculator output.

When the owner provides an experience answer or asks to preserve a rule:

1. Extract the exact statement without broadening it.
2. Separate confirmed facts, examples, exceptions, and unresolved conflicts.
3. Compare it with `/refs/schema-ledger.md` and existing records under `/workspace/store`.
4. If it conflicts with an older rule, show the conflict and ask one simple confirmation question.
5. Append the approved statement to `/workspace/store/node-events.jsonl`; never rewrite historical entries.
6. Update `/workspace/store/node-state.json` only after approval, preserving source record IDs.
7. Reply with what was stored, what remains uncertain, and the next highest-priority question.

## Knowledge Candidate Gate

Keep current-order calculation separate from reusable knowledge capture.

- Use explicit values supplied in chat for the current order immediately when
  the required arithmetic inputs are complete.
- After the result, detect only genuinely reusable new knowledge: material
  density, standard material specification, formula, default processing rule,
  default loss, bag-type rule, exception boundary, or a dated reference price.
- Do not silently save a current-order value as a standing rule.
- Ask exactly one short confirmation after the calculation:
  `是否记录这条知识：<concise candidate>？ 是 / 否`
- When several related candidates came from the same exchange, combine them in
  one concise list and ask one `是 / 否`; do not ask once per field.
- `是`: append an event to `/workspace/store/node-events.jsonl`, then update
  `/workspace/store/node-state.json` with source ID, confirmer, confirmation
  time, scope, and whether the value is time-sensitive.
- `否`: keep it in the current case only and do not write either knowledge file.
- No answer: leave the candidate pending; never treat silence as approval.
- The save question never blocks or delays the current internal calculation.
- Do not ask to save ordinary customer dimensions, quantities, artwork details,
  delivery addresses, one-off margin, or other order-specific facts.

## Fast Result Contract

Before asking for any value that may already have been resolved, inspect the
matching files in `/workspace/cases` and `/workspace/outputs`. Match by exact
company plus contact and keep every item under its own `item_no`; never merge
two customers, reuse another item's price, or treat a manually proposed price
as calculator-verified. If an active `matrix_quote_review` exists, report its
item-by-item status and continue the first unresolved item instead of restarting
the inquiry. Customer requirements come from the cited WhatsApp/CRM message
IDs; internal prices come only from the separately cited owner/calculator
evidence. If the WhatsApp evidence is absent or truncated for a fact that
changes the result, state the exact missing fact and ask the owner to forward
only that message or attachment.

- For a normal request, ask no more than five missing questions at once.
- Ask product facts externally and cost judgments internally; never send internal cost questions to a customer.
- Once all required inputs are ready, invoke a deterministic calculator.
- For finished pouch types, including stand-up zipper, eight-side seal,
  irregular zipper, back seal, side seal, and four-side seal, invoke
  `/workspace/scripts/cache-math.js`. This wrapper uses the same read-only
  engine as the order system. Never send these pouch types to `packet-math.js`.
- For roll-film cost per kg, invoke `/workspace/scripts/packet-math.js`. Never do
  the arithmetic in prose.
- For FOB conversion, first obtain the approved product price in yuan/kg and
  quantity/weight, then invoke `/refs/packet-route.js`; never
  divide a yuan price by an exchange rate in prose and never reuse the domestic
  `freight_yuan_ton` field as FOB origin charges.
- If the user says to use the previously organized forwarder basis, read
  `/refs/packet-route-profiles.json`. For a roughly 1000 kg shipment without
  confirmed CBM/cartons, use `shenzhen_lcl_historical_warehouse` only as an
  explicit `internal_estimate`; do not ask the user to resend the old fee table.
  Show the assumed profile, origin-cost allocation, exchange rate, source date,
  and every unresolved item. Then return the calculator's copyable Chinese
  `forwarder_review_message_cn` so the operator can ask the forwarder to verify.
- A historical profile can never produce a current formal customer FOB quote.
  Forwarder confirmation and the owner's final customer-price approval remain
  required. Missing product price, weight, or exchange rate still blocks the
  numeric result.
- The first result is an internal review card. A formal customer result requires explicit current material-price and margin approvals.
- If a special or unsupported case is detected, give a candidate structure or question list but no formal number.

Internal output order:

1. Specification summary.
2. Input approvals and dates.
3. Formula and intermediate values.
4. Unit cost, order amount, plate/MOQ/packing items when applicable.
5. Margin approval state.
6. Warnings and blocked items.

Customer output order:

1. Product and specification.
2. Quantity and unit price.
3. Plate fee or one-time fee when applicable.
4. Delivery estimate, tolerance, validity, and commercial boundary.
5. A short recalculation note for changed specifications.

For a direct internal calculation request, omit the customer reply draft,
readiness boilerplate, approval checklist, and machine-readable form. Return:

1. A compact `核算参数卡`.
2. Result.
3. Compact formula with substituted values.
4. Included/excluded items.
5. At most one genuinely blocking question.

The visible `核算参数卡` must list every numeric input used by the calculator:

- Each layer: material, thickness C, density, and yuan/kg.
- Processing fee and its unit.
- Loss rate.
- Slitting yuan/ton.
- Freight yuan/ton.
- Core/packing yuan/ton.
- Margin rate, or explicitly `未计利润`.

Before calculation, perform a magnitude sanity check against the confirmed
material reference table. A value far outside the normal magnitude is a likely
decimal or unit error. Never silently correct it. Ask one direct confirmation,
for example: `PE单价0.95元/kg明显低于参考范围，是否应为9.5元/kg？ 是 / 否`.
Only after the user explicitly confirms the unusual value may the input include
`confirm_unusual_price: true`. Highlight the confirmed exception in the visible
parameter card.

Use conservative sanity bounds for validation, not quotation: normally block a
material price below 40% or above 250% of its current reference. This guard does
not replace current-price confirmation and must not turn a reference price into
a customer quote.

Never hide a zero-value cost item. Render zero as `0（未计入）`, not as a blank.
Freight must never silently default to zero. If freight is missing, ask one short
question with the most relevant known reference value. If the user explicitly
requires zero freight, pass `confirm_zero_freight: true` to the calculator and
show `运费 0（已确认不计）` in the card.

Preferred compact layout:

```text
核算参数卡
材料：KPA 1.7C｜比重1.2｜21元/kg
      PE 5C｜比重0.96｜9.5元/kg
加工：0.45元/㎡   损耗：2%
分切：400元/吨    运费：600元/吨
包装：0（未计入） 利润：22%
```

## Source Priority

1. Explicit values in the current message.
2. A specifically requested order-system cost snapshot for that order or comparison.
3. The order-system `material_prices` master for material density and current reference price.
4. `/refs/schema-ledger.md` for latest direct confirmations.
5. `/opt/vm_debug_ci/references/rules.json` for machine-readable supported values.
6. `/workspace/store/node-state.json` for subsequently approved additions.
7. Historical examples only as comparison evidence, never as a silent replacement for a confirmed rule.

## Durable Context Lookup

When a message names a company, contact, email address, prior inquiry, or an
existing quote, always query the authoritative system before answering:

```bash
node /workspace/scripts/matrix-context.js "COMPANY OR CONTACT OR EMAIL"
```

Use the returned customer record, complete email thread, attachment inventory,
inquiry, research note, and existing costing tasks as the primary case context.
Continue the first unresolved item instead of restarting intake. If the query
returns a matching email thread or attachment record, never ask the operator to
connect Outlook or Gmail, and never ask them to resend the full email. Ask only
for a specific missing fact or unavailable attachment content that is not in the
authoritative result. Do not claim that the workspace lacks synchronized data
until this command has returned no match.

硬规则：权威查询已命中时，不得要求连接 Outlook 或 Gmail，也不得要求重新
转发整封邮件；必须直接继续该客户现有询盘或核算任务。
查询结果必须联合使用：客户档案、完整邮件线程、附件清单、询盘记录和现有核算任务。

附件图片不能只报数量。对尚未分类且可读取的图片，必须先使用图片查看能力判断
其属于产品参考图、文件照片还是邮件签名素材。只把明确审核的产品参考图与客户、
询盘绑定；不得从照片猜测精确尺寸、材质结构或厚度。发现产品参考图后，先总结
可见信息，再问师傅是否需要发到群里，并给出明确命令：
`显示 <客户公司名> 客户图片`。没有确认不得主动发送图片。

Conversation history is not the durable record. New customer facts belong in
the customer/inquiry/specification records, reusable confirmed rules belong in
the private knowledge ledger, and numeric work belongs in the existing costing
task or snapshot. The next conversation must retrieve those records rather than
depending on a long chat context.

The route ledger at `/refs/packet-ledger.md` is separate from the production result. Its reviewed machine-readable profiles are at `/refs/packet-route-profiles.json`. Time-sensitive route rates must be reconfirmed before a formal FOB/CIF/DDP result.

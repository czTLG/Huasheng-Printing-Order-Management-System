# Matrix Build Cache Design

## Scope

Create a personal Codex skill named `matrix-build-cache` for three workflows: direct forwarding of an inquiry, deterministic bag-cost calculation, and guided apprentice training. Keep it independent from CRM and do not modify existing business code or historical formula implementations.

## Architecture

The skill body orchestrates natural-language extraction and human questions. A standalone Node.js calculator accepts JSON only and performs validation, rule selection, arithmetic, audit output, and training checks. Detailed private rules live in bundled references; sensitive runtime values such as current material prices and margin must be supplied explicitly.

## Safety Boundary

- The model may extract and explain but may not invent numeric inputs.
- Formal price output requires bag type, dimensions, quantity, complete material layers, density, current price, processing fee/rule, loss, additive rate, and explicit margin.
- Auto-selected rules are limited to confirmed cases. Unresolved or special cases return blocking questions.
- Every result includes normalized inputs, formulas, intermediate values, rule provenance, warnings, and status.
- Customer output excludes material prices, margin, internal costs, and private rules.

## Workflows

### Direct Forward

The agent converts a customer message into the input schema, quotes evidence for extracted fields, separates customer questions from internal questions, and calls validation. It does not calculate until readiness is `ready`.

### Deterministic Calculation

The calculator supports three-side seal, stand-up pouch, and eight-side seal in the first release. It computes layer area/weight/cost, square-meter processing cost, bag-type additive cost, freight if explicitly supplied, loss, margin, and unit/total quote. It also calculates MOQ using confirmed mother-roll, layout, and yield rules when all required layout inputs are present.

### Apprentice Training

The agent asks the apprentice to identify bag type, normalize units, select rules, and predict the next calculation step before showing the calculator output. A deterministic checker compares submitted answers against the normalized case and gives field-level feedback without hiding the calculation trail.

## Verification

Use Node's built-in test runner. Cover blocking on missing prices/margin, confirmed rule selection, special-material blocking, exact arithmetic, MOQ calculation, plate-fee calculation, private customer-output redaction, and training feedback. Validate the skill folder with the official skill validator.

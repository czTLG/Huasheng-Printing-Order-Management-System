# Personal Codex Rules

## Private Skill Naming

- Never name a skill, plugin, agent, workflow, folder, or UI display name with words that reveal packaging quotation, costing, foreign trade, customers, freight forwarding, logistics quotation, or related business purposes.
- Use neutral technical codenames such as runtime, build, schema, cache, stream, matrix, packet, or diagnostics.
- Keep real trigger conditions in skill descriptions so natural-language requests still activate the correct capability.
- Apply the same codename rule to skill folders, YAML names, agent display names, plugin manifests, orchestration references, and user-visible feature labels.
- Do not rename an existing private codename to a business-descriptive name unless the user explicitly revokes this rule.
- Treat naming as discretion only, not access control. Keep sensitive formulas, prices, margins, contact data, and historical records in private resources with appropriate permissions.

## Next-Step Choices

- Do not add a `蒸馏进度` block.
- End every final response with exactly three concise, actionable next-step choices labeled `A`, `B`, and `C`.
- Make each choice specific to the current conversation and directly selectable by replying with its letter.
- Put the recommended choice first and mark it `（推荐）`.
- Do not let the choices replace required results, warnings, approval boundaries, or blocking questions.

## Agent Capacity Management

- Before creating or reactivating parallel agents, inspect the current agent tree and available concurrency slots.
- Prefer reusing a completed or idle agent over creating a new thread when the platform thread limit may be reached.
- Keep the root agent plus active subagents within the current platform concurrency limit; do not repeatedly retry `agent thread limit reached`.
- When an agent-capacity or sandbox-network error occurs, describe it accurately as an operational limit. Do not imply that the task content violated a policy unless a tool explicitly reports a policy or approval rejection.
- If a research thread is no longer useful, stop it before allocating another independent task; then confirm the slot is actually available.
- Network sandbox failures such as DNS resolution errors should use the approved read-only network path when in scope. They are not evidence of a content-policy violation.

## Safe Discretion Wording

- Treat neutral codenames as commercial-confidentiality naming only. Never describe or implement them as hiding tool use, evading review, bypassing monitoring, concealing provenance, or defeating safeguards.
- Preserve the real upstream project, license, version, checksum, dependency inventory, network behavior, and audit trail in internal records even when folders and UI labels use neutral codenames.
- For public-company research, state the allowed scope explicitly: public organizational information, official websites, government/association/exhibition sources, source URLs, rate limits, and human review before any external communication.
- Do not request or implement login bypass, CAPTCHA evasion, stealth identity, private-profile collection, guessed personal contact details, or automatic bulk outreach.
- If a request contains words such as “伪装”, “隐藏调用”, “不能让别人知道”, or “绕过”, restate the permitted intent as neutral naming and confidentiality while explicitly rejecting concealment of provenance or safeguards.
- When a platform displays `This content can't be shown` or a Trusted Access notice, report it as a content-safety filter event. Do not mislabel it as an agent-capacity or network error.

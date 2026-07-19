# Matrix Capability Guidance Design

## Goal

Prevent the runtime assistant from claiming that no email interface exists when it prepares a customer clarification draft. The runtime must accurately distinguish draft preparation, the installed guarded relay workflow, explicit approval, and current sender-readiness gates.

## Current Failure

For a request such as `问客户`, the model can prepare a technically appropriate draft but then append an unsupported statement that the system has no mail-sending interface. The guarded relay already exists through the management API. Actual delivery remains fail-closed while sender-domain readiness is incomplete.

## Chosen Design

Add a small intent-scoped capability guidance block in `stream-card.cjs` before the model handles a message. The block is appended only when the user message concerns asking, replying to, drafting, or sending customer email.

The guidance must state:

- a guarded email workflow is installed;
- drafting does not authorize or perform delivery;
- the assistant must not claim that no sending interface exists;
- `发送邮件` enters the existing server-backed draft and final-preview flow;
- actual delivery still requires an immutable preview, explicit final confirmation, duplicate protection, and sender-readiness checks;
- a failed DMARC or relay-readiness gate means `未发送`, not `没有接口`.

The bot container still receives no SMTP credentials and gains no generic outbound request capability.

## Technical Boundary

This change does not modify the relay service, SMTP factory, approval records, database schema, recipient resolution, or delivery gates. It changes only the context supplied to the language model for relevant messages.

For quantified barrier requirements, existing technical safety remains unchanged: OTR and WVTR require the requested value, test temperature, relative humidity, test method, and whether the requirement applies to the source film or finished laminate/package. A report value without matching test conditions must not be represented as proof of compliance.

## Components

1. Add a pure `communicationCapabilityBlock(text)` helper to the interaction extension.
2. Append its output to model-bound content after authoritative customer context resolution.
3. Export the helper for focused tests.
4. Add regression tests for draft intent, send intent, unrelated messages, no automatic API call, and prohibited `no interface` wording.

## Response Contract

For a draft-only request, the model should use the meaning:

`草稿已准备，尚未发送。系统支持受控邮件发送；如需进入发送流程，请回复“发送邮件”，随后审阅最终预览并再次确认。`

When readiness blocks delivery, the meaning is:

`发送流程已安装，但发送就绪校验未通过，本次未发送。`

The assistant must never say or imply that SMTP acceptance proves inbox placement or that a draft was sent.

## Testing

- RED: current extension does not provide capability guidance for `问客户`.
- GREEN: relevant intents receive the bounded guidance and unrelated messages do not.
- Existing relay client/card, context bridge, choice context, asset context, and stream extension tests remain green.
- Security scan confirms no SMTP variable, credential, generic request primitive, message identifier, or business record was added.

## Deployment

Commit the isolated change, merge it into `main`, rebuild the immutable runtime image, restart only the runtime container/service required by the established deployment path, verify health and mounted file hashes, then reconcile the existing `message-relay` catalog entry. Deployment and any real outbound send remain separately approval-gated.

# Matrix Image Context Design

**Date:** 2026-07-19  
**Status:** Approved interaction, pending written-spec review

## Goal

After 智能桓 has clearly identified one customer and found reviewed product-reference images, the operator can reply with the short command `发图`. The system sends only that customer's currently reviewed product images to the same Feishu chat. The operator does not need to repeat a company name or remember a customer abbreviation.

## Interaction

When authoritative context contains exactly one customer with one or more available attachments whose role is `product_reference` and whose `display_recommended` flag is true, the assistant must summarize the visible image evidence and ask:

`是否把这N张产品图发到群里？需要请回复：发图`

The existing explicit form, such as `显示 Acepac 客户图片`, remains supported as a fallback. Bare letters such as `A`, `AC`, and `PAC` are not introduced because they can conflict with candidate, quotation, or other short-choice contexts.

## Durable Context Binding

The runtime stores a short-lived, append-safe image context under the existing private writable runtime store. Each record contains only:

- Feishu chat ID;
- operator open ID;
- customer database ID;
- creation and expiration timestamps.

It does not copy customer names, contact details, email bodies, image paths, or business specifications. The default lifetime is 30 minutes. Registering a newer valid customer image context for the same chat and operator replaces the older active context. Expired records are removed during reads and writes. The file is written atomically with mode `0600`, bounded to 200 records.

## Resolution and Delivery

On `发图`:

1. Resolve exactly one unexpired record for the same chat and operator.
2. Read the customer again from the authoritative management-system API by customer ID.
3. Select at most six attachments that are currently available images, have role `product_reference`, and have `display_recommended=true`.
4. Reply to the operator's confirmation message with those images.
5. Send a compact internal confirmation stating how many product images were shown and that signature assets were filtered.

The runtime never trusts stored attachment paths from the short-lived context. It always refreshes the current attachment list from the authoritative database before delivery.

## Fail-Closed Rules

The system sends nothing when:

- the context is missing or expired;
- chat or operator binding does not match;
- the customer no longer exists or cannot be read;
- no reviewed product-reference image is currently available;
- more than one active record is found due to corrupt state;
- an attachment fails path, size, or digest validation;
- Feishu delivery returns an ambiguous result.

In these cases it asks the operator to mention the customer again. It must not fall back to the latest customer globally, a different operator's context, a candidate A-E session, or unreviewed/signature images.

## Security and Approval Boundaries

`发图` authorizes showing reviewed images only inside the current internal Feishu chat. It does not authorize sending images to a customer, replying by email or WhatsApp, publishing externally, or changing customer/inquiry state. Those existing approval gates remain unchanged.

## Testing

Automated coverage must prove:

- the latest customer context is persisted and survives a container restart;
- `发图` works only for the same chat and operator within 30 minutes;
- a newer customer context replaces the older one;
- expired, cross-chat, cross-operator, missing, duplicate, and corrupt contexts send nothing;
- customer data is refreshed by ID before image selection;
- only reviewed product images are sent, with signature assets filtered;
- the six-image maximum is enforced;
- explicit long-form image commands still work;
- bare A-E candidate routing is unchanged;
- no customer data, message body, attachment path, token, or credential is persisted in the short-lived context store.

## Rollout

Deploy the context store and tests first, then add customer-by-ID read access, register image contexts during authoritative message enrichment, and finally enable the `发图` handler. Restart the bot container, verify a no-send production resolution for Acepac, and perform the actual Feishu image send only after a fresh operator `发图` confirmation.

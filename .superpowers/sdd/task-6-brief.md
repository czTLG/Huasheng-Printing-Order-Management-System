### Task 6: Feishu Two-Confirmation Cards and Revision Context

**Files:**
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Client adds `createVersion`, `reviseVersion`, `approveVersion`, `versionPreview`, and `confirmSend` using the fixed `/api/matrix` origin.
- Card actions add neutral identifiers `mx.review`, `mx.revise`, `mx.approve`, `mx.preview`, and `mx.confirm`.

- [ ] **Step 1: Write the full RED card-flow test**

Drive handlers in this order:

```js
await handlers.get('mx.select')({ evt, value: selectValue });
assert.deepStrictEqual(buttons(sent.at(-1)).map(item => item.text.content), ['确认采用', '修改草稿', '暂不处理']);
await handlers.get('mx.revise')({ evt, value: reviseValue });
assert.ok(visibleText(sent.at(-1)).includes('请回复“修改：……”'));
await registered.onMessage({ msg: { content: '修改：语气更简洁，询问年用量', chatId: evt.chatId, threadId: evt.threadId, senderId: evt.operator.openId } });
assert.strictEqual(clientCalls.at(-1)[0], 'reviseVersion');
await handlers.get('mx.approve')({ evt, value: approveValue });
assert.ok(visibleText(sent.at(-1)).includes('尚未发送'));
assert.ok(visibleText(sent.at(-1)).includes('sales@alpha.test'));
await handlers.get('mx.confirm')({ evt, value: confirmValue });
assert.ok(visibleText(sent.at(-1)).includes('邮件服务器已接受'));
```

Assert selection itself never calls `confirmSend`, approval never calls `confirmSend`, repeated confirmation uses one idempotency key, and the review/final cards stay within 1,500 Unicode code points. Add a blocked-preview fixture that displays quality score, component reasons, duplicate/cooling/quota result, sender readiness, and country-policy failures and does not render `确认发送`.

- [ ] **Step 2: Run and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`  
Expected: FAIL because review actions and client methods do not exist.

- [ ] **Step 3: Add fixed-origin client methods**

Each method validates an exact field set and positive identifiers. `confirmSend` sends no content fields:

```js
function confirmSend(openId, workItemId, versionId, input) {
  const body = exactObject(input, new Set(['expected_work_version', 'expected_content_hash', 'chat_id', 'card_event_id', 'idempotency_key']), 'send confirmation');
  return call(openId, `/work-items/${positiveId(workItemId, 'work item id')}/versions/${positiveId(versionId, 'version id')}/send`, { method: 'POST', body });
}
```

- [ ] **Step 4: Implement short-lived revision context and cards**

Bind edit context by `sessionKey(chatId, openId, threadId)` with work item, base version, and ten-minute expiry. Only the same operator/context message beginning `修改：` is consumed. Clear context on success, expiry, defer, or cancel. Render distinct accepted/failed/ambiguous cards; ambiguous exposes no retry action.

- [ ] **Step 5: Run and commit**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node scripts/test-bridge-artifact-0.6.9.js
```

Expected: PASS.  
Commit: `feat: add matrix stream two-step cards`

---


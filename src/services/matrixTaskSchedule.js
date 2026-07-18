'use strict';

const crypto = require('node:crypto');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function token(value, label) { const result = String(value ?? '').trim(); if (!result) throw new Error(`${label} required`); return result; }
function iso(value, label = 'time') { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new Error(`${label} invalid`); return date.toISOString(); }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

function createMatrixTaskSchedule({
  db,
  clock = () => new Date(),
  timezone = 'Asia/Shanghai',
  holidays = [],
  billDigest = { hour: 9, minute: 0 },
  vmciDigest = { hour: 10, minute: 0 },
  overdueDigest = { hour: 16, minute: 30 },
  quietHours = { start: '22:00', end: '08:00' }
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('db required');
  const holidaySet = new Set(holidays);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  function localParts(value) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
  }
  function minuteOfDay(parts) { return parts.hour * 60 + parts.minute; }
  function parseHm(value) { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; }
  function inQuietHours(parts) {
    const minute = minuteOfDay(parts), start = parseHm(quietHours.start), end = parseHm(quietHours.end);
    return start > end ? minute >= start || minute < end : minute >= start && minute < end;
  }
  function isBusinessDate(dateKey) {
    const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
    return day !== 0 && day !== 6 && !holidaySet.has(dateKey);
  }
  function businessDaysAfter(fromDate, toDate) {
    if (toDate <= fromDate) return 0;
    let cursor = new Date(`${fromDate}T00:00:00.000Z`);
    const end = new Date(`${toDate}T00:00:00.000Z`);
    let count = 0;
    while (cursor < end) {
      cursor = new Date(cursor.getTime() + 86400000);
      const key = cursor.toISOString().slice(0, 10);
      if (isBusinessDate(key)) count += 1;
    }
    return count;
  }
  function command(idempotencyKey, request, operation) {
    const key = token(idempotencyKey, 'idempotency key');
    const fp = hash(request);
    return db.transaction(() => {
      const replay = db.prepare('SELECT * FROM matrix_schedule_commands WHERE idempotency_key=?').get(key);
      if (replay) {
        if (replay.request_fingerprint !== fp) throw new Error('matrix schedule idempotency conflict');
        return parse(replay.result_json, null);
      }
      const result = operation(key);
      db.prepare('INSERT INTO matrix_schedule_commands (idempotency_key,request_fingerprint,result_json,created_at) VALUES (?,?,?,?)')
        .run(key, fp, canonicalJson(result), iso(clock()));
      return result;
    })();
  }
  function outboxResult(row) {
    return {
      id: row.id, channel: row.channel, slotKey: row.slot_key, membershipHash: row.membership_hash,
      payload: parse(row.payload_json, {}), state: row.state, claimToken: row.claim_token,
      leaseExpiresAt: row.lease_expires_at, receiptId: row.receipt_id, attemptCount: row.attempt_count
    };
  }
  function slotsAt(parts) {
    if (!isBusinessDate(parts.date) || inQuietHours(parts)) return [];
    const minute = minuteOfDay(parts);
    const slots = [];
    if (minute >= billDigest.hour * 60 + billDigest.minute) slots.push({ channel: 'bill', slotKey: `${parts.date}:bill:daily` });
    if (minute >= vmciDigest.hour * 60 + vmciDigest.minute) slots.push({ channel: 'vmci', slotKey: `${parts.date}:vmci:daily` });
    if (minute >= overdueDigest.hour * 60 + overdueDigest.minute) {
      slots.push({ channel: 'bill', slotKey: `${parts.date}:bill:overdue` }, { channel: 'vmci', slotKey: `${parts.date}:vmci:overdue` });
    }
    return slots;
  }

  function prepareDueDigests({ now = clock(), idempotencyKey } = {}) {
    const nowValue = iso(now);
    const request = { operation: 'prepare_due_digests', now: nowValue };
    return command(idempotencyKey, request, () => {
      const rows = [];
      for (const slot of slotsAt(localParts(nowValue))) {
        const tasks = db.prepare(`SELECT * FROM matrix_tasks WHERE channel=? AND state IN ('open','blocked','waiting_decision') AND due_at<=? ORDER BY due_at,id`).all(slot.channel, nowValue);
        if (!tasks.length) continue;
        const membership = tasks.map(task => ({ id: task.id, version: task.version, state: task.state, dueAt: task.due_at }));
        const membershipHash = hash(membership);
        const payload = { channel: slot.channel, slotKey: slot.slotKey, generatedAt: nowValue, taskIds: tasks.map(task => task.id), membership };
        db.prepare(`INSERT OR IGNORE INTO matrix_digest_outbox (channel,slot_key,membership_hash,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
          .run(slot.channel, slot.slotKey, membershipHash, canonicalJson(payload), nowValue, nowValue);
        rows.push(outboxResult(db.prepare('SELECT * FROM matrix_digest_outbox WHERE channel=? AND slot_key=? AND membership_hash=?').get(slot.channel, slot.slotKey, membershipHash)));
      }
      return rows;
    });
  }

  function advance({ now = clock(), idempotencyKey } = {}) {
    const nowValue = iso(now), parts = localParts(nowValue);
    const request = { operation: 'advance', now: nowValue };
    return command(idempotencyKey, request, (key) => {
      if (!isBusinessDate(parts.date) || inQuietHours(parts)) return { proposedTaskIds: [], now: nowValue };
      const tasks = db.prepare(`SELECT * FROM matrix_tasks WHERE state IN ('open','blocked','waiting_decision') AND due_at<=? ORDER BY id`).all(nowValue);
      const proposedTaskIds = [];
      for (const task of tasks) {
        if (task.followup_count >= 2) continue;
        const elapsed = businessDaysAfter(localParts(task.due_at).date, parts.date);
        const threshold = task.followup_count === 0 ? 1 : 3;
        if (elapsed < threshold) continue;
        const nextCount = task.followup_count + 1;
        db.prepare('UPDATE matrix_tasks SET followup_count=?,version=version+1,updated_at=? WHERE id=?').run(nextCount, nowValue, task.id);
        const updated = db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(task.id);
        db.prepare(`INSERT INTO matrix_task_events (task_id,task_version,event_type,payload_json,actor_user_id,binding_id,channel,chat_id,card_event_id,idempotency_key,created_at) VALUES (?,?, 'followup_proposed',?,NULL,?,?, '', '', ?,?)`)
          .run(updated.id, updated.version, canonicalJson({ followupCount: nextCount, businessDaysOverdue: elapsed }), updated.binding_id, updated.channel, `${key}:task:${updated.id}`, nowValue);
        proposedTaskIds.push(updated.id);
      }
      return { proposedTaskIds, now: nowValue };
    });
  }

  function claimDigest({ channel, ownerToken, leaseMs, now = clock() } = {}) {
    const targetChannel = token(channel, 'channel');
    const owner = token(ownerToken, 'owner token');
    const lease = Number(leaseMs);
    if (!Number.isInteger(lease) || lease < 1000 || lease > 3600000) throw new Error('lease ms invalid');
    const nowValue = iso(now);
    return db.transaction(() => {
      db.prepare("UPDATE matrix_digest_outbox SET state='manual_review',last_outcome='lease_expired',updated_at=? WHERE channel=? AND state='inflight' AND lease_expires_at<=?")
        .run(nowValue, targetChannel, nowValue);
      const row = db.prepare("SELECT * FROM matrix_digest_outbox WHERE channel=? AND state='pending' ORDER BY id LIMIT 1").get(targetChannel);
      if (!row) return null;
      const claimToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(new Date(nowValue).getTime() + lease).toISOString();
      const info = db.prepare("UPDATE matrix_digest_outbox SET state='inflight',owner_token=?,claim_token=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND state='pending'")
        .run(owner, claimToken, leaseExpiresAt, nowValue, row.id);
      if (info.changes !== 1) return null;
      return outboxResult(db.prepare('SELECT * FROM matrix_digest_outbox WHERE id=?').get(row.id));
    })();
  }

  function ackDigest({ outboxId, claimToken, receiptId, now = clock() } = {}) {
    const id = Number(outboxId), claim = token(claimToken, 'claim token'), receipt = token(receiptId, 'receipt id'), nowValue = iso(now);
    const info = db.prepare("UPDATE matrix_digest_outbox SET state='delivered',receipt_id=?,delivered_at=?,updated_at=? WHERE id=? AND state='inflight' AND claim_token=?")
      .run(receipt, nowValue, nowValue, id, claim);
    if (info.changes !== 1) throw new Error('digest claim mismatch');
    return outboxResult(db.prepare('SELECT * FROM matrix_digest_outbox WHERE id=?').get(id));
  }

  function nackDigest({ outboxId, claimToken, outcome, now = clock() } = {}) {
    const id = Number(outboxId), claim = token(claimToken, 'claim token'), result = token(outcome, 'outcome'), nowValue = iso(now);
    if (!['definite_failure', 'ambiguous', 'lease_expired'].includes(result)) throw new Error('digest outcome invalid');
    const state = result === 'definite_failure' ? 'pending' : 'manual_review';
    const info = db.prepare("UPDATE matrix_digest_outbox SET state=?,last_outcome=?,owner_token='',claim_token='',lease_expires_at='',updated_at=? WHERE id=? AND state='inflight' AND claim_token=?")
      .run(state, result, nowValue, id, claim);
    if (info.changes !== 1) throw new Error('digest claim mismatch');
    return outboxResult(db.prepare('SELECT * FROM matrix_digest_outbox WHERE id=?').get(id));
  }

  return { advance, prepareDueDigests, claimDigest, ackDigest, nackDigest };
}

module.exports = { createMatrixTaskSchedule };

'use strict';
const crypto=require('node:crypto');

function required(value,label,max=256){const v=String(value??'').trim();if(!v||v.length>max||/[\r\n\0]/.test(v))throw new Error(`${label} required`);return v;}
function id(value,label){const n=Number(value);if(!Number.isInteger(n)||n<1)throw new Error(`${label} required`);return n;}
function publicResult(row,revision){return{state:String(row.state),error_class:String(row.error_class||''),route_revision:Number(revision)};}

function createMatrixThreadDelivery({db,transport,previewService,clock=()=>new Date(),fromAddress,replyToAddress=fromAddress,messageIdDomain,requireCanonicalCutover=process.env.NODE_ENV==='production'}={}){
 if(!db||typeof db.prepare!=='function'||!transport||typeof transport.sendMail!=='function'||!previewService||typeof previewService.project!=='function')throw new Error('matrix thread delivery dependencies required');
 const from=required(fromAddress,'from address').toLowerCase(),replyTo=required(replyToAddress,'reply-to address').toLowerCase(),domain=required(messageIdDomain,'message id domain').toLowerCase();
 if(from!==replyTo||from.split('@')[1]!==domain)throw new Error('matrix thread sender mismatch');
 const iso=()=>{const v=clock();const ms=v instanceof Date?v.getTime():Date.parse(String(v));if(!Number.isFinite(ms))throw new Error('matrix thread delivery clock invalid');return new Date(ms).toISOString()};
 async function confirm(raw={}){
  if(requireCanonicalCutover)require('./matrixLedgerCutover').assertCanonicalDeliveryOnly({db});
  const fields=new Set(['actorUserId','bindingId','routeId','expectedRevision','expectedContentHash','chatId','threadId','cardEventId','idempotencyKey']);const unknown=Object.keys(raw).find(k=>!fields.has(k));if(unknown)throw new Error(`unknown thread confirmation field: ${unknown}`);
  const actorUserId=id(raw.actorUserId,'actor user id'),routeId=id(raw.routeId,'route id'),revision=id(raw.expectedRevision,'expected revision');id(raw.bindingId,'binding id');
  const hash=required(raw.expectedContentHash,'expected content hash',64).toLowerCase(),chatId=required(raw.chatId,'chat id'),threadId=String(raw.threadId||'').trim(),cardEventId=required(raw.cardEventId,'card event id'),key=required(raw.idempotencyKey,'idempotency key',200);
  if(!/^[a-f0-9]{64}$/.test(hash)||threadId.length>256||/[\r\n\0]/.test(threadId))throw new Error('valid thread confirmation required');
  const existing=db.prepare('SELECT * FROM matrix_thread_jobs WHERE idempotency_key=?').get(key);if(existing){const route=db.prepare('SELECT revision FROM matrix_thread_routes WHERE id=?').get(existing.route_id);return publicResult(existing,route?.revision)}
  const route=db.prepare('SELECT * FROM matrix_thread_routes WHERE id=?').get(routeId);
  if(!route||route.actor_user_id!==actorUserId||route.chat_id!==chatId||route.thread_id!==threadId)throw new Error('thread delivery not authorized');
  if(route.status!=='approved'||route.revision!==revision||route.content_hash!==hash)throw new Error('stale thread delivery confirmation');
  const projected=await previewService.project(route);if(projected.allowed!==true)throw new Error(`thread delivery gate blocked: ${(projected.readiness?.reasons||[]).join(',')}`);
  let manifest;try{manifest=JSON.parse(route.attachment_manifest_json||'[]')}catch(_){throw new Error('attachment manifest invalid')};if(!Array.isArray(manifest))throw new Error('attachment manifest invalid');
  if(manifest.some(x=>x?.approved!==true||!x.path||!x.filename))throw new Error('unapproved thread attachment');
  const at=iso(),owner=crypto.randomUUID(),messageId=`<matrix-thread-${routeId}-${hash.slice(0,20)}@${domain}>`;
  let job;
  const reserve=db.transaction(()=>{const inserted=db.prepare("INSERT INTO matrix_thread_jobs (route_id,idempotency_key,content_hash,message_id,state,attempt_count,error_class,owner_token,lease_expires_at,created_by,created_at,updated_at) VALUES (?,?,?,?,'sending',1,'',?,?,?, ?,?)").run(routeId,key,hash,messageId,owner,new Date(Date.parse(at)+30000).toISOString(),actorUserId,at,at);return db.prepare('SELECT * FROM matrix_thread_jobs WHERE id=?').get(Number(inserted.lastInsertRowid))});
  try{job=reserve.immediate()}catch(error){const current=db.prepare('SELECT * FROM matrix_thread_jobs WHERE route_id=? AND content_hash=?').get(routeId,hash);if(current)return publicResult(current,revision);throw error}
  let state='ambiguous',errorClass='transport_outcome_unknown';
  try{const response=await transport.sendMail({from,replyTo,to:route.recipient_email,subject:route.subject,text:route.body_en,messageId,inReplyTo:route.in_reply_to,references:route.references_header,attachments:manifest.map(x=>({filename:x.filename,path:x.path}))});const target=route.recipient_email.toLowerCase(),accepted=(response?.accepted||[]).map(x=>String(x).toLowerCase()),rejected=(response?.rejected||[]).map(x=>String(x).toLowerCase());if(accepted.includes(target)&&!rejected.includes(target)){state='accepted';errorClass=''}else if(rejected.includes(target)&&!accepted.includes(target)){state='failed';errorClass='recipient_rejected'}}catch(error){const code=Number(error?.responseCode||0);if(code>=500&&code<600){state='failed';errorClass='recipient_rejected'}}
  const done=iso();db.transaction(()=>{db.prepare('UPDATE matrix_thread_jobs SET state=?,error_class=?,updated_at=? WHERE id=? AND owner_token=?').run(state,errorClass,done,job.id,owner);if(state==='accepted'){db.prepare("UPDATE matrix_thread_routes SET status='sent',updated_at=? WHERE id=? AND status='approved'").run(done,routeId);db.prepare("UPDATE crm_reply_drafts SET status='sent',updated_at=? WHERE id=?").run(done,route.crm_draft_id)}else if(state==='ambiguous')db.prepare("UPDATE matrix_thread_routes SET status='delivery_ambiguous',updated_at=? WHERE id=?").run(done,routeId)}) .immediate();
  return publicResult(db.prepare('SELECT * FROM matrix_thread_jobs WHERE id=?').get(job.id),revision);
 }
 return{confirm};
}
module.exports={createMatrixThreadDelivery};

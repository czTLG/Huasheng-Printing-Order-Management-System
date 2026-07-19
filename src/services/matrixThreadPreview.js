'use strict';

function gate(ok,reasons=[]){return {ok:ok===true,reasons:ok===true?[]:[...new Set(reasons)]};}

function createMatrixThreadPreview({db,readinessService,senderDomain='gdhspack.com',dkimSelector='default'}={}){
  if(!db||typeof db.prepare!=='function'||!readinessService||typeof readinessService.checkSender!=='function') throw new Error('matrix thread preview dependencies required');
  return {async project(route={}){
    const customer=db.prepare('SELECT active,is_invalid,stage FROM customers WHERE id=?').get(route.customer_id);
    const message=db.prepare("SELECT direction,sender_contact FROM crm_messages WHERE id=?").get(route.source_crm_message_id);
    const source=db.prepare('SELECT message_id,from_email FROM email_messages WHERE id=?').get(route.source_email_message_id);
    const recipient=String(route.recipient_email||'').trim().toLowerCase();
    const authorization=gate(Number.isInteger(Number(route.approved_by))&&Boolean(route.approved_at),['approval_evidence_missing']);
    const approval=gate(route.status==='approved'&&/^[a-f0-9]{64}$/.test(String(route.content_hash||'')),['route_not_approved']);
    const thread=gate(message?.direction==='inbound'&&String(message?.sender_contact||'').trim().toLowerCase()===recipient&&String(source?.from_email||'').trim().toLowerCase()===recipient&&Boolean(source?.message_id),['thread_evidence_changed']);
    const suppression=gate(Boolean(customer)&&Number(customer.active??1)===1&&Number(customer.is_invalid||0)===0&&!['blocked','suppressed','unsubscribed'].includes(String(customer.stage||'').toLowerCase()),['recipient_suppressed']);
    let sender;
    try{sender=await readinessService.checkSender({db,domain:senderDomain,selector:dkimSelector});}catch(_){sender={ok:false,hardFailures:['sender_readiness_unavailable']};}
    const readiness=gate(sender?.ok===true,Array.isArray(sender?.hardFailures)?sender.hardFailures:['sender_readiness_unavailable']);
    let duplicate=gate(true);
    try{const row=db.prepare("SELECT state FROM matrix_thread_jobs WHERE route_id=? AND state IN ('pending','sending','accepted','ambiguous') LIMIT 1").get(route.id);duplicate=gate(!row,['thread_delivery_already_reserved']);}catch(_){duplicate=gate(true);}
    const allowed=[authorization,approval,thread,suppression,readiness,duplicate].every(value=>value.ok);
    return {...route,allowed,authorization,approval,thread,suppression,readiness,duplicate};
  }};
}

module.exports={createMatrixThreadPreview};

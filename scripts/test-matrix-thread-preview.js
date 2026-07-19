'use strict';
const assert=require('node:assert');
const Database=require('better-sqlite3');
const { createMatrixThreadPreview }=require('../src/services/matrixThreadPreview');

const db=new Database(':memory:');
db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,active INTEGER,is_invalid INTEGER,stage TEXT); CREATE TABLE crm_messages(id INTEGER PRIMARY KEY,direction TEXT,sender_contact TEXT); CREATE TABLE email_messages(id INTEGER PRIMARY KEY,message_id TEXT,from_email TEXT); CREATE TABLE matrix_thread_jobs(id INTEGER PRIMARY KEY,route_id INTEGER,state TEXT);`);
db.prepare("INSERT INTO customers VALUES (10,1,0,'active')").run();
db.prepare("INSERT INTO crm_messages VALUES (263,'inbound','buyer@example.sg')").run();
db.prepare("INSERT INTO email_messages VALUES (64,'<inbound@example.sg>','buyer@example.sg')").run();
let senderOk=true;
const service=createMatrixThreadPreview({db,readinessService:{checkSender:async()=>senderOk?{ok:true,hardFailures:[]}:{ok:false,hardFailures:['missing_dmarc']}}});
const route={id:1,status:'approved',customer_id:10,source_crm_message_id:263,source_email_message_id:64,recipient_email:'buyer@example.sg',content_hash:'a'.repeat(64),approved_by:1,approved_at:'2026-07-19T15:00:00.000Z'};
(async()=>{
 const ready=await service.project(route); assert.strictEqual(ready.allowed,true); assert.strictEqual(Object.hasOwn(ready,'policy'),false);
 senderOk=false; const blocked=await service.project(route); assert.deepStrictEqual(blocked.readiness,{ok:false,reasons:['missing_dmarc']}); assert.strictEqual(blocked.allowed,false);
 db.prepare("UPDATE customers SET stage='suppressed' WHERE id=10").run(); senderOk=true; const suppressed=await service.project(route); assert.strictEqual(suppressed.suppression.ok,false);
 console.log('matrix thread preview tests passed'); db.close();
})().catch(e=>{console.error(e);process.exitCode=1});

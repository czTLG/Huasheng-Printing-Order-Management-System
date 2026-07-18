#!/usr/bin/env node
'use strict';
const enabled=()=>process.env.MATRIX_SUPERVISOR_ENABLED==='1';
async function tick({now=new Date()}={}){if(!enabled())return{enabled:false,digests:[]};const client=require('./matrix-client');const openId=String(process.env.MATRIX_OWNER_OPEN_ID||''),chatId=String(process.env.MATRIX_BILL_CHAT_ID||'');if(!openId||!chatId)throw new Error('supervisor owner/chat configuration required');const stamp=now.toISOString();const result=await client.prepareCoreDigests(openId,chatId,{now:stamp,idempotencyKey:`supervisor-digest:${stamp.slice(0,16)}`});return{enabled:true,digests:result.digests||[]}}
async function run(){if(!enabled())return;await tick();setInterval(()=>tick().catch(e=>process.stderr.write(`[matrix-supervisor] ${e.message}\n`)),60000).unref();await new Promise(()=>{});}
if(require.main===module)run().catch(e=>{process.stderr.write(`[matrix-supervisor] fatal: ${e.message}\n`);process.exitCode=1});
module.exports={tick,enabled};

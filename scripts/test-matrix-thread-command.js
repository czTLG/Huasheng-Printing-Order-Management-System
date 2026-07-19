'use strict';
process.env.MATRIX_DELIVERY_ENABLED='0';
const assert=require('node:assert');const extension=require('../.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs');
const calls=[],cards=[],handlers=new Map();
const helper={card:(elements,opts={})=>({elements,opts}),md:content=>({tag:'md',content}),note:content=>({tag:'note',content}),hr:()=>({tag:'hr'}),actions:actions=>({tag:'actions',actions}),button:(label,value,type)=>({label,value,type}),linkButton:()=>({})};
const registered=extension.register({
  channel:{}, dispatcher:{on:(a,h)=>handlers.set(a,h)},
  sendManagedCard:async(_c,_chat,card)=>cards.push(card), card:helper,
  assetContext:{resolve:()=>({recordId:10}),bind:()=>{}},
  scheduleReminderPoll:()=>1, clearReminderPoll:()=>{},
  client:{prepareThreadRoute:async(openId,input)=>{
    calls.push([openId,input]);
    return{id:4,route:'existing_relationship',revision:1,status:'draft',customer_id:10,inquiry_id:20,recipient_email:'buyer@example.sg',subject:'Clarification',body_en:'English',body_cn:'中文',attachment_manifest:[],content_hash:'a'.repeat(64)};
  }}
});
(async()=>{const handled=await registered.onMessage({msg:{content:'发送邮件',chatId:'chat',threadId:'thread',senderId:'ou-owner',messageId:'msg'}});assert.strictEqual(handled,true);assert.strictEqual(calls.length,1);assert.ok(JSON.stringify(cards[0]).includes('buyer@example.sg'));registered.dispose();console.log('matrix thread command tests passed')})().catch(e=>{console.error(e);process.exitCode=1});

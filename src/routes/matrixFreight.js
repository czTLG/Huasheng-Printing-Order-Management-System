'use strict';
const express=require('express');
function allow(v,fields){if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('body must be object');const bad=Object.keys(v).find(k=>!fields.has(k));if(bad)throw new Error(`unknown body field: ${bad}`);return v}
function createMatrixFreightRouter({freight}={}){const r=express.Router();const fail=(res,e)=>res.status(/conflict|mismatch|expired/.test(String(e.message))?409:400).json({error:{code:'invalid_request',message:e.message}});
 r.post('/bases/match',(req,res)=>{try{const b=allow(req.body,new Set(['inquiryId','itemIds','destination','tradeTerm','weightVolumeBasis','asOf']));res.json({basis:freight.matchBasis(b)})}catch(e){fail(res,e)}});
 r.post('/bases/:id/reviews',(req,res)=>{try{const b=allow(req.body,new Set(['inquiryId','itemIds','idempotencyKey']));res.status(201).json({review:freight.prepareReview({basisId:Number(req.params.id),...b,actorUserId:req.user.id})})}catch(e){fail(res,e)}});
 r.post('/reviews/:id/confirm',(req,res)=>{try{const b=allow(req.body,new Set(['sourceQuoteId','validityAt','idempotencyKey']));res.json({review:freight.confirmCurrent({reviewId:Number(req.params.id),...b,actorUserId:req.user.id})})}catch(e){fail(res,e)}});
 return r}
module.exports={createMatrixFreightRouter};

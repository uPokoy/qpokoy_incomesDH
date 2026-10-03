'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {createYooKassaClient,YooKassaError}=require('../yookassa');
function client(fetchImpl,extra={}){return createYooKassaClient({shopId:'1',secretKey:randomBytes(24).toString('hex'),fetchImpl,...extra});}
test('recurring API request uses saved method without redirect or save request',async()=>{
  let call;const c=client(async(url,options)=>{call={url,options};return new Response('{}',{status:200});});const method=randomUUID();
  await c.createPayment({amountRub:1190,returnUrl:'https://qpokoy.ru/',paymentMethodId:method,idempotenceKey:randomUUID()});
  const body=JSON.parse(call.options.body);assert.equal(body.payment_method_id,method);assert.equal(body.capture,true);assert.equal(body.confirmation,undefined);assert.equal(body.save_payment_method,undefined);assert.equal(call.options.redirect,'error');
});
test('adapter times out both before headers and during response body, with sanitized errors',async()=>{
  for(const bodyPhase of [false,true]){
    const c=client(async(url,{signal})=>{const pending=()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('sensitive upstream detail'),{name:'AbortError'})),{once:true}));if(!bodyPhase)return pending();return {ok:true,text:pending};},{timeoutMs:5});
    await assert.rejects(c.getPayment(randomUUID()),e=>e instanceof YooKassaError&&e.status===504&&!e.message.includes('sensitive'));
  }
});
test('missing environment never contacts provider; network/malformed/unknown provider errors are safe',async()=>{
  let called=false;const missing=createYooKassaClient({fetchImpl:()=>{called=true;}});await assert.rejects(missing.getPayment(randomUUID()),e=>e.status===503);assert.equal(called,false);
  for(const fetchImpl of [async()=>{throw Error('credential detail');},async()=>new Response('<html>',{status:502}),async()=>new Response(JSON.stringify({code:'credential_detail'}),{status:500})]){
    const c=client(fetchImpl);await assert.rejects(c.getPayment(randomUUID()),e=>e.status===502&&!JSON.stringify({message:e.message,code:e.code}).includes('credential'));
  }
});

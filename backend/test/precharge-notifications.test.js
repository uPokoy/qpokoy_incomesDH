'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createPrechargeNotificationWorker,
  sendPrechargeNotificationEmail,
  hasValidPrechargeNoticeForUser,
  prechargeNoticeKey,
  PRECHARGE_LEAD_MS
}=require('../precharge-notifications');
const {createRenewalWorker}=require('../renewals');
const {BILLING_ACCESS_SETTING:ACCESS,BILLING_PAYMENT_METHOD_SETTING:METHOD}=require('../billing-payments');
const {POSTBOX_SEND_URL,METADATA_TOKEN_URL}=require('../mail');

const CONSENT='billing.auto_renew_consent';
const UID='00000001-1111-4111-8111-111111111111';

function response(status,body,asJson=false){return{ok:status>=200&&status<300,status,
  json:async()=>asJson?body:JSON.parse(body||'{}'),text:async()=>asJson?JSON.stringify(body):String(body||'')}};

function fixture(){
  let clock=new Date('2026-10-05T12:00:00Z');
  const values=new Map();
  const user={user_id:UID,email:'user@example.com',status:'active',created_at:'2026-09-01T00:00:00Z'};
  values.set(ACCESS,{plan:'monthly',auto_renew:true,paid_until:'2026-10-09T12:00:00.000Z',last_payment_id:'payment-1234567890'});
  values.set(METHOD,{saved:true,payment_method_id:'method-1234567890',source_payment_id:'payment-1234567890'});
  values.set(CONSENT,{enabled:true,plan:'monthly',version:'consent-v1'});
  const store={
    listPaymentRenewalUsers:async(after='')=>UID>after?[{user_id:UID}]:[],
    getUser:async id=>id===UID?user:null,
    getSetting:async(id,key)=>id===UID&&values.has(key)?{setting_value:JSON.stringify(values.get(key))}:null,
    async withPaymentTransaction(id,fn){
      if(id!==UID||user.status!=='active')return null;
      return fn({get:async key=>values.get(key)||null,put:async(key,value)=>values.set(key,structuredClone(value))});
    }
  };
  return{store,user,values,now:()=>new Date(clock),setTime:v=>{clock=new Date(v);}};
}

test('precharge email includes approved layout, preview, amount, date and opt-out instructions',async()=>{
  const calls=[];
  const fakeFetch=async(url,init={})=>{
    calls.push({url,init});
    if(url===METADATA_TOKEN_URL)return response(200,{access_token:'iam-token'},true);
    if(url===POSTBOX_SEND_URL)return response(200,'{"MessageId":"precharge-1"}');
    throw new Error('unexpected URL');
  };
  const result=await sendPrechargeNotificationEmail({to:'user@example.com',plan:'monthly',amountRub:149,
    chargeAt:'2026-10-09T12:00:00Z',settingsUrl:'https://qpokoy.ru/',fetchImpl:fakeFetch});
  assert.equal(result.MessageId,'precharge-1');
  const body=JSON.parse(calls[1].init.body);
  assert.equal(body.Content.Simple.Subject.Data,'Предстоящее автопродление');
  assert.match(body.Content.Simple.Body.Text.Data,/149 ₽/);
  assert.match(body.Content.Simple.Body.Text.Data,/9 октября 2026/);
  assert.match(body.Content.Simple.Body.Text.Data,/Отключить автопродление/);
  assert.match(body.Content.Simple.Body.Text.Data,/Отвязать карту/);
  assert.match(body.Content.Simple.Body.Html.Data,/149 ₽ · списание 9 октября 2026/);
  assert.match(body.Content.Simple.Body.Html.Data,/Доступ на месяц/);
  assert.match(body.Content.Simple.Body.Html.Data,/font-size:36px/);
  assert.match(body.Content.Simple.Body.Html.Data,/Хотите оставить автопродление\?/);
  assert.match(body.Content.Simple.Body.Html.Data,/Управление доступом/);
  assert.match(body.Content.Simple.Body.Html.Data,/Отключение автопродления или отвязка карты не меняют уже оплаченный период/);
});

test('notification worker is disabled by default and cannot be public HTTP',async()=>{
  const h=fixture();
  assert.deepEqual(await createPrechargeNotificationWorker(h.store,{now:h.now})(),{disabled:true});
  const run=createPrechargeNotificationWorker(h.store,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:h.now,sendEmail:async()=>({})});
  await assert.rejects(run({httpMethod:'POST'}),/not be public/);
});

test('notification worker sends once per billing cycle and deduplicates later scans',async()=>{
  const h=fixture(),sent=[];
  const run=createPrechargeNotificationWorker(h.store,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:h.now,
    sendEmail:async args=>{sent.push(args);return{MessageId:'m1'};}});
  const first=await run();
  assert.equal(first.checked,1);assert.equal(first.sent,1);assert.equal(first.failed,0);assert.equal(sent.length,1);
  assert.equal(sent[0].amountRub,149);assert.equal(sent[0].plan,'monthly');
  const second=await run();assert.equal(second.checked,1);assert.equal(second.sent,0);assert.equal(sent.length,1);
  const notice=h.values.get(prechargeNoticeKey('2026-10-09T12:00:00.000Z'));
  assert.equal(notice.status,'sent');assert.equal(notice.message_id,'m1');
});

test('failed precharge send is retryable while still inside the legal notice window',async()=>{
  const h=fixture();let attempts=0;
  const run=createPrechargeNotificationWorker(h.store,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:h.now,
    sendEmail:async()=>{attempts++;if(attempts===1)throw new Error('mail down');return{MessageId:'m2'};}});
  const first=await run();assert.equal(first.failed,1);assert.equal(first.sent,0);
  const failed=h.values.get(prechargeNoticeKey('2026-10-09T12:00:00.000Z'));assert.equal(failed.status,'failed');
  const second=await run();assert.equal(second.sent,1);assert.equal(attempts,2);
});

test('valid notice must be sent at least three days before the billing deadline',async()=>{
  const h=fixture(),key=prechargeNoticeKey('2026-10-09T12:00:00.000Z');
  h.values.set(key,{status:'sent',plan:'monthly',paid_until:'2026-10-09T12:00:00.000Z',amount_rub:149,sent_at:'2026-10-05T12:00:00.000Z'});
  assert.equal(await hasValidPrechargeNoticeForUser(h.store,UID),true);
  h.values.set(key,{...h.values.get(key),sent_at:new Date(Date.parse('2026-10-09T12:00:00.000Z')-PRECHARGE_LEAD_MS+1).toISOString()});
  assert.equal(await hasValidPrechargeNoticeForUser(h.store,UID),false);
});

test('production-style renewal worker skips charging unless a valid precharge notice exists',async()=>{
  const h=fixture();let charges=0;
  const router={renewUser:async()=>{charges++;return{status:'succeeded'};}};
  const run=createRenewalWorker(h.store,router,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:h.now,requirePrechargeNotice:true});
  const first=await run();assert.equal(first.processed,0);assert.equal(charges,0);
  h.values.set(prechargeNoticeKey('2026-10-09T12:00:00.000Z'),{
    status:'sent',plan:'monthly',paid_until:'2026-10-09T12:00:00.000Z',amount_rub:149,sent_at:'2026-10-05T12:00:00.000Z'
  });
  const second=await run();assert.equal(second.processed,1);assert.equal(charges,1);
});

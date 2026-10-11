'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {newSession}=require('../security');
const {createPaymentRouter,CONSENT_KEY}=require('../payment-router');
const {BILLING_ACCESS_SETTING:ACCESS,BILLING_PAYMENT_METHOD_SETTING:METHOD}=require('../billing-payments');

function fixture(){
  let clock=new Date('2026-10-03T12:00:00Z'),tail=Promise.resolve();
  const id=randomUUID(),session=newSession(),values=new Map(),payments=new Map(),requests=[];
  const user={user_id:id,status:'active',created_at:'2026-10-02T00:00:00Z'};
  const key=k=>id+':'+k;
  const store={
    getSession:async sessionId=>sessionId===session.sessionId?{user_id:id,secret_hash:session.secretHash,expires_at:'2035-01-01'}:null,
    getUser:async userId=>userId===id?user:null,
    getSetting:async(userId,k)=>userId===id&&values.has(key(k))?{setting_value:JSON.stringify(values.get(key(k)))}:null,
    consumeRateLimit:async()=>({allowed:true}),
    async withPaymentTransaction(userId,fn){
      const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
      try{
        if(userId!==id)return null;
        const copy=new Map([...values].map(([k,v])=>[k,structuredClone(v)]));
        const result=await fn({
          get:async k=>structuredClone(copy.get(key(k)))||null,
          put:async(k,v)=>copy.set(key(k),structuredClone(v))
        });
        values.clear();for(const [k,v] of copy)values.set(k,v);
        return result;
      }finally{release();}
    }
  };
  const client={
    isConfigured:()=>true,
    async createPayment(args){
      requests.push(structuredClone(args));
      let payment=[...payments.values()].find(item=>item.metadata.order_id===args.metadata.order_id);
      if(!payment){
        payment={
          id:randomUUID(),
          status:args.paymentMethodId?'succeeded':'pending',
          paid:!!args.paymentMethodId,
          amount:{value:args.amountRub.toFixed(2),currency:'RUB'},
          metadata:structuredClone(args.metadata),
          created_at:clock.toISOString(),
          captured_at:clock.toISOString(),
          payment_method:{id:args.paymentMethodId||randomUUID(),saved:args.savePaymentMethod||!!args.paymentMethodId},
          confirmation:args.paymentMethodId?undefined:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout/test'}
        };
        payments.set(payment.id,payment);
      }
      return structuredClone(payment);
    },
    async getPayment(paymentId){return structuredClone(payments.get(paymentId));}
  };
  const router=createPaymentRouter(store,{client,now:()=>new Date(clock)});
  const headers={Authorization:'Bearer '+session.token};
  const post=body=>router.handle('POST','/billing/payments',body,headers,{sourceIp:'127.0.0.1'});
  const success=async paymentId=>{
    const payment=payments.get(paymentId);
    payment.status='succeeded';payment.paid=true;payment.payment_method.saved=true;payment.captured_at=clock.toISOString();
    return router.handle('POST','/billing/yookassa/webhook',{type:'notification',event:'payment.succeeded',object:{id:paymentId}}, {},{sourceIp:'127.0.0.1'});
  };
  return{
    router,user,post,success,requests,
    get:k=>values.get(key(k)),
    set:(k,v)=>values.set(key(k),structuredClone(v)),
    setTime:value=>{clock=new Date(value);}
  };
}

test('monthly to yearly keeps paid time and renews as yearly',async()=>{
  const h=fixture();
  const monthly=await h.post({plan:'monthly',auto_renew:true});
  assert.equal(monthly.status,201);await h.success(monthly.body.data.payment_id);
  assert.equal(h.get(ACCESS).paid_until,'2026-11-03T12:00:00.000Z');

  h.setTime('2026-10-10T12:00:00Z');
  const yearly=await h.post({plan:'yearly',auto_renew:true});
  assert.equal(yearly.status,201);await h.success(yearly.body.data.payment_id);
  const switched=h.get(ACCESS);
  assert.equal(switched.plan,'yearly');
  assert.equal(switched.paid_until,'2027-11-03T12:00:00.000Z');
  assert.equal(switched.auto_renew,true);
  assert.equal(h.get(CONSENT_KEY).plan,'yearly');
  assert.equal(h.get(CONSENT_KEY).enabled,true);
  assert.equal(h.get(METHOD).source_payment_id,yearly.body.data.payment_id);

  h.setTime(switched.paid_until);
  const before=h.requests.length;
  const renewal=await h.router.renewUser(h.user.user_id);
  assert.equal(renewal.status,'succeeded');
  assert.equal(h.requests.length,before+1);
  assert.equal(h.requests.at(-1).amountRub,1190);
  assert.equal(h.requests.at(-1).metadata.plan,'yearly');
  assert.equal(h.get(ACCESS).plan,'yearly');
  assert.equal(h.get(ACCESS).paid_until,'2028-11-03T12:00:00.000Z');
});

test('yearly to monthly keeps paid time and renews as monthly',async()=>{
  const h=fixture();
  const yearly=await h.post({plan:'yearly',auto_renew:true});
  assert.equal(yearly.status,201);await h.success(yearly.body.data.payment_id);
  assert.equal(h.get(ACCESS).paid_until,'2027-10-03T12:00:00.000Z');

  h.setTime('2026-10-10T12:00:00Z');
  const monthly=await h.post({plan:'monthly',auto_renew:true});
  assert.equal(monthly.status,201);await h.success(monthly.body.data.payment_id);
  const switched=h.get(ACCESS);
  assert.equal(switched.plan,'monthly');
  assert.equal(switched.paid_until,'2027-11-03T12:00:00.000Z');
  assert.equal(switched.auto_renew,true);
  assert.equal(h.get(CONSENT_KEY).plan,'monthly');
  assert.equal(h.get(CONSENT_KEY).enabled,true);
  assert.equal(h.get(METHOD).source_payment_id,monthly.body.data.payment_id);

  h.setTime(switched.paid_until);
  const before=h.requests.length;
  const renewal=await h.router.renewUser(h.user.user_id);
  assert.equal(renewal.status,'succeeded');
  assert.equal(h.requests.length,before+1);
  assert.equal(h.requests.at(-1).amountRub,149);
  assert.equal(h.requests.at(-1).metadata.plan,'monthly');
  assert.equal(h.get(ACCESS).plan,'monthly');
  assert.equal(h.get(ACCESS).paid_until,'2027-12-03T12:00:00.000Z');
});

test('repurchase after expiry starts a fresh term and clears old grace',async()=>{
  for(const [plan,previousPlan,expectedUntil,amountRub] of [
    ['monthly','yearly','2026-11-03T12:00:00.000Z',149],
    ['yearly','monthly','2027-10-03T12:00:00.000Z',1190]
  ]){
    const h=fixture();
    h.set(ACCESS,{
      plan:previousPlan,
      paid_until:'2026-09-03T12:00:00.000Z',
      grace_until:'2026-09-06T12:00:00.000Z',
      auto_renew:false,
      last_payment_id:randomUUID(),
      last_paid_at:'2026-08-03T12:00:00.000Z'
    });

    const created=await h.post({plan,auto_renew:true});
    assert.equal(created.status,201);
    assert.equal(h.requests.at(-1).amountRub,amountRub);
    await h.success(created.body.data.payment_id);

    const access=h.get(ACCESS);
    assert.equal(access.plan,plan);
    assert.equal(access.paid_until,expectedUntil);
    assert.equal(access.grace_until,null);
    assert.equal(access.auto_renew,true);
    assert.equal(access.last_payment_id,created.body.data.payment_id);
    assert.equal(h.get(CONSENT_KEY).plan,plan);
    assert.equal(h.get(CONSENT_KEY).enabled,true);
    assert.equal(h.get(METHOD).source_payment_id,created.body.data.payment_id);
  }
});

test('manual payment during renewal grace restores normal paid access',async()=>{
  const h=fixture();
  const oldPaymentId=randomUUID(),oldMethodId=randomUUID(),oldConsentVersion=randomUUID();
  h.set(ACCESS,{
    plan:'monthly',
    paid_until:'2026-10-03T12:00:00.000Z',
    grace_until:'2026-10-06T12:00:00.000Z',
    auto_renew:false,
    last_payment_id:oldPaymentId,
    last_paid_at:'2026-09-03T12:00:00.000Z'
  });
  h.set(CONSENT_KEY,{enabled:true,plan:'monthly',version:oldConsentVersion,at:'2026-09-03T12:00:00.000Z'});
  h.set(METHOD,{payment_method_id:oldMethodId,saved:true,source_payment_id:oldPaymentId});
  h.setTime('2026-10-04T12:00:00Z');

  const created=await h.post({plan:'monthly',auto_renew:true});
  assert.equal(created.status,201);
  await h.success(created.body.data.payment_id);

  const access=h.get(ACCESS);
  assert.equal(access.plan,'monthly');
  assert.equal(access.paid_until,'2026-11-04T12:00:00.000Z');
  assert.equal(access.grace_until,null);
  assert.equal(access.auto_renew,true);
  assert.equal(access.last_payment_id,created.body.data.payment_id);
  assert.equal(access.last_paid_at,'2026-10-04T12:00:00.000Z');
  assert.equal(h.get(CONSENT_KEY).plan,'monthly');
  assert.equal(h.get(CONSENT_KEY).enabled,true);
  assert.notEqual(h.get(CONSENT_KEY).version,oldConsentVersion);
  assert.equal(h.get(METHOD).source_payment_id,created.body.data.payment_id);
  assert.notEqual(h.get(METHOD).payment_method_id,oldMethodId);
});

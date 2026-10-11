'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {newSession}=require('../security');
const {createPaymentRouter,CONSENT_KEY}=require('../payment-router');
const {createApp}=require('../app');
const {createYooKassaClient}=require('../yookassa');
const {BILLING_ACCESS_SETTING:ACCESS}=require('../billing-payments');

function fixture(){
  let clock=new Date('2026-10-03T12:00:00Z'),tail=Promise.resolve();
  const id=randomUUID(),session=newSession(),values=new Map(),payments=new Map(),refunds=new Map(),requests=[];
  const user={user_id:id,email:'refund@example.com',status:'active',created_at:'2026-10-02T00:00:00Z',trial_ends_at:'2026-10-16T00:00:00Z'};
  const key=k=>id+':'+k;
  const store={
    getSession:async sid=>sid===session.sessionId?{user_id:id,secret_hash:session.secretHash,expires_at:'2035-01-01'}:null,
    getUser:async uid=>uid===id?user:null,
    getSetting:async(uid,k)=>uid===id&&values.has(key(k))?{setting_value:JSON.stringify(values.get(key(k)))}:null,
    consumeRateLimit:async()=>({allowed:true}),
    async withPaymentTransaction(uid,fn){
      const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
      try{
        if(uid!==id)return null;
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
          id:randomUUID(),status:args.paymentMethodId?'succeeded':'pending',paid:!!args.paymentMethodId,
          amount:{value:args.amountRub.toFixed(2),currency:'RUB'},
          refunded_amount:{value:'0.00',currency:'RUB'},
          metadata:structuredClone(args.metadata),created_at:clock.toISOString(),captured_at:clock.toISOString(),
          payment_method:{id:args.paymentMethodId||randomUUID(),saved:args.savePaymentMethod||!!args.paymentMethodId},
          confirmation:args.paymentMethodId?undefined:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout/test'}
        };
        payments.set(payment.id,payment);
      }
      return structuredClone(payment);
    },
    async getPayment(paymentId){return structuredClone(payments.get(paymentId));},
    async getRefund(refundId){return structuredClone(refunds.get(refundId));}
  };
  const router=createPaymentRouter(store,{client,now:()=>new Date(clock)});
  const headers={Authorization:'Bearer '+session.token};
  const post=body=>router.handle('POST','/billing/payments',body,headers,{sourceIp:'127.0.0.1'});
  const success=async paymentId=>{
    const payment=payments.get(paymentId);
    payment.status='succeeded';payment.paid=true;payment.payment_method.saved=true;payment.captured_at=clock.toISOString();
    return router.handle('POST','/billing/yookassa/webhook',{type:'notification',event:'payment.succeeded',object:{id:paymentId}}, {},{sourceIp:'127.0.0.1'});
  };
  const notifyRefund=refundId=>router.handle('POST','/billing/yookassa/webhook',
    {type:'notification',event:'refund.succeeded',object:{id:refundId}}, {},{sourceIp:'127.0.0.1'});
  const refund=async(paymentId,amountRub,totalRub=amountRub)=>{
    const refundId=randomUUID(),payment=payments.get(paymentId);
    payment.refunded_amount={value:Number(totalRub).toFixed(2),currency:'RUB'};
    refunds.set(refundId,{id:refundId,status:'succeeded',
      amount:{value:Number(amountRub).toFixed(2),currency:'RUB'},
      payment_id:paymentId,created_at:clock.toISOString()});
    return {refundId,response:await notifyRefund(refundId)};
  };
  return{
    router,user,store,post,success,refund,notifyRefund,requests,payments,refunds,headers,
    get:k=>values.get(key(k)),setTime:v=>{clock=new Date(v);}
  };
}

test('full refund of current monthly, yearly or lifetime access revokes it once',async()=>{
  for(const [plan,amount] of [['monthly',149],['yearly',1190],['lifetime',1790]]){
    const h=fixture(),created=await h.post({plan,auto_renew:true});
    assert.equal(created.status,201);await h.success(created.body.data.payment_id);
    assert.equal(h.get(ACCESS).plan,plan);
    const {refundId,response}=await h.refund(created.body.data.payment_id,amount);
    assert.equal(response.status,200);
    const access=h.get(ACCESS);
    assert.equal(access.plan,null);
    assert.equal(access.paid_until,null);
    assert.equal(access.grace_until,null);
    assert.equal(access.auto_renew,false);
    assert.equal(access.refunded_plan,plan);
    assert.equal(access.refunded_payment_id,created.body.data.payment_id);
    assert.equal(h.get(CONSENT_KEY).enabled,false);
    assert.equal(h.get(CONSENT_KEY).plan,null);
    const count=h.requests.length;
    assert.equal((await h.router.renewUser(h.user.user_id)).skipped,true);
    assert.equal(h.requests.length,count);
    const snapshot=structuredClone(access);
    assert.equal((await h.notifyRefund(refundId)).status,200);
    assert.deepEqual(h.get(ACCESS),snapshot);
  }
});

test('partial refund keeps access until cumulative refunds become full',async()=>{
  const h=fixture(),created=await h.post({plan:'monthly',auto_renew:true});
  await h.success(created.body.data.payment_id);
  const before=structuredClone(h.get(ACCESS));
  assert.equal((await h.refund(created.body.data.payment_id,50,50)).response.status,200);
  assert.deepEqual(h.get(ACCESS),before);
  assert.equal((await h.refund(created.body.data.payment_id,99,149)).response.status,200);
  assert.equal(h.get(ACCESS).plan,null);
  assert.ok(h.get(ACCESS).refunded_at);
});

test('refund of an older payment never revokes a newer subscription',async()=>{
  const h=fixture(),first=await h.post({plan:'monthly',auto_renew:true});
  await h.success(first.body.data.payment_id);
  h.setTime('2026-10-10T12:00:00Z');
  const second=await h.post({plan:'yearly',auto_renew:true});
  await h.success(second.body.data.payment_id);
  const current=structuredClone(h.get(ACCESS)),consent=structuredClone(h.get(CONSENT_KEY));
  assert.equal((await h.refund(first.body.data.payment_id,149)).response.status,200);
  assert.deepEqual(h.get(ACCESS),current);
  assert.deepEqual(h.get(CONSENT_KEY),consent);
});

test('refunded payment stays expired even if the original trial still has time',async()=>{
  const id=randomUUID(),session=newSession(),refundedAt='2026-10-03T12:00:00.000Z';
  const user={user_id:id,email:'refund@example.com',status:'active',created_at:'2026-10-02T00:00:00Z',trial_ends_at:'2026-10-16T00:00:00Z'};
  const saved={plan:null,paid_until:null,grace_until:null,auto_renew:false,refunded_at:refundedAt};
  const store={
    getSession:async sid=>sid===session.sessionId?{user_id:id,secret_hash:session.secretHash,expires_at:'2035-01-01'}:null,
    getUser:async uid=>uid===id?user:null,
    getSetting:async(uid,key)=>uid===id&&key==='billing.access'?{setting_value:JSON.stringify(saved)}:null
  };
  const app=createApp(store,{now:()=>new Date('2026-10-04T12:00:00Z')});
  const result=await app.handle('GET','/billing/status',{}, {Authorization:'Bearer '+session.token});
  assert.equal(result.status,200);
  assert.equal(result.body.data.status,'expired');
  assert.equal(result.body.data.mode,'expired');
  assert.equal(result.body.data.can_write,false);
  assert.equal(result.body.data.plan,null);
  assert.equal(result.body.data.refunded_at,refundedAt);
});

test('YooKassa client verifies refund objects through the refunds endpoint',async()=>{
  const refundId=randomUUID(),calls=[];
  const client=createYooKassaClient({
    shopId:'123',secretKey:'12345678',
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method});
      return {ok:true,text:async()=>JSON.stringify({id:refundId,status:'succeeded'})};
    }
  });
  const refund=await client.getRefund(refundId);
  assert.equal(refund.id,refundId);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.yookassa.ru/v3/refunds/'+refundId);
  assert.equal(calls[0].method,'GET');
  await assert.rejects(()=>client.getRefund('../bad'),TypeError);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createRefundReconciler,DEFAULT_INTERVAL_MS}=require('../refund-reconciliation');
const {BILLING_ACCESS_SETTING:ACCESS,paymentSettingKey}=require('../billing-payments');
const CONSENT='billing.auto_renew_consent',ORDER='billing.order.';

function fixture(plan='monthly'){
  let clock=new Date('2026-10-03T12:00:00Z'),calls=0,tail=Promise.resolve();
  const userId=randomUUID(),paymentId=randomUUID(),orderId='a'.repeat(64);
  const amount={monthly:149,yearly:1190,lifetime:1790}[plan],values=new Map();
  values.set(ACCESS,{plan,paid_until:plan==='lifetime'?null:'2027-10-03T12:00:00.000Z',grace_until:null,
    auto_renew:plan!=='lifetime',last_payment_id:paymentId,last_paid_at:clock.toISOString()});
  values.set(paymentSettingKey(paymentId),{payment_id:paymentId,status:'succeeded',plan,amount_rub:amount});
  values.set(ORDER+orderId,{order_id:orderId,user_id:userId,plan,payment_id:paymentId,status:'succeeded',settled:true});
  values.set(CONSENT,{enabled:plan!=='lifetime',plan:plan==='lifetime'?null:plan,version:randomUUID(),at:clock.toISOString()});
  const payment={id:paymentId,status:'succeeded',paid:true,amount:{value:amount.toFixed(2),currency:'RUB'},
    refunded_amount:{value:'0.00',currency:'RUB'},captured_at:clock.toISOString(),
    metadata:{app:'qpokoy-v1',user_id:userId,plan,order_id:orderId}};
  const store={
    async withPaymentTransaction(uid,fn){
      const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;
      try{
        if(uid!==userId)return null;
        const copy=new Map([...values].map(([k,v])=>[k,structuredClone(v)]));
        const result=await fn({get:async k=>structuredClone(copy.get(k))||null,
          put:async(k,v)=>copy.set(k,structuredClone(v))});
        values.clear();for(const [k,v] of copy)values.set(k,v);
        return result;
      }finally{release();}
    }
  };
  const client={isConfigured:()=>true,async getPayment(id){calls++;assert.equal(id,paymentId);return structuredClone(payment);}};
  return{userId,paymentId,orderId,amount,store,client,payment,values,
    now:()=>new Date(clock),setTime:value=>{clock=new Date(value);},calls:()=>calls};
}

test('missed full refund is recovered for monthly, yearly and lifetime access',async()=>{
  for(const plan of ['monthly','yearly','lifetime']){
    const h=fixture(plan);h.payment.refunded_amount={value:h.amount.toFixed(2),currency:'RUB'};
    const result=await createRefundReconciler(h.store,h.client,{now:h.now,intervalMs:0}).reconcileUser(h.userId);
    assert.equal(result.refunded,true);
    const access=h.values.get(ACCESS);
    assert.equal(access.plan,null);assert.equal(access.auto_renew,false);
    assert.equal(access.refunded_payment_id,h.paymentId);assert.equal(access.refunded_plan,plan);
    assert.equal(access.refund_reconciled,true);
    assert.equal(h.values.get(CONSENT).enabled,false);
    assert.equal(h.values.get(paymentSettingKey(h.paymentId)).fully_refunded,true);
  }
});

test('partial refund keeps access and periodic checks eventually catch a later full refund',async()=>{
  const h=fixture('monthly'),reconciler=createRefundReconciler(h.store,h.client,{now:h.now});
  h.payment.refunded_amount={value:'50.00',currency:'RUB'};
  assert.deepEqual(await reconciler.reconcileUser(h.userId),{checked:true,refunded:false});
  assert.equal(h.values.get(ACCESS).plan,'monthly');assert.equal(h.calls(),1);
  assert.deepEqual(await reconciler.reconcileUser(h.userId),{skipped:true});assert.equal(h.calls(),1);
  h.payment.refunded_amount={value:'149.00',currency:'RUB'};
  h.setTime(new Date(new Date('2026-10-03T12:00:00Z').getTime()+DEFAULT_INTERVAL_MS+1000));
  assert.equal((await reconciler.reconcileUser(h.userId)).refunded,true);
  assert.equal(h.values.get(ACCESS).plan,null);assert.equal(h.calls(),2);
});

test('a newer payment cannot be revoked by an older reconciliation already in flight',async()=>{
  const h=fixture('monthly'),newPaymentId=randomUUID();
  h.payment.refunded_amount={value:'149.00',currency:'RUB'};
  h.client.getPayment=async id=>{
    assert.equal(id,h.paymentId);
    h.values.set(ACCESS,{...h.values.get(ACCESS),plan:'yearly',last_payment_id:newPaymentId,last_paid_at:'2026-10-04T12:00:00.000Z'});
    return structuredClone(h.payment);
  };
  const result=await createRefundReconciler(h.store,h.client,{now:h.now,intervalMs:0}).reconcileUser(h.userId);
  assert.deepEqual(result,{skipped:true});
  assert.equal(h.values.get(ACCESS).plan,'yearly');
  assert.equal(h.values.get(ACCESS).last_payment_id,newPaymentId);
});

test('provider mismatch never changes access',async()=>{
  const h=fixture('yearly'),before=structuredClone(h.values.get(ACCESS));
  h.payment.refunded_amount={value:'1190.00',currency:'RUB'};
  h.payment.metadata.user_id=randomUUID();
  assert.deepEqual(await createRefundReconciler(h.store,h.client,{now:h.now,intervalMs:0}).reconcileUser(h.userId),{skipped:true});
  assert.deepEqual(h.values.get(ACCESS),before);
});

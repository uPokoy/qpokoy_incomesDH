'use strict';
const {randomUUID}=require('node:crypto');
const {BILLING_ACCESS_SETTING,BILLING_PLANS,paymentSettingKey}=require('./billing-payments');
const ORDER_PREFIX='billing.order.';
const CONSENT_KEY='billing.auto_renew_consent';
const DEFAULT_INTERVAL_MS=6*60*60*1000;
const paymentIdValid=value=>/^[A-Za-z0-9-]{10,80}$/.test(String(value||''));
const orderIdValid=value=>/^[0-9a-f]{64}$/.test(String(value||''));
function rubAmount(value){
  if(value?.currency!=='RUB'||!/^\d+(?:\.\d{1,2})?$/.test(String(value?.value||'')))return NaN;
  const amount=Number(value.value);return Number.isFinite(amount)?amount:NaN;
}
function createRefundReconciler(store,client,options={}){
  const now=options.now||(()=>new Date());
  const rawInterval=Number(options.intervalMs);
  const intervalMs=Number.isFinite(rawInterval)&&rawInterval>=0?rawInterval:DEFAULT_INTERVAL_MS;
  async function duePayment(userId){
    return store.withPaymentTransaction(userId,async t=>{
      const access=await t.get(BILLING_ACCESS_SETTING);
      const paymentId=access?.last_payment_id;
      if(access?.refunded_at||!paymentIdValid(paymentId))return null;
      const record=await t.get(paymentSettingKey(paymentId));
      if(!record||record.status!=='succeeded'||record.fully_refunded===true)return null;
      const checkedAt=Date.parse(record.refund_checked_at||'');
      if(Number.isFinite(checkedAt)&&now().getTime()-checkedAt<intervalMs)return null;
      return {paymentId};
    });
  }
  async function reconcileUser(userId){
    if(!client?.isConfigured?.())return {skipped:true};
    const due=await duePayment(userId);if(!due)return {skipped:true};
    const payment=await client.getPayment(due.paymentId);
    if(payment?.id!==due.paymentId||payment.status!=='succeeded'||payment.paid!==true||
      payment.metadata?.app!=='qpokoy-v1'||payment.metadata?.user_id!==userId)return {skipped:true};
    return store.withPaymentTransaction(userId,async t=>{
      const access=await t.get(BILLING_ACCESS_SETTING);
      if(!access||access.refunded_at||access.last_payment_id!==payment.id)return {skipped:true};
      const key=paymentSettingKey(payment.id),record=await t.get(key);
      if(!record||record.status!=='succeeded'||record.plan!==payment.metadata?.plan)return {skipped:true};
      const plan=BILLING_PLANS[record.plan],originalAmount=rubAmount(payment.amount);
      if(!plan||originalAmount!==plan.price_rub)return {skipped:true};
      const orderId=payment.metadata?.order_id;
      if(orderId!==undefined){
        if(!orderIdValid(orderId))return {skipped:true};
        const order=await t.get(ORDER_PREFIX+orderId);
        if(!order||order.user_id!==userId||order.plan!==record.plan||order.payment_id!==payment.id||
          order.status!=='succeeded'||order.settled!==true)return {skipped:true};
      }
      const timestamp=now(),refundedAmount=rubAmount(payment.refunded_amount);
      const observed=Number.isFinite(refundedAmount)&&refundedAmount>0?refundedAmount:0;
      const checked={...record,refund_checked_at:timestamp.toISOString(),observed_refunded_amount_rub:observed};
      if(!Number.isFinite(refundedAmount)||refundedAmount<originalAmount){
        await t.put(key,checked,timestamp);return {checked:true,refunded:false};
      }
      await t.put(BILLING_ACCESS_SETTING,{plan:null,paid_until:null,grace_until:null,auto_renew:false,
        last_payment_id:payment.id,last_paid_at:access.last_paid_at||payment.captured_at||timestamp.toISOString(),
        refunded_at:timestamp.toISOString(),refunded_payment_id:payment.id,
        refunded_plan:access.plan||record.plan,refund_reconciled:true},timestamp);
      await t.put(CONSENT_KEY,{enabled:false,plan:null,version:randomUUID(),at:timestamp.toISOString()},timestamp);
      await t.put(key,{...checked,fully_refunded:true,refunded_at:timestamp.toISOString(),
        refunded_amount_rub:originalAmount,refund_reconciled:true,updated_at:timestamp.toISOString()},timestamp);
      return {checked:true,refunded:true};
    });
  }
  return {reconcileUser};
}
module.exports={createRefundReconciler,DEFAULT_INTERVAL_MS};

'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { parseToken, verifySecret } = require('./security');
const { YooKassaError } = require('./yookassa');
const { BILLING_ACCESS_SETTING, BILLING_PAYMENT_METHOD_SETTING, BILLING_PLANS,
  parseJsonSetting, buildPaidGrant, paymentSettingKey, verifiedGrant, GRACE_MS } = require('./billing-payments');
const ORDER_PREFIX = 'billing.order.';
const CONSENT_KEY = 'billing.auto_renew_consent';
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000; // Below YooKassa's 24-hour deduplication window.
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const paymentIdValid = value => /^[A-Za-z0-9-]{10,80}$/.test(String(value || ''));
const methodIdValid = value => /^[A-Za-z0-9-]{10,120}$/.test(String(value || ''));
const hash = value => createHash('sha256').update(value).digest('hex');
function safeConfirmation(value) {
  if (!value) return null;
  try { const u = new URL(value);return u.protocol === 'https:' && !u.username && !u.password &&
    ['yoomoney.ru','yookassa.ru'].some(host => u.hostname === host || u.hostname.endsWith('.'+host)) ? u.toString() : null; } catch (_) { return null; }
}
class PaymentHttpError extends Error {
  constructor(status, code, message, headers = {}) { super(message);this.status=status;this.code=code;this.headers=headers; }
}
function createPaymentRouter(store, options = {}) {
  const client=options.client,now=options.now||(()=>new Date());
  const returnUrl=options.returnUrl||(()=>{const u=new URL(options.appBaseUrl||'https://qpokoy.ru/');u.searchParams.set('payment','return');return u.toString();})();
  const rateLimits={createUser:{limit:10,windowMs:3600000},createIp:{limit:30,windowMs:3600000},
    statusUser:{limit:120,windowMs:60000},renewUser:{limit:20,windowMs:60000},renewIp:{limit:40,windowMs:60000},
    webhookIp:{limit:300,windowMs:60000},...(options.rateLimits||{})};
  const response=(status,body,headers={})=>({status,body,headers});
  const tx=(uid,operation)=>store.withPaymentTransaction(uid,operation);
  const publicPayment=record=>({payment_id:record.payment_id,status:record.status,plan:record.plan,
    amount_rub:record.amount_rub,confirmation_url:safeConfirmation(record.confirmation_url)});
  const configured=()=>{if(!client?.isConfigured?.())throw new PaymentHttpError(503,'payments_not_configured','Оплата пока не настроена.');};
  function sourceIp(headers,context){return String(context?.sourceIp||'unknown').slice(0,128);} // Do not trust client-forwarded IP headers.
  async function rateLimit(name,subject){const rule=rateLimits[name];if(!rule)return;
    if(!store.consumeRateLimit)throw new PaymentHttpError(503,'rate_limit_unavailable','Оплата временно недоступна.');
    const r=await store.consumeRateLimit(hash('payments:'+name+':'+subject),rule.limit,rule.windowMs,now());
    if(!r?.allowed)throw new PaymentHttpError(429,'rate_limited','Слишком много запросов. Попробуйте позже.',{'Retry-After':String(Math.max(1,Number(r?.retry_after_seconds)||60))});
  }
  async function authenticate(headers){const token=parseToken(headers.authorization||headers.Authorization);if(!token)throw new PaymentHttpError(401,'unauthorized','Authentication required');
    const session=await store.getSession(token.sessionId),expiry=Date.parse(session?.expires_at);
    if(!session||session.revoked_at||!Number.isFinite(expiry)||expiry<=now().getTime()||!verifySecret(token.secret,session.secret_hash))throw new PaymentHttpError(401,'unauthorized','Invalid session');
    const user=await store.getUser(session.user_id);if(!user||user.status!=='active')throw new PaymentHttpError(401,'unauthorized','Invalid session');return user;
  }
  function object(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw new PaymentHttpError(400,'bad_request','Некорректные параметры оплаты.');}
  function orderFor(userId,plan,autoRenew,requestId,extra={}){
    const id=hash('qpokoy:payment:'+userId+':'+requestId);
    return {order_id:id,user_id:userId,plan,amount_rub:BILLING_PLANS[plan].price_rub,
      auto_renew_requested:autoRenew,created_at:now().toISOString(),status:'creating',payment_id:null,
      return_url:returnUrl,description:plan==='monthly'?'qPokoy — подписка на месяц':plan==='yearly'?'qPokoy — подписка на год':'qPokoy — бессрочный доступ',
      metadata:{app:'qpokoy-v1',user_id:userId,plan,auto_renew:autoRenew?'1':'0',order_id:id},...extra};
  }
  function paymentMatches(payment,order){return paymentIdValid(payment?.id)&&payment.metadata?.app==='qpokoy-v1'&&
    payment.metadata?.user_id===order.user_id&&payment.metadata?.plan===order.plan&&
    (!order.order_id||payment.metadata?.order_id===order.order_id)&&
    payment.amount?.currency==='RUB'&&payment.amount?.value===Number(order.amount_rub).toFixed(2)&&
    ['pending','waiting_for_capture','succeeded','canceled'].includes(payment.status)&&
    (!order.payment_id||order.payment_id===payment.id);}
  // Only provider-verified snapshots enter here. Status + access + saved method
  // + durable order marker commit together. Duplicate/out-of-order events cannot
  // replay access or re-enable auto-renew after a user canceled consent.
  async function applyPayment(payment){
    const uid=payment.metadata?.user_id;if(!uuid(uid))return null;
    const orderId=payment.metadata?.order_id;
    if(orderId!==undefined&&!/^[0-9a-f]{64}$/.test(orderId))return null;
    return tx(uid,async t=>{
      let order=orderId?await t.get(ORDER_PREFIX+orderId):null;
      const previous=await t.get(paymentSettingKey(payment.id));
      if(!orderId){ // Reconcile only known DEV182 payments, never arbitrary provider metadata.
        if(!previous||!verifiedGrant(payment)||previous.plan!==payment.metadata.plan)return null;
        order={...previous,user_id:uid,amount_rub:BILLING_PLANS[previous.plan]?.price_rub};
      }
      if(!order||!paymentMatches(payment,order))return null;
      if(order.settled||(!orderId&&['succeeded','canceled'].includes(previous?.status)))return previous||order;
      if(payment.status==='succeeded'&&payment.paid!==true)return null;
      const confirmation=safeConfirmation(payment.confirmation?.confirmation_url);
      if(payment.status==='pending'&&!order.renewal&&!confirmation)throw new PaymentHttpError(502,'invalid_confirmation_url','Некорректная ссылка оплаты.');
      const timestamp=now();
      const record={payment_id:payment.id,status:payment.status,plan:order.plan,amount_rub:order.amount_rub,
        auto_renew_requested:order.auto_renew_requested,confirmation_url:confirmation,created_at:order.created_at,
        updated_at:timestamp.toISOString(),payment_method_saved:payment.payment_method?.saved===true};
      if(payment.status==='succeeded'){
        const current=await t.get(BILLING_ACCESS_SETTING),consent=await t.get(CONSENT_KEY);
        const savedId=payment.payment_method?.saved===true&&methodIdValid(payment.payment_method.id)?payment.payment_method.id:null;
        const sameConsent=order.consent_version?consent?.version===order.consent_version&&consent.enabled===true:!consent;
        const auto=order.auto_renew_requested&&order.plan!=='lifetime'&&!!savedId&&sameConsent;
        const captured=Date.parse(payment.captured_at);const paidAt=Number.isFinite(captured)?new Date(captured):timestamp;
        const alreadyApplied=current?.last_payment_id===payment.id;
        if(!alreadyApplied&&current?.plan!=='lifetime'){
          const grant=buildPaidGrant(order.plan,paidAt,current);
          const stale=current&&Date.parse(current.last_paid_at)>paidAt.getTime();
          await t.put(BILLING_ACCESS_SETTING,{...grant,plan:stale?current.plan:grant.plan,
            auto_renew:stale?current.auto_renew===true:auto,last_payment_id:stale?current.last_payment_id:payment.id,
            last_paid_at:stale?current.last_paid_at:paidAt.toISOString()},timestamp);
          if(auto&&!stale)await t.put(BILLING_PAYMENT_METHOD_SETTING,{payment_method_id:savedId,saved:true,
            saved_at:timestamp.toISOString(),source_payment_id:payment.id},timestamp);
        }
        record.succeeded_at=paidAt.toISOString();
      }else if(payment.status==='canceled'&&order.renewal){
        const current=await t.get(BILLING_ACCESS_SETTING);
        if(current?.last_payment_id===order.baseline_payment_id&&current.paid_until===order.baseline_paid_until){
          await t.put(BILLING_ACCESS_SETTING,{...current,auto_renew:false,
            grace_until:new Date(Date.parse(current.paid_until)+GRACE_MS).toISOString()},timestamp);
        }
      }
      await t.put(paymentSettingKey(payment.id),record,timestamp);
      if(orderId)await t.put(ORDER_PREFIX+orderId,{...order,payment_id:payment.id,status:payment.status,
        settled:['succeeded','canceled'].includes(payment.status),updated_at:timestamp.toISOString()},timestamp);
      return record;
    });
  }
  async function submitOrder(order){
    configured();
    if(!Number.isFinite(Date.parse(order.created_at)) || order.metadata?.order_id!==order.order_id || order.metadata?.user_id!==order.user_id)throw new PaymentHttpError(409,'payment_requires_review','Платёж требует проверки.');
    if(order.settled)return order;
    if(order.payment_id){const p=await client.getPayment(order.payment_id);return applyPayment(p);}
    if(order.renewal){
      // Re-check cancellation/new payment after reservation and before an HTTP
      // attempt. Once a charge is sent, disabling renewal cannot retract it.
      const allowed=await tx(order.user_id,async t=>{
        const access=await t.get(BILLING_ACCESS_SETTING),consent=await t.get(CONSENT_KEY),method=await t.get(BILLING_PAYMENT_METHOD_SETTING);
        return !(await t.get('billing.admin_override')) && access?.auto_renew===true &&
          access.paid_until===order.baseline_paid_until && access.last_payment_id===order.baseline_payment_id &&
          consent?.enabled===true && consent.version===order.consent_version && method?.saved===true &&
          method.payment_method_id===order.payment_method_id;
      });
      if(!allowed)return {...order,status:'not_submitted'};
    }
    // Never repeat an ambiguous POST once the provider deduplication window may
    // have expired, even with the same key. A verified webhook can still recover it.
    if(now().getTime()-Date.parse(order.created_at)>=RETRY_WINDOW_MS)throw new PaymentHttpError(409,'payment_requires_review','Платёж требует проверки. Не повторяйте оплату.');
    const payment=await client.createPayment({amountRub:order.amount_rub,returnUrl:order.return_url,
      description:order.description,savePaymentMethod:order.auto_renew_requested&&!order.renewal,
      paymentMethodId:order.renewal?order.payment_method_id:undefined,metadata:order.metadata,idempotenceKey:order.order_id});
    if(!paymentMatches(payment,order))throw new PaymentHttpError(502,'payment_provider_error','Некорректный ответ ЮKassa.');
    const result=await applyPayment(payment);if(!result)throw new PaymentHttpError(409,'payment_state_conflict','Платёж требует проверки.');return result;
  }
  async function createPayment(user,body,ip){
    object(body,['plan','auto_renew','request_id']);configured();
    if(!Object.hasOwn(BILLING_PLANS,body.plan))throw new PaymentHttpError(400,'invalid_plan','Неизвестный тариф.');
    if(body.auto_renew!==undefined&&typeof body.auto_renew!=='boolean')throw new PaymentHttpError(400,'bad_request','Некорректное автопродление.');
    const requestId=body.request_id===undefined?randomUUID():String(body.request_id).toLowerCase();
    if(!uuid(requestId))throw new PaymentHttpError(400,'invalid_request_id','Некорректный идентификатор запроса.');
    await rateLimit('createUser',user.user_id);await rateLimit('createIp',ip);
    const auto=body.plan!=='lifetime'&&body.auto_renew===true;
    const candidate=orderFor(user.user_id,body.plan,auto,requestId);
    const order=await tx(user.user_id,async t=>{
      const old=await t.get(ORDER_PREFIX+candidate.order_id);
      if(old){if(old.plan!==candidate.plan||old.auto_renew_requested!==auto)throw new PaymentHttpError(409,'request_conflict','Этот запрос уже используется для другого платежа.');return old;}
      const consent={enabled:auto,plan:body.plan,version:randomUUID(),at:now().toISOString()};
      candidate.consent_version=consent.version;
      await t.put(CONSENT_KEY,consent,now());await t.put(ORDER_PREFIX+candidate.order_id,candidate,now());return candidate;
    });
    if(!order)throw new PaymentHttpError(401,'unauthorized','Invalid account');
    return response(201,{data:publicPayment(await submitOrder(order))});
  }
  async function paymentStatus(user,id){
    await rateLimit('statusUser',user.user_id);
    const row=parseJsonSetting(await store.getSetting(user.user_id,paymentSettingKey(id)));
    if(!row)throw new PaymentHttpError(404,'payment_not_found','Платёж не найден.');
    if(['pending','waiting_for_capture'].includes(row.status)){configured();const p=await client.getPayment(id);
      if(p?.id!==id||p.metadata?.user_id!==user.user_id)throw new PaymentHttpError(502,'payment_provider_error','Некорректный ответ ЮKassa.');
      const updated=await applyPayment(p);return response(200,{data:publicPayment(updated||row)});}
    return response(200,{data:publicPayment(row)});
  }
  async function setAutoRenew(user,body,ip){
    object(body,['enabled']);if(typeof body.enabled!=='boolean')throw new PaymentHttpError(400,'bad_request','Некорректное автопродление.');
    await rateLimit('renewUser',user.user_id);await rateLimit('renewIp',ip);
    const access=await tx(user.user_id,async t=>{
      const a=await t.get(BILLING_ACCESS_SETTING),method=await t.get(BILLING_PAYMENT_METHOD_SETTING);
      if(!a||!['monthly','yearly'].includes(a.plan))throw new PaymentHttpError(400,'auto_renew_unavailable','Автопродление доступно для monthly/yearly.');
      if(body.enabled&&(!methodIdValid(method?.payment_method_id)||!method?.source_payment_id||method.saved!==true))throw new PaymentHttpError(400,'payment_method_required','Нет сохранённого способа оплаты.');
      const updated={...a,auto_renew:body.enabled};await t.put(BILLING_ACCESS_SETTING,updated,now());
      await t.put(CONSENT_KEY,{enabled:body.enabled,plan:a.plan,version:randomUUID(),at:now().toISOString()},now());return updated;
    });
    if(!access)throw new PaymentHttpError(401,'unauthorized','Invalid account');return response(200,{data:access});
  }
  async function unlinkPaymentMethod(user,ip){
    await rateLimit('renewUser',user.user_id);await rateLimit('renewIp',ip);
    const result=await tx(user.user_id,async t=>{
      const access=await t.get(BILLING_ACCESS_SETTING),method=await t.get(BILLING_PAYMENT_METHOD_SETTING),timestamp=now();
      if(access&&['monthly','yearly'].includes(access.plan)&&access.auto_renew===true){
        await t.put(BILLING_ACCESS_SETTING,{...access,auto_renew:false},timestamp);
      }
      await t.put(CONSENT_KEY,{enabled:false,plan:['monthly','yearly'].includes(access?.plan)?access.plan:null,
        version:randomUUID(),at:timestamp.toISOString()},timestamp);
      await t.put(BILLING_PAYMENT_METHOD_SETTING,{saved:false,payment_method_id:null,source_payment_id:null,
        unlinked_at:timestamp.toISOString()},timestamp);
      return {unlinked:Boolean(method?.saved||method?.payment_method_id),auto_renew:false};
    });
    if(!result)throw new PaymentHttpError(401,'unauthorized','Invalid account');return response(200,{data:result});
  }
  async function webhook(body,ip){
    configured();if(body?.type!=='notification'||!['payment.succeeded','payment.canceled'].includes(body.event)||!paymentIdValid(body.object?.id))return response(200,{ok:true,ignored:true});
    await rateLimit('webhookIp',ip);
    const p=await client.getPayment(body.object.id);
    if(p?.id!==body.object.id||p.status!==(body.event==='payment.succeeded'?'succeeded':'canceled'))return response(200,{ok:true,ignored:true});
    const result=await applyPayment(p);return response(200,{ok:true,...(!result?{ignored:true}:{})});
  }
  // Called only by the separately deployed private worker, never an HTTP route.
  async function renewUser(userId){
    configured();const user=await store.getUser(userId),start=Date.parse(options.billingEnforcementStartedAt||'');
    if(!user||user.status!=='active'||!Number.isFinite(start)||start>now().getTime())return {skipped:true};
    const order=await tx(userId,async t=>{
      const access=await t.get(BILLING_ACCESS_SETTING),method=await t.get(BILLING_PAYMENT_METHOD_SETTING),consent=await t.get(CONSENT_KEY);
      if(await t.get('billing.admin_override')||!access?.auto_renew||!['monthly','yearly'].includes(access.plan)||!consent?.enabled||consent.plan!==access.plan||!method?.saved||!methodIdValid(method.payment_method_id))return null;
      const end=Date.parse(access.paid_until);if(!Number.isFinite(end)||end>now().getTime()||end+GRACE_MS<now().getTime())return null;
      const candidate=orderFor(userId,access.plan,true,'renew:'+access.plan+':'+access.paid_until,
        {renewal:true,baseline_paid_until:access.paid_until,baseline_payment_id:access.last_payment_id,
          consent_version:consent.version,payment_method_id:method.payment_method_id});
      const old=await t.get(ORDER_PREFIX+candidate.order_id);if(old)return old;
      await t.put(ORDER_PREFIX+candidate.order_id,candidate,now());return candidate;
    });
    if(!order)return {skipped:true};const result=await submitOrder(order);return {status:result?.status||'unknown'};
  }
  async function handle(method,path,body={},headers={},context={}){
    const pathname=new URL(path,'https://local.invalid').pathname.replace(/\/$/,'')||'/';
    if(!(['/billing/payments','/billing/auto-renew','/billing/payment-method','/billing/yookassa/webhook'].includes(pathname)||/^\/billing\/payments\/[A-Za-z0-9-]{10,80}$/.test(pathname)))return null;
    try{
      const ip=sourceIp(headers,context);
      if(method==='POST'&&pathname==='/billing/yookassa/webhook')return await webhook(body,ip);
      const user=await authenticate(headers);
      if(method==='POST'&&pathname==='/billing/payments')return await createPayment(user,body,ip);
      const match=/^\/billing\/payments\/([A-Za-z0-9-]{10,80})$/.exec(pathname);
      if(method==='GET'&&match)return await paymentStatus(user,match[1]);
      if(method==='POST'&&pathname==='/billing/auto-renew')return await setAutoRenew(user,body,ip);
      if(method==='DELETE'&&pathname==='/billing/payment-method')return await unlinkPaymentMethod(user,ip);
      throw new PaymentHttpError(404,'not_found','Payment route not found');
    }catch(e){
      if(e instanceof PaymentHttpError||e instanceof YooKassaError)return response(e.status||502,{error:{code:e.code,message:e.message}},e.headers||{});
      // Do not pass arbitrary provider/DB error objects to logs (may contain request credentials).
      options.onError?.({code:'payment_internal_error'});return response(500,{error:{code:'internal_error',message:'Internal server error'}});
    }
  }
  return {handle,renewUser};
}
module.exports={createPaymentRouter,PaymentHttpError,safeConfirmation,ORDER_PREFIX,CONSENT_KEY,RETRY_WINDOW_MS};

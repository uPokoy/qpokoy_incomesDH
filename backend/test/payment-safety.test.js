'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {newSession}=require('../security');
const {createPaymentRouter,ORDER_PREFIX,CONSENT_KEY,RETRY_WINDOW_MS}=require('../payment-router');
const {YooKassaError}=require('../yookassa');
const {BILLING_ACCESS_SETTING:ACCESS,BILLING_PAYMENT_METHOD_SETTING:METHOD,paymentSettingKey}=require('../billing-payments');
function fixture(){
  let clock=new Date('2026-10-03T12:00:00Z'),tail=Promise.resolve();
  const users=new Map(),sessions=new Map(),values=new Map(),payments=new Map(),requests=[];
  function account(){const id=randomUUID(),s=newSession();users.set(id,{user_id:id,status:'active',created_at:'2026-10-02T00:00:00Z'});sessions.set(s.sessionId,{user_id:id,secret_hash:s.secretHash,expires_at:'2035-01-01'});return{id,headers:{Authorization:'Bearer '+s.token}};}
  const user=account(),other=account(),key=(uid,k)=>uid+':'+k;
  const store={getSession:async id=>sessions.get(id),getUser:async id=>users.get(id),
    getSetting:async(uid,k)=>values.has(key(uid,k))?{setting_value:JSON.stringify(values.get(key(uid,k)))}:null,
    consumeRateLimit:async()=>({allowed:true}),
    async withPaymentTransaction(uid,fn){
      const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
      try{if(!users.has(uid))return null;const copy=new Map([...values].map(([k,v])=>[k,structuredClone(v)]));
        const result=await fn({get:async k=>structuredClone(copy.get(key(uid,k)))||null,
          put:async(k,v)=>{if(store.failOn===k)throw Error('injected atomic failure');copy.set(key(uid,k),structuredClone(v));}});
        values.clear();for(const [k,v] of copy)values.set(k,v);return result;
      }finally{release();}
    }
  };
  const client={isConfigured:()=>true,
    async createPayment(args){requests.push(structuredClone(args));
      let p=[...payments.values()].find(p=>p.metadata.order_id===args.metadata.order_id);
      if(!p){p={id:randomUUID(),status:args.paymentMethodId?'succeeded':'pending',paid:!!args.paymentMethodId,
        amount:{value:args.amountRub.toFixed(2),currency:'RUB'},metadata:structuredClone(args.metadata),
        created_at:clock.toISOString(),captured_at:clock.toISOString(),
        payment_method:{id:args.paymentMethodId||randomUUID(),saved:args.savePaymentMethod||!!args.paymentMethodId},
        confirmation:args.paymentMethodId?undefined:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout/test'}};payments.set(p.id,p);}
      if(client.afterCreate)await client.afterCreate(p);
      if(client.failCreate)throw new YooKassaError('yookassa_timeout','Synthetic timeout',504);
      return structuredClone(p);
    },
    async getPayment(id){if(client.failGet)throw new YooKassaError('yookassa_unavailable','Synthetic unavailable',502);return structuredClone(payments.get(id));}
  };
  const options={client,now:()=>new Date(clock),billingEnforcementStartedAt:'2026-10-01'};
  const router=createPaymentRouter(store,options);
  const post=(body,who=user)=>router.handle('POST','/billing/payments',body,who.headers,{sourceIp:'127.0.0.1'});
  const notify=async(id,event='payment.succeeded',extra={})=>router.handle('POST','/billing/yookassa/webhook',{type:'notification',event,object:{id,...extra}}, {},{sourceIp:'127.0.0.1'});
  const success=async(id,saved=true)=>{const p=payments.get(id);p.status='succeeded';p.paid=true;p.payment_method.saved=saved;p.captured_at=clock.toISOString();return notify(id);};
  return{store,client,router,options,users,user,other,post,notify,success,requests,payments,values,key,
    get:(k,uid=user.id)=>values.get(key(uid,k)),set:(k,v,uid=user.id)=>values.set(key(uid,k),v),setTime:v=>clock=new Date(v)};
}
test('payment endpoints require a valid active session and fail closed without configuration',async()=>{
  const h=fixture();for(const [m,p,b] of [['POST','/billing/payments',{plan:'monthly'}],['GET','/billing/payments/'+randomUUID(),{}],['POST','/billing/auto-renew',{enabled:true}]])assert.equal((await h.router.handle(m,p,b)).status,401);
  h.users.get(h.user.id).status='blocked';assert.equal((await h.post({plan:'monthly'})).status,401);h.users.get(h.user.id).status='active';h.client.isConfigured=()=>false;assert.equal((await h.post({plan:'monthly'})).status,503);assert.equal(h.requests.length,0);
});
test('client cannot override prices, owner, grant, metadata or prototype plans',async()=>{
  const h=fixture();for(const field of ['amount','amount_rub','user_id','paid_until','grace_until','metadata','return_url','payment_method_id'])assert.equal((await h.post({plan:'monthly',[field]:'attacker'})).status,400);
  for(const plan of ['__proto__','constructor','other'])assert.equal((await h.post({plan})).status,400);assert.equal((await h.post({plan:'monthly',auto_renew:'yes'})).status,400);
  for(const [plan,price] of [['monthly',149],['yearly',1190],['lifetime',1790]]){const r=await h.post({plan});assert.equal(r.status,201);assert.equal(r.body.data.amount_rub,price);}assert.equal(h.requests.length,3);
});
test('request identity is durable, user scoped and binds immutable parameters across lost responses',async()=>{
  const h=fixture(),id=randomUUID();h.client.failCreate=true;assert.equal((await h.post({plan:'monthly',request_id:id})).status,504);
  const args=h.requests[0];h.setTime('2026-10-03T13:00:00Z');h.client.failCreate=false;
  assert.equal((await h.post({plan:'monthly',request_id:id})).status,201);assert.deepEqual(h.requests[1],args);assert.equal(h.payments.size,1);
  assert.equal((await h.post({plan:'yearly',request_id:id})).status,409);
  assert.equal((await h.post({plan:'monthly',request_id:id},h.other)).status,201);assert.notEqual(h.requests.at(-1).idempotenceKey,args.idempotenceKey);
});
test('ambiguous requests older than 23 hours never issue another provider POST',async()=>{
  const h=fixture(),id=randomUUID();h.client.failCreate=true;await h.post({plan:'monthly',request_id:id});h.setTime(new Date(Date.parse('2026-10-03T12:00:00Z')+RETRY_WINDOW_MS));
  const r=await h.post({plan:'monthly',request_id:id});assert.equal(r.status,409);assert.equal(r.body.error.code,'payment_requires_review');assert.equal(h.requests.length,1);
  h.client.failCreate=false;const p=[...h.payments.values()][0];p.status='succeeded';p.paid=true;assert.equal((await h.notify(p.id)).status,200);assert.ok(h.get(ACCESS));
});
test('provider-verified webhook rejects mismatches, unknown orders and unpaid succeeded',async()=>{
  const h=fixture(),r=await h.post({plan:'monthly'}),id=r.body.data.payment_id,original=structuredClone(h.payments.get(id));
  assert.equal((await h.notify(id)).body.ignored,true);assert.equal(h.get(ACCESS),undefined);
  for(const change of [{amount:{value:'1.00',currency:'RUB'}},{amount:{value:'149.00',currency:'USD'}},{metadata:{...original.metadata,user_id:h.other.id}},{metadata:{...original.metadata,plan:'yearly'}},{metadata:{...original.metadata,order_id:'a'.repeat(64)}},{paid:false}]){
    h.payments.set(id,{...structuredClone(original),status:'succeeded',paid:true,...change});assert.equal((await h.notify(id)).body.ignored,true);assert.equal(h.get(ACCESS),undefined);
  }
  h.payments.set(id,original);assert.equal((await h.notify(id,'payment.succeeded',{user_id:h.other.id,status:'succeeded',amount:{value:'999'}})).body.ignored,true);
});
test('duplicate and concurrent webhooks apply once; older payment never undoes lifetime or user auto-renew disable',async()=>{
  const h=fixture(),r=await h.post({plan:'monthly',auto_renew:true}),id=r.body.data.payment_id;const results=await Promise.all([h.success(id),h.success(id),h.success(id)]);assert.ok(results.every(r=>r.status===200));
  const paid=h.get(ACCESS).paid_until;await h.router.handle('POST','/billing/auto-renew',{enabled:false},h.user.headers);await h.notify(id);assert.equal(h.get(ACCESS).auto_renew,false);assert.equal(h.get(ACCESS).paid_until,paid);
  const lifetime=await h.post({plan:'lifetime',auto_renew:true});await h.success(lifetime.body.data.payment_id);await h.notify(id);assert.equal(h.get(ACCESS).plan,'lifetime');assert.equal(h.get(ACCESS).auto_renew,false);assert.equal(h.requests.at(-1).savePaymentMethod,false);
});
test('auto-renew requires explicit consent and provider saved flag; method IDs never returned',async()=>{
  for(const [consent,saved,expected] of [[false,true,false],[true,false,false],[true,true,true]]){const h=fixture(),r=await h.post({plan:'monthly',auto_renew:consent});await h.success(r.body.data.payment_id,saved);assert.equal(h.get(ACCESS).auto_renew,expected);assert.equal(!!h.get(METHOD),expected);
    const status=await h.router.handle('GET','/billing/payments/'+r.body.data.payment_id,{},h.user.headers);assert.equal(JSON.stringify(status.body).includes(h.payments.get(r.body.data.payment_id).payment_method.id),false);
    if(!expected)assert.equal((await h.router.handle('POST','/billing/auto-renew',{enabled:true},h.user.headers)).status,400);
  }
  const h=fixture();h.set(ACCESS,{plan:'monthly',auto_renew:false});h.set(METHOD,{payment_method_id:randomUUID(),source_payment_id:randomUUID()});assert.equal((await h.router.handle('POST','/billing/auto-renew',{enabled:true},h.user.headers)).status,400);
});
test('canceling consent during checkout is not undone by a later successful webhook',async()=>{
  const h=fixture();h.set(ACCESS,{plan:'monthly',paid_until:'2026-10-10',auto_renew:false});
  const r=await h.post({plan:'monthly',auto_renew:true});await h.router.handle('POST','/billing/auto-renew',{enabled:false},h.user.headers);await h.success(r.body.data.payment_id);assert.equal(h.get(ACCESS).auto_renew,false);assert.equal(h.get(METHOD),undefined);
});
test('canceled checkout does not grant access and user payment status enforces ownership',async()=>{
  const h=fixture(),r=await h.post({plan:'yearly'}),id=r.body.data.payment_id;h.payments.get(id).status='canceled';assert.equal((await h.notify(id,'payment.canceled')).status,200);assert.equal(h.get(ACCESS),undefined);
  assert.equal((await h.router.handle('GET','/billing/payments/'+id,{},h.other.headers)).status,404);assert.equal((await h.router.handle('GET','/billing/payments/'+id,{},h.user.headers)).body.data.status,'canceled');
});
test('provider timeout and transaction failure can be reconciled without partial access or replay',async()=>{
  const h=fixture(),r=await h.post({plan:'monthly',auto_renew:true}),id=r.body.data.payment_id;h.client.failGet=true;assert.equal((await h.notify(id)).status,502);h.client.failGet=false;
  h.store.failOn=paymentSettingKey(id);assert.equal((await h.success(id)).status,500);assert.equal(h.get(ACCESS),undefined);assert.equal(h.get(METHOD),undefined);
  h.store.failOn=null;assert.equal((await h.notify(id)).status,200);assert.equal(h.get(ACCESS).auto_renew,true);
});
test('webhook arriving before the create response attaches the known order and stays terminal',async()=>{
  const h=fixture();h.client.afterCreate=async p=>{p.status='succeeded';p.paid=true;await h.notify(p.id);};const r=await h.post({plan:'monthly'});assert.equal(r.status,201);assert.equal(r.body.data.status,'succeeded');assert.ok(h.get(ACCESS));
});
test('confirmation URL must be HTTPS on a provider host without embedded credentials',async()=>{
  for(const url of ['javascript:alert(1)','https://attacker.invalid/','https://yoomoney.ru.attacker.invalid','https://user:password@yoomoney.ru/']){const h=fixture();h.client.afterCreate=p=>{p.confirmation.confirmation_url=url;};const r=await h.post({plan:'monthly'});assert.equal(r.status,502);assert.equal(h.get(ACCESS),undefined);}
});
test('all payment endpoints are rate limited and do not use caller-supplied IP headers',async()=>{
  const h=fixture(),subjects=[];h.store.consumeRateLimit=async(subject)=>{subjects.push(subject);return {allowed:false,retry_after_seconds:7};};
  for(const [method,path,body] of [['POST','/billing/payments',{plan:'monthly'}],['POST','/billing/auto-renew',{enabled:false}],['GET','/billing/payments/'+randomUUID(),{}],['POST','/billing/yookassa/webhook',{type:'notification',event:'payment.succeeded',object:{id:randomUUID()}}]]){const r=await h.router.handle(method,path,body,h.user.headers,{sourceIp:'127.0.0.1'});assert.equal(r.status,429);assert.equal(r.headers['Retry-After'],'7');}
  assert.equal(h.requests.length,0);assert.equal(subjects.length,4);
});
async function paidRenewable(h){const r=await h.post({plan:'monthly',auto_renew:true});await h.success(r.body.data.payment_id);h.setTime('2026-11-03T12:00:00Z');return r.body.data.payment_id;}
test('renewal uses a saved method, one durable cycle/key and cannot double-charge on concurrent workers',async()=>{
  const h=fixture();await paidRenewable(h);const before=h.requests.length;await Promise.all([h.router.renewUser(h.user.id),h.router.renewUser(h.user.id)]);
  const calls=h.requests.slice(before);assert.ok(calls.length>=1);assert.ok(calls.every(c=>c.idempotenceKey===calls[0].idempotenceKey));assert.ok(calls.every(c=>c.paymentMethodId===h.get(METHOD).payment_method_id&&!c.savePaymentMethod));assert.equal(h.payments.size,2);assert.equal(h.get(ACCESS).paid_until,'2026-12-03T12:00:00.000Z');
  await h.router.renewUser(h.user.id);assert.equal(h.payments.size,2);assert.equal(h.requests.length,before+calls.length);
});
test('ambiguous renewal retries exact parameters, while canceled renewal retains three-day grace and stops charging',async()=>{
  const h=fixture();await paidRenewable(h);h.client.failCreate=true;await assert.rejects(h.router.renewUser(h.user.id));const args=h.requests.at(-1);h.client.failCreate=false;h.setTime('2026-11-03T13:00:00Z');await h.router.renewUser(h.user.id);assert.deepEqual(h.requests.at(-1),args);
  const c=fixture();await paidRenewable(c);c.client.afterCreate=p=>{if(p.metadata.order_id!==[...c.payments.values()][0].metadata.order_id){p.status='canceled';p.paid=false;}};await c.router.renewUser(c.user.id);assert.equal(c.get(ACCESS).auto_renew,false);assert.equal(c.get(ACCESS).grace_until,'2026-11-06T12:00:00.000Z');const count=c.requests.length;await c.router.renewUser(c.user.id);assert.equal(c.requests.length,count);
});
test('renewal skips prelaunch, future enforcement, lifetime, missing consent/method and admin overrides',async()=>{
  for(const kind of ['prelaunch','future','lifetime','consent','method','override']){const h=fixture();await paidRenewable(h);
    let router=h.router;if(kind==='prelaunch'||kind==='future')router=createPaymentRouter(h.store,{...h.options,billingEnforcementStartedAt:kind==='prelaunch'?'':'2030-01-01'});
    if(kind==='lifetime')h.set(ACCESS,{plan:'lifetime',auto_renew:true});if(kind==='consent')h.set(CONSENT_KEY,{enabled:false});if(kind==='method')h.set(METHOD,{saved:false,payment_method_id:randomUUID()});if(kind==='override')h.set('billing.admin_override',{plan:'lifetime'});
    const count=h.requests.length;assert.equal((await router.renewUser(h.user.id)).skipped,true,kind);assert.equal(h.requests.length,count);
  }
});
test('paid auto-renew account created before enforcement start can renew',async()=>{
  const h=fixture();await paidRenewable(h);h.users.get(h.user.id).created_at='2026-09-01T00:00:00Z';
  const count=h.requests.length;const result=await h.router.renewUser(h.user.id);
  assert.equal(result.status,'succeeded');assert.equal(h.requests.length,count+1);assert.equal(h.get(ACCESS).paid_until,'2026-12-03T12:00:00.000Z');
});
test('old DEV182 known payments reconcile; arbitrary historical metadata cannot grant access',async()=>{
  const h=fixture(),id=randomUUID(),p={id,status:'succeeded',paid:true,amount:{value:'149.00',currency:'RUB'},metadata:{app:'qpokoy-v1',user_id:h.user.id,plan:'monthly',paid_until:'2026-11-03',grace_until:'2026-11-06'}};
  h.payments.set(id,p);assert.equal((await h.notify(id)).body.ignored,true);h.set(paymentSettingKey(id),{payment_id:id,plan:'monthly',status:'pending'});assert.equal((await h.notify(id)).status,200);assert.equal(h.get(ACCESS).plan,'monthly');
});

test('cancellation after reservation but before provider POST prevents the renewal attempt',async()=>{
  const h=fixture();await paidRenewable(h);const original=h.store.withPaymentTransaction;
  h.store.withPaymentTransaction=async(uid,fn)=>{const result=await original(uid,fn);if(result?.renewal&&result.status==='creating'){h.set(ACCESS,{...h.get(ACCESS),auto_renew:false});h.set(CONSENT_KEY,{...h.get(CONSENT_KEY),enabled:false,version:randomUUID()});}return result;};
  const count=h.requests.length;assert.equal((await h.router.renewUser(h.user.id)).status,'not_submitted');assert.equal(h.requests.length,count);
});
test('ambiguous renewal past the provider dedup window never charges again',async()=>{
  const h=fixture();await paidRenewable(h);h.client.failCreate=true;await assert.rejects(h.router.renewUser(h.user.id));const count=h.requests.length;
  h.setTime('2026-11-04T12:00:00Z');h.client.failCreate=false;await assert.rejects(h.router.renewUser(h.user.id),e=>e.code==='payment_requires_review');assert.equal(h.requests.length,count);
});
test('out-of-order distinct successful payments extend once without downgrading a newer plan',async()=>{
  const h=fixture(),first=await h.post({plan:'monthly'}),second=await h.post({plan:'yearly'});
  h.setTime('2026-10-03T13:00:00Z');await h.success(second.body.data.payment_id);h.setTime('2026-10-03T12:00:00Z');await h.success(first.body.data.payment_id);
  assert.equal(h.get(ACCESS).plan,'yearly');assert.equal(h.get(ACCESS).paid_until,'2027-11-03T13:00:00.000Z');const before=structuredClone(h.get(ACCESS));await h.notify(first.body.data.payment_id);assert.deepEqual(h.get(ACCESS),before);
});

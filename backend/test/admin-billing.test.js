'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app');
const {adminFixture}=require('./helpers/admin-store');
const {grantFor,adminIds}=require('../admin-billing');
function harness(options={}){const h=adminFixture();h.time=new Date('2026-10-03T12:00:00Z');h.app=createApp(h.store,{now:()=>h.time,adminUserIds:[h.admin.id],billingEnforcementStartedAt:'2026-10-01',...options});h.write=(body,headers=h.admin.headers)=>h.app.handle('POST','/admin/users/'+h.target.id+'/access',body,headers);h.status=async()=> (await h.app.handle('GET','/billing/status',{},h.target.headers)).body.data;return h;}
test('admin IDs fail closed, ordinary user cannot access or write by direct requests',async()=>{
  const h=harness();assert.equal(adminIds('bad, ').size,0);
  for(const [method,path,body] of [['GET','/admin/session',{}],['GET','/admin/users?email=target@example.invalid',{}],['POST','/admin/users/'+h.target.id+'/access',{action:'lifetime'}],['GET','/admin/audit',{}]])assert.equal((await h.app.handle(method,path,body,h.ordinary.headers)).status,403);
  assert.equal(h.audit.length,0);assert.equal(h.settings.size,0);
  assert.equal((await h.app.handle('GET','/admin/session',{},{})).status,401);
  const unconfigured=createApp(h.store);assert.equal((await unconfigured.handle('GET','/admin/session',{},h.admin.headers)).status,403);
  assert.equal((await h.app.handle('GET','/admin/session',{},h.admin.headers)).status,200);
});
test('exact email search returns only public account and billing fields',async()=>{
  const h=harness();const r=await h.app.handle('GET','/admin/users?email=TARGET%40example.invalid',{},h.admin.headers);
  assert.equal(r.status,200);assert.deepEqual(Object.keys(r.body.data).sort(),['assignment','billing','created_at','email','status','trial_ends_at','user_id']);
  assert.equal((await h.app.handle('GET','/admin/users?email=target',{},h.admin.headers)).status,400);
  assert.equal((await h.app.handle('GET','/admin/users?email=missing@example.invalid',{},h.admin.headers)).status,404);
});
test('month/year/lifetime/until affect access and produce private minimal audit',async()=>{
  const h=harness();for(const action of ['month','year','lifetime','until']){const r=await h.write({action,date:'2026-12-31'});assert.equal(r.status,200);const a=await h.status();assert.equal(a.source,'admin');assert.equal(a.can_write,true);if(action==='until')assert.equal(a.paid_until,'2026-12-31T20:59:59.999Z');if(action==='lifetime')assert.equal(a.plan,'lifetime');}
  assert.equal(h.audit.length,4);for(const row of h.audit)assert.deepEqual(Object.keys(row).sort(),['action','actor_user_id','at','target_user_id']);
  const publicSettings=await h.app.handle('GET','/settings',{},h.target.headers);assert.equal(publicSettings.body.data.length,0);
  assert.equal((await h.app.handle('PUT','/settings/billing.admin_override',{setting_value:'{}'},h.target.headers)).status,403);
  const full=await h.app.handle('GET','/bootstrap',{},h.target.headers);assert.equal(full.body.settings.length,0);
  assert.equal((await h.app.handle('GET','/bootstrap?revision=same',{},h.target.headers)).body.billing.source,'admin');
});
test('reset preserves underlying billing; launch trial, trial, prelaunch and grace remain correct',async()=>{
  const h=harness();await h.store.putSetting({user_id:h.target.id,setting_key:'billing.access',setting_value:JSON.stringify({plan:'yearly',paid_until:'2027-01-01',auto_renew:true})});
  await h.write({action:'lifetime'});await h.write({action:'reset'});assert.equal((await h.status()).plan,'yearly');assert.equal((await h.app.handle('GET','/admin/users?email=target@example.invalid',{},h.admin.headers)).body.data.assignment.source,'payment');
  const pre=harness({billingEnforcementStartedAt:''});await pre.write({action:'until',date:'2020-01-01'});assert.equal((await pre.status()).mode,'prelaunch');assert.equal((await pre.status()).can_write,true);
  const future=harness({billingEnforcementStartedAt:'2030-01-01'});await future.write({action:'until',date:'2020-01-01'});assert.equal((await future.status()).mode,'prelaunch');
  const existing=harness();existing.users.get(existing.target.id).created_at='2026-09-01';await existing.write({action:'month'});await existing.write({action:'reset'});assert.equal((await existing.status()).mode,'trial');
  const trial=harness();await trial.write({action:'year'});await trial.write({action:'reset'});assert.equal((await trial.status()).mode,'trial');
  await trial.write({action:'month'});trial.time=new Date('2026-11-04T12:00:00Z');assert.equal((await trial.status()).mode,'grace');trial.time=new Date('2026-11-07T12:00:00Z');assert.equal((await trial.status()).can_write,false);
  assert.equal((await trial.app.handle('POST','/incomes',{amount:1},trial.target.headers)).status,402);
});
test('auto renew changes only monthly/yearly and reset does not erase payment data',async()=>{
  const h=harness();assert.equal((await h.write({action:'auto_renew',auto_renew:true})).status,400);await h.write({action:'lifetime'});assert.equal((await h.write({action:'auto_renew',auto_renew:true})).status,400);
  await h.write({action:'month'});assert.equal((await h.write({action:'auto_renew',auto_renew:'true'})).status,400);await h.write({action:'auto_renew',auto_renew:true});assert.equal((await h.status()).auto_renew,true);
  await h.write({action:'auto_renew',auto_renew:false});assert.equal((await h.status()).auto_renew,false);
  await h.write({action:'reset'});await h.store.putSetting({user_id:h.target.id,setting_key:'billing.access',setting_value:'{"plan":"yearly","paid_until":"2027-01-01","provider_reference":"keep-me"}'});await h.write({action:'auto_renew',auto_renew:true});assert.equal((await h.status()).auto_renew,true);assert.equal(JSON.parse((await h.store.getSetting(h.target.id,'billing.access')).setting_value).provider_reference,'keep-me');
});
test('validation and audit failure leave access unchanged',async()=>{
  const h=harness();for(const body of [{action:'unknown'},{action:'until',date:'2026-02-30'},{action:'until',date:'99999-01-01'},null,[]])assert.equal((await h.write(body)).status,400);
  h.store.failAudit=true;assert.equal((await h.write({action:'lifetime'})).status,500);assert.equal(h.audit.length,0);assert.equal((await h.status()).mode,'trial');
});
test('admin search and writes are separately rate limited with Retry-After',async()=>{
  const h=harness({rateLimits:{adminSearchUser:{limit:1,windowMs:60000},adminWriteUser:{limit:1,windowMs:60000}}});
  assert.equal((await h.app.handle('GET','/admin/users?email=target@example.invalid',{},h.admin.headers)).status,200);const search=await h.app.handle('GET','/admin/users?email=target@example.invalid',{},h.admin.headers);assert.equal(search.status,429);assert.equal(search.headers['Retry-After'],'60');
  assert.equal((await h.write({action:'month'})).status,200);assert.equal((await h.write({action:'year'})).status,429);assert.equal(h.audit.length,1);
});
test('calendar grants clamp month-end and leap-day without overflow',()=>{
  assert.equal(grantFor('month',null,new Date('2026-01-31T12:00:00Z')).paid_until,'2026-02-28T12:00:00.000Z');
  assert.equal(grantFor('year',null,new Date('2028-02-29T12:00:00Z')).paid_until,'2029-02-28T12:00:00.000Z');
});

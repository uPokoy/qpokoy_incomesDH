'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {create,snapshot,incomeValue}=require('../android/app/src/main/assets/android-read-cache.js');
const clone=x=>structuredClone(x),failure=status=>Object.assign(new Error('Test response'),{status});
function fixture(){
  let uid='A',token='session-A',online=true,nativeState='online',observedState='unknown',fault=null,lost=false,stale=false,posts=[],ui=[];
  const snapshots=new Map(),queue=new Map(),server=new Map();
  const data=()=>({user:{user_id:uid,email:uid+'@test.invalid',onboarding_completed:true},incomes:[...server.values()].filter(row=>row.user_id===uid),categories:[{id:'category-'+uid,user_id:uid,name:'Category '+uid}],settings:[]});
  const listed=(hash,id)=>[...queue.values()].filter(row=>row.hash===hash&&row.user_id===id).map(({hash,...row})=>clone(row));
  const db={
    read:async({sessionHash:hash})=>{const s=snapshots.get(hash);return {snapshot:s?clone(s):null,pending:s?listed(hash,s.user.user_id):[]};},
    write:async({sessionHash:hash,snapshot:s})=>{
      const ids=new Set(s.incomes.map(row=>row.id));snapshots.clear();snapshots.set(hash,clone(s));
      for(const [key,row] of queue)if(row.user_id===s.user.user_id){if(ids.has(row.income_id))queue.delete(key);else row.hash=hash;}
      return {pending:listed(hash,s.user.user_id)};
    },
    clear:async()=>snapshots.clear(),
    enqueue:async({sessionHash:hash,userId:id,income:row})=>{
      assert.equal(snapshots.get(hash).user.user_id,id);
      assert.equal([...queue.values()].some(r=>r.income_id===row.income_id&&r.user_id===id),false);
      queue.set(row.operation_id,{...clone(row),user_id:id,hash,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,id)};
    },
    pendingState:async({sessionHash:hash,userId:id,operationId:key,status,nextAttempt,code})=>{
      const row=queue.get(key);if(row?.hash===hash&&row.user_id===id)Object.assign(row,{status,next_attempt_at:nextAttempt,error_code:code,attempts:row.attempts+1});
    },
    pendingCount:async({sessionHash:hash})=>({count:[...queue.values()].filter(row=>row.hash===hash).length})
  };
  const api={getToken:()=>token,clearToken:()=>{token=null;},
    bootstrap:async()=>token?clone({...data(),...(stale?{incomes:[]}:{})}):null,
    login:async who=>{uid=who;token='new-session-'+who;return data().user;},register:async()=>{},exchangeOAuthTicket:async()=>{},
    logout:async()=>{token=null;},deleteAccount:async()=>{token=null;},
    listIncomes:async()=>clone(data().incomes),
    addIncome:async row=>{
      posts.push({uid,...clone(row)});
      if(fault){if(fault===401)api.clearToken();throw typeof fault==='number'?failure(fault):fault;}
      const key=uid+':'+row.id;
      if(!server.has(key))server.set(key,{id:row.id,user_id:uid,...incomeValue(row)});
      if(lost){lost=false;throw Object.assign(failure(0),{code:'android_transport'});}
      return clone(server.get(key));
    },updateIncome:async()=>{throw new Error('Unexpected edit');},deleteIncome:async()=>{throw new Error('Unexpected delete');},
    deleteAllIncomes:async()=>{throw new Error('Unexpected bulk');},replaceIncomes:async()=>{throw new Error('Unexpected import');}
  };
  const view={IncomeStore:{load:()=>ui,save:rows=>ui=rows},document:{addEventListener:()=>{},visibilityState:'visible'},addEventListener:()=>{},setTimeout:()=>{},qPokoyNotice:()=>{}};
  const originalApi={...api};
  function coordinator(){Object.assign(api,originalApi);observedState='unknown';const c=create({api,db,fingerprint:async value=>'hash-'+value,
    online:()=>observedState==='online'||observedState==='unknown'&&online,networkState:async()=>{observedState=nativeState;return {state:nativeState};}});c.install(view);return c;}
  let cache=coordinator();
  const hydrate=async payload=>view.IncomeStore.save(payload?payload.incomes.map(row=>({...row,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4)})):[]);
  return {api,db,server,queue,posts,view,hydrate,get cache(){return cache;},get ui(){return ui;},
    setOnline:value=>{online=value;nativeState=observedState=value?'online':'offline';},setNative:value=>nativeState=value,setFault:value=>fault=value,setLost:value=>lost=value,setStale:value=>stale=value,
    freshCoordinator:()=>{cache=coordinator();},
    expireRetries:()=>{for(const row of queue.values())row.next_attempt_at=0;},
    start:()=>cache.start(hydrate),add:amount=>view.IncomeStore.add({id:randomUUID(),date:'10.10.26',amount,category:'Category '+uid,description:'Offline '+amount})};
}

test('A/B: offline add commits durable queue before UI and survives a new coordinator/storage reader',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(123);
  assert.equal(f.queue.size,1);assert.equal(f.ui.length,1);assert.equal(f.ui[0].amount,123);assert.equal(f.cache.snapshot.incomes.length,0);
  assert.equal(f.cache.pendingLabel(f.ui[0].id),'Ожидает синхронизации');
  f.freshCoordinator();await f.start();assert.equal(f.ui.length,1);assert.equal(f.ui[0].amount,123);assert.equal(f.queue.size,1);
  f.setOnline(true);await f.cache.refresh();assert.equal(f.server.size,1);assert.equal(f.queue.size,0);
});
test('C/E: reconnect sequentially acknowledges three rows, preserves IDs and clears pending without duplicates',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);
  for(const amount of [1,2,3])await f.add(amount);const ids=f.ui.map(row=>row.id);
  f.setOnline(true);await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.server.size,3);assert.equal(f.ui.length,3);
  assert.deepEqual(new Set(f.ui.map(row=>row.id)),new Set(ids));assert.deepEqual(f.posts.map(row=>row.amount),[1,2,3]);
  await f.cache.refresh();assert.equal(f.server.size,3);assert.equal(f.cache.pending.length,0);
});
test('D: lost response keeps pending; UUID retry/reconciliation produces exactly one server income',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(4);
  f.setOnline(true);f.setLost(true);await f.cache.refresh();assert.equal(f.server.size,1);assert.equal(f.queue.size,1);
  // A full bootstrap already contains the same authoritative UUID: no second POST.
  await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.ui.length,1);assert.equal(f.server.size,1);assert.equal(f.posts.length,1);
});
test('F: 5xx preserves pending across restart and confirmed snapshot remains unmodified',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(5);
  f.setOnline(true);f.setFault(503);await f.cache.refresh();assert.equal(f.queue.size,1);assert.equal(f.cache.snapshot.incomes.length,0);
  assert.equal([...f.queue.values()][0].error_code,'http_503');
  f.setOnline(false);f.freshCoordinator();await f.start();assert.equal(f.ui.length,1);assert.equal(f.queue.size,1);
});
test('lost response followed by an actual POST retry reuses the same UUID',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(41);
  f.setOnline(true);f.setLost(true);await f.cache.refresh();assert.equal(f.server.size,1);assert.equal(f.queue.size,1);
  f.expireRetries();f.freshCoordinator();
  // Emulate a stale bootstrap before retry; original server create remains committed.
  f.setStale(true);
  await f.start();assert.equal(f.queue.size,0);assert.equal(f.server.size,1);assert.equal(f.ui.length,1);
  assert.equal(f.posts.length,2);assert.equal(f.posts[0].id,f.posts[1].id);assert.equal(f.posts[0].client_mutation_id,f.posts[1].client_mutation_id);
});
test('SQLite enqueue failure cannot display a successful offline income',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);
  f.db.enqueue=async()=>{throw new Error('disk full');};await assert.rejects(f.add(42),/disk full/);
  assert.equal(f.ui.length,0);assert.equal(f.queue.size,0);assert.equal(f.posts.length,0);
});
test('G/I: 401 retains A; B never displays or posts A; verified re-login A resumes the same UUID',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(6);const id=f.ui[0].id;
  f.setOnline(true);f.setFault(401);await f.cache.refresh();assert.equal(f.queue.size,1);assert.equal(f.ui.length,0);
  f.setFault(null);await f.api.login('B');await f.start();assert.equal(f.ui.length,0);assert.equal(f.queue.size,1);assert.equal(f.posts.filter(row=>row.uid==='B').length,0);
  await f.api.login('A');await f.start();assert.equal(f.queue.size,0);assert.equal(f.ui.length,1);assert.equal(f.ui[0].id,id);assert.equal(f.server.size,1);
});
test('H: pending blocks logout/deletion/bulk replacement, without token or data loss',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(7);
  await assert.rejects(f.api.logout(),e=>e.code==='android_pending_logout');assert.equal(f.api.getToken(),'session-A');assert.equal(f.queue.size,1);assert.equal(f.ui.length,1);
  f.setOnline(true);await assert.rejects(f.api.deleteAccount(),e=>e.code==='android_pending_logout');
  await assert.rejects(f.api.deleteAllIncomes(),e=>e.code==='android_pending_logout');assert.equal(f.queue.size,1);
});
test('permanent 4xx persists error row and does not retry forever',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(8);f.setOnline(true);f.setFault(400);
  await f.cache.refresh();await f.cache.refresh();assert.equal(f.posts.length,1);assert.equal(f.queue.size,1);assert.equal(f.ui.length,1);
  assert.equal(f.cache.pending[0].status,'error');assert.match(f.cache.pendingLabel(f.ui[0].id),/ошибка/);
});
test('J: normal online create uses server ACK and does not enter pending queue',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(9);
  assert.equal(f.posts.length,1);assert.equal(f.queue.size,0);assert.equal(f.ui.length,1);assert.equal(f.cache.snapshot.incomes.length,1);
});
test('offline edits/deletes/import and unknown categories remain denied',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(10);
  await assert.rejects(f.view.IncomeStore.update(f.ui[0].id,f.ui[0]),/Нет подключения/);
  await assert.rejects(f.view.IncomeStore.remove(f.ui[0].id),/Нет подключения/);
  await assert.rejects(f.view.IncomeStore.addMany([f.ui[0]]),/Нет подключения/);
  await assert.rejects(f.view.IncomeStore.add({id:randomUUID(),date:'10.10.26',amount:1,category:'Unknown',description:''}),/категорию/);
  assert.equal(f.queue.size,1);assert.equal(f.posts.length,0);
});
test('offline validation matches server rules for dates, integer rubles and length limits',()=>{
  const valid={income_date:'2026-10-10',amount:'1 250,75',category:' A ',description:' B '};
  assert.deepEqual(incomeValue(valid),{income_date:'2026-10-10',amount:1250,category:'A',description:'B'});
  for(const bad of [{amount:0},{amount:1e12+1},{amount:Infinity},{income_date:'2026-02-30'},{category:'x'.repeat(81)},{description:'x'.repeat(5001)}])assert.throws(()=>incomeValue({...valid,...bad}));
});
test('Samsung A/J: stale onLine=true and native offline commits without a POST',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setNative('offline');await f.add(51);
  assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);assert.equal(f.ui[0].amount,51);
});
test('Samsung B/K/L: native online but connection failure falls back, survives restart and reconnects once',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setNative('online');f.setFault(new TypeError('Failed to fetch'));
  await f.add(52);const id=f.posts[0].id;assert.equal(f.queue.size,1);assert.equal(f.ui[0].id,id);assert.equal(f.cache.pendingLabel(id),'Ожидает синхронизации');
  f.setNative('offline');f.freshCoordinator();await f.start();assert.equal(f.ui[0].id,id);
  f.setFault(null);f.setNative('online');await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.server.size,1);assert.equal(f.ui[0].id,id);
});
test('Samsung C: online server commit with lost response queues the original UUID and reconciles one row',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setLost(true);await f.add(53);
  const id=f.posts[0].id;assert.equal(f.posts[0].client_mutation_id,id);assert.equal(f.cache.pending[0].income_id,id);assert.equal(f.server.size,1);
  await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.server.size,1);assert.equal(f.ui.length,1);assert.equal(f.ui[0].id,id);
});
test('Samsung D: timeout falls back using the original POST UUID',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setFault(Object.assign(new Error('Timeout'),{code:'android_transport',status:0}));
  await f.add(54);assert.equal(f.cache.pending[0].income_id,f.posts[0].id);assert.equal(f.ui[0].id,f.posts[0].id);
});
for(const status of [400,401,402,403,404,409,500,502,503,504])test('Samsung HTTP '+status+' is not converted into a new offline income',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setFault(status);
  await assert.rejects(f.add(55),e=>e.status===status);assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});
test('Samsung: validation/business/runtime errors do not become offline success',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  for(const error of [new Error('Business error'),Object.assign(new Error('Bad session payload'),{status:0,code:'invalid_response'}),new TypeError('Cannot read properties of undefined')]){
    f.setFault(error);await assert.rejects(f.add(56));assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
  }
});
test('Samsung: transport fallback with SQLite failure rejects instead of showing success',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setFault(new TypeError('Failed to fetch'));
  f.db.enqueue=async()=>{throw new Error('disk full');};await assert.rejects(f.add(57),/disk full/);assert.equal(f.ui.length,0);assert.equal(f.queue.size,0);
});
test('Samsung M: account switch during failed POST cannot enqueue the old account into the new one',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  f.setFault(Object.assign(new TypeError('Failed to fetch'),{name:'TypeError'}));
  const original=f.api.addIncome;f.api.addIncome=async row=>{try{return await original(row);}finally{await f.api.login('B');await f.start();}};
  await assert.rejects(f.add(58),/Сессия/);assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});
test('unknown state queues locally without POST or transport timeout',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setNative('unknown');
  await f.add(59);assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);assert.equal(f.ui.length,1);
});
test('slow SQLite commit cannot publish a successful local income prematurely',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);
  let release,entered;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),enqueue=f.db.enqueue;
  f.db.enqueue=async value=>{entered();await held;return enqueue(value);};
  const save=f.add(60);await ready;assert.equal(f.ui.length,0);assert.equal(f.queue.size,0);
  release();await save;assert.equal(f.ui.length,1);assert.equal(f.queue.size,1);
});
test('confirmed and pending use date order across restart and sync, never pending status',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  const add=date=>f.view.IncomeStore.add({date,amount:61,category:'Category A',description:date});
  await add('01.10.26');f.setOnline(false);await add('10.10.26');await add('05.10.26');await add('12.10.26');
  const expected=['12.10.26','10.10.26','05.10.26','01.10.26'];assert.deepEqual(f.ui.map(row=>row.date),expected);
  f.freshCoordinator();await f.start();assert.deepEqual(f.ui.map(row=>row.date),expected);
  f.setOnline(true);await f.cache.refresh();assert.deepEqual(f.ui.map(row=>row.date),expected);assert.equal(f.queue.size,0);assert.equal(f.server.size,4);
});
test('actual bundled submit keeps form open until held SQLite commit, then closes and renders one card',async t=>{
  const {createHarness}=require('../../tests/helpers/frontend-harness');
  const fs=require('node:fs'),path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8').replace('src="js/app.js','src="android-app/www/js/app.js');
  const h=await createHarness({html,width:390,pointer:'coarse',empty:true});
  const f=fixture(),hash='hash-'+h.api.getToken();
  h.api.clearToken=()=>{};
  h.api.register=h.api.exchangeOAuthTicket=async()=>{};
  h.api.deleteAccount=async()=>{};
  await f.db.write({sessionHash:hash,snapshot:snapshot(await h.api.bootstrap(),Date.now())});
  const cache=create({api:h.api,db:f.db,fingerprint:async token=>'hash-'+token,online:()=>false,networkState:async()=>({state:'offline'})});
  t.after(async()=>{await cache.purge();h.close();});h.w.qPokoyAndroidCache=cache;cache.install(h.w);
  await cache.start(async data=>{h.w.IncomeStore.save(data.incomes.map(row=>({...row,date:'07.10.26'})));h.w.applyIncomeHeaderFilters();});
  let release,entered;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),enqueue=f.db.enqueue;
  f.db.enqueue=async value=>{entered();await held;return enqueue(value);};
  h.add(62,'Commit gate');await ready;
  assert.equal(h.node('incomeForm').hidden,false);assert.equal(cache.pending.length,0);assert.equal(h.node('saveIncome').disabled,true);
  release();await h.settle();assert.equal(h.node('incomeForm').hidden,true);assert.equal(cache.pending.length,1);
  assert.equal(h.calls.filter(call=>call==='addIncome').length,0);
  assert.equal(h.node('incomeRecentGrid').querySelectorAll('.income-recent-card').length,1);
  assert.equal(h.node('incomeRecentGrid').querySelector('[data-android-pending]').textContent,'Ожидает синхронизации');
});

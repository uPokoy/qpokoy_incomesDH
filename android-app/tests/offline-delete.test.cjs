'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {create,incomeValue}=require('../android/app/src/main/assets/android-read-cache.js');
const clone=value=>structuredClone(value);
const failure=(status,code)=>Object.assign(new Error(code||'test failure'),{status,code});

function fixture(){
  let uid='A',token='session-A',online=true,gate=null,lostDelete=false,fault=null,bootstrapGate=null,ui=[];
  let bootstraps=0,identities=0;
  const snapshots=new Map(),queue=new Map(),server=new Map(),posts=[],updates=[],deletes=[],writes=[],renders=[];
  const data=()=>({user:{user_id:uid,email:'a@test.invalid',onboarding_completed:true},incomes:[...server.values()],categories:[{id:'category-A',user_id:uid,name:'Test'}],settings:[]});
  const listed=(hash,id)=>[...queue.values()].filter(row=>row.hash===hash&&row.user_id===id).map(({hash,...row})=>clone(row));
  const db={
    read:async({sessionHash:hash})=>{const saved=snapshots.get(hash);return {snapshot:saved?clone(saved):null,pending:saved?listed(hash,saved.user.user_id):[]};},
    write:async({sessionHash:hash,snapshot:saved,deleteAck})=>{
      writes.push(clone(saved));
      snapshots.clear();snapshots.set(hash,clone(saved));
      for(const [key,row] of [...queue])if(row.user_id===saved.user.user_id){
        row.hash=hash;const confirmed=saved.incomes.find(item=>item.id===row.income_id);
        if(row.kind==='delete'){if(deleteAck===key)queue.delete(key);continue;}
        if(confirmed){
          if(JSON.stringify(incomeValue(confirmed))===JSON.stringify(incomeValue(row)))queue.delete(key);
          else if(row.kind==='add')Object.assign(row,{kind:'update',status:'pending',next_attempt_at:0,error_code:''});
        }
      }
      return {pending:listed(hash,saved.user.user_id)};
    },
    clear:async()=>snapshots.clear(),
    enqueue:async({sessionHash:hash,userId,income})=>{
      queue.set(income.operation_id,{...clone(income),hash,user_id:userId,kind:'add',sent:0,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    enqueueEdit:async({sessionHash:hash,userId,income})=>{
      const old=[...queue.values()].find(row=>row.hash===hash&&row.user_id===userId&&row.income_id===income.income_id);
      if(old)queue.delete(old.operation_id);
      queue.set(income.operation_id,{...clone(income),hash,user_id:userId,kind:old?.kind||'update',sent:old?.sent||0,created_at:old?.created_at||income.created_at,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    enqueueDelete:async({sessionHash:hash,userId,operationId,incomeId,createdAt,collapseUnsentAdd})=>{
      const old=[...queue.values()].find(row=>row.hash===hash&&row.user_id===userId&&row.income_id===incomeId);
      if(old?.kind==='delete')return {pending:listed(hash,userId)};
      if(old?.kind==='add'&&collapseUnsentAdd&&!old.sent&&!old.attempts){queue.delete(old.operation_id);return {pending:listed(hash,userId)};}
      const basis=old||snapshots.get(hash).incomes.find(row=>row.id===incomeId);assert.ok(basis);
      if(old)queue.delete(old.operation_id);
      queue.set(operationId,{operation_id:operationId,income_id:incomeId,user_id:userId,hash,income_date:basis.income_date,amount:basis.amount,category:basis.category,description:basis.description,created_at:old?.created_at||createdAt,kind:'delete',sent:0,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    beginSend:async({sessionHash:hash,userId,operationId})=>{const row=queue.get(operationId);if(!row||row.hash!==hash||row.user_id!==userId)return {allowed:false};row.sent=1;return {allowed:true};},
    pendingState:async({operationId,status,nextAttempt,code})=>{
      const row=queue.get(operationId);if(row)Object.assign(row,{status,next_attempt_at:nextAttempt,error_code:code,attempts:row.attempts+1});
    },
    pendingCount:async({sessionHash:hash})=>({count:[...queue.values()].filter(row=>row.hash===hash).length})
  };
  const api={
    getToken:()=>token,clearToken:()=>{token=null;},
    restoreSession:async()=>{identities++;return token?data().user:null;},
    bootstrap:async()=>{bootstraps++;const value=token?clone(data()):null;if(bootstrapGate)await bootstrapGate;return value;},
    login:async()=>data().user,register:async()=>{},exchangeOAuthTicket:async()=>{},
    logout:async()=>{token=null;},deleteAccount:async()=>{token=null;},
    listIncomes:async()=>clone([...server.values()]),
    addIncome:async row=>{
      posts.push(clone(row));if(gate)await gate;
      const saved={id:row.id,user_id:uid,...incomeValue(row)};server.set(row.id,saved);return clone(saved);
    },
    updateIncome:async(id,row)=>{
      updates.push({id,...clone(row)});if(gate)await gate;if(!server.has(id))throw failure(404,'not_found');
      const saved={...server.get(id),...incomeValue(row)};server.set(id,saved);return clone(saved);
    },
    deleteIncome:async id=>{
      deletes.push(id);if(gate)await gate;if(fault)throw failure(fault.status,fault.code);
      if(!server.delete(id))throw failure(404,'not_found');
      if(lostDelete){lostDelete=false;throw Object.assign(new Error('lost response'),{status:0,code:'android_transport'});}
    },
    deleteAllIncomes:async()=>{},replaceIncomes:async()=>{}
  };
  const events=new Map(),listen=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
  const view={IncomeStore:{load:()=>ui,save:rows=>ui=rows},document:{addEventListener:listen,visibilityState:'visible'},addEventListener:listen,setTimeout:()=>{},applyIncomeHeaderFilters:()=>{},renderIncomeAnalytics:()=>{},qPokoyNotice:()=>{}};
  const originals={...api};
  const hydrate=async payload=>{renders.push(clone(payload));return view.IncomeStore.save(payload?payload.incomes.map(row=>({id:row.id,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description})):[]);};
  let cache;
  function fresh(){Object.assign(api,originals);cache=create({api,db,fingerprint:async()=> 'a'.repeat(64),online:()=>online,networkState:async()=>({state:online?'online':'offline'})});cache.install(view);}
  fresh();
  return {api,db,server,queue,posts,updates,deletes,writes,renders,snapshots,view,get bootstraps(){return bootstraps;},get identities(){return identities;},get cache(){return cache;},get ui(){return ui;},
    event:name=>events.get(name)?.forEach(fn=>fn()),
    setOnline:value=>online=value,setGate:value=>gate=value,setLostDelete:value=>lostDelete=value,setFault:value=>fault=value,setBootstrapGate:value=>bootstrapGate=value,fresh,
    start:()=>cache.start(hydrate),add:amount=>view.IncomeStore.add({id:randomUUID(),date:'10.10.26',amount,category:'Test',description:'Fixture'})};
}

test('confirmed income DELETE commits tombstone, hides immediately and survives restart',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  const id=randomUUID();f.server.set(id,{id,user_id:'A',income_date:'2026-10-10',amount:10,category:'Test',description:'server'});await f.cache.refresh();
  f.setOnline(false);await f.view.IncomeStore.remove(id);
  assert.equal(f.ui.length,0);assert.equal(f.queue.size,1);assert.equal(f.cache.pending[0].kind,'delete');
  f.fresh();await f.start();assert.equal(f.ui.length,0);assert.equal(f.queue.size,1);
  f.setOnline(true);await f.cache.refresh();assert.equal(f.server.size,0);assert.equal(f.queue.size,0);
});

test('ADD then DELETE before any send collapses to nothing',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(20);const id=f.ui[0].id;
  await f.view.IncomeStore.remove(id);
  assert.equal(f.ui.length,0);assert.equal(f.queue.size,0);
  f.setOnline(true);await f.cache.syncPending();assert.equal(f.posts.length,0);assert.equal(f.server.size,0);
});

test('ADD in-flight then DELETE keeps tombstone until server row is removed',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(30);const id=f.ui[0].id;
  let release;f.setGate(new Promise(resolve=>release=resolve));const sync=f.cache.syncPending();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.posts.length,1);
  await f.view.IncomeStore.remove(id);assert.equal(f.ui.length,0);assert.equal(f.cache.pending[0].kind,'delete');
  f.setGate(null);release();await sync;await f.cache.syncPending();
  assert.equal(f.server.size,0);assert.equal(f.queue.size,0);assert.deepEqual(f.deletes,[id]);
});

test('pending UPDATE is superseded by DELETE and never sent',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(40);await f.cache.syncPending();const id=f.ui[0].id;
  f.setOnline(false);await f.view.IncomeStore.update(id,{...f.ui[0],amount:41});await f.view.IncomeStore.remove(id);
  assert.equal(f.cache.pending[0].kind,'delete');assert.equal(f.ui.length,0);
  f.setOnline(true);await f.cache.syncPending();
  assert.equal(f.updates.length,0);assert.equal(f.server.size,0);assert.equal(f.queue.size,0);
});

test('lost DELETE response stays hidden and clears when refresh proves row absent',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(50);await f.cache.syncPending();const id=f.ui[0].id;
  f.setLostDelete(true);await f.view.IncomeStore.remove(id);await f.cache.syncPending();
  assert.equal(f.server.size,0);assert.equal(f.queue.size,1);assert.equal(f.ui.length,0);
  f.queue.values().next().value.next_attempt_at=0;await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});

test('repeat DELETE 404/not_found is a successful final state',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(60);await f.cache.syncPending();const id=f.ui[0].id;
  f.setOnline(false);await f.view.IncomeStore.remove(id);f.server.delete(id);f.setOnline(true);
  await f.cache.syncPending();
  assert.deepEqual(f.deletes,[id]);assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});


test('bootstrap absence during held ADD must never acknowledge DELETE',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(70);const id=f.ui[0].id;
 let release;f.setGate(new Promise(r=>release=r));const active=f.cache.syncPending();await new Promise(r=>setImmediate(r));
 await f.view.IncomeStore.remove(id);// no new transport while the original ADD is held
 const bootstrap=f.api.bootstrap();await bootstrap;
 assert.equal(f.cache.pending.length,1);assert.equal(f.cache.pending[0].kind,'delete');assert.equal(f.ui.length,0);
 f.setGate(null);release();await active;await f.cache.syncPending();assert.equal(f.server.size,0);assert.equal(f.queue.size,0);
});
test('sent ADD survives restart and cannot collapse even after edit resets attempts',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(80);const id=f.ui[0].id;
 await f.db.beginSend({sessionHash:'a'.repeat(64),userId:'A',operationId:f.cache.pending[0].operation_id});
 await f.view.IncomeStore.update(id,{...f.ui[0],amount:81});f.fresh();await f.start();await f.view.IncomeStore.remove(id);
 assert.equal(f.cache.pending[0].kind,'delete');f.server.set(id,{id,user_id:'A',income_date:'2026-10-10',amount:80,category:'Test',description:'Fixture'});
 f.setOnline(true);await f.cache.refresh();assert.equal(f.server.size,0);assert.equal(f.posts.length,0);
});
test('held UPDATE followed by DELETE cannot resurrect income',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(90);await f.cache.syncPending();const id=f.ui[0].id;
 await f.view.IncomeStore.update(id,{...f.ui[0],amount:91});let release;f.setGate(new Promise(r=>release=r));const active=f.cache.syncPending();await new Promise(r=>setImmediate(r));
 await f.view.IncomeStore.remove(id);f.setGate(null);release();await active;await f.cache.syncPending();assert.equal(f.server.size,0);assert.equal(f.ui.length,0);
});
test('DELETE awaits SQLite commit; storage rejection leaves visible income',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(100);await f.cache.syncPending();const id=f.ui[0].id;
 const enqueue=f.db.enqueueDelete;let release;const gate=new Promise(r=>release=r);f.db.enqueueDelete=async args=>{await gate;return enqueue(args)};
 const saving=f.view.IncomeStore.remove(id);await new Promise(r=>setImmediate(r));assert.equal(f.ui.length,1);assert.equal(f.deletes.length,0);
 release();await saving;assert.equal(f.ui.length,0);
 const g=fixture();t.after(()=>g.cache.purge());await g.start();await g.add(101);await g.cache.syncPending();g.db.enqueueDelete=async()=>{throw Error('sqlite failure')};
 await assert.rejects(g.view.IncomeStore.remove(g.ui[0].id),/sqlite failure/);assert.equal(g.ui.length,1);assert.equal(g.deletes.length,0);
});
for(const status of [400,401,403,404,500])test('DELETE failure '+status+' retains hidden durable intent',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(110);await f.cache.syncPending();const id=f.ui[0].id;
 await f.view.IncomeStore.remove(id);f.setFault({status,code:status===404?'different_route':'error'});await f.cache.syncPending();
 assert.equal(f.ui.length,0);assert.equal(f.queue.size,1);assert.equal(f.cache.pending[0].status,status===401?'auth_required':status<500?'error':'pending');
});
test('multiple tombstones and duplicate DELETE leave unrelated income untouched',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();for(let i=1;i<=4;i++)await f.add(i);await f.cache.syncPending();const ids=f.ui.map(r=>r.id);
 f.setOnline(false);for(const id of ids.slice(0,3))await f.view.IncomeStore.remove(id);await f.view.IncomeStore.remove(ids[0]);assert.equal(f.queue.size,3);
 f.setOnline(true);await f.cache.syncPending();assert.equal(f.server.size,1);assert.ok(f.server.has(ids[3]));assert.equal(f.queue.size,0);
});

test('bootstrap started before DELETE ACK cannot restore its stale row',async t=>{
 const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(120);await f.cache.syncPending();const id=f.ui[0].id;
 let release;f.setBootstrapGate(new Promise(r=>release=r));const old=f.cache.refresh();await new Promise(r=>setImmediate(r));
 await f.view.IncomeStore.remove(id);await f.cache.syncPending();f.setBootstrapGate(null);release();await old;
 assert.equal(f.server.size,0);assert.equal(f.ui.length,0);assert.equal(f.cache.snapshot.incomes.length,0);assert.equal(f.queue.size,0);
});


test('manual pull sends existing ADD UPDATE DELETE after cold offline restore, without bootstrap',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());const edit=randomUUID(),del=randomUUID();
  for(const id of [edit,del])f.server.set(id,{id,user_id:'A',income_date:'2026-10-10',amount:10,category:'Test',description:'server'});
  await f.start();f.setOnline(false);await f.add(123);
  await f.view.IncomeStore.update(edit,{date:'10.10.26',amount:456,category:'Test',description:'edit'});await f.view.IncomeStore.remove(del);
  const id=f.ui.find(r=>r.amount===123).id;assert.match(f.cache.pendingMarkup(id),/aria-label=/);assert.doesNotMatch(f.cache.pendingMarkup(id),/Ожидает|<small/);
  f.fresh();await f.start();assert.equal(f.cache.pending.length,3);assert.equal(f.ui.some(r=>r.id===del),false);
  const callbacks=[];f.view.setTimeout=fn=>callbacks.push(fn);
  const before=f.bootstraps;f.setOnline(true);await f.cache.manualSync();
  for(const callback of callbacks.splice(0))callback();await new Promise(r=>setImmediate(r));
  assert.equal(f.bootstraps,before);assert.equal(f.identities,1);assert.equal(f.posts.length,1);assert.equal(f.updates.length,1);assert.equal(f.deletes.length,1);
  assert.equal(f.server.has(del),false);assert.equal(f.server.get(edit).amount,456);assert.equal(f.server.get(id).amount,123);assert.equal(f.queue.size,0);assert.equal(f.cache.pendingMarkup(id),'');
});
test('manual pull offline leaves durable intents untouched and does not contact API',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(124);const before=f.bootstraps;
  assert.equal(await f.cache.manualSync(),'offline');assert.equal(f.queue.size,1);assert.equal(f.posts.length,0);assert.equal(f.identities,0);assert.equal(f.bootstraps,before);
});
test('manual pull bypasses transient backoff once but preserves permanent DELETE error',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());const id=randomUUID();f.server.set(id,{id,user_id:'A',income_date:'2026-10-10',amount:10,category:'Test',description:'server'});
  await f.start();f.setOnline(false);await f.view.IncomeStore.remove(id);f.setOnline(true);f.setFault({status:503});await f.cache.syncPending();
  assert.ok(f.cache.pending[0].next_attempt_at>Date.now());f.setFault({status:403});await f.cache.manualSync();assert.equal(f.deletes.length,2);assert.equal(f.cache.pending[0].status,'error');
  await f.cache.manualSync();assert.equal(f.deletes.length,2);assert.equal(f.queue.size,1);assert.equal(f.ui.length,0);
});
test('concurrent pulls and active automatic send coalesce without duplicate requests',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(125);let release;f.setGate(new Promise(r=>release=r));f.setOnline(true);
  const auto=f.cache.syncPending();while(!f.posts.length)await new Promise(r=>setImmediate(r));
  const a=f.cache.manualSync(),b=f.cache.manualSync();release();await Promise.all([auto,a,b]);assert.equal(f.posts.length,1);assert.equal(f.queue.size,0);assert.equal(f.server.size,1);
});
test('cold manual account mismatch never sends or discards another account queue',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);await f.add(126);f.fresh();await f.start();f.setOnline(true);
  f.api.restoreSession=async()=>({user_id:'B'});assert.equal(await f.cache.manualSync(),'idle');assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);assert.equal(f.ui.length,0);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));

for(const kind of ['ADD','UPDATE'])test('stale bootstrap after '+kind+' ACK never reaches SQLite/current/UI; fresh refresh still applies',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  f.setOnline(false);await f.add(130);const id=f.ui[0].id;
  if(kind==='UPDATE'){
    f.setOnline(true);await f.cache.syncPending();f.setOnline(false);
    await f.view.IncomeStore.update(id,{...f.ui[0],amount:131});
  }
  let release;f.setBootstrapGate(new Promise(resolve=>release=resolve));
  f.setOnline(true);const old=f.cache.refresh();await settle();
  // The held bootstrap captured the server before this successful ADD/UPDATE.
  await f.cache.syncPending();
  const amount=kind==='ADD'?130:131;
  assert.equal(f.queue.size,0);assert.equal(f.cache.pending.length,0);
  assert.equal(f.cache.snapshot.incomes.find(row=>row.id===id).amount,amount);
  const writes=f.writes.length,renders=f.renders.length;
  f.setBootstrapGate(null);release();await old;
  assert.equal(f.writes.length,writes,'obsolete response must be rejected before native write');
  assert.equal(f.renders.length,renders,'obsolete response must not redraw UI');
  assert.equal(f.snapshots.get('a'.repeat(64)).incomes.find(row=>row.id===id).amount,amount);
  assert.equal(f.cache.snapshot.incomes.find(row=>row.id===id).amount,amount);
  assert.equal(f.ui.find(row=>row.id===id).amount,amount);assert.equal(f.queue.size,0);
  // A later authoritative snapshot must still remove server-deleted records.
  f.server.delete(id);await f.cache.refresh();
  assert.equal(f.writes.length,writes+1);assert.equal(f.ui.length,0);
  assert.equal(f.cache.snapshot.incomes.length,0);assert.equal(f.queue.size,0);
});

for(const kind of ['ADD','UPDATE'])test('overlapping recovery/refresh around '+kind+' ACK coalesces and fetches fresh state',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  f.setOnline(false);await f.add(140);const id=f.ui[0].id;
  if(kind==='UPDATE'){
    f.setOnline(true);await f.cache.syncPending();f.setOnline(false);
    await f.view.IncomeStore.update(id,{...f.ui[0],amount:141});
  }
  const amount=kind==='ADD'?140:141,before=f.bootstraps;
  let release;f.setBootstrapGate(new Promise(resolve=>release=resolve));f.setOnline(true);
  const first=f.cache.refresh();await settle();
  const others=Array.from({length:5},()=>f.cache.refresh());
  for(let i=0;i<5;i++)f.event('online');await settle();
  assert.equal(f.bootstraps,before+1);
  await f.cache.syncPending();
  const writes=f.writes.length;let active=0,maxActive=0;const write=f.db.write;
  f.db.write=async args=>{active++;maxActive=Math.max(maxActive,active);try{await settle();return await write(args);}finally{active--;}};
  f.setBootstrapGate(null);release();await Promise.all([first,...others]);await settle();
  assert.equal(f.bootstraps,before+2,'one obsolete and one fresh bootstrap, no loop');
  assert.equal(f.writes.length,writes+1,'only fresh bootstrap writes after ACK');
  assert.equal(maxActive,1);assert.equal(f.queue.size,0);assert.equal(f.server.size,1);
  assert.equal(f.ui.length,1);assert.equal(f.ui[0].amount,amount);
  assert.equal(f.posts.length,1);assert.equal(f.updates.length,kind==='UPDATE'?1:0);
  assert.equal(f.snapshots.get('a'.repeat(64)).incomes[0].amount,amount);
});

async function coldPending(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();t.after(()=>f.cache.purge());await f.start();
  f.setOnline(false);await f.add(127);f.event('pagehide');f.fresh();await f.start();
  assert.equal(f.cache.canWrite,false);assert.equal(f.cache.pending.length,1);
  return f;
}
test('missed native/online event: bounded fallback validates cold owner and automatically flushes',async t=>{
  const f=await coldPending(t),before=f.bootstraps;
  t.mock.timers.tick(1000);await settle();assert.equal(f.identities,0);assert.equal(f.posts.length,0);
  f.setOnline(true);t.mock.timers.tick(3000);await settle();
  assert.equal(f.identities,1);assert.equal(f.bootstraps,before);assert.equal(f.cache.canWrite,true);
  assert.equal(f.posts.length,1);assert.equal(f.server.size,1);assert.equal(f.queue.size,0);
  t.mock.timers.tick(600000);await settle();assert.equal(f.posts.length,1);
});
for(const status of [401,503])test('failed automatic session validation '+status+' never sends pending',async t=>{
  const f=await coldPending(t);let validations=0;
  f.api.restoreSession=async()=>{validations++;throw failure(status);};
  f.setOnline(true);t.mock.timers.tick(1000);await settle();
  assert.equal(validations,1);assert.equal(f.cache.canWrite,false);assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);
});
test('automatic owner mismatch retains durable old queue and cannot send it under another user',async t=>{
  const f=await coldPending(t);f.api.restoreSession=async()=>({user_id:'B'});
  f.setOnline(true);t.mock.timers.tick(1000);await settle();
  assert.equal(f.posts.length,0);assert.equal(f.cache.canWrite,false);assert.equal(f.queue.size,1);assert.equal(f.ui.length,0);
});
test('repeated online/foreground events and fallback share one validation and one send',async t=>{
  const f=await coldPending(t);let validations=0,release;
  f.api.restoreSession=async()=>{validations++;await new Promise(resolve=>release=resolve);return {user_id:'A'};};
  f.setOnline(true);for(let i=0;i<5;i++){f.event('online');f.event('visibilitychange');}
  t.mock.timers.tick(1000);await settle();assert.equal(validations,1);assert.equal(f.posts.length,0);
  release();await settle();assert.equal(f.posts.length,1);assert.equal(f.queue.size,0);
});
test('offline fallback is finite, does not call API, and foreground re-arms recovery',async t=>{
  const f=await coldPending(t),before=f.bootstraps;
  for(let i=0;i<20;i++){t.mock.timers.tick(600000);await settle();}
  assert.equal(f.identities,0);assert.equal(f.bootstraps,before);assert.equal(f.posts.length,0);
  f.setOnline(true);t.mock.timers.tick(600000);await settle();assert.equal(f.posts.length,0);
  f.event('visibilitychange');await settle();assert.equal(f.identities,1);assert.equal(f.posts.length,1);
});
test('fallback pauses while hidden and stops on pagehide',async t=>{
  const f=await coldPending(t);f.view.document.visibilityState='hidden';f.event('visibilitychange');
  f.setOnline(true);t.mock.timers.tick(600000);await settle();assert.equal(f.identities,0);
  f.event('pagehide');f.view.document.visibilityState='visible';f.event('visibilitychange');
  t.mock.timers.tick(600000);await settle();assert.equal(f.posts.length,0);
});
test('native reconnect signals use the same guarded single-flight recovery',async t=>{
  const f=await coldPending(t);f.event('pagehide');let callback;
  f.view.Capacitor={addListener(plugin,event,fn){assert.equal(plugin,'QPokoyReadCache');assert.equal(event,'networkStateChange');callback=fn;return {remove:async()=>{}};}};
  f.view.qPokoyAndroidNetwork={accept:()=>{}};f.fresh();await f.start();
  f.setOnline(true);for(let i=0;i<6;i++)callback({state:'online'});await settle();
  assert.equal(f.identities,1);assert.equal(f.posts.length,1);assert.equal(f.queue.size,0);
});
test('token change during automatic validation never sends the old queue',async t=>{
  const f=await coldPending(t);let release;
  f.api.restoreSession=()=>new Promise(resolve=>release=resolve);
  f.setOnline(true);t.mock.timers.tick(1000);await settle();
  f.api.getToken=()=> 'different-session';release({user_id:'A'});await settle();
  assert.equal(f.cache.canWrite,false);assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);
});
test('a bootstrap for another owner cannot rebind or send a cold pending queue',async t=>{
  const f=await coldPending(t);f.api.bootstrap=async()=>({user:{user_id:'B'},incomes:[],categories:[],settings:[]});
  // Capture the changed original bootstrap in a new process-equivalent coordinator.
  // fixture.fresh restores API originals, so use a standalone coordinator here.
  f.event('pagehide');const c=create({api:f.api,db:f.db,fingerprint:async()=> 'a'.repeat(64),online:()=>true});
  t.after(()=>c.purge());await c.start(async()=>{});
  assert.equal(c.canWrite,false);assert.equal(f.posts.length,0);assert.equal(f.queue.size,1);assert.equal(c.snapshot,null);
});

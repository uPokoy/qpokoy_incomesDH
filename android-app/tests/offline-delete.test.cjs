'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {create,incomeValue}=require('../android/app/src/main/assets/android-read-cache.js');
const clone=value=>structuredClone(value);
const failure=(status,code)=>Object.assign(new Error(code||'test failure'),{status,code});

function fixture(){
  let uid='A',token='session-A',online=true,gate=null,lostDelete=false,ui=[];
  const snapshots=new Map(),queue=new Map(),server=new Map(),posts=[],updates=[],deletes=[];
  const data=()=>({user:{user_id:uid,email:'a@test.invalid',onboarding_completed:true},incomes:[...server.values()],categories:[{id:'category-A',user_id:uid,name:'Test'}],settings:[]});
  const listed=(hash,id)=>[...queue.values()].filter(row=>row.hash===hash&&row.user_id===id).map(({hash,...row})=>clone(row));
  const db={
    read:async({sessionHash:hash})=>{const saved=snapshots.get(hash);return {snapshot:saved?clone(saved):null,pending:saved?listed(hash,saved.user.user_id):[]};},
    write:async({sessionHash:hash,snapshot:saved})=>{
      snapshots.clear();snapshots.set(hash,clone(saved));
      for(const [key,row] of [...queue])if(row.user_id===saved.user.user_id){
        row.hash=hash;const confirmed=saved.incomes.find(item=>item.id===row.income_id);
        if(row.kind==='delete'){if(!confirmed)queue.delete(key);continue;}
        if(confirmed){
          if(JSON.stringify(incomeValue(confirmed))===JSON.stringify(incomeValue(row)))queue.delete(key);
          else if(row.kind==='add')Object.assign(row,{kind:'update',status:'pending',next_attempt_at:0,error_code:''});
        }
      }
      return {pending:listed(hash,saved.user.user_id)};
    },
    clear:async()=>snapshots.clear(),
    enqueue:async({sessionHash:hash,userId,income})=>{
      queue.set(income.operation_id,{...clone(income),hash,user_id:userId,kind:'add',status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    enqueueEdit:async({sessionHash:hash,userId,income})=>{
      const old=[...queue.values()].find(row=>row.hash===hash&&row.user_id===userId&&row.income_id===income.income_id);
      if(old)queue.delete(old.operation_id);
      queue.set(income.operation_id,{...clone(income),hash,user_id:userId,kind:old?.kind||'update',created_at:old?.created_at||income.created_at,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    enqueueDelete:async({sessionHash:hash,userId,operationId,incomeId,createdAt,collapseUnsentAdd})=>{
      const old=[...queue.values()].find(row=>row.hash===hash&&row.user_id===userId&&row.income_id===incomeId);
      if(old?.kind==='delete')return {pending:listed(hash,userId)};
      if(old?.kind==='add'&&collapseUnsentAdd){queue.delete(old.operation_id);return {pending:listed(hash,userId)};}
      const basis=old||snapshots.get(hash).incomes.find(row=>row.id===incomeId);assert.ok(basis);
      if(old)queue.delete(old.operation_id);
      queue.set(operationId,{operation_id:operationId,income_id:incomeId,user_id:userId,hash,income_date:basis.income_date,amount:basis.amount,category:basis.category,description:basis.description,created_at:old?.created_at||createdAt,kind:'delete',status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    pendingState:async({operationId,status,nextAttempt,code})=>{
      const row=queue.get(operationId);if(row)Object.assign(row,{status,next_attempt_at:nextAttempt,error_code:code,attempts:row.attempts+1});
    },
    pendingCount:async({sessionHash:hash})=>({count:[...queue.values()].filter(row=>row.hash===hash).length})
  };
  const api={
    getToken:()=>token,clearToken:()=>{token=null;},
    bootstrap:async()=>token?clone(data()):null,
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
      deletes.push(id);if(gate)await gate;
      if(!server.delete(id))throw failure(404,'not_found');
      if(lostDelete){lostDelete=false;throw Object.assign(new Error('lost response'),{status:0,code:'android_transport'});}
    },
    deleteAllIncomes:async()=>{},replaceIncomes:async()=>{}
  };
  const view={IncomeStore:{load:()=>ui,save:rows=>ui=rows},document:{addEventListener:()=>{},visibilityState:'visible'},addEventListener:()=>{},setTimeout:()=>{},applyIncomeHeaderFilters:()=>{},renderIncomeAnalytics:()=>{},qPokoyNotice:()=>{}};
  const originals={...api};
  const hydrate=async payload=>view.IncomeStore.save(payload?payload.incomes.map(row=>({id:row.id,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description})):[]);
  let cache;
  function fresh(){Object.assign(api,originals);cache=create({api,db,fingerprint:async()=> 'a'.repeat(64),online:()=>online,networkState:async()=>({state:online?'online':'offline'})});cache.install(view);}
  fresh();
  return {api,db,server,queue,posts,updates,deletes,view,get cache(){return cache;},get ui(){return ui;},
    setOnline:value=>online=value,setGate:value=>gate=value,setLostDelete:value=>lostDelete=value,fresh,
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
  await f.cache.refresh();assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});

test('repeat DELETE 404/not_found is a successful final state',async t=>{
  const f=fixture();t.after(()=>f.cache.purge());await f.start();await f.add(60);await f.cache.syncPending();const id=f.ui[0].id;
  f.setOnline(false);await f.view.IncomeStore.remove(id);f.server.delete(id);f.setOnline(true);
  await f.cache.syncPending();
  assert.deepEqual(f.deletes,[id]);assert.equal(f.queue.size,0);assert.equal(f.ui.length,0);
});

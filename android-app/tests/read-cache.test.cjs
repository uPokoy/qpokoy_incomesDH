'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,snapshot}=require('../android/app/src/main/assets/android-read-cache.js');
const data=(uid='A',amount=10)=>({user:{user_id:uid,email:uid+'@test.invalid',onboarding_completed:true,password:'MUST_NOT_COPY'},
  incomes:[{id:'income-'+uid,user_id:uid,income_date:'2026-10-10',amount,category:'Test',description:uid}],
  categories:[{id:'category-'+uid,user_id:uid,name:uid}],settings:[],token:'MUST_NOT_COPY'});
function fixture(){
  let token='session-A',online=true,rows=new Map(),networkData=data(),calls=0,fail=false;
  const db={read:async({sessionHash})=>({snapshot:rows.get(sessionHash)||null}),write:async({sessionHash,snapshot})=>{rows.clear();rows.set(sessionHash,structuredClone(snapshot));},clear:async()=>rows.clear()};
  const api={getToken:()=>token,bootstrap:async()=>{calls++;if(fail)throw new Error('500');return structuredClone(networkData);}};
  const cache=create({api,db,fingerprint:async value=>'hash-'+value,online:()=>online});
  return {cache,api,db,rows,setToken:value=>token=value,setOnline:value=>online=value,setData:value=>networkData=value,setFailure:value=>fail=value,get calls(){return calls;}};
}
test('cache contains whitelisted data only, rejects mixed owners and duplicates',()=>{
  const clean=snapshot(data(),1);assert.equal(JSON.stringify(clean).includes('MUST_NOT_COPY'),false);
  assert.throws(()=>snapshot({...data(),categories:data('B').categories},1),/Cross-account/);
  assert.throws(()=>snapshot({...data(),incomes:[...data().incomes,...data().incomes]},1),/Duplicate/);
});
test('first load fills cache; next load displays cache before a held network response',async()=>{
  const f=fixture();await f.cache.start(async()=>{});assert.equal(f.rows.size,1);
  let release;f.api.bootstrap=()=>new Promise(resolve=>release=resolve);
  // Coordinator captures its bootstrap at creation, use a new coordinator for a real cold start.
  const second=create({api:f.api,db:f.db,fingerprint:async value=>'hash-'+value,online:()=>true});
  const events=[];const job=second.start(async(payload,cached)=>events.push(cached?'cache':'server'));
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['cache']);assert.equal(second.canWrite,false);
  release(data('A',20));await job;assert.deepEqual(events,['cache','server']);assert.equal(second.snapshot.incomes[0].amount,20);
});
test('offline cache displays history/analytics source and all writes are denied; no unknown identity fallback',async()=>{
  const f=fixture();await f.cache.start(async()=>{});f.setOnline(false);
  await f.cache.start(async(payload,cached)=>{assert.equal(cached,true);assert.equal(payload.incomes.length,1);});
  assert.throws(()=>f.cache.requireWrite(),/Нет подключения/);
  f.setToken('session-B');let shown=false;
  await assert.rejects(f.cache.start(async()=>shown=true),/Нет подключения/);assert.equal(shown,false);
});
test('A logout clears every snapshot; B can never display A',async()=>{
  const f=fixture();await f.cache.start(async()=>{});await f.cache.purge();assert.equal(f.rows.size,0);
  f.setToken('session-B');f.setData(data('B'));const displayed=[];
  await f.cache.start(async value=>displayed.push(value.user.user_id));assert.deepEqual(displayed,['B']);assert.equal(f.cache.snapshot.user.user_id,'B');
});
test('old and corrupt snapshots are discarded; server remains available',async()=>{
  for(const bad of [{schemaVersion:99}, {...snapshot(data(),1),categories:[{user_id:'B'}]}]){
    const f=fixture();f.rows.set('hash-session-A',bad);const events=[];
    await f.cache.start(async(value,cached)=>events.push(cached));assert.deepEqual(events,[false]);assert.equal(f.cache.snapshot.user.user_id,'A');
  }
});
test('same server data avoids rehydration; timestamp refreshes; transient 5xx retains cache',async()=>{
  const f=fixture();await f.cache.start(async()=>{});let count=0;
  await f.cache.start(async()=>count++);assert.equal(count,1); // cached render only
  f.setFailure(true);await f.cache.refresh();assert.equal(count,1);assert.equal(f.cache.snapshot.incomes.length,1);
});
test('delayed A response cannot recreate a cache after logout/account switch',async()=>{
  const f=fixture();let release;f.api.bootstrap=()=>new Promise(resolve=>release=resolve);
  const cache=create({api:f.api,db:f.db,fingerprint:async value=>'hash-'+value,online:()=>true});
  const shown=[];const job=cache.start(async value=>shown.push(value));await new Promise(resolve=>setImmediate(resolve));
  await cache.purge();f.setToken('session-B');release(data('A'));await job;
  assert.equal(f.rows.size,0);assert.equal(cache.snapshot,null);assert.deepEqual(shown,[]);
});
test('successful mutations persist server rows; failed/offline mutations never alter cache or create a journal',async()=>{
  const f=fixture();let failed=false,posts=0;
  for(const name of ['login','register','exchangeOAuthTicket','logout','deleteAccount','clearToken'])f.api[name]=async()=>{};
  f.api.addIncome=async row=>{posts++;if(failed)throw new Error('500');return {...row,user_id:'A'};};
  const timers=[];
  const w={IncomeStore:{load:()=>[],save:rows=>rows},document:{addEventListener:()=>{},visibilityState:'visible'},addEventListener:()=>{},setTimeout:fn=>timers.push(fn)};
  f.cache.install(w);await f.cache.start(async()=>{});
  await f.api.addIncome({id:'new',income_date:'2026-10-10',amount:20,description:'New',category:'Test'});
  assert.equal(f.cache.snapshot.incomes.length,2);assert.equal(f.rows.get('hash-session-A').incomes.length,2);
  failed=true;await assert.rejects(f.api.addIncome({id:'bad'}),/500/);assert.equal(f.cache.snapshot.incomes.length,2);
  f.setOnline(false);await assert.rejects(f.api.addIncome({id:'offline'}),/Нет подключения/);assert.equal(posts,2);
  assert.equal(f.cache.snapshot.incomes.length,2);
});
test('logout and successful deletion purge data; failed deletion keeps a valid cache',async()=>{
  for(const deletion of [false,true]){
    const f=fixture();let fail=true;
    for(const name of ['login','register','exchangeOAuthTicket','clearToken'])f.api[name]=async()=>{};
    f.api.logout=async()=>f.setToken(null);
    f.api.deleteAccount=async()=>{if(fail)throw new Error('500');f.setToken(null);};
    const w={IncomeStore:{load:()=>[],save:()=>{}},document:{addEventListener:()=>{}},addEventListener:()=>{},setTimeout:()=>{}};
    f.cache.install(w);await f.cache.start(async()=>{});
    if(deletion){await assert.rejects(f.api.deleteAccount(),/500/);assert.equal(f.rows.size,1);fail=false;await f.api.deleteAccount();}
    else await f.api.logout();
    assert.equal(f.rows.size,0);assert.equal(f.cache.snapshot,null);assert.equal(f.cache.canWrite,false);
  }
});

test('confirmed direct mutation still refreshes the displayed UI, even when its cache is already current',async()=>{
  const f=fixture();
  for(const name of ['login','register','exchangeOAuthTicket','logout','deleteAccount','clearToken'])f.api[name]=async()=>{};
  const next=data('A',99);
  f.api.updateIncome=async()=>{f.setData(next);return next.incomes[0];};
  const w={IncomeStore:{load:()=>[],save:()=>{}},document:{addEventListener:()=>{}},addEventListener:()=>{},setTimeout:()=>{}};
  f.cache.install(w);const amounts=[];await f.cache.start(async value=>amounts.push(value.incomes[0].amount));
  await f.api.updateIncome('income-A',{});assert.equal(f.cache.snapshot.incomes[0].amount,99);
  await f.cache.refresh();assert.deepEqual(amounts,[10,99]);
  await f.cache.refresh();assert.deepEqual(amounts,[10,99]);
});

test('refresh requested after a mutation waits past an obsolete in-flight bootstrap',async()=>{
  const f=fixture();let hold=false,release;
  f.api.bootstrap=()=>hold?new Promise(resolve=>release=resolve):Promise.resolve(data('A',99));
  for(const name of ['login','register','exchangeOAuthTicket','logout','deleteAccount','clearToken'])f.api[name]=async()=>{};
  f.api.updateIncome=async()=>data('A',99).incomes[0];
  const cache=create({api:f.api,db:f.db,fingerprint:async value=>'hash-'+value,online:()=>true});
  const w={IncomeStore:{load:()=>[],save:()=>{}},document:{addEventListener:()=>{}},addEventListener:()=>{},setTimeout:()=>{}};
  cache.install(w);const amounts=[];await cache.start(async value=>amounts.push(value.incomes[0].amount));
  hold=true;const old=cache.refresh();await new Promise(resolve=>setImmediate(resolve));
  await f.api.updateIncome('income-A',{});const fresh=cache.refresh();hold=false;release(data('A',10));
  await Promise.all([old,fresh]);assert.equal(cache.snapshot.incomes[0].amount,99);assert.equal(cache.canWrite,true);assert.equal(amounts.includes(10),false);
});

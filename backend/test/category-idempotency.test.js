'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {TypedValues}=require('ydb-sdk');
const {createYdbStore}=require('../ydb');
const {createApp}=require('../app');
const {newSession}=require('../security');
const when=new Date('2026-10-17T12:00:00Z');
const cloneMap=map=>new Map([...map].map(([key,value])=>[key,structuredClone(value)]));
function result(rows){
 if(!rows.length)return {resultSets:[]};
 const keys=Object.keys(rows[0]),typed=value=>value instanceof Date?TypedValues.timestamp(value):TypedValues.utf8(String(value));
 return {resultSets:[{columns:keys.map(key=>({name:key,type:typed(rows[0][key]).type})),rows:rows.map(row=>({items:keys.map(key=>typed(row[key]).value)}))}]};
}
function fixture(){
 const categories=new Map(),settings=new Map(),versions=new Map(),transactions=new Map(),calls=[];
 let sequence=0,failWrite=false,loseCommit=false,aborts=0,rollbacks=0;
 const key=(uid,id)=>uid+'\0'+id;
 const snapshot=()=>({categories:cloneMap(categories),settings:cloneMap(settings),versions:new Map(versions),dirty:false});
 function commit(tx){
  if((versions.get(tx.uid)||0)!==(tx.versions.get(tx.uid)||0)){aborts++;throw Object.assign(new Error('ABORTED'),{code:400040});}
  if(tx.dirty){
   for(const [id,row]of tx.categories)if(row.user_id===tx.uid)categories.set(id,row);
   for(const [id,row]of tx.settings)if(row.user_id===tx.uid)settings.set(id,row);
   versions.set(tx.uid,(versions.get(tx.uid)||0)+1);
  }
 }
 class Driver{
  async ready(){return true;}
  tableClient={withSession:async callback=>callback({
   beginTransaction:async options=>{assert.deepEqual(options,{serializableReadWrite:{}});const id=String(++sequence);transactions.set(id,snapshot());return {id};},
   executeQuery:async(sql,params,control)=>{
    calls.push({sql,control});const tx=control?.txId?transactions.get(control.txId):snapshot();
    assert.ok(tx);tx.uid=params.$uid.value.textValue;
    if(sql.includes('INSERT INTO `categories`')){
     const row={user_id:tx.uid,id:params.$id.value.textValue,name:params.$name.value.textValue,created_at:when};
     assert.equal(tx.categories.has(key(tx.uid,row.id)),false);tx.categories.set(key(tx.uid,row.id),row);tx.dirty=true;
     if(params.$key){
      assert.ok(control?.txId,'mapping/category writes require explicit transaction');
      assert.match(sql,/UPSERT INTO `settings`.*\$key,\$value/s);assert.match(sql,/\$revisionKey/);
      if(failWrite){failWrite=false;throw new Error('injected mapping write failure');}
      tx.settings.set(key(tx.uid,params.$key.value.textValue),{user_id:tx.uid,setting_key:params.$key.value.textValue,setting_value:params.$value.value.textValue,updated_at:when});
     }
     tx.settings.set(key(tx.uid,'system.data_revision'),{user_id:tx.uid,setting_key:'system.data_revision',setting_value:params.$revision.value.textValue,updated_at:when});
     if(!control)commit(tx);return result([]);
    }
    if(sql.includes('FROM `categories`')){
     const rows=[...tx.categories.values()].filter(row=>row.user_id===tx.uid&&(!params.$id||row.id===params.$id.value.textValue));return result(rows);
    }
    if(sql.includes('FROM `settings`')){
     const rows=[...tx.settings.values()].filter(row=>row.user_id===tx.uid&&(!params.$key||row.setting_key===params.$key.value.textValue));return result(rows);
    }
    throw new Error('Unexpected SQL in category fixture');
   },
   commitTransaction:async control=>{const tx=transactions.get(control.txId);commit(tx);transactions.delete(control.txId);if(loseCommit&&tx.dirty){loseCommit=false;throw new Error('injected lost commit acknowledgement');}},
   rollbackTransaction:async control=>{rollbacks++;transactions.delete(control.txId);}
  })};
 }
 const persistence=createYdbStore({ENDPOINT:'grpcs://fixture.invalid',DATABASE:'/fixture'},Driver);
 const users=[0,1].map(()=>({user_id:randomUUID(),email:'fixture@example.test',status:'active',created_at:when,trial_ends_at:'2030-01-01'}));
 const sessions=users.map(user=>({...newSession(),user_id:user.user_id}));
 const store={...persistence,
  getSession:async id=>{const row=sessions.find(s=>s.sessionId===id);return row?{user_id:row.user_id,secret_hash:row.secretHash,expires_at:'2030-01-01'}:null;},
  getUser:async id=>users.find(u=>u.user_id===id)};
 let app;const restart=()=>{app=createApp(store,{now:()=>when});};restart();
 const auth=index=>({Authorization:'Bearer '+sessions[index].token});
 // Compare the JSON contract delivered by the HTTP handler, not SDK row prototypes.
 const post=async(body,index=0)=>JSON.parse(JSON.stringify(await app.handle('POST','/categories',body,auth(index))));
 const own=uid=>[...categories.values()].filter(c=>c.user_id===(uid||users[0].user_id));
 return {post,store,users,settings,categories,calls,transactions,restart,own,
  revision:()=>settings.get(key(users[0].user_id,'system.data_revision'))?.setting_value,
  mappings:()=>[...settings.values()].filter(s=>s.setting_key.startsWith('system.category_create.')),
  signedOut:body=>app.handle('POST','/categories',body),
  getSettings:()=>app.handle('GET','/settings',{},auth(0)),
  putReserved:request=>app.handle('PUT','/settings/system.category_create.'+request,{setting_value:'evil'},auth(0)),
  failWrite:()=>{failWrite=true;},loseCommit:()=>{loseCommit=true;},get aborts(){return aborts;},get rollbacks(){return rollbacks;}};
}
test('legacy category create retains 201/body shape and case-insensitive duplicate error',async()=>{
 const f=fixture(),first=await f.post({name:'Такси'});assert.equal(first.status,201);assert.deepEqual(Object.keys(first.body),['data']);
 assert.deepEqual(Object.keys(first.body.data).sort(),['created_at','id','name','user_id']);
 const duplicate=await f.post({name:'ТАКСИ'});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.code,'category_exists');assert.equal(f.own().length,1);assert.equal(f.mappings().length,0);
});
test('request_id create is 201; sequential replay is 200 with identical category and no revision change',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()},first=await f.post(body),revision=f.revision();assert.equal(first.status,201);
 for(let i=0;i<3;i++){const replay=await f.post(body);assert.equal(replay.status,200);assert.deepEqual(replay.body,first.body);assert.equal(f.revision(),revision);}
 assert.equal(f.own().length,1);assert.equal(f.mappings().length,1);assert.equal(f.transactions.size,0);
});
test('lost HTTP response then process recreation retries the durable mapping without duplicate',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()};let original;
 await assert.rejects((async()=>{original=await f.post(body);throw new Error('lost HTTP response');})(),/lost HTTP/);
 f.restart();const retry=await f.post(body);assert.equal(retry.status,200);assert.deepEqual(retry.body,original.body);assert.equal(f.own().length,1);
});
test('two parallel identical requests create exactly one category and return its same ID',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()},results=await Promise.all([f.post(body),f.post(body)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.deepEqual(results[0].body,results[1].body);assert.equal(f.own().length,1);assert.equal(f.mappings().length,1);assert.ok(f.aborts>=1);
});
test('request_id with another name returns controlled 409 without mutation',async()=>{
 const f=fixture(),request_id=randomUUID(),first=await f.post({name:'Такси',request_id}),revision=f.revision();
 const next=await f.post({name:'Другое',request_id});assert.equal(next.status,409);assert.equal(next.body.error.code,'idempotency_conflict');assert.equal(f.own().length,1);assert.equal(f.own()[0].id,first.body.data.id);assert.equal(f.revision(),revision);
});
test('parallel different names with the same request_id have one winner and one conflict',async()=>{
 const f=fixture(),request_id=randomUUID(),results=await Promise.all([f.post({name:'Такси',request_id}),f.post({name:'Другое',request_id})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(results.find(r=>r.status===409).body.error.code,'idempotency_conflict');assert.equal(f.own().length,1);
});
test('same request UUID is isolated by authenticated user',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()},results=await Promise.all([f.post(body,0),f.post(body,1)]);
 assert.equal(results[0].status,201);assert.equal(results[1].status,201);assert.notEqual(results[0].body.data.id,results[1].body.data.id);assert.equal(f.mappings().length,2);
});
test('different request UUIDs are independent; duplicate-name validation is retained',async()=>{
 const f=fixture();for(const name of ['Такси','Продажи'])assert.equal((await f.post({name,request_id:randomUUID()})).status,201);
 const duplicate=await f.post({name:'ТАКСИ',request_id:randomUUID()});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.code,'category_exists');assert.equal(f.own().length,2);assert.equal(f.mappings().length,2);
});
test('parallel distinct keys cannot create the same category name twice',async()=>{
 const f=fixture(),results=await Promise.all([f.post({name:'Такси',request_id:randomUUID()}),f.post({name:'ТАКСИ',request_id:randomUUID()})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(f.own().length,1);assert.equal(f.mappings().length,1);
});
test('mapping/category/revision roll back together on mapping write failure',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()};f.failWrite();assert.equal((await f.post(body)).status,500);
 assert.equal(f.own().length,0);assert.equal(f.mappings().length,0);assert.equal(f.revision(),undefined);assert.equal(f.transactions.size,0);assert.ok(f.rollbacks);
 assert.equal((await f.post(body)).status,201);assert.equal(f.own().length,1);
});
test('lost YDB commit acknowledgement still permits safe retry with the same category',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()};f.loseCommit();assert.equal((await f.post(body)).status,500);assert.equal(f.own().length,1);
 const saved=f.own()[0],retry=await f.post(body);assert.equal(retry.status,200);assert.equal(retry.body.data.id,saved.id);assert.equal(f.own().length,1);
});
test('UUID case is canonical; names use existing whitespace normalization',async()=>{
 const f=fixture(),request_id=randomUUID(),first=await f.post({name:'  Такси   поездки  ',request_id:request_id.toUpperCase()});assert.equal(first.status,201);assert.equal(first.body.data.name,'Такси поездки');
 assert.deepEqual((await f.post({name:'Такси поездки',request_id})).body,first.body);
});
test('invalid request IDs and invalid category names fail before persistence',async()=>{
 const f=fixture();for(const request_id of [null,42,[],[randomUUID()],{},'', 'not-a-uuid'])assert.equal((await f.post({name:'Такси',request_id})).status,400);
 for(const name of ['', 'x'.repeat(81)])assert.equal((await f.post({name,request_id:randomUUID()})).status,400);
 assert.equal(f.own().length,0);assert.equal(f.mappings().length,0);
});
test('authentication and subscription guards apply to idempotent creation',async()=>{
 const f=fixture(),body={name:'Такси',request_id:randomUUID()};assert.equal((await f.signedOut(body)).status,401);
 f.users[0].trial_ends_at='2020-01-01';assert.equal((await f.post(body)).status,402);assert.equal(f.own().length,0);
});
test('mapping is private and a replay cannot resurrect a deleted category',async()=>{
 const f=fixture(),request_id=randomUUID(),body={name:'Такси',request_id};const first=await f.post(body);
 assert.deepEqual((await f.getSettings()).body.data,[]);assert.equal((await f.putReserved(request_id)).status,403);
 for(const [key,row]of f.categories)if(row.id===first.body.data.id)f.categories.delete(key);
 const replay=await f.post(body);assert.equal(replay.status,409);assert.equal(replay.body.error.code,'category_request_deleted');assert.equal(f.own().length,0);assert.equal(f.mappings().length,1);
});

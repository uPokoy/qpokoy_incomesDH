'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Load the unchanged production wrapper with SDK/adapter boundaries substituted.
// Do not pass DriverClass: that would bypass the exact branch being protected.
function harness({readyResults=[true]}={}){
  const actions=[],timers=[],created=[];
  const base={
    async addIncome(row){assert.equal(await this.getIncome(row.user_id,row.id),null);actions.push('insert');return !row.conflict;},
    async getIncome(uid,id){actions.push(['read',uid,id]);return {user_id:uid,id,source:'database'};}
  };
  class Driver{
    constructor(config){created.push(config);this.tableClient={withSession:async callback=>callback({executeQuery:async sql=>{actions.push(sql);return {resultSets:[['users'],['settings']]};}})};}
    async ready(timeout){actions.push(['ready',timeout]);return readyResults.length>1?readyResults.shift():readyResults[0];}
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ydb.js'),'utf8'),{
    module,exports:module.exports,process:{env:{}},Map,
    setTimeout(callback,delay){const timer={callback,delay,unref(){this.unreferenced=true;}};timers.push(timer);return timer;},
    require(name){if(name==='./ydb-core')return {createYdbStore:()=>base};if(name==='ydb-sdk')return {Driver,MetadataAuthService:class{},TypedData:{createNativeObjects:rows=>rows}};throw Error('Unexpected module '+name);}
  });
  return {store:module.exports.createYdbStore({ENDPOINT:'test-endpoint',DATABASE:'/test'}),actions,timers,created};
}
test('production add skips preliminary SELECT and first read consumes cache only once',async()=>{
  const h=harness();const row={user_id:'a',id:'income-1',amount:123};
  assert.equal(await h.store.addIncome(row),true);assert.deepEqual(h.actions,['insert']);
  assert.equal((await h.store.getIncome('a','income-1')).amount,123);assert.deepEqual(h.actions,['insert']);
  assert.equal((await h.store.getIncome('a','income-1')).source,'database');
  assert.deepEqual(h.actions[1],['read','a','income-1']);
  assert.equal(h.timers[0].delay,10000);assert.equal(h.timers[0].unreferenced,true);
});
test('production cache is user-scoped, expires and is not populated on duplicate insert',async()=>{
  const h=harness();await h.store.addIncome({user_id:'a',id:'same',amount:10});
  assert.equal((await h.store.getIncome('b','same')).source,'database');
  h.timers[0].callback();assert.equal((await h.store.getIncome('a','same')).source,'database');
  assert.equal(await h.store.addIncome({user_id:'a',id:'duplicate',conflict:true}),false);
  assert.equal(h.timers.length,1);assert.equal((await h.store.getIncome('a','duplicate')).source,'database');
});
test('production admin driver is lazy, reused and only queries account/billing metadata',async()=>{
  const h=harness();assert.equal(h.created.length,0);
  const result=await h.store.listAdminUsers();
  assert.equal(h.created.length,1);assert.equal(result.users[0],'users');assert.equal(result.settings[0],'settings');
  await h.store.listAdminUsers();assert.equal(h.created.length,1);
  assert.equal(h.actions.filter(x=>Array.isArray(x)&&x[0]==='ready').length,1);
  for(const sql of h.actions.filter(x=>typeof x==='string')){
    assert.match(sql,/FROM `users`/);assert.match(sql,/billing\.access/);assert.doesNotMatch(sql,/FROM `incomes`|FROM `categories`/);
  }
});
test('production admin readiness failure permits a fresh readiness attempt',async()=>{
  const h=harness({readyResults:[false,true]});
  await assert.rejects(h.store.listAdminUsers(),/not ready/);await h.store.listAdminUsers();
  assert.equal(h.actions.filter(x=>Array.isArray(x)&&x[0]==='ready').length,2);
});

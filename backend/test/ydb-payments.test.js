'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TypedValues}=require('ydb-sdk');
const {createYdbStore}=require('../ydb');
function resultSet(rows){const names=Object.keys(rows[0]||{});return {columns:names.map(name=>({name,type:TypedValues.utf8(rows[0][name]).type})),rows:rows.map(row=>({items:names.map(name=>TypedValues.utf8(row[name]).value)}))};}
function fixture(options={}){
  const actions=[],state=new Map();let staged;
  class Driver{
    async ready(){return true;}
    tableClient={withSession:async operation=>operation({
      beginTransaction:async()=>{actions.push('begin');staged=new Map(state);return{id:'payment-tx'};},
      executeQuery:async(sql,params,control)=>{
        actions.push({sql,params,control});if(options.failWrite&&sql.includes('UPSERT'))throw Error('write failed');
        const key=params.$key?.value.textValue;
        if(sql.includes('FROM `users`'))return {resultSets:[resultSet(options.deleted?[]:[{user_id:'user',status:'active'}])]};
        if(sql.includes('SELECT setting_value'))return {resultSets:[resultSet(staged.has(key)?[{setting_value:staged.get(key)}]:[])]};
        if(sql.includes('UPSERT'))staged.set(key,params.$value.value.textValue);return {resultSets:[]};
      },
      commitTransaction:async()=>{if(options.abortOnce){options.abortOnce=false;throw Object.assign(Error('transaction conflict'),{code:400040});}actions.push('commit');state.clear();for(const [k,v] of staged)state.set(k,v);},
      rollbackTransaction:async()=>{actions.push('rollback');staged=null;}
    })};
  }
  return{store:createYdbStore({ENDPOINT:'grpcs://example.invalid',DATABASE:'/test'},Driver),actions,state};
}
test('payment adapter uses scoped bound reads and one serializable commit for marker and access',async()=>{
  const h=fixture(),time=new Date('2026-10-03');h.state.set('billing.order.test','{"status":"pending"}');
  await h.store.withPaymentTransaction('user',async t=>{assert.equal((await t.get('billing.order.test')).status,'pending');await t.put('billing.access',{plan:'monthly'},time);await t.put('billing.order.test',{status:'succeeded'},time);});
  assert.equal(h.actions[0],'begin');assert.equal(h.actions.at(-1),'commit');const queries=h.actions.filter(x=>x.sql);assert.ok(queries.every(q=>q.control.txId==='payment-tx'&&q.params.$uid.value.textValue==='user'));assert.ok(queries.every(q=>!q.sql.includes('incomes')&&!q.sql.includes('categories')));assert.equal(JSON.parse(h.state.get('billing.order.test')).status,'succeeded');
});
test('adapter rolls back failed writes and skips deleted accounts instead of recreating settings',async()=>{
  const h=fixture({failWrite:true});await assert.rejects(h.store.withPaymentTransaction('user',t=>t.put('billing.access',{},new Date())));assert.equal(h.state.size,0);assert.equal(h.actions.at(-1),'rollback');
  const d=fixture({deleted:true});assert.equal(await d.store.withPaymentTransaction('user',()=>{throw Error('must not run');}),null);assert.equal(d.state.size,0);
});
test('ABORTED retries re-read state; corrupt durable payment state fails closed',async()=>{
  const h=fixture({abortOnce:true});h.state.set('billing.order.test','{"count":0}');let evaluations=0;
  await h.store.withPaymentTransaction('user',async t=>{evaluations++;const value=await t.get('billing.order.test');await t.put('billing.order.test',{count:value.count+1},new Date());});assert.equal(evaluations,2);assert.equal(JSON.parse(h.state.get('billing.order.test')).count,1);assert.ok(h.actions.includes('rollback'));
  h.state.set('billing.order.bad','not JSON');await assert.rejects(h.store.withPaymentTransaction('user',t=>t.get('billing.order.bad')));assert.equal(h.state.get('billing.order.bad'),'not JSON');
});

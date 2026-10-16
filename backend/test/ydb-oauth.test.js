'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TypedValues}=require('ydb-sdk');
const {createYdbStore}=require('../ydb');
function fixture({failDelete=false}={}){
  let value='ticket-value',revision=0,next=0;const transactions=new Map(),calls=[];
  class Driver{
    async ready(){return true;}
    tableClient={withSession:async callback=>callback({
      beginTransaction:async options=>{assert.deepEqual(options,{serializableReadWrite:{}});const id=String(++next);transactions.set(id,{value,revision,deleted:false});return {id};},
      executeQuery:async(sql,params,control)=>{
        calls.push({sql,control});assert.ok(control?.txId);assert.equal(params.$key.value.textValue,'auth.oauth_ticket');
        const tx=transactions.get(control.txId);
        if(sql.includes('SELECT setting_value')){const typed=TypedValues.utf8(tx.value||'');return {resultSets:[{columns:[{name:'setting_value',type:typed.type}],rows:tx.value===null?[]:[{items:[typed.value]}]}]};}
        assert.match(sql,/DELETE FROM `settings`/);if(failDelete)throw new Error('injected delete failure');tx.deleted=true;return {resultSets:[]};
      },
      commitTransaction:async control=>{const tx=transactions.get(control.txId);if(tx.revision!==revision)throw Object.assign(new Error('ABORTED'),{code:400040});if(tx.deleted){value=null;revision++;}transactions.delete(control.txId);},
      rollbackTransaction:async control=>{transactions.delete(control.txId);}
    })};
  }
  return {store:createYdbStore({ENDPOINT:'grpcs://fixture.invalid',DATABASE:'/fixture'},Driver),calls,get value(){return value;},get active(){return transactions.size;}};
}
test('OAuth YDB consume retries serializable conflict and allows exactly one parallel winner',async()=>{
  const f=fixture();const results=await Promise.all([f.store.consumeOAuthTicket('u','auth.oauth_ticket','ticket-value'),f.store.consumeOAuthTicket('u','auth.oauth_ticket','ticket-value')]);
  assert.deepEqual(results.sort(),[false,true]);assert.equal(f.value,null);assert.equal(f.active,0);
  assert.equal(f.calls.filter(c=>c.sql.includes('SELECT setting_value')).length,3);
});
test('OAuth YDB consume does not delete mismatched ticket and rolls back failed delete',async()=>{
  const f=fixture();assert.equal(await f.store.consumeOAuthTicket('u','auth.oauth_ticket','wrong'),false);assert.equal(f.value,'ticket-value');
  assert.equal(f.calls.filter(c=>c.sql.includes('DELETE')).length,0);
  const broken=fixture({failDelete:true});await assert.rejects(broken.store.consumeOAuthTicket('u','auth.oauth_ticket','ticket-value'),/injected/);assert.equal(broken.value,'ticket-value');assert.equal(broken.active,0);
});
test('OAuth consume cannot target arbitrary user settings',async()=>{const f=fixture();await assert.rejects(f.store.consumeOAuthTicket('u','theme','ticket-value'),/Invalid OAuth ticket key/);assert.equal(f.calls.length,0);});

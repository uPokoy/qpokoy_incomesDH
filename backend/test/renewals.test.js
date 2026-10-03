'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRenewalWorker,handler}=require('../renewals');
test('worker is disabled by default, without enforcement or before launch and cannot be invoked as HTTP',async()=>{
  const store={listPaymentRenewalUsers:async()=>{throw Error('must not scan');}},router={renewUser:async()=>{throw Error('must not charge');}};
  for(const options of [{},{enabled:true},{enabled:true,billingEnforcementStartedAt:'2030-01-01'}])assert.deepEqual(await createRenewalWorker(store,router,{...options,now:()=>new Date('2026-10-03')})(),{disabled:true});
  const run=createRenewalWorker(store,router,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:()=>new Date('2026-10-03')});await assert.rejects(run({httpMethod:'POST'}),/not be public/);
  assert.deepEqual(await handler(),{disabled:true});
});
test('worker scans only billing candidates, isolates failures, paginates and reports a bounded continuation',async()=>{
  const ids=Array.from({length:501},(_,i)=>String(i).padStart(8,'0')+'-1111-4111-8111-111111111111');let calls=[];
  const store={listPaymentRenewalUsers:async(after)=>ids.filter(id=>id>after).slice(0,100).map(user_id=>({user_id}))};
  const router={renewUser:async id=>{calls.push(id);if(id===ids[4])throw Error('private failure');return id===ids[0]?{skipped:true}:{status:'succeeded'};}};
  const run=createRenewalWorker(store,router,{enabled:true,billingEnforcementStartedAt:'2026-10-01',now:()=>new Date('2026-10-03')});
  const first=await run();assert.equal(first.checked,500);assert.equal(first.processed,498);assert.equal(first.failed,1);assert.equal(first.next_cursor,ids[499]);assert.equal(calls.length,500);
  const next=await run({cursor:first.next_cursor});assert.equal(next.checked,1);assert.equal(next.next_cursor,null);
});

test('worker returns continuation at its time budget rather than losing batch progress',async()=>{
  const ids=['00000001-1111-4111-8111-111111111111','00000002-1111-4111-8111-111111111111'];let elapsed=0,calls=0;
  const run=createRenewalWorker({listPaymentRenewalUsers:async()=>ids.map(user_id=>({user_id}))},{renewUser:async()=>{calls++;elapsed=11;return {skipped:true};}},
    {enabled:true,billingEnforcementStartedAt:'2026-10-01',now:()=>new Date('2026-10-03'),elapsedNow:()=>elapsed,budgetMs:10});
  const result=await run();assert.equal(result.checked,1);assert.equal(result.next_cursor,ids[0]);assert.equal(calls,1);
});

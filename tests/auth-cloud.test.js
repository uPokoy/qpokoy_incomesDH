'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8');
const user={user_id:'user-1',email:'test@example.com'};
const oldRow={id:'11111111-1111-4111-8111-111111111111',user_id:user.user_id,income_date:'2026-09-01',category:'Зарплата',description:'Старый',amount:50};
const otherEntry={userId:'user-2',kind:'add',record:{id:'22222222-2222-4222-8222-222222222222',date:'02.09.26',category:'Зарплата',description:'Другой пользователь',amount:20}};
const journalKey='qPokoyIncomeWriteJournalV1';

function setup(overrides={}){
  const values=new Map([[journalKey,JSON.stringify([otherEntry])]]);
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      id,hidden:false,disabled:false,textContent:'',className:'',value:'',listeners:{},
      classList:{toggle(){}},
      addEventListener(name,handler){this.listeners[name]=handler;},
      querySelector(){return {textContent:''};}
    });
    return nodes.get(id);
  }
  const document={getElementById:node,querySelectorAll:()=>[],body:{classList:{toggle(){}}}};
  let records=[];
  const saves=[];
  const notices=[];
  const calls=[];
  let categoryLoads=0;
  let confirmation=null;
  const api={
    setUnauthorizedHandler(){},
    async restoreSession(){return user;},
    async listIncomes(){calls.push('list');return [oldRow];},
    async replaceIncomes(rows){calls.push({replace:rows});return rows.map((row,i)=>({...row,id:row.id||`33333333-3333-4333-8333-33333333333${i}`,user_id:user.user_id}));},
    async deleteAllIncomes(){calls.push('deleteAll');},
    async deleteAccount(){calls.push('deleteAccount');},
    ...overrides
  };
  const win={qPokoyApi:api,qPokoyLoadCategories:async()=>{categoryLoads++;},qPokoyNotice:(...args)=>notices.push(args),qPokoyConfirm:(title,message,callback)=>{confirmation=callback;},addEventListener(){}};
  const store={load:()=>records,save(next){records=next;saves.push(next);}};
  vm.runInNewContext(source,{window:win,document,localStorage:storage,IncomeStore:store,console:{error(){}},Date,Promise});
  return {win,api,values,nodes,notices,calls,saves,get records(){return records;},get categoryLoads(){return categoryLoads;},confirm:()=>confirmation()};
}
async function ready(h){
  for(let i=0;i<10&&!h.nodes.get('qpAuthGate').hidden;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.nodes.get('qpAuthGate').hidden,true);
}

test('backup import replaces in one call and preserves another user journal',async()=>{
  const h=setup();
  await ready(h);
  const replacement={id:'55555555-5555-4555-8555-555555555555',date:'15.09.26',category:'Зарплата',description:'Новый',amount:100};
  const withoutId={id:'old-id',date:'16.09.26',category:'Подработка',description:'Ещё один',amount:200};
  assert.equal(await h.win.qPokoyCloudRestoreBackup([replacement,withoutId]),true);
  const replace=h.calls.filter(x=>typeof x==='object'&&x.replace);
  assert.equal(replace.length,1);
  assert.equal(replace[0].replace[0].income_date,'2026-09-15');
  assert.equal(replace[0].replace[0].id,replacement.id);
  assert.equal(replace[0].replace[0].user_id,undefined);
  assert.equal(replace[0].replace[1].id,undefined);
  assert.equal(replace[0].replace[1].description,'Ещё один');
  assert.equal(h.records.length,2);
  assert.equal(h.records[0].description,'Новый');
  assert.equal(JSON.parse(h.values.get(journalKey)).length,1);
});

test('failed or invalid backup import keeps previous income data',async()=>{
  const h=setup({async replaceIncomes(){throw new Error('offline');}});
  await ready(h);
  const before=JSON.stringify(h.records);
  assert.equal(await h.win.qPokoyCloudRestoreBackup([{date:'15.09.26',category:'Зарплата',amount:100}]),false);
  assert.equal(JSON.stringify(h.records),before);
  assert.equal(await h.win.qPokoyCloudRestoreBackup([{date:'31.02.26',category:'Зарплата',amount:100}]),false);
  assert.equal(JSON.stringify(h.records),before);
});

test('delete all clears UI only after server confirmation',async()=>{
  let fail=true;
  const h=setup({async deleteAllIncomes(){if(fail)throw new Error('offline');}});
  await ready(h);
  const categoryLoads=h.categoryLoads;
  assert.equal(await h.win.qPokoyCloudDeleteAll(),false);
  assert.equal(h.records.length,1);
  fail=false;
  assert.equal(await h.win.qPokoyCloudDeleteAll(),true);
  assert.equal(h.records.length,0);
  assert.equal(h.categoryLoads,categoryLoads);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry]);
});

test('unsynced journal blocks replace and delete without losing local data',async()=>{
  const h=setup({async addIncome(){throw new Error('offline');}});
  await ready(h);
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  h.values.set(journalKey,JSON.stringify([otherEntry,ownEntry]));
  assert.equal(await h.win.qPokoyCloudRestoreBackup([{date:'15.09.26',category:'Зарплата',amount:100}]),false);
  assert.equal(await h.win.qPokoyCloudDeleteAll(),false);
  assert.equal(h.records.length,1);
  assert.equal(h.calls.some(x=>typeof x==='object'&&x.replace),false);
  assert.equal(h.calls.includes('deleteAll'),false);
  assert.equal(JSON.parse(h.values.get(journalKey)).length,2);
});

test('successful replace and delete drain only the current user journal',async()=>{
  const h=setup({async addIncome(row){return row;}});
  await ready(h);
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  h.values.set(journalKey,JSON.stringify([otherEntry,ownEntry]));
  assert.equal(await h.win.qPokoyCloudRestoreBackup([{date:'15.09.26',category:'Зарплата',amount:100}]),true);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry]);
  h.values.set(journalKey,JSON.stringify([otherEntry,ownEntry]));
  assert.equal(await h.win.qPokoyCloudDeleteAll(),true);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry]);
  assert.equal(h.records.length,0);
});

test('account deletion leaves UI on failure and clears own journal on success',async()=>{
  let fail=true;
  const h=setup({async deleteAccount(){if(fail)throw new Error('offline');}});
  await ready(h);
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  h.values.set(journalKey,JSON.stringify([otherEntry,ownEntry]));
  h.nodes.get('qpAuthDeleteAccountBtn').listeners.click();
  await h.confirm();
  assert.equal(h.nodes.get('qpAuthGate').hidden,true);
  assert.equal(h.records.length,1);
  assert.equal(JSON.parse(h.values.get(journalKey)).length,2);
  fail=false;
  h.nodes.get('qpAuthDeleteAccountBtn').listeners.click();
  await h.confirm();
  assert.equal(h.nodes.get('qpAuthGate').hidden,false);
  assert.equal(h.records.length,0);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry]);
});

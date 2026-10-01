'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createApiClient,TOKEN_KEY,BOOTSTRAP_CACHE_KEY}=require('../js/api-client');

const source=fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8');
const user={user_id:'user-1',email:'test@example.com'};
const oldRow={id:'11111111-1111-4111-8111-111111111111',user_id:user.user_id,income_date:'2026-09-01',category:'Зарплата',description:'Старый',amount:50};
const otherEntry={userId:'user-2',kind:'add',record:{id:'22222222-2222-4222-8222-222222222222',date:'02.09.26',category:'Зарплата',description:'Другой пользователь',amount:20}};
const journalKey='qPokoyIncomeWriteJournalV1';

function setup(overrides={},options={}){
  const values=options.values||new Map([[journalKey,JSON.stringify(options.journal||[otherEntry])]]);
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      id,hidden:false,disabled:false,textContent:'',className:'',value:'',listeners:{},
      classList:{toggle(){}},
      checkValidity(){return true;},
      reset(){},
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
  const api=options.apiFactory?options.apiFactory(storage):{
    setUnauthorizedHandler(){},
    async bootstrap(){calls.push('bootstrap');return {user,incomes:[oldRow],categories:[],settings:[]};},
    async listIncomes(){calls.push('list');return [oldRow];},
    async replaceIncomes(rows){calls.push({replace:rows});return rows.map((row,i)=>({...row,id:row.id||`33333333-3333-4333-8333-33333333333${i}`,user_id:user.user_id}));},
    async deleteAllIncomes(){calls.push('deleteAll');},
    async deleteAccount(){calls.push('deleteAccount');},
    async logout(){calls.push('logout');},
    ...overrides
  };
  const win={qPokoyApi:api,qPokoyLoadCategories:async(user,rows)=>{categoryLoads++;calls.push({categories:rows});},renderIncomes:()=>calls.push('renderIncomes'),qPokoyNotice:(...args)=>notices.push(args),qPokoyConfirm:(title,message,callback)=>{confirmation=callback;},qPokoyConfirmPhrase:(title,message,phrase,callback)=>{confirmation=callback;},addEventListener(){}};
  const store={load:()=>records,save(next){records=next;saves.push(next);}};
  vm.runInNewContext(source,{window:win,document,localStorage:storage,IncomeStore:store,console:{error(){}},Date,Promise,
    URLSearchParams,URL,location:{search:options.search||'',href:'https://qpokoy.ru/'+(options.search||'')},history:{replaceState(){}}});
  return {win,api,values,nodes,notices,calls,saves,get records(){return records;},get categoryLoads(){return categoryLoads;},confirm:()=>confirmation()};
}
async function ready(h){
  for(let i=0;i<10&&!h.nodes.get('qpAuthGate').hidden;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.nodes.get('qpAuthGate').hidden,true);
}

test('startup consumes bootstrap data with no legacy GETs and exposes settings',async()=>{
  const settings=[{setting_key:'theme',setting_value:'dark'}];
  let requests=0;
  const h=setup({async bootstrap(){requests++;return {user,incomes:[oldRow],categories:[{id:'c1',name:'Зарплата'}],settings};}});
  await ready(h);
  assert.equal(requests,1);
  assert.equal(h.calls.includes('list'),false);
  assert.equal(h.calls.find(x=>x.categories)?.categories[0].name,'Зарплата');
  assert.equal(h.win.qPokoyAuth.getSettings()[0].setting_value,'dark');
});

test('cached bootstrap reconciles a server-saved journal entry without duplicate INSERT',async()=>{
  const requests=[];
  const values=new Map([[TOKEN_KEY,'session.secret'],[journalKey,JSON.stringify([otherEntry])]]);
  const apiFactory=storage=>createApiClient({storage,fetchImpl:async(url,init)=>{
    requests.push({url,method:init.method});
    assert.equal(init.method,'GET'); // No duplicate add/update during recovery.
    assert.ok(url.includes('/bootstrap'));
    const body=url.includes('?revision=revision-a')?{user,revision:'revision-a',not_modified:true}
      :{user,revision:'revision-a',not_modified:false,incomes:[oldRow],categories:[],settings:[]};
    return {ok:true,status:200,text:async()=>JSON.stringify(body)};
  }});
  const first=setup({}, {values,apiFactory});
  await ready(first);
  assert.ok(values.has(BOOTSTRAP_CACHE_KEY));
  const savedEntry={userId:user.user_id,kind:'add',record:{id:oldRow.id,date:'01.09.26',category:oldRow.category,description:oldRow.description,amount:oldRow.amount}};
  values.set(journalKey,JSON.stringify([otherEntry,savedEntry]));
  const reload=setup({}, {values,apiFactory});
  await ready(reload);
  assert.equal(requests.length,2);
  assert.ok(requests[1].url.endsWith('?revision=revision-a'));
  assert.equal(reload.records.length,1);
  assert.deepEqual(JSON.parse(values.get(journalKey)),[otherEntry]);
});

test('cached startup preserves unsaved pending journal and DEV138 unlocks UI before sync finishes',async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  const h=setup({async addIncome(){await pending;throw new Error('offline');}}, {journal:[otherEntry,ownEntry]});
  await ready(h);
  assert.equal(h.records.length,2);
  assert.equal(h.nodes.get('qpAuthGate').hidden,true);
  finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry,ownEntry]);
});

test('email login and OAuth ticket both initialize through bootstrap',async()=>{
  const h=setup({async login(){return user;}});
  await ready(h);
  h.nodes.get('qpAuthEmail').value=user.email;
  h.nodes.get('qpAuthPassword').value='test-password';
  const form=h.nodes.get('qpAuthForm');
  await form.listeners.submit({preventDefault(){},currentTarget:form});
  assert.equal(h.calls.filter(x=>x==='bootstrap').length,2);
  assert.equal(h.calls.includes('list'),false);
  const oauth=setup({async exchangeOAuthTicket(){return user;}},{search:'?oauth_ticket=test-ticket'});
  await ready(oauth);
  assert.equal(oauth.calls.filter(x=>x==='bootstrap').length,1);
  assert.equal(oauth.calls.includes('list'),false);
});

test('startup attempts a failing pending write once and keeps its journal',async()=>{
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  let attempts=0;
  const h=setup({async addIncome(){attempts++;throw new Error('offline');}},{journal:[otherEntry,ownEntry]});
  await ready(h);
  assert.equal(attempts,1);
  assert.equal(h.records.length,2);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry,ownEntry]);
});

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

test('logout clears local income state and refreshes the income DOM immediately',async()=>{
  const h=setup();
  await ready(h);
  assert.equal(h.records.length,1);
  const beforeRenders=h.calls.filter(x=>x==='renderIncomes').length;
  h.nodes.get('qpAuthLogoutBtn').listeners.click();
  await h.confirm();
  assert.equal(h.calls.includes('logout'),true);
  assert.equal(h.records.length,0);
  assert.equal(h.values.has('incomes'),true);
  assert.equal(h.values.get('incomes'),'[]');
  assert.ok(h.calls.filter(x=>x==='renderIncomes').length>beforeRenders);
  assert.equal(h.nodes.get('qpAuthGate').hidden,false);
});

test('account deletion leaves UI on failure and clears own journal on success',async()=>{
  let fail=true;
  const h=setup({async deleteAccount(){if(fail)throw new Error('offline');}});
  await ready(h);
  const ownEntry={userId:user.user_id,kind:'add',record:{id:'44444444-4444-4444-8444-444444444444',date:'03.09.26',category:'Зарплата',description:'Ожидает',amount:30}};
  h.values.set(journalKey,JSON.stringify([otherEntry,ownEntry]));
  h.nodes.get('qpAuthDeleteAccountBtn').listeners.click();
  await h.confirm();
  await h.confirm();
  assert.equal(h.nodes.get('qpAuthGate').hidden,true);
  assert.equal(h.records.length,1);
  assert.equal(JSON.parse(h.values.get(journalKey)).length,2);
  fail=false;
  h.nodes.get('qpAuthDeleteAccountBtn').listeners.click();
  await h.confirm();
  await h.confirm();
  assert.equal(h.nodes.get('qpAuthGate').hidden,false);
  assert.equal(h.records.length,0);
  assert.deepEqual(JSON.parse(h.values.get(journalKey)),[otherEntry]);
});

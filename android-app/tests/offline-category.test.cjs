'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {create,incomeValue}=require('../android/app/src/main/assets/android-read-cache.js');
const clone=value=>structuredClone(value);
const failure=(status,code)=>Object.assign(new Error(code||'test failure'),{status,code});

function fixture(){
  let uid='A',token='session-A',online=true,gate=null,lostDelete=false,fault=null,bootstrapGate=null,ui=[];
  let lostCategoryDelete=false;const categoryDeletes=[];
  let bootstraps=0,identities=0,categoryFault=null,lostCategory=false,categoryGate=null;
  const categories=new Map(),categoryRequests=new Map(),categoryPosts=[],order=[];
  const snapshots=new Map(),queue=new Map(),server=new Map(),posts=[],updates=[],deletes=[],writes=[],renders=[];
  const data=()=>({user:{user_id:uid,email:'a@test.invalid',onboarding_completed:true},incomes:[...server.values()].filter(row=>row.user_id===uid),categories:[{id:'category-A',user_id:uid,name:'Test'},...[...categories.values()].filter(row=>row.user_id===uid)],settings:[]});
  const listed=(hash,id)=>[...queue.values()].filter(row=>row.hash===hash&&row.user_id===id).map(({hash,...row})=>clone(row));
  const db={
    read:async({sessionHash:hash})=>{const saved=snapshots.get(hash);return {snapshot:saved?clone(saved):null,pending:saved?listed(hash,saved.user.user_id):[]};},
    write:async({sessionHash:hash,snapshot:saved,deleteAck,categoryAck})=>{
      writes.push(clone(saved));
      snapshots.clear();snapshots.set(hash,clone(saved));
      for(const [key,row] of [...queue])if(row.user_id===saved.user.user_id){
        row.hash=hash;if(row.kind==='category_add'){if(categoryAck?.request_id===row.request_id){assert.ok(saved.categories.some(cat=>cat.id===categoryAck.category_id&&cat.name===row.name));if(row.delete_requested)Object.assign(row,{kind:'category_delete',category_id:categoryAck.category_id,sent:0,status:'pending',attempts:0,next_attempt_at:0,error_code:''});else queue.delete(key);}continue;}if(row.kind==='category_delete'){if(categoryAck?.deleted&&categoryAck.request_id===key)queue.delete(key);continue;}const confirmed=saved.incomes.find(item=>item.id===row.income_id);
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
    enqueueCategory:async({sessionHash:hash,userId,category})=>{
      assert.equal(snapshots.get(hash)?.user.user_id,userId);
      const nameKey=category.name.toLocaleLowerCase('ru-RU');
      if([...queue.values()].some(row=>row.user_id===userId&&row.kind==='category_add'&&row.name.toLocaleLowerCase('ru-RU')===nameKey))throw Error('duplicate category');
      queue.set(category.request_id,{...clone(category),operation_id:category.request_id,hash,user_id:userId,kind:'category_add',sent:0,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      return {pending:listed(hash,userId)};
    },
    enqueueCategoryDelete:async({sessionHash:hash,userId,categoryId,operationId,createdAt})=>{
      assert.equal(snapshots.get(hash)?.user.user_id,userId);
      const old=[...queue.values()].find(row=>row.hash===hash&&row.user_id===userId&&(row.request_id===categoryId||row.category_id===categoryId));
      if(old){
        if(old.delete_requested)return {pending:listed(hash,userId)};
        if(!old.sent&&!old.attempts&&![...queue.values()].some(row=>['add','update'].includes(row.kind)&&row.user_id===userId&&row.category===old.name))queue.delete(old.operation_id);
        else old.delete_requested=1;
      }else{
        const cat=snapshots.get(hash).categories.find(row=>row.id===categoryId);assert.ok(cat);
        queue.set(operationId,{operation_id:operationId,request_id:operationId,hash,user_id:userId,name:cat.name,kind:'category_delete',category_id:categoryId,delete_requested:1,created_at:createdAt,sent:0,status:'pending',attempts:0,next_attempt_at:0,error_code:''});
      }
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
      order.push('income');posts.push(clone(row));if(gate)await gate;
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
    request:async(method,path,body)=>{
      assert.equal(method,'POST');assert.equal(path,'/categories');assert.deepEqual(Object.keys(body).sort(),['name','request_id']);
      order.push('category');categoryPosts.push(clone(body));if(categoryGate)await categoryGate;
      if(categoryFault)throw failure(categoryFault.status,categoryFault.code);
      const key=uid+':'+body.request_id,old=categoryRequests.get(key);
      if(old&&old.name!==body.name)throw failure(409,'idempotency_conflict');
      const row=old||{id:randomUUID(),user_id:uid,name:body.name};
      categories.set(row.id,row);categoryRequests.set(key,row);
      if(lostCategory){lostCategory=false;throw failure(0,'android_transport');}
      return {data:clone(row)}; // API unwraps both HTTP 201 and 200.
    },
    addCategory:async()=>{throw Error('legacy category path must not run');},
    deleteCategory:async id=>{
      categoryDeletes.push(id);order.push('category_delete');
      if(!categories.has(id)||categories.get(id).user_id!==uid)throw failure(404,'not_found');
      categories.delete(id);
      if(lostCategoryDelete){lostCategoryDelete=false;throw failure(0,'android_transport');}
    },
    deleteAllIncomes:async()=>{},replaceIncomes:async()=>{}
  };
  const events=new Map(),listen=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
  const view={IncomeStore:{load:()=>ui,save:rows=>ui=rows},document:{addEventListener:listen,visibilityState:'visible'},addEventListener:listen,setTimeout:()=>{},applyIncomeHeaderFilters:()=>{},renderIncomeAnalytics:()=>{},qPokoyNotice:()=>{}};
  const originals={...api};
  const hydrate=async payload=>{renders.push(clone(payload));return view.IncomeStore.save(payload?payload.incomes.map(row=>({id:row.id,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description})):[]);};
  let cache;
  function fresh(){Object.assign(api,originals);cache=create({api,db,fingerprint:async value=>(value==='session-A'?'a':'b').repeat(64),online:()=>online,networkState:async()=>({state:online?'online':'offline'})});cache.install(view);}
  fresh();
  return {api,db,server,queue,categoryDeletes,setLostCategoryDelete:value=>lostCategoryDelete=value,posts,updates,deletes,writes,renders,snapshots,view,categories,categoryRequests,categoryPosts,order,
    setCategoryFault:value=>categoryFault=value,setLostCategory:value=>lostCategory=value,setCategoryGate:value=>categoryGate=value,
    switchUser:value=>{uid=value;token="session-"+value;},get bootstraps(){return bootstraps;},get identities(){return identities;},get cache(){return cache;},get ui(){return ui;},
    event:name=>events.get(name)?.forEach(fn=>fn()),click:event=>events.get('click')?.forEach(fn=>fn(event)),
    setOnline:value=>online=value,setGate:value=>gate=value,setLostDelete:value=>lostDelete=value,setFault:value=>fault=value,setBootstrapGate:value=>bootstrapGate=value,fresh,
    start:()=>cache.start(hydrate),add:amount=>view.IncomeStore.add({id:randomUUID(),date:'10.10.26',amount,category:'Test',description:'Fixture'})};
}


const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function ready(t){const f=fixture();t.after(()=>f.cache.purge());await f.start();f.setOnline(false);return f;}

test('offline category commit returns local row, renders after reload and is selectable by income',async t=>{
 const f=await ready(t),category=await f.api.addCategory('  Такси   город  ');
 assert.equal(category.name,'Такси город');assert.equal(f.categoryPosts.length,0);assert.equal(f.queue.size,1);
 assert.equal(f.cache.pending[0].request_id,category.id);
 f.fresh();await f.start();assert.ok(f.renders.at(-1).categories.some(row=>row.name==='Такси город'));
 await f.view.IncomeStore.add({date:'10.10.26',amount:12,category:category.name,description:'offline'});
 assert.equal(f.ui[0].category,category.name);assert.equal(f.queue.size,2);
});
test('category UI waits for SQLite commit, never for network; failed commit has no success',async t=>{
 const f=await ready(t),enqueue=f.db.enqueueCategory;let release;
 f.db.enqueueCategory=async args=>{await new Promise(resolve=>release=resolve);return enqueue(args);};
 let done=false;const saving=f.api.addCategory('Такси').then(row=>{done=true;return row;});await tick();
 assert.equal(done,false);assert.equal(f.cache.pending.length,0);assert.equal(f.categoryPosts.length,0);
 release();await saving;assert.equal(done,true);assert.equal(f.cache.pending.length,1);
 f.db.enqueueCategory=async()=>{throw Error('SQLite unavailable');};await assert.rejects(f.api.addCategory('Other'),/SQLite/);assert.equal(f.queue.size,1);
});
test('pending request_id persists across simulated process death and WebView reload',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');const original=f.cache.pending[0].request_id;
 // Serialize the durable rows so no objects from the original coordinator survive.
 const durable=JSON.parse(JSON.stringify([...f.queue]));f.queue.clear();for(const [key,row] of durable)f.queue.set(key,row);
 for(let i=0;i<2;i++){f.fresh();await f.start();assert.equal(f.cache.pending[0].request_id,original);assert.ok(f.renders.at(-1).categories.some(row=>row.name==='Такси'));}
});
test('reconnect event automatically syncs category before dependent income without pull',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');await f.view.IncomeStore.add({date:'10.10.26',amount:15,category:'Такси',description:'offline'});
 f.setOnline(true);f.event('online');for(let i=0;i<15&&f.queue.size;i++)await tick();
 assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);assert.equal(f.server.size,1);assert.deepEqual(f.order,['category','income']);assert.equal([...f.server.values()][0].category,'Такси');
});
test('201 category success replaces temporary ID and clears pending atomically',async t=>{
 const f=await ready(t),local=await f.api.addCategory('Такси');f.setOnline(true);await f.cache.refresh();
 assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);assert.notEqual(f.cache.snapshot.categories.find(row=>row.name==='Такси').id,local.id);
});
test('lost response retains intent; 200 replay reuses exact request_id and cannot duplicate',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');const request=f.cache.pending[0].request_id;
 f.setLostCategory(true);f.setOnline(true);await f.cache.refresh();assert.equal(f.queue.size,1);assert.equal(f.categories.size,1);
 // Even an authoritative bootstrap with a matching name must not clear the request.
 await f.api.bootstrap();assert.equal(f.queue.size,1);
 await f.cache.manualSync();assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);
 assert.equal(f.categoryPosts.length,2);assert.ok(f.categoryPosts.every(row=>row.request_id===request));
});
test('lost response then process restart preserves request UUID and retries safely',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');f.setLostCategory(true);f.setOnline(true);await f.cache.refresh();
 const request=f.cache.pending[0].request_id;f.setOnline(false);f.fresh();await f.start();f.setOnline(true);await f.cache.manualSync();
 assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);assert.ok(f.categoryPosts.every(row=>row.request_id===request));
});
test('409 idempotency_conflict is durable, blocks dependent income and does not spin retry',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');await f.view.IncomeStore.add({date:'10.10.26',amount:20,category:'Такси',description:''});
 f.setCategoryFault({status:409,code:'idempotency_conflict'});f.setOnline(true);await f.cache.refresh();
 const category=f.cache.pending.find(row=>row.kind==='category_add');assert.equal(category.status,'error');assert.equal(category.error_code,'idempotency_conflict');assert.equal(f.posts.length,0);
 await Promise.all([f.cache.syncPending(),f.cache.syncPending(),f.cache.manualSync()]);assert.equal(f.categoryPosts.length,1);assert.equal(f.queue.size,2);
});
for(const status of [401,403,408,429,500,503])test('category failure '+status+' retains account-bound pending with safe status',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');f.setCategoryFault({status,code:'test'});f.setOnline(true);await f.cache.refresh();
 assert.equal(f.queue.size,1);assert.equal(f.cache.pending[0].status,status===401?'auth_required':[403].includes(status)?'error':'pending');
});
test('local validation retains normalization, 80 limit and duplicate behavior for server/pending',async t=>{
 const f=await ready(t);for(const name of ['', '  ',null,42,'a'.repeat(81)])await assert.rejects(f.api.addCategory(name));
 await assert.rejects(f.api.addCategory(' test '),/существует/);
 await f.api.addCategory('Такси');await assert.rejects(f.api.addCategory('  ТАКСИ  '),/существует/);assert.equal(f.queue.size,1);
 const results=await Promise.allSettled([f.api.addCategory('Sales'),f.api.addCategory('SALES')]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.queue.size,2);
});
test('several categories and dependent incomes preserve order and sync once',async t=>{
 const f=await ready(t);for(const name of ['Такси','Продажи','Другое']){await f.api.addCategory(name);await f.view.IncomeStore.add({date:'10.10.26',amount:25,category:name,description:''});}
 f.setOnline(true);await f.cache.refresh();await f.cache.manualSync();
 assert.equal(f.queue.size,0);assert.equal(f.categories.size,3);assert.equal(f.server.size,3);assert.deepEqual(f.order,['category','category','category','income','income','income']);
});
test('transient category failure blocks dependent income until retry succeeds',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');await f.view.IncomeStore.add({date:'10.10.26',amount:25,category:'Такси',description:''});
 f.setCategoryFault({status:500});f.setOnline(true);await f.cache.refresh();assert.equal(f.posts.length,0);
 f.setCategoryFault(null);await f.cache.manualSync();assert.equal(f.queue.size,0);assert.equal(f.server.size,1);
});
test('old bootstrap captured before category ACK cannot replace confirmed category',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');f.setOnline(true);await f.api.restoreSession();
 // Validate session without sending (hold the category request during refresh).
 let release;f.setCategoryGate(new Promise(resolve=>release=resolve));const syncing=f.cache.refresh();await tick();
 let releaseBootstrap;f.setBootstrapGate(new Promise(resolve=>releaseBootstrap=resolve));const stale=f.api.bootstrap();await tick();
 f.setCategoryGate(null);release();await syncing;f.setBootstrapGate(null);releaseBootstrap();await stale.catch(()=>{});
 assert.equal(f.queue.size,0);assert.equal(f.cache.snapshot.categories.filter(row=>row.name==='Такси').length,1);
});
test('logout guard covers categories; user switch cannot send or display another user pending',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');await assert.rejects(f.api.logout(),error=>error.code==='android_pending_logout');
 await f.cache.purge();f.switchUser('B');f.fresh();f.setOnline(true);await f.start();await f.cache.manualSync();
 assert.equal(f.categoryPosts.length,0);assert.equal(f.cache.pending.length,0);assert.ok(!f.renders.at(-1).categories.some(row=>row.name==='Такси'));assert.equal(f.queue.size,1);
 await f.cache.purge();f.switchUser('A');f.fresh();await f.start();assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);
});

for(const status of [201,200])test('real bundled HTTP client accepts category '+status+' with DEV422 request_id',async t=>{
 const {createApiClient,TOKEN_KEY}=require('../www/js/api-client.js'),f=await ready(t),calls=[];
 const client=createApiClient({baseUrl:'https://fixture.invalid',storage:{getItem:key=>key===TOKEN_KEY?'session-A':null,removeItem:()=>{}},fetchImpl:async(url,options)=>{
  calls.push({url,options});return new Response(JSON.stringify({data:{id:randomUUID(),user_id:'A',name:'Такси'}}),{status});
 }});
 // Feed real HTTP serialization and status handling into the existing coordinator.
 const cache=create({api:{...f.api,request:client.request},db:f.db,fingerprint:async()=> 'a'.repeat(64),online:()=>true});t.after(()=>cache.purge());
 await cache.start(async()=>{});await cache.enqueueCategory('Такси');await cache.syncPending();
 assert.equal(cache.pending.length,0);assert.equal(calls.length,1);const body=JSON.parse(calls[0].options.body);
 assert.match(body.request_id,/^[a-f0-9-]{36}$/);assert.equal(body.name,'Такси');assert.equal(calls[0].options.headers.Authorization,'Bearer session-A');
});

test('existing category form adds exactly one local option without duplicate hydration',async t=>{
 const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),f=await ready(t);
 const dom=new JSDOM('<section id="settings"><div class="settings-card"></div></section><input id="incomeCategory"><span id="categoryValue"></span><button id="categorySelect"></button><div id="categoryPopup"></div>',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const w=dom.window;w.matchMedia=()=>({matches:false,addEventListener:()=>{}});w.qPokoyApi=f.api;w.qPokoyNotice=()=>{};
 w.eval(fs.readFileSync(path.join(__dirname,'../www/js/categories.js'),'utf8'));
 await w.qPokoyLoadCategories({id:'A'},[{id:'category-A',user_id:'A',name:'Test'}]);
 w.document.querySelector('#qpCategoryInput').value='Такси';w.document.querySelector('#qpCategoryAddBtn').click();
 for(let i=0;i<4;i++)await tick();
 assert.equal(w.qPokoyGetCategories().filter(row=>row.name==='Такси').length,1);
 assert.equal([...w.document.querySelectorAll('#categoryPopup .category-option')].filter(row=>row.dataset.value==='Такси').length,1);
 assert.equal(f.cache.pending.length,1);assert.equal(f.categoryPosts.length,0);
});

test('permanent category conflict does not block unrelated existing-category income',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');
 await f.view.IncomeStore.add({date:'10.10.26',amount:35,category:'Такси',description:''});
 await f.view.IncomeStore.add({date:'10.10.26',amount:36,category:'Test',description:''});
 f.setCategoryFault({status:409,code:'idempotency_conflict'});f.setOnline(true);await f.cache.refresh();
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].category,'Test');assert.equal(f.queue.size,2);
});
test('category ACK storage failure retains durable request and a retry uses same UUID',async t=>{
 const f=await ready(t);await f.api.addCategory('Такси');const request=f.cache.pending[0].request_id,write=f.db.write;let fail=true;
 f.db.write=async options=>{if(options.categoryAck&&fail){fail=false;throw Error('SQLite ACK failure');}return write(options);};
 f.setOnline(true);await f.cache.refresh();assert.equal(f.queue.size,1);assert.equal(f.categories.size,1);
 await f.cache.manualSync();assert.equal(f.queue.size,0);assert.equal(f.categories.size,1);assert.ok(f.categoryPosts.every(row=>row.request_id===request));
});

async function categoryWithIncome(f,name='Такси'){
 const id=randomUUID(),incomeId=randomUUID();f.categories.set(id,{id,user_id:'A',name});
 f.server.set(incomeId,{id:incomeId,user_id:'A',income_date:'2026-10-17',amount:150,category:name,description:'unchanged'});
 f.setOnline(true);await f.cache.refresh();f.setOnline(false);return {id,incomeId};
}
test('category delete waits for SQLite, persists after restart and never modifies incomes',async t=>{
 const f=await ready(t),{id,incomeId}=await categoryWithIncome(f),before=clone(f.server.get(incomeId));
 const commit=f.db.enqueueCategoryDelete;let release;
 f.db.enqueueCategoryDelete=async args=>{await new Promise(resolve=>release=resolve);return commit(args);};
 let done=false;const deleting=f.api.deleteCategory(id).then(()=>done=true);await tick();assert.equal(done,false);assert.equal(f.queue.size,0);release();await deleting;
 assert.equal(f.categoryDeletes.length,0);assert.equal(f.queue.size,1);f.fresh();await f.start();assert.ok(!f.renders.at(-1).categories.some(row=>row.id===id));assert.equal(f.ui.find(row=>row.id===incomeId).category,'Такси');
 f.setOnline(true);f.event('online');for(let i=0;i<20&&f.queue.size;i++)await tick();
 assert.equal(f.queue.size,0);assert.equal(f.categories.has(id),false);assert.deepEqual(f.server.get(incomeId),before);
 await f.cache.manualSync();await f.cache.refresh();f.fresh();await f.start();assert.equal(f.categoryDeletes.length,1);assert.ok(!f.renders.at(-1).categories.some(row=>row.id===id));assert.deepEqual(f.server.get(incomeId),before);
});
test('lost category DELETE response safely retries 404 without touching income',async t=>{
 const f=await ready(t),{id,incomeId}=await categoryWithIncome(f),before=clone(f.server.get(incomeId));
 await f.api.deleteCategory(id);await f.api.deleteCategory(id);assert.equal(f.queue.size,1);
 f.setLostCategoryDelete(true);f.setOnline(true);await f.cache.refresh();assert.equal(f.queue.size,1);assert.ok(!f.renders.at(-1).categories.some(row=>row.id===id));
 f.setOnline(false);f.fresh();await f.start();f.setOnline(true);await f.cache.manualSync();assert.equal(f.queue.size,0);assert.deepEqual(f.categoryDeletes,[id,id]);assert.deepEqual(f.server.get(incomeId),before);
});
test('unsent offline category without dependents collapses without HTTP',async t=>{
 const f=await ready(t),cat=await f.api.addCategory('Такси');await f.api.deleteCategory(cat.id);assert.equal(f.queue.size,0);f.setOnline(true);await f.cache.refresh();assert.equal(f.categoryPosts.length,0);assert.equal(f.categoryDeletes.length,0);
});
test('deleted offline category creates then saves dependent income then deletes only category',async t=>{
 const f=await ready(t),cat=await f.api.addCategory('Такси');await f.view.IncomeStore.add({date:'10.10.26',amount:42,category:cat.name,description:'preserved'});
 await f.api.deleteCategory(cat.id);f.fresh();await f.start();assert.ok(!f.renders.at(-1).categories.some(row=>row.name==='Такси'));assert.equal(f.ui[0].category,'Такси');
 f.setOnline(true);await f.cache.refresh();await f.cache.manualSync();await f.cache.manualSync();assert.equal(f.queue.size,0);assert.deepEqual(f.order,['category','income','category_delete']);assert.equal(f.categories.size,0);assert.equal(f.server.size,1);assert.equal([...f.server.values()][0].category,'Такси');
});
test('delete during in-flight category CREATE removes eventual server category',async t=>{
 const f=await ready(t),cat=await f.api.addCategory('Такси');let release;f.setCategoryGate(new Promise(resolve=>release=resolve));f.setOnline(true);const syncing=f.cache.refresh();await tick();
 await f.api.deleteCategory(cat.id);assert.equal(f.cache.pending[0].delete_requested,1);f.setCategoryGate(null);release();await syncing;await f.cache.manualSync();await f.cache.manualSync();assert.equal(f.queue.size,0);assert.equal(f.categories.size,0);assert.equal(f.categoryDeletes.length,1);assert.equal(new Set(f.categoryPosts.map(row=>row.request_id)).size,1);
});
test('salary, failed commit and account isolation prevent unsafe category deletion',async t=>{
 const f=await ready(t),{id}=await categoryWithIncome(f,'Зарплата');await assert.rejects(f.api.deleteCategory(id),/нельзя/);assert.equal(f.queue.size,0);
 const cat=await categoryWithIncome(f);f.db.enqueueCategoryDelete=async()=>{throw Error('commit failed');};await assert.rejects(f.api.deleteCategory(cat.id),/commit failed/);assert.ok(f.cache.snapshot.categories.some(row=>row.id===cat.id));
 const g=await ready(t),other=await categoryWithIncome(g);await g.api.deleteCategory(other.id);await g.cache.purge();g.switchUser('B');g.fresh();g.setOnline(true);await g.start();await g.cache.manualSync();assert.equal(g.categoryDeletes.length,0);assert.equal(g.queue.size,1);
});
test('pending income for existing category settles before category DELETE with original name',async t=>{
 const f=await ready(t),{id}=await categoryWithIncome(f);await f.view.IncomeStore.add({date:'10.10.26',amount:51,category:'Такси',description:'pending'});await f.api.deleteCategory(id);f.setOnline(true);await f.cache.refresh();await f.cache.manualSync();assert.deepEqual(f.order,['income','category_delete']);assert.equal(f.queue.size,0);assert.equal([...f.server.values()].filter(row=>row.category==='Такси').length,2);
});

test('stale pre-DELETE bootstrap cannot resurrect acknowledged category',async t=>{
 const f=await ready(t),{id}=await categoryWithIncome(f);await f.api.deleteCategory(id);f.setOnline(true);
 let release;f.setBootstrapGate(new Promise(resolve=>release=resolve));const stale=f.api.bootstrap();await tick();
 await f.cache.syncPending();assert.equal(f.queue.size,0);f.setBootstrapGate(null);release();await assert.rejects(stale,/Сессия изменилась/);
 assert.ok(!f.cache.snapshot.categories.some(row=>row.id===id));
});
test('parallel local category deletes converge to one durable operation',async t=>{
 const f=await ready(t),{id}=await categoryWithIncome(f);await Promise.all([f.api.deleteCategory(id),f.api.deleteCategory(id)]);assert.equal(f.queue.size,1);f.setOnline(true);await f.cache.refresh();assert.equal(f.categoryDeletes.length,1);
});
for(const status of [401,403,429,500])test('category DELETE '+status+' retains durable operation and all incomes',async t=>{
 const f=await ready(t),{id,incomeId}=await categoryWithIncome(f),before=clone(f.server.get(incomeId));
 // Inject at the captured transport, preserving actual auth/cache coordinator.
 const g=create({api:{...f.api,deleteCategory:async()=>{throw failure(status,'fixture');}},db:f.db,fingerprint:async()=> 'a'.repeat(64),online:()=>true});t.after(()=>g.purge());await g.start(async()=>{});
 await f.api.deleteCategory(id);await g.start(async()=>{});await g.syncPending();assert.equal(f.queue.size,1);assert.deepEqual(f.server.get(incomeId),before);assert.equal([...f.queue.values()][0].status,status===401?'auth_required':status===403?'error':'pending');
});

test('offline click guard permits category delete but keeps destructive online-only actions blocked',async t=>{
 const f=await ready(t),{JSDOM}=require('jsdom'),dom=new JSDOM('<button class="qp-category-delete"></button><button id="clearIncomeDataBtn"></button><button id="qpAuthDeleteAccountBtn"></button>');t.after(()=>dom.window.close());
 for(const selector of ['.qp-category-delete','#clearIncomeDataBtn','#qpAuthDeleteAccountBtn']){
  let prevented=false,stopped=false;f.click({target:dom.window.document.querySelector(selector),preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(prevented,selector!=='.qp-category-delete');assert.equal(stopped,selector!=='.qp-category-delete');
 }
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApiClient,TOKEN_KEY,BOOTSTRAP_CACHE_KEY,API_BASE_URL}=require('../js/api-client');

function harness(responses){
  const values=new Map();
  const calls=[];
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method,headers:init.headers,body:init.body&&JSON.parse(init.body)});
    const next=responses.shift();
    assert.ok(next,`Unexpected ${init.method} ${url}`);
    return {ok:next.status>=200&&next.status<300,status:next.status,text:async()=>next.status===204?'':JSON.stringify(next.body)};
  };
  return {api:createApiClient({fetchImpl,storage}),values,calls};
}
const ok=(data,status=200)=>({status,body:data});
const user={user_id:'user-1',email:'тест@example.com'};
const cachedRow={id:'income-1',user_id:user.user_id,income_date:'2026-09-15',category:'Зарплата',description:'Кэш',amount:123};
const bundle=(revision='revision-a')=>({user,revision,not_modified:false,incomes:[cachedRow],categories:[{id:'c1',name:'Зарплата'}],settings:[]});

test('first full bootstrap saves cache; reload validates revision with no legacy requests',async()=>{
  const h=harness([ok(bundle()),ok({user,revision:'revision-a',not_modified:true})]);
  h.values.set(TOKEN_KEY,'session.secret');
  await h.api.bootstrap();
  const cache=JSON.parse(h.values.get(BOOTSTRAP_CACHE_KEY));
  assert.equal(cache.version,1);
  assert.equal(cache.user_id,user.user_id);
  assert.equal(cache.revision,'revision-a');
  const hit=await h.api.bootstrap();
  assert.deepEqual(hit.incomes,[cachedRow]);
  assert.equal(hit.not_modified,true);
  assert.equal(h.calls[1].url,API_BASE_URL+'/bootstrap?revision=revision-a');
  assert.ok(h.calls.every(call=>call.url.includes('/bootstrap')));
  // Another API instance represents a page reload reading the same storage.
  const storage={getItem:key=>h.values.get(key)||null,setItem:(key,value)=>h.values.set(key,value),removeItem:key=>h.values.delete(key)};
  const fresh=createApiClient({storage,fetchImpl:async url=>{
    assert.ok(url.endsWith('?revision=revision-a'));
    return {ok:true,status:200,text:async()=>JSON.stringify({user,revision:'revision-a',not_modified:true})};
  }});
  assert.deepEqual((await fresh.bootstrap()).incomes,[cachedRow]);
});

test('stale revision replaces cache with the fresh server bundle',async()=>{
  const updated={...bundle('revision-b'),incomes:[{...cachedRow,amount:456}]};
  const h=harness([ok(bundle()),ok(updated)]);
  h.values.set(TOKEN_KEY,'session.secret');
  await h.api.bootstrap();
  assert.equal((await h.api.bootstrap()).incomes[0].amount,456);
  assert.equal(JSON.parse(h.values.get(BOOTSTRAP_CACHE_KEY)).revision,'revision-b');
});

test('invalid, corrupted, wrong-version and other-session caches force a full bootstrap',async()=>{
  for(const corrupt of [()=>'{broken',cache=>JSON.stringify({...cache,version:999}),
    cache=>JSON.stringify({...cache,sessionId:'other'}),
    cache=>JSON.stringify({...cache,incomes:[{...cachedRow,amount:999}]})]){
    const h=harness([ok(bundle()),ok(bundle('revision-b'))]);
    h.values.set(TOKEN_KEY,'session.secret');
    await h.api.bootstrap();
    h.values.set(BOOTSTRAP_CACHE_KEY,corrupt(JSON.parse(h.values.get(BOOTSTRAP_CACHE_KEY))));
    await h.api.bootstrap();
    assert.equal(h.calls[1].url,API_BASE_URL+'/bootstrap');
  }
});

test('a not_modified response for another user never exposes the old cache',async()=>{
  const other={user_id:'user-2',email:'other@example.com'};
  const otherBundle={...bundle('revision-b'),user:other,incomes:[],categories:[],settings:[]};
  const h=harness([ok(bundle()),ok({user:other,revision:'revision-a',not_modified:true}),ok(otherBundle)]);
  h.values.set(TOKEN_KEY,'session.secret');
  await h.api.bootstrap();
  const result=await h.api.bootstrap();
  assert.equal(result.user.user_id,'user-2');
  assert.deepEqual(result.incomes,[]);
  assert.equal(h.calls[2].url,API_BASE_URL+'/bootstrap');
  assert.equal(JSON.parse(h.values.get(BOOTSTRAP_CACHE_KEY)).user_id,'user-2');
});

test('logout/account deletion/401 clear cache; 500 preserves session and cache',async()=>{
  for(const action of ['logout','deleteAccount','unauthorized','serverError']){
    const status=action==='unauthorized'?401:action==='serverError'?500:204;
    const h=harness([ok(bundle()),{status,body:{error:{message:'failed'}}}]);
    h.values.set(TOKEN_KEY,'session.secret');
    await h.api.bootstrap();
    if(action==='logout'||action==='deleteAccount')await h.api[action]();
    else if(action==='unauthorized')assert.equal(await h.api.bootstrap(),null);
    else await assert.rejects(h.api.bootstrap(),error=>error.status===500);
    assert.equal(h.values.has(BOOTSTRAP_CACHE_KEY),action==='serverError');
    assert.equal(h.values.has(TOKEN_KEY),action==='serverError');
  }
});

test('writes invalidate before sending, even when the response is lost, without touching journal',async()=>{
  const h=harness([ok(bundle()),{status:500,body:{error:{message:'lost response'}}}]);
  h.values.set(TOKEN_KEY,'session.secret');
  h.values.set('qPokoyIncomeWriteJournalV1','durable');
  await h.api.bootstrap();
  await assert.rejects(h.api.addIncome(cachedRow));
  assert.equal(h.values.has(BOOTSTRAP_CACHE_KEY),false);
  assert.equal(h.values.get('qPokoyIncomeWriteJournalV1'),'durable');
  assert.equal(h.values.get(TOKEN_KEY),'session.secret');
});

test('new email/OAuth sessions discard prior cache before user hydration',async()=>{
  for(const method of ['login','exchangeOAuthTicket']){
    const h=harness([ok(bundle()),ok({token:'other-session.secret',user:{user_id:'user-2'}})]);
    h.values.set(TOKEN_KEY,'session.secret');
    await h.api.bootstrap();
    await h.api[method]('test@example.com','password123');
    assert.equal(h.values.has(BOOTSTRAP_CACHE_KEY),false);
    assert.equal(h.values.get(TOKEN_KEY),'other-session.secret');
  }
});

test('bootstrap loads all startup data in one bearer request and skips signed-out sessions',async()=>{
  const startup={user,incomes:[],categories:[],settings:[]};
  const h=harness([ok(startup)]);
  assert.equal(await h.api.bootstrap(),null);
  assert.equal(h.calls.length,0);
  h.values.set(TOKEN_KEY,'secret');
  assert.deepEqual(await h.api.bootstrap(),startup);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,API_BASE_URL+'/bootstrap');
  assert.equal(h.calls[0].headers.Authorization,'Bearer secret');
});

test('bootstrap expiry signs out; server failure keeps token without legacy fallback',async()=>{
  const h=harness([{status:500,body:{error:{code:'internal_error',message:'Unavailable'}}},
    {status:401,body:{error:{code:'unauthorized',message:'Expired'}}}]);
  h.values.set(TOKEN_KEY,'secret');
  await assert.rejects(h.api.bootstrap(),error=>error.status===500);
  assert.equal(h.values.get(TOKEN_KEY),'secret');
  assert.equal(await h.api.bootstrap(),null);
  assert.equal(h.values.has(TOKEN_KEY),false);
  assert.ok(h.calls.every(call=>call.url.endsWith('/bootstrap')));
});

test('register and login store token; restore uses bearer; logout clears it',async()=>{
  const h=harness([
    ok({token:'register-secret',expires_at:'2026-10-30T00:00:00Z',user},201),
    ok({token:'login-secret',user}),
    ok({user}),
    {status:204},
  ]);
  assert.deepEqual(await h.api.register(user.email,'пароль123'),user);
  assert.equal(h.values.get(TOKEN_KEY),'register-secret');
  assert.deepEqual(h.calls[0].body,{email:user.email,password:'пароль123'});
  assert.equal(h.calls[0].url,API_BASE_URL+'/auth/register');
  await h.api.login(user.email,'пароль123');
  assert.equal(h.values.get(TOKEN_KEY),'login-secret');
  assert.deepEqual(await h.api.restoreSession(),user);
  assert.equal(h.calls[2].headers.Authorization,'Bearer login-secret');
  await h.api.logout();
  assert.equal(h.calls[3].headers.Authorization,'Bearer login-secret');
  assert.equal(h.values.has(TOKEN_KEY),false);
});

test('OAuth start is public and ticket exchange stores the qPokoy session',async()=>{
  const h=harness([
    ok({url:'https://accounts.example.test/authorize'}),
    ok({token:'oauth-session-secret',expires_at:'2026-10-30T00:00:00Z',user})
  ]);
  assert.equal(await h.api.startOAuth('yandex'),'https://accounts.example.test/authorize');
  assert.equal(h.calls[0].url,API_BASE_URL+'/auth/oauth/yandex/start');
  assert.equal(h.calls[0].method,'GET');
  assert.equal(h.calls[0].headers.Authorization,undefined);
  assert.deepEqual(await h.api.exchangeOAuthTicket('signed-ticket'),user);
  assert.equal(h.calls[1].url,API_BASE_URL+'/auth/oauth/exchange');
  assert.equal(h.calls[1].headers.Authorization,undefined);
  assert.deepEqual(h.calls[1].body,{ticket:'signed-ticket'});
  assert.equal(h.values.get(TOKEN_KEY),'oauth-session-secret');
  await assert.rejects(h.api.startOAuth('unknown'),error=>error.code==='invalid_provider');
});

test('pending registration and email verification endpoints are public',async()=>{
  const pending={ok:true,verification_required:true,user:{...user,status:'pending_email'}};
  const h=harness([
    ok(pending,201),
    ok({ok:true},202),
    {status:204}
  ]);
  assert.deepEqual(await h.api.register(user.email,'пароль123'),pending);
  assert.equal(h.values.has(TOKEN_KEY),false);
  assert.equal(h.calls[0].headers.Authorization,undefined);
  assert.deepEqual(await h.api.resendEmailVerification(user.email),{ok:true});
  assert.equal(h.calls[1].url,API_BASE_URL+'/auth/email-verification/resend');
  assert.equal(h.calls[1].headers.Authorization,undefined);
  await h.api.confirmEmailVerification('user.secret');
  assert.equal(h.calls[2].url,API_BASE_URL+'/auth/email-verification/confirm');
  assert.equal(h.calls[2].headers.Authorization,undefined);
  assert.deepEqual(h.calls[2].body,{token:'user.secret'});
});

test('401 clears stored session and restore reports signed-out',async()=>{
  const h=harness([{status:401,body:{error:{code:'unauthorized',message:'Invalid session'}}}]);
  h.values.set(TOKEN_KEY,'expired');
  let notified=0;
  h.api.setUnauthorizedHandler(()=>notified++);
  assert.equal(await h.api.restoreSession(),null);
  assert.equal(h.values.has(TOKEN_KEY),false);
  assert.equal(notified,1);
});

test('income CRUD preserves Russian UTF-8 and server errors',async()=>{
  const row={id:'income-1',income_date:'2026-09-30',category:'Зарплата',description:'Тестовый доход',amount:12345};
  const h=harness([ok({data:[row]}),ok({data:row},201),ok({data:row}),{status:204},
    {status:409,body:{error:{code:'income_exists',message:'Income already exists'}}}]);
  h.values.set(TOKEN_KEY,'secret');
  assert.deepEqual(await h.api.listIncomes(),[row]);
  assert.deepEqual(await h.api.addIncome(row),row);
  assert.equal(h.calls[1].body.description,'Тестовый доход');
  assert.deepEqual(await h.api.updateIncome(row.id,row),row);
  assert.equal(h.calls[2].method,'PUT');
  await h.api.deleteIncome(row.id);
  assert.equal(h.calls[3].method,'DELETE');
  await assert.rejects(h.api.addIncome(row),error=>error.status===409&&error.code==='income_exists');
});

test('categories and settings use scoped REST routes',async()=>{
  const category={id:'category-1',name:'Подработка'};
  const setting={setting_key:'theme',setting_value:'dark'};
  const h=harness([ok({data:[category]}),ok({data:category},201),{status:204},ok({data:[setting]}),ok({data:setting})]);
  h.values.set(TOKEN_KEY,'secret');
  assert.deepEqual(await h.api.listCategories(),[category]);
  assert.deepEqual(await h.api.addCategory('Подработка'),category);
  assert.deepEqual(h.calls[1].body,{name:'Подработка'});
  await h.api.deleteCategory('category-1');
  assert.deepEqual(await h.api.listSettings(),[setting]);
  assert.deepEqual(await h.api.putSetting('theme','dark'),setting);
  assert.equal(h.calls[4].url,API_BASE_URL+'/settings/theme');
  assert.deepEqual(h.calls[4].body,{setting_value:'dark'});
});

test('logout clears token even when server is unavailable',async()=>{
  const h=harness([{status:500,body:{error:{code:'internal_error',message:'Internal server error'}}}]);
  h.values.set(TOKEN_KEY,'secret');
  await assert.rejects(h.api.logout(),error=>error.status===500);
  assert.equal(h.values.has(TOKEN_KEY),false);
});

test('replace incomes sends one authenticated batch and returns server rows',async()=>{
  const income={income_date:'2026-09-15',category:'Зарплата',description:'Импорт',amount:123};
  const saved={...income,id:'server-id'};
  const h=harness([ok({data:[saved]})]);
  h.values.set(TOKEN_KEY,'secret');
  assert.deepEqual(await h.api.replaceIncomes([income]),[saved]);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,API_BASE_URL+'/incomes/replace');
  assert.equal(h.calls[0].method,'POST');
  assert.deepEqual(h.calls[0].body,{incomes:[income]});
  assert.equal(h.calls[0].headers.Authorization,'Bearer secret');
});

test('delete all incomes uses one request and keeps the session',async()=>{
  const h=harness([{status:204}]);
  h.values.set(TOKEN_KEY,'secret');
  await h.api.deleteAllIncomes();
  assert.equal(h.calls[0].url,API_BASE_URL+'/incomes');
  assert.equal(h.calls[0].method,'DELETE');
  assert.equal(h.values.get(TOKEN_KEY),'secret');
});

test('account deletion clears token only after server success',async()=>{
  const h=harness([
    {status:500,body:{error:{code:'internal_error',message:'Try again'}}},
    {status:204}
  ]);
  h.values.set(TOKEN_KEY,'secret');
  await assert.rejects(h.api.deleteAccount(),error=>error.status===500);
  assert.equal(h.values.get(TOKEN_KEY),'secret');
  await h.api.deleteAccount();
  assert.equal(h.calls[0].url,API_BASE_URL+'/auth/me');
  assert.equal(h.calls[0].method,'DELETE');
  assert.equal(h.values.has(TOKEN_KEY),false);
});

test('password reset endpoints are public and do not require a session',async()=>{
  const h=harness([ok({ok:true},202),{status:204}]);
  assert.deepEqual(await h.api.requestPasswordReset('тест@example.com'),{ok:true});
  assert.equal(h.calls[0].url,API_BASE_URL+'/auth/password-reset/request');
  assert.equal(h.calls[0].headers.Authorization,undefined);
  assert.deepEqual(h.calls[0].body,{email:'тест@example.com'});
  await h.api.confirmPasswordReset('reset-token','новый-пароль123');
  assert.equal(h.calls[1].url,API_BASE_URL+'/auth/password-reset/confirm');
  assert.equal(h.calls[1].headers.Authorization,undefined);
  assert.deepEqual(h.calls[1].body,{token:'reset-token',password:'новый-пароль123'});
});

test('admin API uses bearer, encoded exact email and server writes; 403 is propagated without exposing credentials',async()=>{
  const h=harness([ok({data:{admin:true}}),ok({data:{user_id:'target'}}),ok({data:{user_id:'target',assignment:{plan:'lifetime'}}}),{status:403,body:{error:{code:'admin_forbidden',message:'Нет доступа'}}}]);
  h.values.set(TOKEN_KEY,'synthetic-session.synthetic-secret');
  assert.equal((await h.api.adminSession()).admin,true);await h.api.adminFindUser('user+test@example.invalid');await h.api.adminSetAccess('target',{action:'lifetime'});
  assert.ok(h.calls[1].url.endsWith('/admin/users?email=user%2Btest%40example.invalid'));assert.equal(h.calls[2].method,'POST');assert.deepEqual(h.calls[2].body,{action:'lifetime'});assert.equal(h.calls[2].headers.Authorization,'Bearer synthetic-session.synthetic-secret');
  await assert.rejects(h.api.adminSession(),e=>e.status===403&&e.code==='admin_forbidden');
});

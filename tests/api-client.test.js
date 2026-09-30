'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApiClient,TOKEN_KEY,API_BASE_URL}=require('../js/api-client');

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

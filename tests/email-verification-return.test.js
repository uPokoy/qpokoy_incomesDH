'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {createApiClient}=require('../js/api-client');
const source=fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const callback='ru.qpokoy.app://email/confirmed';
async function fixture(t,{result,error,blocked=false,search='?verify_token=fixture-proof',wait}={}){
  const dom=new JSDOM(html,{url:'https://qpokoy.ru/'+search,runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,calls=[],attempts=[];
  w.qPokoyApi={setUnauthorizedHandler(){},async bootstrap(){calls.push('bootstrap');return null;},
    async confirmEmailVerification(token){calls.push(['confirm',token]);if(wait)await wait;if(error)throw error;return result;},
    clearToken(){calls.push('clear');}};
  const location={get search(){return w.location.search;},get href(){return w.location.href;},
    assign(value){attempts.push({value,url:w.location.href,link:w.document.querySelector('#qpAuthMessage a')?.href});if(blocked)throw new Error('launch blocked');}};
  vm.runInNewContext(source,{window:w,document:w.document,location,history:w.history,localStorage:w.localStorage,
    IncomeStore:{load:()=>[],save(){}},URL,URLSearchParams,Date,Promise,console:{error(){}}});
  await new Promise(resolve=>setImmediate(resolve));
  return {w,calls,attempts};
}

test('successful Android confirmation cleans URL first, opens only fixed callback once and retains web login/manual fallback',async t=>{
  const f=await fixture(t,{result:{ok:true,return_to:'android'}});
  assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].value,callback);
  assert.equal(new URL(f.attempts[0].url).searchParams.has('verify_token'),false);
  assert.equal(f.attempts[0].link,callback);
  assert.equal(f.w.document.querySelector('#qpAuthGate').hidden,false);
  assert.equal(f.w.document.querySelector('#qpAuthForm').hidden,false);
  assert.match(f.w.document.querySelector('#qpAuthMessage').textContent,/Почта подтверждена/);
  const link=f.w.document.querySelector('#qpAuthMessage a');assert.equal(link.textContent,'Открыть qPokoy');
  assert.equal(new URL(link.href).search,'');assert.equal(new URL(link.href).hash,'');
  f.w.dispatchEvent(new f.w.Event('focus'));f.w.dispatchEvent(new f.w.Event('pageshow'));
  assert.equal(f.attempts.length,1);
});

test('blocked launch or missing application leaves success page and fixed manual link usable; no retry loop',async t=>{
  for(const blocked of [true,false]){
    const f=await fixture(t,{result:{ok:true,return_to:'android'},blocked});
    assert.equal(f.attempts.length,1);assert.equal(f.w.document.querySelector('#qpAuthMessage a').href,callback);
    assert.equal(f.w.document.querySelector('#qpAuthSubmit').disabled,false);
    assert.equal(f.w.document.querySelector('#qpAuthGate').hidden,false);
    assert.equal(f.w.document.querySelector('#qpAuthMessage').classList.contains('error'),false);
  }
});

test('legacy web responses and untrusted return targets cannot open Android, even with URL source flags',async t=>{
  for(const result of [null,undefined,{ok:true},{return_to:'android'},{ok:true,return_to:'https://attacker.invalid'}]){
    const f=await fixture(t,{result,search:'?verify_token=fixture-proof&client=android&return_to=android'});
    assert.equal(f.attempts.length,0);assert.equal(f.w.document.querySelector('#qpAuthMessage a'),null);
    assert.match(f.w.document.querySelector('#qpAuthMessage').textContent,/Почта подтверждена/);
  }
});

test('failed, expired and replayed verification never open Android or offer the link',async t=>{
  for(const code of ['invalid_verification_token','rate_limited','network_error']){
    const f=await fixture(t,{error:Object.assign(new Error('fixture error'),{code})});
    assert.equal(f.attempts.length,0);assert.equal(f.w.document.querySelector('#qpAuthMessage a'),null);
    assert.equal(f.w.document.querySelector('#qpAuthMessage').classList.contains('error'),true);
    assert.equal(f.w.location.search.includes('verify_token'),false);
  }
  const noToken=await fixture(t,{search:'?client=android&return_to=android'});
  assert.equal(noToken.attempts.length,0);assert.equal(noToken.calls.some(c=>Array.isArray(c)),false);
});

test('confirmation must finish successfully before any launch',async t=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{result:{ok:true,return_to:'android'},wait});
  assert.equal(f.attempts.length,0);assert.equal(f.w.document.querySelector('#qpAuthMessage a'),null);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.attempts.length,1);
});

test('web API registration/resend remain unmarked and confirmation preserves 200/204 response contracts',async()=>{
  for(const status of [200,204]){
    const calls=[];const client=createApiClient({storage:{getItem(){return null;},setItem(){},removeItem(){}},location:{search:''},
      fetchImpl:async(url,options)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
        return {ok:true,status,text:async()=>status===204?'':JSON.stringify({ok:true,return_to:'android'})};}});
    await client.register('fixture@example.invalid','fixture-password');
    await client.resendEmailVerification('fixture@example.invalid');
    const result=await client.confirmEmailVerification('fixture-proof');
    assert.deepEqual(calls.map(c=>c.body),[{email:'fixture@example.invalid',password:'fixture-password'},
      {email:'fixture@example.invalid'},{token:'fixture-proof'}]);
    if(status===200)assert.equal(result.return_to,'android');else assert.equal(result,null);
  }
});

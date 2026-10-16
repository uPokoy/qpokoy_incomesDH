'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const assets=path.join(root,'android/app/src/main/assets');
const source=fs.readFileSync(path.join(assets,'android-oauth.js'),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,options={}){
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
  let pending={attempt_id:'fixture-attempt',code_verifier:'private-fixture-verifier',ticket:'fixture-ticket'},token=null,user=null;
  const calls=[],messages=[],syncs=[],timers=[];let listener;
  w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
  w.Capacitor={nativePromise:async(plugin,method,args)=>{
    assert.equal(plugin,'QPokoyOAuth');calls.push({method,args});
    if(method==='pending')return pending?{...pending}:{};
    if(method==='acknowledge'){assert.equal(args.attempt_id,pending.attempt_id);pending=null;}
    if(method==='cancel')pending=null;
    return {};
  },addListener:(plugin,event,fn)=>{assert.equal(plugin,'QPokoyOAuth');assert.equal(event,'available');listener=fn;return {remove(){}};}};
  let exchanges=0;
  const api={getToken:()=>token,exchangeOAuthTicket:async(ticket,proof)=>{exchanges++;calls.push({method:'exchange',ticket,proof});if(options.exchange)return options.exchange(ticket,proof);token='new-session';return {user_id:'fixture-user'};}};
  const args={api,ready:()=>options.ready||Promise.resolve(),getUser:()=>user,sync:async value=>{syncs.push(value);},message:text=>messages.push(text)};
  w.eval(source);
  return {w,api,args,calls,messages,syncs,timers,start:()=>w.qPokoyAndroidOAuth.attach(args),event:()=>listener(),
    get exchanges(){return exchanges;},get pending(){return pending;},set pending(value){pending=value;},set token(value){token=value;},set user(value){user=value;}};
}
test('native OAuth start calls begin and never starts web OAuth/navigation',async t=>{
  const f=fixture(t);f.w.fetch=async()=>{throw new Error('No web fetch expected');};
  f.w.eval(fs.readFileSync(path.join(assets,'android-platform.js'),'utf8'));
  await f.w.qPokoyAndroidStartOAuth('yandex');assert.equal(f.calls.at(-1).method,'begin');assert.equal(f.calls.at(-1).args.provider,'yandex');
  assert.equal(f.w.location.href,'https://localhost/');await assert.rejects(f.w.qPokoyAndroidStartOAuth('google'),/unavailable/);
});
test('getter recovers callback before listener; duplicate events are single-flight; exact proof and success ack',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{exchange:async()=>{await gate;return {user_id:'oauth-user'};}});f.start();await tick();f.event();f.event();await tick();assert.equal(f.exchanges,1);
  const call=f.calls.find(c=>c.method==='exchange');assert.equal(call.ticket,'fixture-ticket');assert.deepEqual({...call.proof},{attempt_id:'fixture-attempt',code_verifier:'private-fixture-verifier'});
  release();await tick();assert.equal(f.pending,null);assert.equal(f.syncs.length,1);assert.equal(f.calls.filter(c=>c.method==='acknowledge').length,1);
});
test('JS waits for initial auth restoration and ignores callback after ordinary login',async t=>{
  let release;const ready=new Promise(resolve=>{release=resolve;}),f=fixture(t,{ready});f.start();await tick();assert.equal(f.calls.length,0);
  f.token='email-session';release();await tick();assert.equal(f.exchanges,0);assert.equal(f.pending,null);assert.equal(f.calls.at(-1).method,'cancel');
});
test('late callback cannot replace already displayed user even if token getter is empty',async t=>{
  const f=fixture(t);f.user={id:'email-user'};f.start();await tick();assert.equal(f.exchanges,0);assert.equal(f.pending,null);
});
test('missing callback does not exchange, rejected attempt does not affect current UI/session',async t=>{
  const f=fixture(t);f.pending=null;f.start();await tick();f.event();await tick();assert.equal(f.exchanges,0);assert.equal(f.syncs.length,0);
});
test('provider cancellation is acknowledged without exchange',async t=>{
  const f=fixture(t);f.pending={attempt_id:'fixture-attempt',error:'oauth_cancelled'};f.start();await tick();assert.equal(f.exchanges,0);assert.equal(f.pending,null);assert.equal(f.messages.length,1);
});
test('network loss preserves pending callback for bounded retry and later resume',async t=>{
  let offline=true;const f=fixture(t,{exchange:async()=>{if(offline)throw Object.assign(new Error('offline'),{status:0});return {user_id:'restored'};}});
  f.start();await tick();assert.ok(f.pending);assert.equal(f.timers.length,1);
  for(let i=0;i<3;i++){f.timers[i]();await tick();}
  assert.equal(f.timers.length,3);assert.ok(f.pending);assert.equal(f.exchanges,4);
  offline=false;f.event();await tick();assert.equal(f.pending,null);assert.equal(f.syncs.length,1);
});
for(const code of ['invalid_oauth_ticket','session_changed'])test('terminal '+code+' never loops or clears valid session',async t=>{
  const f=fixture(t,{exchange:async()=>{throw Object.assign(new Error(code),{status:400,code});}});f.start();await tick();assert.equal(f.pending,null);assert.equal(f.timers.length,0);assert.equal(f.syncs.length,0);
});
test('bundle auth publication registers native callback after startup and removes location.assign OAuth path',()=>{
  const text=fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8');
  assert.match(text,/androidAuthReady=window.qPokoyAndroidCache.start/);assert.match(text,/qPokoyAndroidOAuth.attach/);
  assert.doesNotMatch(text,/const url=await window.qPokoyAndroidStartOAuth|location.assign\(url\)/);
  assert.match(text,/sync:user=>sync\(\{user:apiUser\(user\)\}\)/);
});
function apiFixture(){
  const {createApiClient,TOKEN_KEY}=require('../www/js/api-client.js');const values=new Map(),requests=[];
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  let respond;
  const client=createApiClient({storage,location:{search:''},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({path:new URL(url).pathname,body});
    if(new URL(url).pathname==='/auth/oauth/exchange')await new Promise(resolve=>{respond=resolve;});
    const payload={token:body.email?'email-token':'oauth-token',user:{user_id:body.email?'email':'oauth'}};
    return {ok:true,status:200,text:async()=>JSON.stringify(payload)};
  }});
  return {client,requests,values,TOKEN_KEY,respond:()=>respond()};
}
test('bundled exchange forwards proof through existing saveSession; web ticket-only remains compatible',async()=>{
  const f=apiFixture(),job=f.client.exchangeOAuthTicket('ticket',{attempt_id:'attempt',code_verifier:'verifier'});await tick();f.respond();assert.equal((await job).user_id,'oauth');
  assert.deepEqual(f.requests[0].body,{ticket:'ticket',attempt_id:'attempt',code_verifier:'verifier'});assert.equal(f.values.get(f.TOKEN_KEY),'oauth-token');
  f.client.clearToken();const web=f.client.exchangeOAuthTicket('web-ticket');await tick();f.respond();await web;assert.deepEqual(f.requests[1].body,{ticket:'web-ticket'});
});
test('email login during exchange prevents late OAuth response replacing token; logout remains usable',async()=>{
  const f=apiFixture(),job=f.client.exchangeOAuthTicket('ticket',{attempt_id:'a',code_verifier:'v'});await tick();
  assert.equal((await f.client.login('test@example.test','fixture-password')).user_id,'email');f.respond();await assert.rejects(job,error=>error.code==='session_changed');
  assert.equal(f.values.get(f.TOKEN_KEY),'email-token');await assert.rejects(f.client.exchangeOAuthTicket('ticket',{attempt_id:'a',code_verifier:'v'}),error=>error.code==='session_changed');
  f.client.clearToken();assert.equal(f.client.getToken(),null);
});
test('native cold and warm intents share handler and strip data before bridge; URI intent filter exact',()=>{
  const java=fs.readFileSync(path.join(root,'android/app/src/main/java/ru/qpokoy/app/MainActivity.java'),'utf8');
  assert.ok(java.indexOf('receiveOAuthIntent(getIntent())')<java.indexOf('super.onCreate(state)'));
  assert.match(java,/super.onNewIntent\(receiveOAuthIntent\(intent\)\)/);assert.match(java,/intent.setData\(null\)/);
  const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
  assert.match(manifest,/android:scheme="ru.qpokoy.app" android:host="oauth" android:path="\/callback"/);
  assert.match(manifest,/android.intent.action.MAIN/);assert.match(manifest,/singleTask/);
});

test('starting a newer attempt invalidates an older in-flight exchange without saving its session',async()=>{
  const f=apiFixture(),job=f.client.exchangeOAuthTicket('old-ticket',{attempt_id:'old',code_verifier:'old'});await tick();
  f.client.invalidateOAuthAttempt();f.respond();await assert.rejects(job,error=>error.code==='session_changed');assert.equal(f.client.getToken(),null);
});

test('bundled auth completes cold OAuth through existing sync and still supports logout/login',async t=>{
  const {createHarness,userA}=require('../../tests/helpers/frontend-harness');
  const html=fs.readFileSync(path.join(root,'../index.html'),'utf8').replace(/<script id="qPokoyAuth"[^>]*><\/script>/,'');
  const h=await createHarness({html,signedOut:true,empty:true});t.after(()=>{h.w.dispatchEvent(new h.w.Event('pagehide'));h.close();});
  const w=h.w;let pending={attempt_id:'cold-attempt',ticket:'cold-ticket',code_verifier:'cold-verifier'},exchanges=0;
  w.qPokoyAndroidCache={displayed:false,purge:async()=>{},start:async hydrate=>hydrate(null,false)};
  w.Capacitor={nativePromise:async(plugin,method,args)=>{
    assert.equal(plugin,'QPokoyOAuth');
    if(method==='pending')return pending||{};
    if(method==='acknowledge'){assert.equal(args.attempt_id,'cold-attempt');pending=null;}
    if(method==='cancel')pending=null;
    return {};
  },addListener:()=>({remove(){}})};
  h.api.exchangeOAuthTicket=async(ticket,proof)=>{exchanges++;assert.equal(ticket,'cold-ticket');assert.equal(proof.code_verifier,'cold-verifier');return h.api.login(userA.email);};
  w.eval(source);w.eval(fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8'));await h.settle();
  assert.equal(exchanges,1);assert.equal(w.qPokoyAuth.getUser().id,userA.user_id);assert.equal(pending,null);
  assert.equal(w.document.body.classList.contains('qp-auth-required'),false);
  await h.logout();assert.equal(w.qPokoyAuth.getUser(),null);await h.login();assert.equal(w.qPokoyAuth.getUser().id,userA.user_id);assert.deepEqual(h.errors,[]);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),java=path.join(root,'android/app/src/main/java/ru/qpokoy/app');
const adapter=fs.readFileSync(path.join(root,'android/app/src/main/assets/android-adapter.js'),'utf8');
function fixture(t,url='https://localhost/'){
 const dom=new JSDOM('<head></head><body><div id="qpAuthGate"><form id="qpAuthForm"><input id="qpAuthEmail" type="email"><input id="qpAuthPassword" type="password"></form></div></body>',{url,runScripts:'outside-only',pretendToBeVisual:true});
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
 const sent=[];dom.window.qPokoyAndroid={postMessage:text=>sent.push(JSON.parse(text))};
 const password=dom.window.document.getElementById('qpAuthPassword'),original=password.addEventListener.bind(password);
 let pointer;
 password.addEventListener=(name,handler,...rest)=>{if(name==='pointerdown')pointer=handler;return original(name,handler,...rest);};
 dom.window.eval(adapter);
 return {w:dom.window,sent,tap:()=>pointer({isTrusted:true,button:0})};
}
test('Password save uses only internal bridge and returns status without echoing credentials',async t=>{
 const {w,sent}=fixture(t);
 const promise=w.qPokoyAndroidSavePassword('fixture@example.invalid','test-fixture');
 const request=sent.find(row=>row.kind==='savePassword');
 assert.deepEqual(Object.keys(request).sort(),['email','kind','password','request']);
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'passwordSaveFinished',request:request.request,status:'saved'})});
 assert.equal(await promise,'saved');assert.equal(w.qPokoyAndroidPasswordSaveStatus,'saved');
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
});
test('Cancellation is a successful optional outcome; leaving the page releases waiter',async t=>{
 const {w,sent}=fixture(t);const p=w.qPokoyAndroidSavePassword('fixture@example.invalid','test-fixture');
 const row=sent.find(row=>row.kind==='savePassword');
 w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'passwordSaveFinished',request:row.request,status:'cancelled'})});
 assert.equal(await p,'cancelled');
 const next=w.qPokoyAndroidSavePassword('fixture@example.invalid','test-fixture');
 w.dispatchEvent(new w.Event('pagehide'));assert.equal(await next,'cancelled');
});
test('Hidden auth form and non-auth document cannot request credential save',async t=>{
 for(const url of ['https://localhost/pricing.html','https://foreign.invalid/']){
  const {w,sent}=fixture(t,url);assert.equal(await w.qPokoyAndroidSavePassword('fixture@example.invalid','test-fixture'),'unavailable');
  assert.equal(sent.some(row=>row.kind==='savePassword'),false);
 }
 const {w,sent}=fixture(t);w.document.getElementById('qpAuthGate').hidden=true;
 assert.equal(await w.qPokoyAndroidSavePassword('fixture@example.invalid','test-fixture'),'unavailable');
 assert.equal(sent.some(row=>row.kind==='savePassword'),false);
});
test('Native credential helper has no persistence, secret fields, raw exception logs or origin impersonation',()=>{
 const saver=fs.readFileSync(path.join(java,'PasswordCredentialSaver.java'),'utf8');
 assert.match(saver,/new CreatePasswordRequest\(email,password,null,false,false\)/);
 assert.match(saver,/createCredentialAsync/);
 assert.doesNotMatch(saver,/SharedPreferences|SQLite|FileOutputStream|printStackTrace|getMessage\(|Log\.[a-z]\([^;]*(?:email|password|request|error)/);
 assert.doesNotMatch(saver,/(?:private|static)\s+(?:final\s+)?String\s+(?:email|password)/);
 const activity=fs.readFileSync(path.join(java,'MainActivity.java'),'utf8');
 assert.match(activity,/if\(!mainFrame\|\|!isInternal\(origin\)\)return/);
 assert.match(activity,/web!=bridge.getWebView\(\)\|\|!PasswordSavePolicy.trustedPage\(web.getUrl\(\)\)/);
 assert.match(activity,/data.remove\("email"\);data.remove\("password"\)/);
 const auth=fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8');
 assert.match(auth,/const user=await api.login\(mail,pass\);[\s\S]*?qPokoyAndroidSavePassword\?\.\(mail,pass\)[\s\S]*?await sync\(\{user:apiUser\(user\)\}\)/);
 assert.equal((auth.match(/qPokoyAndroidSavePassword/g)||[]).length,1);
});


const tick=()=>new Promise(resolve=>setImmediate(resolve));
function reply(w,row,status,extra={}){
 w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'passwordGetFinished',request:row.request,status,...extra})});
}
test('Only first real password tap opens picker; selection fills existing fields without submitting',async t=>{
 const {w,sent,tap}=fixture(t);const form=w.document.getElementById('qpAuthForm'),password=w.document.getElementById('qpAuthPassword');
 let submits=0;form.addEventListener('submit',e=>{e.preventDefault();submits++;});
 assert.equal(w.document.getElementById('qpAndroidSavedPassword'),null);
 password.focus();password.dispatchEvent(new w.Event('focus'));password.dispatchEvent(new w.Event('pointerdown'));
 assert.equal(sent.some(r=>r.kind==='getPassword'),false);
 tap();tap();
 const rows=sent.filter(r=>r.kind==='getPassword');assert.equal(rows.length,1);
 assert.deepEqual(Object.keys(rows[0]).sort(),['kind','request']);
 reply(w,rows[0],'selected',{email:'fixture@example.invalid',password:'test-fixture'});await tick();
 assert.equal(w.document.getElementById('qpAuthEmail').value,'fixture@example.invalid');
 assert.equal(password.value,'test-fixture');assert.equal(submits,0);
 assert.equal(w.qPokoyAndroidSavedPasswordFilled(),true);
 assert.equal(w.qPokoyAndroidLoginWithPassword,undefined);
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 tap();assert.equal(sent.filter(r=>r.kind==='getPassword').length,1);
 password.value='manual-fixture';password.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(w.qPokoyAndroidSavedPasswordFilled(),false);
});
test('Cancel permits manual input without reopening until form closes and opens',async t=>{
 const {w,sent,tap}=fixture(t),form=w.document.getElementById('qpAuthForm'),password=w.document.getElementById('qpAuthPassword');
 tap();reply(w,sent.find(r=>r.kind==='getPassword'),'cancelled');await tick();
 password.value='manual-fixture';password.dispatchEvent(new w.Event('input'));password.focus();tap();
 assert.equal(password.value,'manual-fixture');assert.equal(sent.filter(r=>r.kind==='getPassword').length,1);
 // App resume/visibility has no effect on the once-per-form-opening guard.
 w.document.dispatchEvent(new w.Event('visibilitychange'));w.dispatchEvent(new w.Event('pageshow'));tap();
 assert.equal(sent.filter(r=>r.kind==='getPassword').length,1);
 form.hidden=true;await tick();form.hidden=false;await tick();tap();
 const rows=sent.filter(r=>r.kind==='getPassword');assert.equal(rows.length,2);
 reply(w,rows[1],'cancelled');await tick();
});
test('A response from an earlier form opening cannot fill a newly reopened form',async t=>{
 const {w,sent,tap}=fixture(t),gate=w.document.getElementById('qpAuthGate');
 tap();const row=sent.find(r=>r.kind==='getPassword');
 gate.hidden=true;await tick();gate.hidden=false;await tick();
 reply(w,row,'selected',{email:'fixture@example.invalid',password:'test-fixture'});await tick();
 assert.equal(w.document.getElementById('qpAuthPassword').value,'');
 assert.equal(w.qPokoyAndroidSavedPasswordFilled(),false);
});
test('Hidden/non-auth pages cannot open the picker',async t=>{
 for(const url of ['https://localhost/pricing.html','https://foreign.invalid/']){
  const {sent,tap}=fixture(t,url);tap();assert.equal(sent.some(r=>r.kind==='getPassword'),false);
 }
 const {w,sent,tap}=fixture(t);w.document.getElementById('qpAuthGate').hidden=true;tap();
 assert.equal(sent.some(r=>r.kind==='getPassword'),false);
});
test('Only pressing ordinary submit logs in; untouched filled credentials skip re-saving, manual edits still save',async()=>{
 const auth=fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8');
 const start=auth.indexOf('  async function handleAuthSubmit('),end=auth.indexOf("  form.addEventListener('submit'",start);
 const calls=[],signupForm={},email={value:'fixture@example.invalid',checkValidity:()=>true};let filled=true;
 const context={signupForm,email,signupEmail:email,password:{value:'test-fixture'},signupPassword:{},confirm:{},signupSubmit:{},submit:{},signupMessage:{},message:{},
  setMessage(){},setResetMessage(){},friendlyError:()=>'',apiUser:x=>x,
  api:{async login(mail,password){calls.push(['login',mail,password]);return {id:'fixture'};}},
  async sync(){calls.push(['sync']);},window:{qPokoyAndroidSavedPasswordFilled:()=>filled,async qPokoyAndroidSavePassword(){calls.push(['save']);}}};
 const handler=vm.runInNewContext('('+auth.slice(start,end).trim()+')',context);
 assert.deepEqual(calls,[]);
 await handler({preventDefault(){},currentTarget:{}});
 assert.deepEqual(calls,[['login','fixture@example.invalid','test-fixture'],['sync']]);
 calls.length=0;filled=false;context.password.value='manual-fixture';
 await handler({preventDefault(){},currentTarget:{}});
 assert.deepEqual(calls.map(row=>row[0]),['login','save','sync']);
 assert.doesNotMatch(auth,/qPokoyAndroidLoginWithPassword/);
});
test('Native get request uses password-only option and rechecks trusted document before replying',()=>{
 const saver=fs.readFileSync(path.join(java,'PasswordCredentialSaver.java'),'utf8');
 assert.match(saver,/new GetCredentialRequest.Builder\(\)/);
 assert.match(saver,/addCredentialOption\(new GetPasswordOption\(\)\)/);
 assert.match(saver,/getCredentialAsync/);
 const activity=fs.readFileSync(path.join(java,'MainActivity.java'),'utf8');
 assert.match(activity,/if\(!page.equals\(web.getUrl\(\)\)\|\|!PasswordSavePolicy.trustedPage\(web.getUrl\(\)\)\)return/);
 assert.match(activity,/finally\{result.remove\("email"\);result.remove\("password"\);\}/);
});

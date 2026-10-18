'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const adapter=fs.readFileSync(path.join(root,'android/app/src/main/assets/android-adapter.js'),'utf8');
function bridge(t,post){
 const dom=new JSDOM('<head></head><body><div id="qpAuthGate"></div></body>',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
 dom.window.qPokoyAndroid={postMessage:post};dom.window.eval(adapter);return dom.window;
}
test('Autofill sends no credentials and waits for matching native acknowledgement',async t=>{
 const sent=[];const w=bridge(t,text=>sent.push(JSON.parse(text)));
 let done=false;const result=w.qPokoyAndroidCommitAutofill().then(()=>done=true);
 const request=sent.find(row=>row.kind==='commitAutofill');
 assert.deepEqual(Object.keys(request).sort(),['kind','request']);
 assert.equal(done,false);
 w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'autofillCommitted',request:request.request+1})});
 await Promise.resolve();assert.equal(done,false);
 w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'autofillCommitted',request:request.request})});
 await result;assert.equal(done,true);
});
test('Autofill missing acknowledgement and bridge failures cannot block login',async t=>{
 const w=bridge(t,()=>{});
 await w.qPokoyAndroidCommitAutofill();
 w.qPokoyAndroid.postMessage=()=>{throw new Error('bridge unavailable');};
 await w.qPokoyAndroidCommitAutofill();
});
function loginFixture({fail=false,signup=false}={}){
 const text=fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8');
 const start=text.indexOf('  async function handleAuthSubmit('),end=text.indexOf("  form.addEventListener('submit'",start);
 const calls=[],signupForm={reset(){}},input={value:'person@example.invalid',checkValidity:()=>true};
 let release;
 const context={signupForm,signupEmail:input,email:input,password:{value:'fixture-password'},signupPassword:{value:'fixture-password'},confirm:{value:'fixture-password'},
  signupSubmit:{},submit:{},signupMessage:{},message:{},setMessage(){},setResetMessage(){},apiUser:x=>x,
  api:{async login(){calls.push('login');if(fail)throw new Error('bad credentials');return {id:'test'};},async register(){calls.push('register');return {verification_required:true};}},
  async sync(){calls.push('hide form');},setMode(){},friendlyError:()=>'',window:{qPokoyAndroidSavePassword(){calls.push('commit');return new Promise(resolve=>release=resolve);}}};
 const handler=vm.runInNewContext('('+text.slice(start,end).trim()+')',context);
 return {calls,release:()=>release(),run:()=>handler({preventDefault(){},currentTarget:signup?signupForm:{}})};
}
test('Only confirmed password login commits before sync hides the form',async()=>{
 const f=loginFixture();const run=f.run();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.calls,['login','commit']);f.release();await run;
 assert.deepEqual(f.calls,['login','commit','hide form']);
});
test('Failed password login and signup never commit Autofill',async()=>{
 for(const options of [{fail:true},{signup:true}]){
  const f=loginFixture(options);await f.run();assert.equal(f.calls.includes('commit'),false);assert.equal(f.calls.includes('hide form'),false);
 }
});
test('Native autofill uses trusted main WebView, API guard, and release version is unchanged',()=>{
 const java=fs.readFileSync(path.join(root,'android/app/src/main/java/ru/qpokoy/app/MainActivity.java'),'utf8');
 assert.match(java,/if\(!mainFrame\|\|!isInternal\(origin\)\)return/);
 assert.match(java,/case "commitAutofill":\s*if\(web!=bridge.getWebView\(\)\)break/);
 assert.match(java,/Build.VERSION.SDK_INT>=26/);assert.match(java,/manager\.isEnabled\(\)\)manager\.commit\(\)/);
 assert.match(java,/setImportantForAutofill\(View.IMPORTANT_FOR_AUTOFILL_YES\)/);
 const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
 assert.match(gradle,/versionName "0.1.18"/);assert.match(gradle,/versionCode 19/);
});

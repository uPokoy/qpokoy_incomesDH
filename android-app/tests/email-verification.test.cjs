'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const auth=()=>read('www/js/auth.js');
test('only Android registration sends the fixed UX source marker; web and login contracts stay unchanged',async()=>{
 for(const android of [false,true]){
  const modulePath=android?'../www/js/api-client.js':'../../js/api-client.js';
  const {createApiClient}=require(modulePath);const calls=[];
  const client=createApiClient({storage:{getItem:()=>null,setItem(){},removeItem(){}},location:{search:''},fetchImpl:async(url,options)=>{
   calls.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
   return {ok:true,status:201,text:async()=>JSON.stringify({verification_required:true})};
  }});
  assert.equal((await client.register('test@example.invalid','fixture-password')).verification_required,true);
  assert.deepEqual(calls[0].body,android?{email:'test@example.invalid',password:'fixture-password',client:'android'}:{email:'test@example.invalid',password:'fixture-password'});
  assert.equal(calls[0].body.redirect_uri,undefined);
 }
});
function hook({user=null,token=null,ready=Promise.resolve()}={}){
 const text=auth(),start=text.indexOf('window.qPokoyAndroidEmailConfirmed=async()=>{'),end=text.indexOf('\n  };',start);
 assert.ok(start>0&&end>start);const calls=[];
 const context={window:{},androidAuthReady:ready,cloudUser:user,api:{getToken:()=>token},message:{},setMode:value=>calls.push(['mode',value]),showGate:value=>calls.push(['gate',value]),setMessage:(value,type)=>calls.push(['message',value,type])};
 vm.runInNewContext(text.slice(start,end+5),context);return {calls,run:()=>context.window.qPokoyAndroidEmailConfirmed()};
}
test('cold email return waits for auth bootstrap before displaying the ordinary login and message',async()=>{
 let release;const f=hook({ready:new Promise(resolve=>release=resolve)});const running=f.run();
 await Promise.resolve();assert.deepEqual(f.calls,[]);release();await running;
 assert.deepEqual(f.calls,[['mode','login'],['gate',true],['message','Почта подтверждена. Войдите в аккаунт','success']]);
});
test('warm return and failed startup still show login without exchanging/clearing session credentials',async()=>{
 for(const ready of [Promise.resolve(),Promise.reject(new Error('offline'))]){
  const f=hook({ready});await f.run();assert.equal(f.calls.at(-1)[1],'Почта подтверждена. Войдите в аккаунт');
 }
 const text=auth();const start=text.indexOf('window.qPokoyAndroidEmailConfirmed=');const end=text.indexOf('\n  };',start);
 assert.doesNotMatch(text.slice(start,end),/api\.(login|logout|clearToken|confirmEmailVerification|exchangeOAuthTicket)/);
});
test('return never logs out an existing account or discards its offline data',async()=>{
 for(const state of [{user:{id:'existing'}},{token:'fixture-session'}]){const f=hook(state);await f.run();assert.deepEqual(f.calls,[]);}
});
test('trusted native bridge transfers only the UI hint, with no verification token or auth data',t=>{
 const dom=new JSDOM('<head></head><body></body>',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,sent=[];let calls=0;w.qPokoyAndroid={postMessage:text=>sent.push(JSON.parse(text))};w.qPokoyAndroidEmailConfirmed=()=>{calls++;};
 w.eval(read('android/app/src/main/assets/android-adapter.js'));
 assert.deepEqual(sent.find(x=>x.kind==='emailVerificationReady'),{kind:'emailVerificationReady'});
 for(const confirmed of [false,'true',true])w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'emailVerificationReturn',confirmed})});
 assert.equal(calls,1);assert.equal(w.localStorage.length,0);
});
test('other origins and non-login pages cannot poll or consume the email-return hint',t=>{
 for(const url of ['https://foreign.invalid/','https://localhost/pricing.html']){
  const dom=new JSDOM('<head></head><body></body>',{url,runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,sent=[];let calls=0;w.qPokoyAndroid={postMessage:text=>sent.push(JSON.parse(text))};w.qPokoyAndroidEmailConfirmed=()=>calls++;
  w.eval(read('android/app/src/main/assets/android-adapter.js'));
  w.qPokoyAndroid.onmessage({data:JSON.stringify({kind:'emailVerificationReturn',confirmed:true})});
  assert.equal(sent.some(x=>x.kind==='emailVerificationReady'),false);assert.equal(calls,0);
 }
});
test('unavailable email bridge cannot interrupt existing password manager or download initialization',t=>{
 const dom=new JSDOM('<head></head><body></body>',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.qPokoyAndroid={postMessage(text){if(JSON.parse(text).kind==='emailVerificationReady')throw new Error('email bridge unavailable');}};
 assert.doesNotThrow(()=>w.eval(read('android/app/src/main/assets/android-adapter.js')));
 assert.equal(typeof w.qPokoyAndroidSavePassword,'function');assert.equal(typeof w.qPokoyAndroidDownload,'function');
});
test('manifest has disjoint email and OAuth filters; cold and warm handling strip custom URIs before Capacitor',()=>{
 const dom=new JSDOM(read('android/app/src/main/AndroidManifest.xml'),{contentType:'text/xml'});
 try{
  const filters=[...dom.window.document.querySelectorAll('activity intent-filter')];
  for(const [host,target] of [['email','/confirmed'],['oauth','/callback']]){
   const filter=filters.find(f=>[...f.querySelectorAll('data')].some(d=>d.getAttribute('android:host')===host));
   assert.ok(filter);assert.equal(filter.querySelectorAll('data').length,1);assert.equal(filter.querySelector('data').getAttribute('android:path'),target);
  }
 }finally{dom.window.close();}
 const java=read('android/app/src/main/java/ru/qpokoy/app/MainActivity.java');
 assert.match(java,/EmailVerificationReturn.accepts\(intent.getData\(\).toString\(\)\)/);
 assert.match(java,/else OAuthPlugin.receive/);assert.match(java,/intent.setData\(null\);setIntent\(intent\)/);
 assert.match(java,/super.onNewIntent\(receiveOAuthIntent\(intent\)\)/);
 assert.match(java,/case "emailVerificationReady":\s*if\(web!=bridge.getWebView\(\)\|\|!PasswordSavePolicy.trustedPage\(web.getUrl\(\)\)\)break/);
 assert.match(java,/if\(!mainFrame\|\|!isInternal\(origin\)\)return/);
 assert.match(java,/state.putBoolean\("emailVerificationPending",emailVerificationPending\)/);
});

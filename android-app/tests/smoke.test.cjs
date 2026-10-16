'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const adapter=fs.readFileSync(path.join(root,'android/app/src/main/assets/android-adapter.js'),'utf8');
test('bundle has all local references, early platform adaptation and offline PDF assets',()=>{
  const info=JSON.parse(fs.readFileSync(path.join(root,'www/bundle-info.json')));
  assert.match(info.sourceCommit,/^[a-f0-9]{40}$/);
  assert.equal(info.origin,'https://localhost');
  for(const page of ['index.html','pricing.html','service.html','offer.html','privacy.html','about.html']){
    const text=fs.readFileSync(path.join(root,'www',page),'utf8');
    assert.match(text,/<head>\s*<script src="\/android-platform.js">/);
    assert.doesNotMatch(text,/<link[^>]+rel="manifest"/);
    assert.match(text,/android-adapter.js/);
  }
  for(const name of info.files)assert.equal(fs.existsSync(path.join(root,'www',name)),true,name);
  assert.match(fs.readFileSync(path.join(root,'www/js/auth.js'),'utf8'),/window.qPokoyAndroidStartOAuth/);
  assert.match(fs.readFileSync(path.join(root,'www/js/report-print.js'),'utf8'),/https:\/\/localhost\/vendor\/html2pdf/);
  assert.equal(fs.existsSync(path.join(root,'www/vendor/html2pdf.bundle.min.js')),true);
});
test('offline API failures are controlled and OAuth does not start an unsafe WebView flow',async t=>{
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const w=dom.window;let calls=0;w.fetch=async()=>{calls++;return {status:401};};
  Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
  w.eval(fs.readFileSync(path.join(root,'android/app/src/main/assets/android-platform.js'),'utf8'));
  await assert.rejects(w.fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me'),/интернет/);
  assert.equal(calls,0);
  await assert.rejects(w.qPokoyAndroidStartOAuth('yandex'),/email/);
  Object.defineProperty(w.navigator,'onLine',{value:true});
  assert.equal((await w.fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me')).status,401);
});

test('bundle preserves the main recent-card description and Android pending icons',()=>{
  const info=JSON.parse(fs.readFileSync(path.join(root,'www/bundle-info.json')));
  const app=fs.readFileSync(path.join(root,'www/js/app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'www/css/mobile.css'),'utf8');
  const {execFileSync}=require('node:child_process');
  assert.equal(css,execFileSync('git',['show',info.sourceCommit+':css/mobile.css'],{cwd:path.join(root,'..'),encoding:'utf8'}));
  assert.match(app,/income-recent-description/);
  assert.match(app,/pendingMarkup\(item.id\).*\n\s*<\/article>/);
  assert.match(app,/\$\{cells\}\$\{window.qPokoyAndroidCache\?\.pendingMarkup\(item.id\)/);
  assert.match(app,/\.matches\?1:RECENT_INCOME_PAGE_SIZE/);
  assert.match(css,/Mobile recent cards use the same content layout as full history/);
  assert.match(css,/grid-template-areas:"amount category" "date category" "description description"/);
});
test('DEV420 bundled API client keeps bootstrap and Android income CRUD contracts',async()=>{
  const info=JSON.parse(fs.readFileSync(path.join(root,'www/bundle-info.json')));
  const source=fs.readFileSync(path.join(root,'www/js/api-client.js'),'utf8');
  const {execFileSync}=require('node:child_process');
  assert.equal(source,execFileSync('git',['show',info.sourceCommit+':js/api-client.js'],{cwd:path.join(root,'..'),encoding:'utf8'}));
  const {createApiClient,TOKEN_KEY}=require('../www/js/api-client.js');
  const values=new Map([[TOKEN_KEY,'test-only-token']]),calls=[];
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const id='b1d5dd77-df32-48cf-9165-a97b1215d40c',user={user_id:'test-user'};
  const client=createApiClient({storage,location:{search:''},fetchImpl:async(url,options)=>{
    calls.push({path:new URL(url).pathname,method:options.method,body:options.body?JSON.parse(options.body):null});
    const value=calls.at(-1).path==='/bootstrap'?{user,incomes:[],categories:[],settings:[],revision:'test'}:{data:{id,user_id:user.user_id},user};
    return {ok:true,status:200,text:async()=>JSON.stringify(value)};
  }});
  assert.deepEqual((await client.bootstrap()).user,user);
  assert.deepEqual(await client.restoreSession(),user);
  await client.addIncome({id,client_mutation_id:id,amount:1,income_date:'2026-10-11',category:'Test',description:'Fixture'});
  await client.updateIncome(id,{amount:2});await client.deleteIncome(id);
  assert.deepEqual(calls.map(({path,method})=>[method,path]),[['GET','/bootstrap'],['GET','/auth/me'],['POST','/incomes'],['PUT','/incomes/'+id],['DELETE','/incomes/'+id]]);
  assert.equal(calls[2].body.id,id);assert.equal(calls[2].body.client_mutation_id,id);
});
test('bundled HTTPS localhost origin, separate identity/version and no release signing',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'capacitor.config.json')));
  assert.equal(config.appId,'ru.qpokoy.app');assert.equal(config.server.url,undefined);
  assert.equal(config.server.hostname,'localhost');assert.equal(config.server.androidScheme,'https');
  assert.equal(config.server.cleartext,false);assert.equal(config.android.allowMixedContent,false);
  assert.equal(config.plugins.SystemBars.insetsHandling,'disable');
  const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
  assert.match(gradle,/versionName "0.1.17-dev"/);assert.match(gradle,/versionCode 18/);
  assert.doesNotMatch(gradle,/signingConfigs|storePassword|keyPassword/);
  const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
  assert.match(manifest,/allowBackup="false"/);assert.match(manifest,/windowSoftInputMode="adjustResize"/);
});
test('content top inset preserves existing padding and does not accumulate',t=>{
  const dom=new JSDOM('<head><style>body{padding-top:7px}#qpAuthGate{padding-top:14px}</style></head><body><div id="qpAuthGate"></div></body>',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const w=dom.window;w.qPokoyAndroid={postMessage(){}};w.eval(adapter);
  const root=w.document.documentElement;
  w.qPokoyAndroidSetTopInset(48);w.qPokoyAndroidSetTopInset(48);
  assert.equal(root.style.getPropertyValue('--qp-android-top'),'48px');
  assert.equal(root.style.getPropertyValue('--qp-android-page-top'),'7px');
  assert.equal(root.style.getPropertyValue('--qp-android-auth-top'),'14px');
  w.eval(adapter);assert.equal(w.document.querySelectorAll('#qpAndroidSafeArea').length,1);
  w.qPokoyAndroidSetTopInset(0);assert.equal(root.style.getPropertyValue('--qp-android-top'),'0px');
});
test('editor autoscroll respects the current Android inset without affecting other page scroll',t=>{
  const dom=new JSDOM('<div id="incomeForm"><input id="description"></div><input id="outside">',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
  const frames=new Map();let frame=0,y=450;const moves=[];
  w.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};w.cancelAnimationFrame=id=>frames.delete(id);
  const flush=()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}};
  Object.defineProperty(w,'scrollY',{get:()=>y});
  w.scrollTo=options=>{moves.push(options);y=options.top;};
  w.visualViewport=new w.EventTarget();w.visualViewport.height=490;
  const form=w.document.getElementById('incomeForm');form.getBoundingClientRect=()=>({top:400-y});
  w.qPokoyAndroid={postMessage(){}};w.eval(adapter);w.qPokoyAndroidSetTopInset(34.333332,true);
  w.document.getElementById('description').focus();flush();
  assert.ok(form.getBoundingClientRect().top>=34.333332);assert.equal(moves.length,1);assert.equal(moves[0].behavior,'instant');
  w.document.dispatchEvent(new w.Event('scroll'));flush();assert.equal(moves.length,1,'no repeated correction once safe');
  // IME resize and a changed system inset use the same guard, not a fixed offset.
  y=430;w.qPokoyAndroidSetTopInset(48,true);w.visualViewport.dispatchEvent(new w.Event('resize'));flush();
  assert.equal(form.getBoundingClientRect().top,48);
  w.qPokoyAndroidSetTopInset(48,false);y=500;w.visualViewport.dispatchEvent(new w.Event('resize'));flush();assert.equal(y,500,'normal scrolling remains available without the keyboard');
  w.qPokoyAndroidSetTopInset(48,true);
  w.document.getElementById('outside').focus();y=500;w.document.dispatchEvent(new w.Event('scroll'));flush();assert.equal(y,500);
  w.document.getElementById('description').focus();form.hidden=true;flush();assert.equal(y,500);
});

test('Android Back closes real controls in order without changing website handlers',t=>{
  const dom=new JSDOM('<div id="qpConfirmOverlay"><button data-confirm-cancel></button></div><div id="categoryPopup" class="open"></div><button id="categorySelect"></button><div id="incomeForm"><button id="cancelIncome"></button></div>',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const w=dom.window;w.qPokoyAndroid={postMessage(){}};
  w.document.querySelector('[data-confirm-cancel]').onclick=()=>w.document.querySelector('#qpConfirmOverlay').remove();
  w.document.querySelector('#categorySelect').onclick=()=>w.document.querySelector('#categoryPopup').classList.remove('open');
  w.document.querySelector('#cancelIncome').onclick=()=>{w.document.querySelector('#incomeForm').hidden=true;};
  w.eval(adapter);
  assert.equal(w.qPokoyAndroidBack(),true);assert.equal(w.document.querySelector('#qpConfirmOverlay'),null);
  assert.equal(w.qPokoyAndroidBack(),true);assert.equal(w.document.querySelector('#categoryPopup').classList.contains('open'),false);
  assert.equal(w.qPokoyAndroidBack(),true);assert.equal(w.document.querySelector('#incomeForm').hidden,true);
  assert.equal(w.qPokoyAndroidBack(),false);
});
test('native print/report transport and PWA suppression are Android-local and installed only once',async t=>{
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const w=dom.window,messages=[];w.qPokoyAndroid={postMessage:value=>messages.push(JSON.parse(value))};
  w.fetch=async()=>({text:async()=>'<table><tr><td>123 ₽</td></tr></table>'});
  w.eval(adapter);w.eval(adapter);messages.length=0;w.print();assert.deepEqual(messages,[{kind:'print'}]);
  const prompt=new w.Event('beforeinstallprompt',{cancelable:true});w.dispatchEvent(prompt);assert.equal(prompt.defaultPrevented,true);
  w.open('blob:https://localhost/report');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages[1].kind,'report');assert.match(messages[1].html,/<table>/);
});


test('Android pending icon is subtle, direct on surfaces, and pull is gated by dialogs/inner scroll',async t=>{
  const dom=new JSDOM('<head></head><body><section id="income"><article class="income-recent-card"><div class="income-recent-description">long</div><span class="qp-android-pending" data-android-pending><svg></svg></span></article></section><div id="list"><div id="item"></div></div><div id="incomeForm" hidden></div></body>',{url:'https://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,messages=[];t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
  w.qPokoyAndroid={postMessage:v=>messages.push(JSON.parse(v))};w.qPokoyAndroidCache={displayed:true};w.qPokoyAuth={getUser:()=>({})};w.eval(adapter);
  assert.equal(messages.at(-1).allowed,true);const icon=w.document.querySelector('[data-android-pending]'),style=w.getComputedStyle(icon);
  assert.equal(style.width,'16px');assert.equal(style.height,'16px');assert.equal(style.opacity,'0.5');assert.equal(style.position,'absolute');assert.equal(icon.textContent,'');
  w.document.getElementById('list').scrollTop=10;w.document.getElementById('item').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(messages.at(-1).allowed,false);
  w.document.getElementById('list').scrollTop=0;w.document.getElementById('item').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(messages.at(-1).allowed,true);
  w.document.getElementById('incomeForm').hidden=false;await new Promise(r=>w.setTimeout(r,40));assert.equal(messages.at(-1).allowed,false);
  w.document.getElementById('incomeForm').hidden=true;await new Promise(r=>w.setTimeout(r,40));assert.equal(messages.at(-1).allowed,true);
  w.document.body.classList.add('qp-auth-locked');await new Promise(r=>w.setTimeout(r,40));assert.equal(messages.at(-1).allowed,false);
});

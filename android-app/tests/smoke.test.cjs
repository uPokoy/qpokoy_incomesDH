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
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;let calls=0;w.fetch=async()=>{calls++;return {status:401};};
  Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
  w.eval(fs.readFileSync(path.join(root,'android/app/src/main/assets/android-platform.js'),'utf8'));
  await assert.rejects(w.fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me'),/интернет/);
  assert.equal(calls,0);
  await assert.rejects(w.qPokoyAndroidStartOAuth('yandex'),/email/);
  Object.defineProperty(w.navigator,'onLine',{value:true});
  assert.equal((await w.fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me')).status,401);
});

test('bundle preserves the main recent-card description and Android pending date label',()=>{
  const info=JSON.parse(fs.readFileSync(path.join(root,'www/bundle-info.json')));
  const app=fs.readFileSync(path.join(root,'www/js/app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'www/css/mobile.css'),'utf8');
  const {execFileSync}=require('node:child_process');
  assert.equal(css,execFileSync('git',['show',info.sourceCommit+':css/mobile.css'],{cwd:path.join(root,'..'),encoding:'utf8'}));
  assert.match(app,/income-recent-description/);
  assert.match(app,/<div class="income-recent-date">\$\{escapeHtml\(formatDateShort\(item.date\)\)\}\$\{window.qPokoyAndroidCache\?\.pendingMarkup\(item.id\)/);
  assert.match(app,/\.matches\?1:RECENT_INCOME_PAGE_SIZE/);
  assert.match(css,/Mobile recent cards use the same content layout as full history/);
  assert.match(css,/grid-template-areas:"amount category" "date category" "description description"/);
});
test('bundled HTTPS localhost origin, separate identity/version and no release signing',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'capacitor.config.json')));
  assert.equal(config.appId,'ru.qpokoy.app');assert.equal(config.server.url,undefined);
  assert.equal(config.server.hostname,'localhost');assert.equal(config.server.androidScheme,'https');
  assert.equal(config.server.cleartext,false);assert.equal(config.android.allowMixedContent,false);
  assert.equal(config.plugins.SystemBars.insetsHandling,'disable');
  const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
  assert.match(gradle,/versionName "0.1.11-dev"/);assert.match(gradle,/versionCode 12/);
  assert.doesNotMatch(gradle,/signingConfigs|storePassword|keyPassword/);
  const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
  assert.match(manifest,/allowBackup="false"/);assert.match(manifest,/windowSoftInputMode="adjustResize"/);
});
test('content top inset preserves existing padding and does not accumulate',t=>{
  const dom=new JSDOM('<head><style>body{padding-top:7px}#qpAuthGate{padding-top:14px}</style></head><body><div id="qpAuthGate"></div></body>',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.qPokoyAndroid={postMessage(){}};w.eval(adapter);
  const root=w.document.documentElement;
  w.qPokoyAndroidSetTopInset(48);w.qPokoyAndroidSetTopInset(48);
  assert.equal(root.style.getPropertyValue('--qp-android-top'),'48px');
  assert.equal(root.style.getPropertyValue('--qp-android-page-top'),'7px');
  assert.equal(root.style.getPropertyValue('--qp-android-auth-top'),'14px');
  w.eval(adapter);assert.equal(w.document.querySelectorAll('#qpAndroidSafeArea').length,1);
  w.qPokoyAndroidSetTopInset(0);assert.equal(root.style.getPropertyValue('--qp-android-top'),'0px');
});
test('Android Back closes real controls in order without changing website handlers',t=>{
  const dom=new JSDOM('<div id="qpConfirmOverlay"><button data-confirm-cancel></button></div><div id="categoryPopup" class="open"></div><button id="categorySelect"></button><div id="incomeForm"><button id="cancelIncome"></button></div>',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
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
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,messages=[];w.qPokoyAndroid={postMessage:value=>messages.push(JSON.parse(value))};
  w.fetch=async()=>({text:async()=>'<table><tr><td>123 ₽</td></tr></table>'});
  w.eval(adapter);w.eval(adapter);w.print();assert.deepEqual(messages,[{kind:'print'}]);
  const prompt=new w.Event('beforeinstallprompt',{cancelable:true});w.dispatchEvent(prompt);assert.equal(prompt.defaultPrevented,true);
  w.open('blob:https://localhost/report');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages[1].kind,'report');assert.match(messages[1].html,/<table>/);
});

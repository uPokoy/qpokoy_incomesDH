'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {createHarness}=require('./helpers/frontend-harness');

test('delayed bootstrap leaves the real shell inert, hides auth spinner and blocks actions',async t=>{
  let release;const bootstrapGate=new Promise(resolve=>{release=resolve;});
  const h=await createHarness({bootstrapGate,localIncomes:[{id:'stale',date:'07.10.26',category:'Old account',description:'Old private income',amount:999999}]});
  t.after(()=>h.close());
  const app=h.w.document.querySelector('.app');
  assert.equal(h.w.document.querySelector('.qp-auth-loading'),null);
  assert.equal(h.w.document.body.classList.contains('qp-auth-checking'),true);
  assert.equal(h.w.document.body.classList.contains('qp-auth-locked'),false);
  assert.equal(app.hasAttribute('inert'),true);
  assert.equal(app.getAttribute('aria-hidden'),'true');
  assert.equal(h.node('analyticsSettingsToggle').disabled,true);
  h.node('analyticsSettingsToggle').click();h.add(123,'Blocked while loading');
  assert.equal(h.node('analyticsSettingsHost').hidden,true);
  assert.equal(h.calls.includes('addIncome'),false);
  release();await h.settle();
  assert.equal(h.w.document.body.classList.contains('qp-auth-checking'),false);
  assert.equal(app.hasAttribute('inert'),false);
  assert.equal(app.getAttribute('aria-hidden'),'false');
  assert.equal(h.node('analyticsSettingsToggle').disabled,false);
  assert.equal(h.node('incomeRecentGrid').textContent.includes('Old private income'),false);
  assert.equal(h.w.document.querySelector('.qp-skeleton-row'),null);
  assert.deepEqual(h.errors,[]);
});

test('signed-out bootstrap removes skeleton, restores the existing auth gate and keeps app inert',async t=>{
  const h=await createHarness({signedOut:true});t.after(()=>h.close());
  assert.equal(h.w.document.body.classList.contains('qp-auth-checking'),false);
  assert.equal(h.w.document.body.classList.contains('qp-auth-locked'),true);
  assert.equal(h.node('qpAuthGate').hidden,false);
  assert.equal(h.w.document.querySelector('.app').hasAttribute('inert'),true);
  assert.equal(h.w.document.querySelector('.qp-skeleton-row'),null);
  await h.login();
  assert.equal(h.node('qpAuthGate').hidden,true);
  assert.equal(h.w.document.querySelector('.app').hasAttribute('inert'),false);
  assert.deepEqual(h.errors,[]);
});

test('finishing skeleton preserves the separate subscription write restriction',async t=>{
  let release;const bootstrapGate=new Promise(resolve=>{release=resolve;});
  const h=await createHarness({bootstrapGate,readOnly:true});t.after(()=>h.close());
  assert.equal(h.node('analyticsSettingsToggle').disabled,true);
  release();await h.settle();
  assert.equal(h.node('analyticsSettingsToggle').disabled,false);
  assert.equal(h.node('saveIncome').disabled,true);
  assert.equal(h.w.qPokoyCanWrite(),false);
  h.add(123,'Must stay read-only');await h.settle();
  assert.equal(h.calls.includes('addIncome'),false);
  assert.deepEqual(h.errors,[]);
});

test('failed bootstrap returns to auth without revealing the cached account',async t=>{
  let fail;const bootstrapGate=new Promise((resolve,reject)=>{fail=reject;});
  const h=await createHarness({bootstrapGate});t.after(()=>h.close());
  fail(Object.assign(new Error('Unavailable'),{code:'internal_error'}));await h.settle();
  assert.equal(h.w.document.body.classList.contains('qp-auth-checking'),false);
  assert.equal(h.node('qpAuthGate').hidden,false);
  assert.equal(h.w.document.querySelector('.app').hasAttribute('inert'),true);
  assert.match(h.node('qpAuthMessage').textContent,/Сервер временно недоступен/);
});

test('custom appearance reads the existing DB once and waits for image decode before reveal',async t=>{
  const root=path.resolve(__dirname,'..');
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://preview.example/',runScripts:'outside-only'});
  const w=dom.window;t.after(()=>w.close());
  await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
  w.localStorage.setItem('qPokoyBackgroundMode','custom');
  let reads=0,decoded;const decodeGate=new Promise(resolve=>{decoded=resolve;});
  const blob=new w.Blob(['fixture'],{type:'image/png'});
  w.URL.createObjectURL=()=> 'blob:preview-image';w.URL.revokeObjectURL=()=>{};
  w.Image=class {decode(){return decodeGate;}};
  w.indexedDB={open(name,version){
    assert.equal(name,'qPokoyLocalAppearance');assert.equal(version,1);
    const request={result:{close(){},transaction(store,mode){
      assert.equal(store,'backgrounds');assert.equal(mode,'readonly');
      return {objectStore(){return {get(key){
        assert.equal(key,'custom');reads++;const get={result:blob};
        queueMicrotask(()=>get.onsuccess());return get;
      }}}};
    }}};
    queueMicrotask(()=>request.onsuccess());return request;
  }};
  w.eval(fs.readFileSync(path.join(root,'js/accent.js'),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.body.classList.contains('qp-bg-custom'),true);
  assert.equal(w.document.documentElement.classList.contains('qp-appearance-pending'),true);
  assert.equal(reads,1);
  decoded();await w.qPokoyAppearanceReady;
  assert.equal(w.document.documentElement.classList.contains('qp-appearance-pending'),false);
  assert.match(w.document.getElementById('qpCustomBackgroundLayer').style.backgroundImage,/blob:preview-image/);
});

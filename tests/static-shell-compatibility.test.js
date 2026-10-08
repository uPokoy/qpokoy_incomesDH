'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {createHarness,userA,userB}=require('./helpers/frontend-harness');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const reference=read('tests/fixtures/stage5-static-shells.html');
function html(page,staticShell){
  if(!staticShell)return read(page);
  const dom=new JSDOM(read(page)),fixture=new JSDOM(reference);
  const d=dom.window.document;
  if(page==='index.html'){
    d.getElementById('qpAppearanceCard').appendChild(d.importNode(fixture.window.document.querySelector('.qp-category-manager'),true));
  }else{
    d.querySelector('.admin-search-box').insertAdjacentElement('afterend',d.importNode(fixture.window.document.querySelector('.admin-mobile-filter-toggle'),true));
  }
  const value=dom.serialize();dom.window.close();fixture.window.close();return value;
}
function categoryContract(h){
  const d=h.w.document,card=d.querySelector('#settings > .settings-card:not([style])');
  assert.equal(card.id,'qpAppearanceCard');
  assert.equal(d.querySelectorAll('.qp-category-manager').length,1);
  const box=card.querySelector('.qp-category-manager');
  assert.equal(box,card.lastChild);assert.equal(box.nextSibling,null);
  assert.equal(box.previousElementSibling.className,'settings-row');
  const expected=new JSDOM(reference);
  assert.equal(box.firstElementChild.outerHTML,expected.window.document.querySelector('.qp-category-add').outerHTML);
  expected.window.close();
  for(const id of ['qpCategoryInput','qpCategoryAddBtn','qpCategoryList'])assert.equal(d.querySelectorAll('#'+id).length,1);
}

for(const staticShell of [false,true]){
  const mode=staticShell?'future static HTML':'legacy HTML';
  test('categories '+mode+': click/Enter, repeated hydration and user switch bind once',async t=>{
    const h=await createHarness({html:html('index.html',staticShell),signedOut:true});t.after(()=>h.close());
    await h.login(userA);const input=h.node('qpCategoryInput');
    for(let i=0;i<3;i++)await h.w.qPokoyLoadCategories({id:userA.user_id},h.categories.get(userA.user_id));
    categoryContract(h);
    input.value='Owner A click';h.node('qpCategoryAddBtn').click();await h.settle();
    assert.equal(h.calls.filter(x=>x==='addCategory').length,1);
    input.value='Owner A Enter';input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await h.settle();
    assert.equal(h.calls.filter(x=>x==='addCategory').length,2);
    await h.logout();assert.equal(h.w.qPokoyGetCategories().length,0);
    h.node('qpCategoryAddBtn').click();await h.settle();assert.equal(h.calls.filter(x=>x==='addCategory').length,2);
    await h.login(userB);assert.equal(h.node('qpCategoryInput'),input);
    input.value='Owner B click';h.node('qpCategoryAddBtn').click();await h.settle();
    assert.equal(h.calls.filter(x=>x==='addCategory').length,3);
    assert.deepEqual(h.categories.get(userA.user_id).map(x=>x.name),['Зарплата','Owner A click','Owner A Enter']);
    assert.deepEqual(h.categories.get(userB.user_id).map(x=>x.name),['Зарплата','Owner B click']);
    assert.equal(h.w.qPokoyGetCategories().some(x=>x.name.startsWith('Owner A')),false);
    categoryContract(h);assert.deepEqual(h.errors,[]);
  });

  test('categories '+mode+': DOMContentLoaded/init repetition retains one binding',async t=>{
    const dom=new JSDOM(html('index.html',staticShell),{runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window;let writes=0;
    Object.defineProperty(w.document,'readyState',{get:()=> 'loading'});
    w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.qPokoyApi={async addCategory(name){writes++;return{id:'fixture-'+writes,name};}};
    w.eval(read('js/categories.js'));
    // Hydration can precede the scheduled init; both must reuse one DOM/binding.
    await w.qPokoyLoadCategories({id:'fixture-user'},[]);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const input=w.document.getElementById('qpCategoryInput');
    input.value='Init click';w.document.getElementById('qpCategoryAddBtn').click();
    await new Promise(r=>setImmediate(r));assert.equal(writes,1);
    input.value='Init Enter';input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setImmediate(r));assert.equal(writes,2);
    assert.equal(w.document.querySelectorAll('.qp-category-manager').length,1);
  });

  test('admin '+mode+': repeated adapter, readyState and media transitions are idempotent',t=>{
    for(const readyState of ['loading','complete']){
      const dom=new JSDOM(html('admin.html',staticShell),{runScripts:'outside-only'});t.after(()=>dom.window.close());
      const w=dom.window;Object.defineProperty(w.document,'readyState',{get:()=>readyState});
      const changes=[];let clicks=0;
      const media={matches:true,addEventListener(type,fn){assert.equal(type,'change');changes.push(fn);}};
      w.matchMedia=()=>media;
      const native=w.EventTarget.prototype.addEventListener;
      w.EventTarget.prototype.addEventListener=function(type,fn,options){if(this.classList?.contains('admin-mobile-filter-toggle')&&type==='click')clicks++;return native.call(this,type,fn,options);};
      w.eval(read('js/admin-ui-polish.js'));
      for(let i=0;i<3;i++)w.eval(read('js/admin-mobile.js'));
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
      const toggle=w.document.querySelector('.admin-mobile-filter-toggle'),dashboard=toggle.closest('.admin-dashboard');
      assert.equal(w.document.querySelectorAll('.admin-mobile-filter-toggle').length,1);
      assert.equal(clicks,1);assert.equal(changes.length,1);
      assert.equal(toggle.previousSibling,w.document.querySelector('.admin-search-box'));
      const expected=new JSDOM(reference);assert.equal(toggle.outerHTML,expected.window.document.querySelector('.admin-mobile-filter-toggle').outerHTML);expected.window.close();
      toggle.click();assert.equal(dashboard.classList.contains('mobile-filters-open'),true);
      assert.equal(toggle.getAttribute('aria-expanded'),'true');
      // Rerunning while open must not reset state or add listeners.
      w.eval(read('js/admin-mobile.js'));assert.equal(clicks,1);assert.equal(changes.length,1);
      assert.equal(toggle.getAttribute('aria-expanded'),'true');
      toggle.click();assert.equal(dashboard.classList.contains('mobile-filters-open'),false);
      toggle.click();media.matches=false;changes[0]();assert.equal(toggle.getAttribute('aria-expanded'),'false');
      media.matches=true;changes[0]();toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');
    }
  });
}

test('legacy and future category shells retain desktop/coarse read-only controls',async t=>{
  for(const staticShell of [false,true])for(const pointer of ['fine','coarse']){
    const h=await createHarness({html:html('index.html',staticShell),readOnly:true,pointer,width:pointer==='fine'?1440:390,height:844});
    try{
      assert.equal(h.node('qpCategoryInput').disabled,true);assert.equal(h.node('qpCategoryAddBtn').disabled,true);
      h.node('qpCategoryAddBtn').click();await h.settle();assert.equal(h.calls.includes('addCategory'),false);
      assert.equal(h.w.qPokoyGetCategories()[0].name,'Зарплата');assert.deepEqual(h.errors,[]);
    }finally{h.close();}
  }
});

test('admin compatibility preserves desktop initial close and addListener fallback',t=>{
  for(const staticShell of [false,true]){
    const dom=new JSDOM(html('admin.html',staticShell),{runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window;let change,subscriptions=0;
    const media={matches:false,addListener(fn){subscriptions++;change=fn;}};w.matchMedia=()=>media;
    w.document.querySelector('.admin-dashboard').classList.add('mobile-filters-open');
    w.eval(read('js/admin-mobile.js'));w.eval(read('js/admin-mobile.js'));assert.equal(subscriptions,1);
    const toggle=w.document.querySelector('.admin-mobile-filter-toggle');assert.equal(toggle.getAttribute('aria-expanded'),'false');
    media.matches=true;change();toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');
    media.matches=false;change();assert.equal(toggle.getAttribute('aria-expanded'),'false');
  }
});

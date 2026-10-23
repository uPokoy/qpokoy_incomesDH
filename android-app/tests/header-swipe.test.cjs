'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'scripts/header-swipe.js'),'utf8');
function fixture(t,mobile=true){
 const dom=new JSDOM('<section id="income"><div class="income-top"><div class="income-month-block"><span id="incomeTotal"></span><div class="month-switcher"><span id="monthName"></span><button id="monthPrev"></button></div><div class="income-chart-year-switcher"><span id="yearName"></span></div></div><div class="income-month-chart"><svg><rect class="income-chart-bar" role="button"></rect></svg><button id="chartYearNext"></button></div><div id="incomeRecent"></div></div></section>',{runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,calls=[];
 w.matchMedia=()=>({matches:mobile});w.qPokoyChangeSelectedIncomeMonth=delta=>calls.push(delta);w.eval(source);
 const fire=(selector,type,x=100,y=100,count=1)=>{
  const e=new w.Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(e,'touches',{value:type==='touchend'?[]:Array.from({length:count},()=>({clientX:x,clientY:y}))});
  Object.defineProperty(e,'changedTouches',{value:[{clientX:x,clientY:y}]});
  w.document.querySelector(selector).dispatchEvent(e);return e;
 };
 return {w,calls,fire,swipe:(selector,dx,dy=3)=>{fire(selector,'touchstart');return fire(selector,'touchend',100+dx,100+dy);}};
}
test('sum, free month block, chart background and bars keep the same swipe direction',t=>{
 for(const selector of ['#incomeTotal','.income-month-block','.income-month-chart','svg','.income-chart-bar']){
  const f=fixture(t);assert.equal(f.swipe(selector,-70).defaultPrevented,true);f.swipe(selector,70);
  assert.deepEqual(f.calls,[1,-1]);
 }
});
test('vertical scroll, diagonal noise, short movement and cancel never switch months or prevent scroll',t=>{
 const f=fixture(t);
 for(const [dx,dy] of [[12,120],[60,60],[40,2]])assert.equal(f.swipe('svg',dx,dy).defaultPrevented,false);
 f.fire('svg','touchstart');assert.equal(f.fire('svg','touchmove',105,140).defaultPrevented,false);
 f.fire('svg','touchend',200,143); // Vertical movement followed by a horizontal tail remains a scroll.
 f.fire('svg','touchstart');f.fire('svg','touchcancel');f.fire('svg','touchend',20,100);
 assert.deepEqual(f.calls,[]);
});
test('buttons, recent-income pager, desktop and multi-touch are excluded',t=>{
 const f=fixture(t);for(const selector of ['#monthPrev','#monthName','#yearName','#chartYearNext','#incomeRecent'])f.swipe(selector,-90);
 f.fire('svg','touchstart',100,100,2);f.fire('svg','touchend',0,100);
 f.fire('svg','touchstart');f.fire('svg','touchmove',90,100,2);f.fire('svg','touchend',0,100);
 assert.deepEqual(f.calls,[]);const desktop=fixture(t,false);desktop.swipe('#incomeTotal',-90);assert.deepEqual(desktop.calls,[]);
});
test('a real chart tap and keyboard action survive; only the swipe-generated click is suppressed',t=>{
 const f=fixture(t);const bar=f.w.document.querySelector('.income-chart-bar');let clicks=0,keys=0;
 bar.addEventListener('click',()=>clicks++);bar.addEventListener('keydown',()=>keys++);
 f.swipe('.income-chart-bar',-90);bar.dispatchEvent(new f.w.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(clicks,0);
 f.fire('.income-chart-bar','touchstart');f.fire('.income-chart-bar','touchend');bar.dispatchEvent(new f.w.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(clicks,1);
 bar.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(keys,1);
});
test('bundle replaces the old sum handler exactly once and does not add CSS or duplicate listeners',t=>{
 const f=fixture(t);f.w.eval(source);f.swipe('#incomeTotal',-90);assert.deepEqual(f.calls,[1]);
 const app=fs.readFileSync(path.join(root,'www/js/app.js'),'utf8');
 assert.ok(app.includes(source));assert.equal(app.includes('/* qp-mobile-month-total-swipe-v34 */'),false);
 assert.doesNotMatch(source,/style\.|touch-action|touchmove[^]*?preventDefault[^]*?touchcancel/);
});

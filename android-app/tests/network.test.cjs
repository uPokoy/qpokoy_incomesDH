'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const platform=fs.readFileSync(path.join(__dirname,'../android/app/src/main/assets/android-platform.js'),'utf8');
const apiUrl='https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/incomes';
function fixture(t,{native='online',browser=true,fetcher=async()=>({ok:true,status:200,text:async()=>'{}'}),manualTimers=false}={}){
  const dom=new JSDOM('',{url:'https://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,timers=new Map();let calls=0,reads=0,timerId=0;
  Object.defineProperty(w.navigator,'onLine',{value:browser,configurable:true});
  w.Capacitor={nativePromise:async()=>{reads++;return {state:native};}};
  w.fetch=(...args)=>{calls++;return fetcher(...args);};
  if(manualTimers){w.setTimeout=(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;};w.clearTimeout=id=>timers.delete(id);}
  w.eval(platform);
  return {w,timers,get calls(){return calls;},get reads(){return reads;}};
}
test('native offline beats stale navigator.onLine=true; no HTTP request',async t=>{
  const f=fixture(t,{native:'offline'});await assert.rejects(f.w.fetch(apiUrl),e=>e.code==='android_transport'&&e.status===0);
  assert.equal(f.calls,0);assert.equal(f.w.qPokoyAndroidNetwork.state,'offline');
});
test('validated native online beats stale navigator.onLine=false',async t=>{
  const f=fixture(t,{browser:false});assert.equal((await f.w.fetch(apiUrl)).status,200);assert.equal(f.calls,1);
});
test('unknown native state remains unknown and uses WebView only as an additional hint',async t=>{
  const f=fixture(t,{native:'unknown'});await f.w.fetch(apiUrl);assert.equal(f.w.qPokoyAndroidNetwork.state,'unknown');assert.equal(f.calls,1);
});
test('fetch rejection is marked transport; real HTTP errors keep their status',async t=>{
  const lost=fixture(t,{fetcher:async()=>{throw new TypeError('Failed to fetch');}});
  await assert.rejects(lost.w.fetch(apiUrl),e=>e.code==='android_transport'&&e.status===0);
  for(const status of [400,401,402,403,404,409,500]){
    const f=fixture(t,{fetcher:async()=>({ok:false,status,text:async()=>'{"error":{}}'})});
    const response=await f.w.fetch(apiUrl);assert.equal(response.status,status);assert.equal(await response.text(),'{"error":{}}');
  }
});
test('lost successful body is transport; lost HTTP 500 body cannot become offline success',async t=>{
  for(const status of [200,500]){
    const f=fixture(t,{fetcher:async()=>({ok:status===200,status,text:async()=>{throw new TypeError('network lost');}})});
    const response=await f.w.fetch(apiUrl);
    await assert.rejects(response.text(),e=>e.status===(status===200?0:500)&&e.code===(status===200?'android_transport':'android_response_body'));
  }
});
test('actual header timeout uses a bounded timer and reports transport failure',async t=>{
  const f=fixture(t,{manualTimers:true,fetcher:()=>new Promise(()=>{})});
  const result=f.w.fetch(apiUrl);for(let i=0;i<20;i++)await Promise.resolve();
  const timeout=[...f.timers.values()].find(timer=>timer.ms===30000);assert.ok(timeout);timeout.callback();
  await assert.rejects(result,e=>e.code==='android_transport'&&e.status===0);assert.equal(f.timers.size,0);assert.equal(f.calls,1);
});
test('actual HTTP-error body timeout retains its HTTP status',async t=>{
  const f=fixture(t,{manualTimers:true,fetcher:async()=>({ok:false,status:500,text:()=>new Promise(()=>{})})});
  const response=await f.w.fetch(apiUrl),result=response.text();for(let i=0;i<10;i++)await Promise.resolve();
  const timeout=[...f.timers.values()].find(timer=>timer.ms===30000);assert.ok(timeout);timeout.callback();
  await assert.rejects(result,e=>e.status===500&&e.code==='android_response_body');assert.equal(f.timers.size,0);
});
test('new native callback beats a stale in-flight query, and concurrent reads share one call',async t=>{
  const f=fixture(t);let release,reads=0;f.w.Capacitor.nativePromise=()=>{reads++;return new Promise(resolve=>release=resolve);};
  const a=f.w.qPokoyAndroidNetwork.read(),b=f.w.qPokoyAndroidNetwork.read();f.w.qPokoyAndroidNetwork.accept({state:'offline'});
  release({state:'online'});await Promise.all([a,b]);assert.equal(reads,1);assert.equal(f.w.qPokoyAndroidNetwork.state,'offline');
});

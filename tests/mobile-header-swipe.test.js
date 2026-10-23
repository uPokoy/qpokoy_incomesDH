'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/frontend-harness');
const mobile={width:390,height:844,pointer:'coarse'};
function gestures(h){
  const fire=(selector,type,x=150,y=100,count=1)=>{
    const target=h.w.document.querySelector(selector);assert.ok(target,selector);
    const event=new h.w.Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{
      touches:{value:type==='touchend'?[]:Array.from({length:count},()=>({clientX:x,clientY:y}))},
      changedTouches:{value:[{clientX:x,clientY:y}]}
    });
    target.dispatchEvent(event);return event;
  };
  return {fire,swipe(selector,dx,dy=3){fire(selector,'touchstart');return fire(selector,'touchend',150+dx,100+dy);}};
}
const period=h=>({...h.w.qPokoyGetSelectedIncomePeriod()});

for(const width of [320,360,375,390,412,430])test(`mobile header swipe ${width}: sum and chart use the existing month direction exactly once`,async t=>{
  const h=await createHarness({...mobile,width});t.after(()=>h.close());const g=gestures(h),initial=period(h);
  for(const selector of ['#incomeTotal','.income-total-cloud-inner','.income-month-block','#incomeMonthChart','.income-chart-wrap','#incomeChartSvg','.income-chart-bar']){
    assert.equal(g.swipe(selector,-80).defaultPrevented,true);
    assert.deepEqual(period(h),{month:initial.month+1,year:initial.year});
    assert.equal(g.swipe(selector,80).defaultPrevented,true);assert.deepEqual(period(h),initial);
  }
  assert.deepEqual(h.errors,[]);
});

test('header swipe retains December/January year rollover',async t=>{
  const h=await createHarness(mobile);t.after(()=>h.close());const g=gestures(h);
  h.w.qPokoyChangeSelectedIncomeMonth(11-period(h).month);const december=period(h);
  g.swipe('#incomeChartSvg',-80);assert.deepEqual(period(h),{month:0,year:december.year+1});
  g.swipe('#incomeTotal',80);assert.deepEqual(period(h),december);
});

test('vertical scrolling, diagonal noise and short movements are never prevented or interpreted as month swipes',async t=>{
  const h=await createHarness(mobile);t.after(()=>h.close());const g=gestures(h),initial=period(h);
  for(const selector of ['#incomeTotal','#incomeChartSvg']){
    for(const [dx,dy] of [[0,100],[10,-100],[60,60],[43,0]])assert.equal(g.swipe(selector,dx,dy).defaultPrevented,false);
    g.fire(selector,'touchstart');assert.equal(g.fire(selector,'touchmove',155,145).defaultPrevented,false);
    assert.equal(g.fire(selector,'touchend',250,148).defaultPrevented,false);
  }
  assert.deepEqual(period(h),initial);assert.deepEqual(h.errors,[]);
});

test('cancelled/multitouch gestures and unmatched touchend do not change the month',async t=>{
  const h=await createHarness(mobile);t.after(()=>h.close());const g=gestures(h),initial=period(h);
  g.fire('#incomeChartSvg','touchend',20,100);
  g.fire('#incomeChartSvg','touchstart');g.fire('#incomeChartSvg','touchcancel');g.fire('#incomeChartSvg','touchend',20,100);
  g.fire('#incomeChartSvg','touchstart',150,100,2);g.fire('#incomeChartSvg','touchend',20,100);
  g.fire('#incomeChartSvg','touchstart');g.fire('#incomeChartSvg','touchmove',140,100,2);g.fire('#incomeChartSvg','touchend',20,100);
  assert.deepEqual(period(h),initial);
});

test('chart taps and keyboard selection work, while the synthetic click after a swipe is suppressed',async t=>{
  const h=await createHarness(mobile);t.after(()=>h.close());const g=gestures(h),year=period(h).year;
  const click=selector=>h.w.document.querySelector(selector).dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true}));
  g.swipe('.income-chart-bar',-80);const afterSwipe=period(h);
  assert.equal(click('.income-chart-bar[data-month="1"]'),false);assert.deepEqual(period(h),afterSwipe);
  g.fire('.income-chart-bar[data-month="1"]','touchstart');g.fire('.income-chart-bar[data-month="1"]','touchend');
  click('.income-chart-bar[data-month="1"]');assert.deepEqual(period(h),{month:1,year});
  for(const key of ['Enter',' ']){
    h.w.document.querySelector('.income-chart-bar[data-month="3"]').dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    assert.deepEqual(period(h),{month:3,year});
  }
  assert.deepEqual(h.errors,[]);
});

test('month/year controls retain their own swipes and clicks without double navigation; recent cards are excluded',async t=>{
  const h=await createHarness(mobile);t.after(()=>h.close());const g=gestures(h),initial=period(h);
  g.swipe('#incomeMonthSwitcher',-80);assert.deepEqual(period(h),{month:initial.month+1,year:initial.year});
  g.swipe('#incomeMonthSwitcher',80);assert.deepEqual(period(h),initial);
  g.swipe('#incomeChartYear',-80);assert.deepEqual(period(h),{month:initial.month,year:initial.year+1});
  h.node('chartYearPrev').click();assert.deepEqual(period(h),initial);
  h.node('monthNext').click();assert.deepEqual(period(h),{month:initial.month+1,year:initial.year});
  h.node('monthPrev').click();assert.deepEqual(period(h),initial);
  g.swipe('#incomeRecent',-80);assert.deepEqual(period(h),initial);
  assert.deepEqual(h.errors,[]);
});

test('desktop fine pointer and large portrait touch screens keep their existing behavior',async t=>{
  for(const options of [{width:390,pointer:'fine'},{width:1440,pointer:'fine'},{width:1024,height:1366,pointer:'coarse'}]){
    const h=await createHarness(options);t.after(()=>h.close());const g=gestures(h),initial=period(h);
    for(const selector of ['#incomeTotal','#incomeChartSvg','.income-chart-bar'])assert.equal(g.swipe(selector,-80).defaultPrevented,false);
    assert.deepEqual(period(h),initial);
    h.w.document.querySelector('.income-chart-bar[data-month="2"]').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
    assert.equal(period(h).month,2);assert.deepEqual(h.errors,[]);
  }
});

test('existing mobile landscape media query also enables the shared header swipe',async t=>{
  const h=await createHarness({width:1024,height:500,pointer:'coarse'});t.after(()=>h.close());
  const initial=period(h);gestures(h).swipe('#incomeChartSvg',-80);
  assert.deepEqual(period(h),{month:initial.month+1,year:initial.year});
});

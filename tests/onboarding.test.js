'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHarness,userA}=require('./helpers/frontend-harness');
const tour=h=>h.node('qpOnboarding');
const next=h=>tour(h).querySelector('[data-tour-next]').click();
const storage=h=>JSON.stringify(Object.fromEntries(Object.keys(h.w.localStorage).map(key=>[key,h.w.localStorage.getItem(key)])));

test('desktop tour uses DOM-only demo, restores real records before plus and waits for actual category popup',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
  assert.match(tour(h).textContent,/1 из 4/);
  assert.equal(h.node('incomeTotal').textContent,'57 600 ₽');
  assert.equal(h.node('monthlyGrowthValue').textContent,'+8%');
  assert.equal(h.node('monthlyGrowthValue').classList.contains('is-empty'),false);
  assert.equal(h.node('incomeChartSvg').querySelector('rect').namespaceURI,'http://www.w3.org/2000/svg');
  const records=JSON.stringify([...h.records]),categories=JSON.stringify([...h.categories]);
  const beforeStorage=storage(h),beforeCalls=[...h.calls];
  next(h);assert.match(tour(h).textContent,/2 из 4/);
  assert.equal(h.node('monthlyAnalyticsCategories').children.length,4);
  const dayTotals=Array(31).fill(0);
  [[1,5000],[4,6500],[7,4100],[10,12000],[14,7200],[18,8400],[23,6400],[28,8000]].forEach(([day,value])=>{dayTotals[day-1]=value;});
  assert.equal(dayTotals.reduce((sum,value)=>sum+value,0),57600);
  const expectedChart=h.w.document.createElement('div');
  h.w.qPokoyRenderIncomeSpikes(expectedChart,dayTotals,{month:9,year:2026});
  assert.equal(h.node('monthlyHeroBars').innerHTML,expectedChart.innerHTML);
  assert.equal(h.node('monthlyHeroBars').querySelectorAll('.monthly-spike-marker').length,8);
  assert.equal(h.node('monthlyHeroBars').querySelectorAll('.monthly-spike-label').length,3);
  assert.match(h.node('monthlyHeroDaysLabels').textContent,/151015202531/);
  next(h);assert.match(tour(h).textContent,/3 из 4/);
  assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
  assert.equal(h.node('incomeForm').hidden,true);
  h.node('openIncomeForm').click();await h.settle();
  assert.equal(h.node('incomeForm').hidden,false);assert.equal(tour(h),null);
  h.node('categorySelect').click();await h.settle();
  assert.match(tour(h).textContent,/Не нашли нужную категорию/);
  assert.ok(h.node('categoryPopup').querySelector('.category-popup-create'));
  assert.equal(tour(h).querySelector('[data-tour-next]'),null);
  h.node('categoryPopup').querySelector('button.category-option').click();
  assert.equal(tour(h),null);
  assert.equal(h.node('incomeCategory').value,'Зарплата');
  h.node('cancelIncome').click();
  assert.equal(JSON.stringify([...h.records]),records);
  assert.equal(JSON.stringify([...h.categories]),categories);
  assert.equal(storage(h),beforeStorage);assert.deepEqual(h.calls,[...beforeCalls,'completeOnboarding']);
  assert.deepEqual(h.errors,[]);
  // Ordinary existing CRUD handlers work after completing the presentation.
  h.add(123,'After tour');await h.settle();
  assert.equal(h.records.get(userA.user_id).length,2);
  assert.equal(h.calls.filter(value=>value==='addIncome').length,1);
});

test('Skip persists completion once and restores real UI without storing demo data',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
  const before=storage(h),calls=[...h.calls];
  tour(h).querySelector('[data-tour-skip]').click();
  assert.equal(tour(h),null);assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-shade,.qp-tour-focus,.qp-tour-demo-badge'),null);
  h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
  assert.equal(tour(h),null);assert.equal(storage(h),before);assert.deepEqual(h.calls,[...calls,'completeOnboarding']);
  assert.deepEqual(h.errors,[]);
  const reload=await createHarness({onboarding:true,onboardingCompleted:h.w.qPokoyAuth.getUser().onboarding_completed});t.after(()=>reload.close());
  assert.equal(tour(reload),null);
  await h.logout();await h.login();assert.equal(tour(h),null);
});

test('onboarding waits for authenticated bootstrap and never appears on signed-out screen',async t=>{
  for(const options of [{signedOut:true},{signedOut:true,width:390,height:844,pointer:'coarse'}]){
    const h=await createHarness({...options,onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
    assert.equal(tour(h),null);assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
    assert.deepEqual(h.errors,[]);
  }
  let release;const bootstrapGate=new Promise(resolve=>{release=resolve;});
  const h=await createHarness({onboarding:true,onboardingCompleted:false,bootstrapGate});t.after(()=>h.close());
  assert.equal(tour(h),null);release();await h.settle();
  assert.match(tour(h).textContent,/1 из 4/);assert.deepEqual(h.errors,[]);
});

test('mobile has three unchanged texts and indicators, completes at plus and never shows a category step',async t=>{
  const d=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>d.close());
  const expected=[d.node('qpTourText').textContent];next(d);expected.push(d.node('qpTourText').textContent);
  next(d);expected.push(d.node('qpTourText').textContent);d.node('openIncomeForm').click();d.node('categorySelect').click();await d.settle();
  expected.push(d.node('qpTourText').textContent);
  for(const width of [360,390,420]){
    const h=await createHarness({onboarding:true,onboardingCompleted:false,width,height:844,pointer:'coarse'});t.after(()=>h.close());
    const before=JSON.stringify([...h.records]),cats=JSON.stringify([...h.categories]);
    assert.match(tour(h).textContent,/1 из 3/);
    assert.equal(h.node('qpTourText').textContent,expected[0]);
    assert.equal(tour(h).dataset.target,'income-top');
    assert.equal(h.node('incomeRecent').classList.contains('is-collapsed'),true);
    next(h);assert.equal(h.node('qpTourText').textContent,expected[1]);
    assert.match(tour(h).textContent,/2 из 3/);
    assert.equal(tour(h).dataset.target,'monthly-statistics');
    assert.equal(h.node('qpTourText').textContent,'А здесь — статистика и анализ ваших доходов.');
    next(h);assert.equal(h.node('qpTourText').textContent,expected[2]);
    assert.match(tour(h).textContent,/3 из 3/);
    assert.equal(tour(h).dataset.target,'openIncomeForm');
    assert.equal(h.node('incomeTotal').textContent,'100 ₽');
    h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
    assert.equal(tour(h),null);
    assert.equal(h.node('incomeForm').hidden,false);
    assert.ok(h.node('categoryPopup').querySelector('.category-popup-create-trigger'));
    h.node('categoryPopup').querySelector('button.category-option').click();await h.settle();
    assert.equal(tour(h),null);assert.equal(h.w.qPokoyAuth.getUser().onboarding_completed,true);
    assert.equal(h.calls.filter(c=>c==='completeOnboarding').length,1);
    assert.equal(JSON.stringify([...h.records]),before);assert.equal(JSON.stringify([...h.categories]),cats);
    assert.deepEqual(h.errors,[]);
  }
});

test('mobile statistics outline unions exactly four zones, including on short screens and resize',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false,width:390,height:500,pointer:'coarse'});t.after(()=>h.close());
  const selectors=['#monthlyAnalytics .monthly-summary-best','#monthlyGrowthCard','#monthlyAnalytics .monthly-summary-average','#monthlyTotalCard'];
  const rects=[{left:20,top:100,right:200,bottom:316},{left:208,top:100,right:370,bottom:204},{left:208,top:212,right:370,bottom:316},{left:20,top:324,right:370,bottom:562}];
  selectors.forEach((selector,i)=>{h.w.document.querySelector(selector).getBoundingClientRect=()=>({...rects[i],width:rects[i].right-rects[i].left,height:rects[i].bottom-rects[i].top});});
  h.node('monthlyYearGrowthCard').getBoundingClientRect=()=>({left:0,top:570,right:390,bottom:900,height:330});
  h.node('monthlyAnalyticsCategories').getBoundingClientRect=()=>({left:0,top:910,right:390,bottom:1200,height:290});
  // Model native scrolling: client rectangles move, card dimensions do not.
  h.w.scrollTo=({top})=>{const delta=top-(h.w.scrollY||0);Object.defineProperty(h.w,'scrollY',{value:top,configurable:true});rects.forEach(rect=>{rect.top-=delta;rect.bottom-=delta;});};
  next(h);await h.settle();
  const outline=h.w.document.querySelector('.qp-tour-focus');
  assert.equal(tour(h).dataset.target,'monthly-statistics');
  assert.equal(parseFloat(outline.style.left),14);
  assert.equal(parseFloat(outline.style.width),362);
  assert.equal(parseFloat(outline.style.top)+parseFloat(outline.style.height),rects[3].bottom+6);
  assert.ok(parseFloat(tour(h).style.top)>rects[3].bottom+6);
  assert.equal(tour(h).dataset.placement,'below');
  assert.equal(rects[3].bottom-rects[0].top,462);
  rects[3].bottom+=20;h.w.dispatchEvent(new h.w.Event('resize'));await h.settle();
  assert.equal(parseFloat(outline.style.top)+parseFloat(outline.style.height),rects[3].bottom+6);
  assert.equal(tour(h).dataset.placement,'below');assert.deepEqual(h.errors,[]);
});

test('mobile category trigger opens the existing editor and creates/selects without another tour',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false,width:390,height:844,pointer:'coarse'});t.after(()=>h.close());
  next(h);next(h);h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
  const popup=h.node('categoryPopup');
  popup.querySelector('.category-popup-create-trigger').click();
  popup.querySelector('.category-popup-create-input').value='Mobile category test';
  popup.querySelector('.category-popup-create-btn').click();await h.settle();
  assert.equal(h.node('incomeCategory').value,'Mobile category test');
  assert.equal(h.calls.filter(c=>c==='addCategory').length,1);
  assert.equal(popup.classList.contains('open'),false);assert.equal(tour(h),null);
  h.node('categorySelect').click();await h.settle();
  popup.querySelector('button.category-option').click();
  assert.equal(h.node('incomeCategory').value,'Зарплата');assert.equal(tour(h),null);
  assert.deepEqual(h.errors,[]);
});

test('temporary mobile test mode repeats completed accounts on fresh launch and login, not desktop',async t=>{
  for(let launch=0;launch<3;launch++){
    const h=await createHarness({onboarding:true,onboardingCompleted:true,width:390,height:844,pointer:'coarse'});t.after(()=>h.close());
    assert.equal(h.node('qpTourText').textContent,'Здесь самое важное: доход за текущий месяц, а также годовой график.');
    tour(h).querySelector('[data-tour-skip]').click();await h.settle();
    assert.equal(tour(h),null);assert.equal(h.calls.includes('completeOnboarding'),false);
    assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
    await h.logout();await h.login();assert.ok(tour(h));
    assert.deepEqual(h.errors,[]);
  }
  const desktop=await createHarness({onboarding:true,onboardingCompleted:true});t.after(()=>desktop.close());
  assert.equal(tour(desktop),null);await desktop.logout();await desktop.login();assert.equal(tour(desktop),null);
});

test('mobile skip saves normal completion and restores the prior recent/history state',async t=>{
  const h=await createHarness({width:390,height:844,pointer:'coarse',onboardingCompleted:false});t.after(()=>h.close());
  h.node('incomeRecentToggle').click();h.node('incomeRecentHistory').click();
  await h.settle();
  const prior=storage(h);
  h.w.eval(require('node:fs').readFileSync(require('node:path').join(__dirname,'../js/onboarding.js'),'utf8'));
  await h.settle();assert.equal(h.node('incomeRecent').classList.contains('is-history-open'),false);
  tour(h).querySelector('[data-tour-skip]').click();await h.settle();
  assert.equal(h.node('incomeRecent').classList.contains('is-history-open'),true);
  assert.equal(storage(h),prior);assert.equal(h.calls.filter(c=>c==='completeOnboarding').length,1);
  assert.deepEqual(h.errors,[]);
});

test('real data render cancels presentation rather than retaining stale demo values',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
  h.w.renderIncomes();await h.settle();
  assert.equal(tour(h),null);assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
  assert.deepEqual(h.errors,[]);
});

test('empty account demo reveals the best share temporarily and returns to genuine zero state',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false,empty:true});t.after(()=>h.close());
  assert.equal(h.node('monthlyBestShare').hidden,false);
  assert.equal(h.node('monthlyBestShare').textContent,'69%');
  assert.equal(h.records.get(userA.user_id).length,0);
  next(h);next(h);await h.settle();
  assert.equal(h.node('incomeTotal').textContent,'0 ₽');
  assert.equal(h.node('monthlyBestShare').hidden,true);
  assert.equal(h.records.get(userA.user_id).length,0);
  assert.equal(h.calls.some(value=>/add|update|replace/i.test(value)),false);
  assert.deepEqual(h.errors,[]);
});

test('category hint closes on creation without blocking the existing category handler',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
  next(h);next(h);h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
  const popup=h.node('categoryPopup');
  assert.match(tour(h).textContent,/4 из 4/);
  popup.querySelector('.category-popup-create-input').value='Tour test category';
  popup.querySelector('.category-popup-create-btn').click();
  assert.equal(tour(h),null);await h.settle();
  assert.equal(h.calls.filter(value=>value==='addCategory').length,1);
  assert.equal(h.node('incomeCategory').value,'Tour test category');
  assert.ok(h.categories.get(userA.user_id).some(category=>category.name==='Tour test category'));
  assert.deepEqual(h.errors,[]);
});

test('Skip from category hint removes overlay without closing or changing the real form',async t=>{
  const h=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>h.close());
  next(h);next(h);h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
  tour(h).querySelector('[data-tour-skip]').click();
  assert.equal(tour(h),null);assert.equal(h.node('incomeForm').hidden,false);
  h.node('categorySelect').click();
  h.node('categoryPopup').querySelector('button.category-option').click();
  assert.equal(h.node('incomeCategory').value,'Зарплата');
  assert.equal(h.calls.some(value=>value==='addCategory'),false);
  assert.deepEqual(h.errors,[]);
});


test('legacy missing/null and completed accounts never see onboarding',async t=>{
  for(const flag of [undefined,null,true]){
    const h=await createHarness({onboarding:true,onboardingCompleted:flag});t.after(()=>h.close());
    assert.equal(tour(h),null);assert.equal(h.calls.includes('completeOnboarding'),false);assert.deepEqual(h.errors,[]);
  }
});

test('completion failure closes locally without demo leakage; lifecycle cancellation does not complete',async t=>{
  const failed=await createHarness({onboarding:true,onboardingCompleted:false,completionError:true});t.after(()=>failed.close());
  tour(failed).querySelector('[data-tour-skip]').click();await failed.settle();
  assert.equal(tour(failed),null);assert.equal(failed.calls.filter(x=>x==='completeOnboarding').length,1);assert.deepEqual(failed.errors,[]);
  await failed.logout();await failed.login();assert.ok(tour(failed));
  const cancelled=await createHarness({onboarding:true,onboardingCompleted:false});t.after(()=>cancelled.close());
  cancelled.w.renderIncomes();await cancelled.settle();
  assert.equal(cancelled.calls.includes('completeOnboarding'),false);
});

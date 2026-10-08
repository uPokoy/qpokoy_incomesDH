'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHarness,userA}=require('./helpers/frontend-harness');
const tour=h=>h.node('qpOnboarding');
const next=h=>tour(h).querySelector('[data-tour-next]').click();
const storage=h=>JSON.stringify(Object.fromEntries(Object.keys(h.w.localStorage).map(key=>[key,h.w.localStorage.getItem(key)])));

test('desktop tour uses DOM-only demo, restores real records before plus and waits for actual category popup',async t=>{
  const h=await createHarness({onboarding:true});t.after(()=>h.close());
  assert.match(tour(h).textContent,/1 из 4/);
  assert.equal(h.node('incomeTotal').textContent,'57 600 ₽');
  assert.equal(h.node('monthlyGrowthValue').textContent,'+8%');
  assert.equal(h.node('monthlyGrowthValue').classList.contains('is-empty'),false);
  assert.equal(h.node('incomeChartSvg').querySelector('rect').namespaceURI,'http://www.w3.org/2000/svg');
  const records=JSON.stringify([...h.records]),categories=JSON.stringify([...h.categories]);
  const beforeStorage=storage(h),beforeCalls=[...h.calls];
  next(h);assert.match(tour(h).textContent,/2 из 4/);
  assert.equal(h.node('monthlyAnalyticsCategories').children.length,4);
  next(h);assert.match(tour(h).textContent,/3 из 4/);
  assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
  assert.equal(h.node('incomeForm').hidden,true);
  h.node('openIncomeForm').click();await h.settle();
  assert.equal(h.node('incomeForm').hidden,false);assert.equal(tour(h),null);
  h.node('categorySelect').click();await h.settle();
  assert.match(tour(h).textContent,/Не нашли нужную категорию/);
  assert.ok(h.node('categoryPopup').querySelector('.category-popup-create'));
  next(h);assert.equal(tour(h),null);
  h.node('cancelIncome').click();
  assert.equal(JSON.stringify([...h.records]),records);
  assert.equal(JSON.stringify([...h.categories]),categories);
  assert.equal(storage(h),beforeStorage);assert.deepEqual(h.calls,beforeCalls);
  assert.deepEqual(h.errors,[]);
  // Ordinary existing CRUD handlers work after completing the presentation.
  h.add(123,'After tour');await h.settle();
  assert.equal(h.records.get(userA.user_id).length,2);
  assert.equal(h.calls.filter(value=>value==='addIncome').length,1);
});

test('Skip stops all later hints, restores real UI and does not persist tour status',async t=>{
  const h=await createHarness({onboarding:true});t.after(()=>h.close());
  const before=storage(h),calls=[...h.calls];
  tour(h).querySelector('[data-tour-skip]').click();
  assert.equal(tour(h),null);assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-shade,.qp-tour-focus,.qp-tour-demo-badge'),null);
  h.node('openIncomeForm').click();h.node('categorySelect').click();await h.settle();
  assert.equal(tour(h),null);assert.equal(storage(h),before);assert.deepEqual(h.calls,calls);
  assert.deepEqual(h.errors,[]);
  const reload=await createHarness({onboarding:true});t.after(()=>reload.close());
  assert.match(tour(reload).textContent,/1 из 4/);
});

test('onboarding waits for authenticated bootstrap and never appears on mobile or signed-out screen',async t=>{
  for(const options of [{signedOut:true},{width:390,height:844,pointer:'coarse'}]){
    const h=await createHarness({...options,onboarding:true});t.after(()=>h.close());
    assert.equal(tour(h),null);assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
    assert.deepEqual(h.errors,[]);
  }
  let release;const bootstrapGate=new Promise(resolve=>{release=resolve;});
  const h=await createHarness({onboarding:true,bootstrapGate});t.after(()=>h.close());
  assert.equal(tour(h),null);release();await h.settle();
  assert.match(tour(h).textContent,/1 из 4/);assert.deepEqual(h.errors,[]);
});

test('real data render cancels presentation rather than retaining stale demo values',async t=>{
  const h=await createHarness({onboarding:true});t.after(()=>h.close());
  h.w.renderIncomes();await h.settle();
  assert.equal(tour(h),null);assert.match(h.node('incomeTotal').textContent,/100/);
  assert.equal(h.w.document.querySelector('.qp-tour-demo-badge'),null);
  assert.deepEqual(h.errors,[]);
});

test('empty account demo reveals the best share temporarily and returns to genuine zero state',async t=>{
  const h=await createHarness({onboarding:true,empty:true});t.after(()=>h.close());
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

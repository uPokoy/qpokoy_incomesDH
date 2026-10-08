'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHarness}=require('./helpers/frontend-harness');

function actionClock(w){
  const timers=new Map();let id=-1;
  const set=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w);
  w.setTimeout=(fn,delay,...args)=>{
    if(delay!==5000)return set(fn,delay,...args);
    const handle=id--;timers.set(handle,fn);return handle;
  };
  w.clearTimeout=handle=>{if(timers.has(handle))timers.delete(handle);else clear(handle);};
  return {timers,expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}

test('desktop shares one action selection and timer across recent cards and history rows',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  h.add(200,'Second income');await h.settle();
  const clock=actionClock(h.w);
  const cards=[...h.node('incomeRecentGrid').querySelectorAll('.income-recent-card')];
  const rows=[...h.node('incomeList').querySelectorAll('.income-row:not(.income-header)')];
  const open=()=>h.w.document.querySelectorAll('.is-desktop-actions-open');
  assert.equal(open().length,0);
  cards[0].click();cards[0].click();
  assert.equal(clock.timers.size,1);
  assert.equal(open().length,1);
  cards[1].click();assert.equal(open()[0],cards[1]);
  assert.equal(cards[0].classList.contains('is-selected'),false);
  rows[0].click();assert.equal(open()[0],rows[0]);
  rows[1].click();assert.equal(open()[0],rows[1]);
  clock.expire();assert.equal(open().length,0);
  cards[0].click();h.node('incomeTotal').click();
  assert.equal(open().length,0);assert.equal(clock.timers.size,0);
  rows[0].click();h.w.renderIncomes();
  assert.equal(open().length,0);assert.equal(clock.timers.size,0);
  assert.deepEqual(h.errors,[]);
});

test('desktop action clicks close selection and keep existing edit/delete workflows',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  const card=h.node('incomeRecentGrid').querySelector('.income-recent-card');
  card.click();card.querySelector('.income-recent-edit').click();
  assert.equal(card.classList.contains('is-desktop-actions-open'),false);
  assert.equal(h.node('incomeAmount').value,'100');
  h.node('incomeAmount').value='250';h.node('saveIncome').click();await h.settle();
  assert.equal(h.calls.filter(x=>x==='updateIncome').length,1);
  const updated=h.node('incomeRecentGrid').querySelector('.income-recent-card');
  updated.click();updated.querySelector('.income-recent-delete').click();
  assert.equal(updated.classList.contains('is-desktop-actions-open'),false);
  assert.ok(h.node('qpConfirmOverlay').querySelector('[role="dialog"]'));
  h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();
  assert.equal(h.calls.filter(x=>x==='deleteIncome').length,1);
  assert.equal(h.node('incomeRecentGrid').querySelector('.income-recent-card'),null);
  h.add(300,'History action');await h.settle();
  const row=h.node('incomeList').querySelector('.income-row:not(.income-header)');
  row.click();row.querySelector('.edit-income').click();
  assert.equal(row.classList.contains('is-desktop-actions-open'),false);
  assert.equal(h.node('incomeAmount').value,'300');
  h.node('cancelIncome').click();
  const deleteRow=h.node('incomeList').querySelector('.income-row:not(.income-header)');
  const deleteButton=deleteRow.querySelector('.delete-income');
  // outside-only JSDOM disables inline handlers; execute the actual unchanged attribute.
  deleteButton.onclick=h.w.Function('event',deleteButton.getAttribute('onclick'));
  deleteRow.click();deleteButton.click();
  assert.equal(deleteRow.classList.contains('is-desktop-actions-open'),false);
  h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();
  assert.equal(h.calls.filter(x=>x==='deleteIncome').length,2);
  assert.deepEqual(h.errors,[]);
});

test('mobile keeps its existing action markup and does not activate desktop selection',async t=>{
  const h=await createHarness({width:390,height:844,pointer:'coarse'});t.after(()=>h.close());
  const card=h.node('incomeRecentGrid').querySelector('.income-recent-card');
  card.click();
  assert.equal(card.querySelector('.income-recent-delete'),null);
  assert.equal(card.querySelector('.desktop-income-pencil'),null);
  assert.equal(card.classList.contains('is-desktop-actions-open'),false);
  assert.ok(card.querySelector('.income-recent-mobile-delete'));
  assert.ok(h.node('incomeList').querySelector('.history-swipe-row .history-swipe-actions'));
  assert.deepEqual(h.errors,[]);
});

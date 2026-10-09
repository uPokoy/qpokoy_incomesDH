'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHarness}=require('./helpers/frontend-harness');

test('mobile full-history collapse keeps the full button target and restores recent cards',async t=>{
  const h=await createHarness({width:390,height:844,pointer:'coarse'});
  t.after(()=>h.close());
  h.node('incomeRecentToggle').click();
  h.node('incomeRecentHistory').click();
  assert.equal(h.node('incomeRecentHistoryPanel').hidden,false);
  assert.ok(h.node('incomeRecentHistory').querySelector('svg.income-history-collapse-icon'));
  assert.equal(h.node('incomeRecentHistory').getAttribute('aria-label'),'Свернуть всю историю до последних доходов');
  // The handler remains on the button, not the child icon.
  h.node('incomeRecentHistory').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
  assert.equal(h.node('incomeRecentHistoryPanel').hidden,true);
  assert.equal(h.node('incomeRecent').classList.contains('is-collapsed'),false);
  assert.equal(h.node('incomeRecentHistory').textContent,'Вся история');
  assert.deepEqual(h.errors,[]);
});

test('mobile settings close full history without collapsing recent cards or reopening history',async t=>{
  const h=await createHarness({width:390,height:844,pointer:'coarse'});
  t.after(()=>h.close());
  h.node('incomeRecentToggle').click();
  h.node('incomeRecentHistory').click();
  h.node('analyticsSettingsToggle').click();
  assert.equal(h.node('incomeRecentHistoryPanel').hidden,true);
  assert.equal(h.node('incomeRecent').classList.contains('is-history-open'),false);
  assert.equal(h.node('incomeRecent').classList.contains('is-collapsed'),false);
  h.node('analyticsSettingsToggle').click();
  assert.equal(h.node('incomeRecentHistoryPanel').hidden,true);
  h.node('incomeRecentToggle').click();
  h.node('analyticsSettingsToggle').click();
  h.node('analyticsSettingsToggle').click();
  assert.equal(h.node('incomeRecent').classList.contains('is-collapsed'),true);
  assert.deepEqual(h.errors,[]);
});

test('desktop history label and settings/history independence are unchanged',async t=>{
  const h=await createHarness();t.after(()=>h.close());
  h.node('incomeRecentHistory').click();
  assert.equal(h.node('incomeRecentHistory').textContent,'Последние доходы');
  assert.equal(h.node('incomeRecentHistory').querySelector('svg'),null);
  h.node('analyticsSettingsToggle').click();
  assert.equal(h.node('incomeRecent').classList.contains('is-history-open'),true);
  assert.deepEqual(h.errors,[]);
});

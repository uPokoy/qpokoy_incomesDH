'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHarness,userA,userB}=require('./helpers/frontend-harness');
async function boot(t,options){const h=await createHarness(options);t.after(()=>h.close());return h;}
function rows(h){return [...h.node('incomeList').querySelectorAll('.income-row:not(.income-header)')];}
function noErrors(h){assert.deepEqual(h.errors,[]);}
test('cold authenticated startup builds unique dashboard, editor, history, analytics and settings components',async t=>{
  const h=await boot(t);
  for(const id of ['income','incomeForm','incomeDate','incomeAmount','incomeCategory','incomeList','incomeAnalytics','analyticsSettingsToggle','settings','qpAccountCard','qpAuthLogoutBtn','qpBillingSettings','qpBillingPurchase','qpBillingDisableRenew','qpCategoryList','qpBackgroundSettings']){
    assert.equal(h.w.document.querySelectorAll('#'+id).length,1,id);
  }
  assert.equal(h.node('incomeForm').closest('#income').id,'income');
  assert.equal(h.node('incomeList').closest('#history').id,'history');
  assert.equal(h.node('settings').parentElement,h.node('analyticsSettingsHost'));
  assert.equal(h.node('qpBillingSettings').closest('#qpAccountCard').id,'qpAccountCard');
  assert.equal(h.node('qpAuthGate').hidden,true);
  assert.equal(rows(h).length,1);
  assert.match(h.node('qpAccountEmail').textContent,/a@example/);
  noErrors(h);
});
test('signed-out cold startup, login, logout without reload and repeat login restore data once',async t=>{
  const h=await boot(t,{signedOut:true});
  assert.equal(h.node('qpAuthGate').hidden,false);assert.equal(rows(h).length,0);
  await h.login();assert.equal(rows(h).length,1);
  // Seed stale visible shares so logout must actively clear both labels.
  h.node('analyticsBestShare').textContent='73%';
  h.node('analyticsWorstShare').textContent='17%';
  await h.logout();
  assert.equal(rows(h).length,0);assert.equal(h.node('qpAuthGate').hidden,false);
  assert.match(h.node('incomeTotal').textContent,/^0\s*₽$/);
  assert.equal(h.node('analyticsBestShare').textContent.trim(),'0%');
  assert.equal(h.node('analyticsWorstShare').textContent.trim(),'0%');
  assert.equal(h.api.getToken(),null);
  await h.login();assert.equal(rows(h).length,1);noErrors(h);
});
test('income add, edit and confirmed delete update the actual DOM and cloud boundary',async t=>{
  const h=await boot(t);
  h.add(123,'DOM regression record');await h.settle();
  assert.equal(rows(h).length,2);
  const record=h.records.get(userA.user_id).find(x=>x.description==='DOM regression record');
  h.node('incomeRecentHistory').click();
  h.node('incomeList').querySelector(`.edit-income[data-id="${record.id}"]`).click();
  assert.equal(h.node('incomeForm').hidden,false);
  h.node('incomeAmount').value='456';h.node('saveIncome').click();await h.settle();
  assert.equal(h.records.get(userA.user_id).find(x=>x.id===record.id).amount,456);
  assert.match(h.node('incomeList').textContent,/456/);
  // jsdom outside-only does not compile inline attributes; call the exact global
  // used by the existing delete button's onclick, then confirm through its DOM.
  h.w.qPokoyDeleteIncome(record.id);
  h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();
  assert.equal(rows(h).length,1);assert.equal(h.node('incomeList').textContent.includes('DOM regression record'),false);
  assert.deepEqual(h.calls.filter(x=>['addIncome','updateIncome','deleteIncome'].includes(x)),['addIncome','updateIncome','deleteIncome']);
  noErrors(h);
});
test('delayed add response cannot repopulate another user UI after logout and login',async t=>{
  const h=await boot(t);const release=h.holdAdd();
  h.add(333,'User A pending response');await h.settle();
  await h.logout();await h.login(userB);
  assert.equal(rows(h).length,1);assert.match(h.node('incomeList').textContent,/b@example/);
  release();await h.settle();
  assert.equal(rows(h).length,1);
  assert.equal(h.node('incomeList').textContent.includes('User A pending response'),false);
  assert.match(h.node('qpAccountEmail').textContent,/b@example/);
  assert.equal(h.records.get(userB.user_id).length,1);noErrors(h);
});
test('lost add response retains pending journal and next login reconciles server record without duplicates',async t=>{
  const h=await boot(t);const release=h.holdAdd({fail:true});
  h.add(222,'Lost response');release();await h.settle();
  const journal=()=>JSON.parse(h.w.localStorage.getItem('qPokoyIncomeWriteJournalV1')||'[]');
  assert.equal(journal().length,1);assert.equal(h.records.get(userA.user_id).length,2);
  await h.logout();await h.login();
  assert.equal(rows(h).length,2);assert.equal(journal().length,0);
  assert.equal(h.calls.filter(x=>x==='addIncome').length,1);
  // The deliberately injected error is expected, not a standard-flow JS error.
  assert.equal(h.errors.length,1);
  assert.match(h.errors[0],/lost response/);
});
test('settings gear, all tabs, Month/Year, history search and categories work with real handlers',async t=>{
  const h=await boot(t);
  h.node('analyticsSettingsToggle').click();assert.equal(h.node('analyticsSettingsHost').hidden,false);
  for(const tab of ['categories','appearance','data']){
    h.node('settings').querySelector(`[data-settings-tab-target="${tab}"]`).click();
    assert.equal(h.node('settings').dataset.settingsTab,tab);
  }
  h.node('analyticsSettingsToggle').click();assert.equal(h.node('analyticsSettingsHost').hidden,true);
  h.node('analyticsModeYear').click();assert.equal(h.node('incomeAnalytics').classList.contains('is-monthly'),false);
  h.node('analyticsModeMonth').click();assert.equal(h.node('incomeAnalytics').classList.contains('is-monthly'),true);
  h.node('incomeRecentHistory').click();assert.equal(h.node('incomeRecentHistoryPanel').hidden,false);
  h.node('historySearch').value='missing fixture';h.node('historySearch').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(rows(h).length,0);
  h.node('historySearch').value='';h.node('historySearch').dispatchEvent(new h.w.Event('input',{bubbles:true}));assert.equal(rows(h).length,1);
  h.node('qpCategoryInput').value='Regression category';h.node('qpCategoryAddBtn').click();await h.settle();
  assert.match(h.node('qpCategoryList').textContent,/Regression category/);noErrors(h);
});
test('read-only billing disables write controls but retains data and analytics',async t=>{
  const h=await boot(t,{readOnly:true});
  assert.equal(h.w.qPokoyCanWrite(),false);assert.equal(rows(h).length,1);
  assert.equal(h.node('saveIncome').disabled,true);
  const before=h.calls.filter(x=>x==='addIncome').length;
  h.add();await h.settle();assert.equal(h.calls.filter(x=>x==='addIncome').length,before);
  h.node('analyticsModeYear').click();assert.equal(h.node('incomeAnalytics').classList.contains('is-monthly'),false);noErrors(h);
});
test('backup exporter returns current records and import refreshes actual income DOM',async t=>{
  const h=await boot(t);
  assert.equal(h.w.IncomeBackup.getAllIncomeRecords().length,1);
  h.node('exportDataBtn').click();assert.equal(h.downloads.length,1);
  const reader=new h.w.FileReader();
  const exported=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(JSON.parse(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(h.downloads[0]);});
  assert.equal(exported.format,'qPokoy-income-backup');
  assert.equal(exported.incomes.length,1);assert.equal(exported.incomes[0].amount,100);
  await h.w.IncomeBackup.importData({text:async()=>JSON.stringify({incomes:[{date:'08.10.26',category:'Зарплата',amount:999,description:'Imported fixture'}]})});
  await h.settle();assert.equal(rows(h).length,1);assert.match(h.node('incomeList').textContent,/Imported fixture/);
  assert.equal(h.w.IncomeBackup.getAllIncomeRecords()[0].amount,999);noErrors(h);
});
test('subscription UI confirms auto-renew change and retains the account',async t=>{
  const h=await boot(t);const before=h.node('qpAccountEmail').textContent;
  assert.equal(h.node('qpBillingDisableRenew').disabled,false);
  h.node('qpBillingDisableRenew').click();
  h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();
  assert.equal(h.billing.auto_renew,false);
  assert.match(h.node('qpBillingDisableRenew').textContent,/Подключить/);
  assert.equal(h.node('qpAccountEmail').textContent,before);noErrors(h);
});
test('history category filter survives redraw and category removal uses confirmation',async t=>{
  const h=await boot(t);
  h.node('qpCategoryInput').value='Disposable category';h.node('qpCategoryAddBtn').click();await h.settle();
  const category=h.categories.get(userA.user_id).find(x=>x.name==='Disposable category');
  h.node('qpCategoryList').querySelector(`[data-id="${category.id}"].qp-category-delete`).click();
  h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();
  assert.equal(h.node('qpCategoryList').textContent.includes('Disposable category'),false);
  h.node('qpCategoryInput').value='Other';h.node('qpCategoryAddBtn').click();await h.settle();
  h.add(42,'Excluded by category filter','Other');await h.settle();assert.equal(rows(h).length,2);
  h.node('incomeRecentHistory').click();
  const filter=()=>h.node('incomeList').querySelector('[data-filter="category"]');
  filter().click();
  [...h.w.document.querySelectorAll('.filter-choice')].find(x=>x.textContent.includes('Зарплата')).click();
  h.w.applyIncomeHeaderFilters();assert.equal(rows(h).length,1);
  filter().click();
  const selected=h.w.document.querySelector('.filter-choice.selected');
  assert.match(selected.textContent,/Зарплата/);noErrors(h);
});


test('bank amounts retain raw input/paste and save truncated whole rubles, including edit',async t=>{
  const h=await boot(t,{empty:true});
  for(const [input,expected] of [['100',100],['100.90',100],['100,90',100],['1 250,75',1250],['1 250.75',1250],['199.99',199]]){
    h.node('openIncomeForm').click();
    const field=h.node('incomeAmount');
    const paste=new h.w.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(paste,'clipboardData',{value:{getData:()=>input}});field.dispatchEvent(paste);
    assert.equal(paste.defaultPrevented,false);
    field.value=input;field.dispatchEvent(new h.w.Event('input',{bubbles:true}));assert.equal(field.value,input);
    h.node('incomeDate').value='07.10.26';h.node('incomeCategory').value='Зарплата';h.node('saveIncome').click();await h.settle();
    assert.equal(h.records.get(userA.user_id).at(-1).amount,expected);
  }
  const first=h.records.get(userA.user_id)[0];
  h.node('incomeList').querySelector('.edit-income[data-id="'+first.id+'"]').click();h.node('incomeAmount').value='199.99';h.node('saveIncome').click();await h.settle();
  assert.equal(h.records.get(userA.user_id).find(x=>x.id===first.id).amount,199);
  for(const input of ['abc',',','.','0','-100','','Infinity','1.2.3','1e3','0.99']){
    const count=h.records.get(userA.user_id).length;h.add(input);await h.settle();
    assert.equal(h.records.get(userA.user_id).length,count,input);h.node('cancelIncome').click();
  }
  assert.ok(h.w.IncomeBackup.getAllIncomeRecords().every(x=>Number.isInteger(x.amount)));noErrors(h);
});

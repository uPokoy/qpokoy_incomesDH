'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const postcss=require('postcss');
const {createHarness,userA}=require('./helpers/frontend-harness');
async function boot(t,options){const h=await createHarness(options);t.after(()=>h.close());return h;}
function touch(h,node,type,x,y){
  const event=new h.w.Event(type,{bubbles:true,cancelable:true});
  const point={clientX:x,clientY:y};
  Object.defineProperties(event,{
    touches:{value:type==='touchstart'?[point]:[]},
    changedTouches:{value:[point]}
  });
  node.dispatchEvent(event);
}

test('notice overlay replacement/dismissal remains independent of page enhancements',async t=>{
  const h=await boot(t,{width:390,height:844,pointer:'coarse'});
  h.w.qPokoyNotice('First','<b>literal text</b>','success');
  assert.equal(h.node('qpNoticeMessage').textContent,'<b>literal text</b>');
  assert.equal(h.node('qpNoticeMessage').querySelector('b'),null);
  h.w.qPokoyNotice('Second','Replacement','error');
  assert.equal(h.w.document.querySelectorAll('#qpNoticeOverlay').length,1);
  assert.equal(h.node('qpNoticeTitle').textContent,'Second');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(h.node('qpNoticeOverlay'),null);
  h.w.qPokoyNotice('Third','Close by button');
  h.node('qpNoticeOverlay').querySelector('[data-notice-close]').click();
  assert.equal(h.node('qpNoticeOverlay'),null);

  // The legacy initializer still runs at the same startup point after the split.
  h.node('analyticsModeMonth').click();
  touch(h,h.node('incomeAnalytics'),'touchstart',200,100);
  touch(h,h.node('incomeAnalytics'),'touchend',100,100);
  assert.equal(h.node('analyticsModeYear').classList.contains('active'),true);
  const input=h.node('incomeDate');input.value='07.10.26';input.setSelectionRange(2,2);
  input.select();assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,2);
  // On coarse-pointer devices the existing select override is a no-op.
  assert.equal(h.w.IncomeStore.load().length,1);
  assert.deepEqual(h.errors,[]);
});

test('backup binding still captures one export and delegates input import without billing writes',async t=>{
  const h=await boot(t);
  let billingWrites=0;
  h.api.setBillingAutoRenew=async()=>{billingWrites++;};
  h.node('exportDataBtn').click();assert.equal(h.downloads.length,1);
  assert.equal(h.node('qpNoticeOverlay'),null); // Capturing exporter, not app exporter.
  const input=h.node('importDataInput');
  const file={text:async()=>JSON.stringify({incomes:[{
    date:'08.10.26',category:'Зарплата',amount:321,description:'Stage 4 fixture'
  }]})};
  Object.defineProperty(input,'files',{configurable:true,value:[file]});
  input.dispatchEvent(new h.w.Event('change',{bubbles:true}));await h.settle();
  assert.equal(h.records.get(userA.user_id).length,1);
  assert.equal(h.records.get(userA.user_id)[0].amount,321);
  assert.equal(h.w.IncomeStore.load()[0].description,'Stage 4 fixture');
  assert.match(h.node('qpNoticeTitle').textContent,/Импорт завершён/);
  assert.equal(billingWrites,0);
  assert.equal(h.node('qpBillingSettings').closest('#qpAccountCard').id,'qpAccountCard');
  assert.equal(h.node('qpAuthDeleteAccountBtn').parentElement.id,'qpBillingDeleteWrap');
  assert.equal(h.node('qPokoyDevVersion').closest('#qpDataCard').id,'qpDataCard');
  assert.equal(h.node('qpBillingPurchase').nextElementSibling.id,'qpAuthLogoutBtn');
  assert.deepEqual(h.errors,[]);
});

for(const options of [{pointer:'fine',width:1440},{pointer:'coarse',width:390,height:844}]){
test('clear-data requires both confirmations and exact phrase on '+options.pointer,async t=>{
  const h=await boot(t,options);let deletions=0;
  const original=h.api.deleteAllIncomes.bind(h.api);
  h.api.deleteAllIncomes=async()=>{deletions++;return original();};
  const button=h.node('clearIncomeDataBtn');button.click();
  assert.equal(deletions,0);
  h.node('qpConfirmOverlay').querySelector('[data-confirm-cancel]').click();
  assert.equal(h.w.IncomeStore.load().length,1);
  button.click();h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();
  assert.equal(deletions,0);
  assert.equal(h.node('qpConfirmTitle').textContent,'Подтверждение удаления');
  assert.equal(h.node('qpConfirmMessage').textContent,'Для подтверждения введите УДАЛИТЬ.');
  h.node('qpConfirmOverlay').querySelector('[data-confirm-cancel]').click();
  assert.equal(deletions,0);assert.equal(h.w.IncomeStore.load().length,1);
  button.click();h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();
  const input=h.node('qpConfirmPhraseInput');
  const form=h.node('qpConfirmOverlay').querySelector('form');
  const ok=h.node('qpConfirmOverlay').querySelector('[data-confirm-phrase-ok]');
  assert.equal(ok.textContent,'Удалить данные навсегда');
  for(const value of ['', 'удалить', 'УДАЛИТЬ ']){
    input.value=value;input.dispatchEvent(new h.w.Event('input',{bubbles:true}));
    assert.equal(ok.disabled,true);
    form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(deletions,0);
  }
  input.value='УДАЛИТЬ';input.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(ok.disabled,false);ok.click();
  await h.settle();
  assert.equal(deletions,1);
  assert.equal(h.records.get(userA.user_id).length,0);
  assert.equal(h.w.IncomeStore.load().length,0);
  assert.equal(button.disabled,false);
  assert.ok(h.api.getToken());assert.equal(h.w.qPokoyCanWrite(),true);
  assert.deepEqual(h.errors,[]);
});
}

test('confirmed clear action retains rejection/finally behavior and read-only UI lock',async t=>{
  const h=await boot(t);let confirmCallback;
  h.w.qPokoyConfirm=(title,message,callback)=>{confirmCallback=callback;};
  let phraseCallback;
  h.w.qPokoyConfirmPhrase=(title,message,phrase,callback)=>{assert.equal(phrase,'УДАЛИТЬ');phraseCallback=callback;};
  const button=h.node('clearIncomeDataBtn');button.click();
  let reject;
  h.w.qPokoyCloudDeleteAll=()=>new Promise((resolve,rejectPromise)=>{reject=rejectPromise;});
  confirmCallback();assert.equal(button.disabled,false);
  const pending=phraseCallback();assert.equal(button.disabled,true);
  reject(new Error('fixture rejection'));
  await assert.rejects(pending,/fixture rejection/);
  assert.equal(button.disabled,false);assert.equal(h.w.IncomeStore.load().length,1);
  h.billing.can_write=false;await h.api.billingStatus();
  assert.equal(h.w.qPokoyCanWrite(),false);assert.equal(button.disabled,true);
  assert.deepEqual(h.errors,[]);
});

test('payment-method wording preserves saved/absent and auto-renew states on fine/coarse',async t=>{
  for(const pointer of ['fine','coarse']){
    for(const saved of [true,false])for(const autoRenew of [true,false]){
      const h=await boot(t,{pointer,width:pointer==='fine'?1440:390,height:844});
      Object.assign(h.billing,{payment_method_saved:saved,auto_renew:autoRenew});
      // Remount only this fixture's billing UI to exercise its initial refresh.
      h.node('qpAccountCard').appendChild(h.node('qpAuthDeleteAccountBtn'));
      h.node('qpBillingSettings').remove();
      h.w.eval(fs.readFileSync(path.join(__dirname,'../js/backup-controls.js'),'utf8'));
      await h.settle();
      const button=h.node('qpBillingUnlinkCard');
      assert.equal(button.textContent,saved?'Удалить способ оплаты':'Способ оплаты не сохранён');
      assert.equal(button.disabled,!saved);
      assert.equal(h.node('qpBillingDisableRenew').disabled,!saved);
      assert.equal(h.node('qpBillingDisableRenew').textContent,autoRenew?'Отключить автопродление':'Подключить автопродление');
      let calls=0;
      h.api.request=async(method,endpoint)=>{
        calls++;assert.equal(method,'DELETE');assert.equal(endpoint,'/billing/payment-method');
        return {data:{unlinked:autoRenew}};
      };
      button.click();
      if(saved){
        assert.equal(h.node('qpConfirmTitle').textContent,'Удалить способ оплаты?');
        assert.equal(calls,0);
        h.node('qpConfirmOverlay').querySelector('[data-confirm-cancel]').click();
        assert.equal(calls,0);
        button.click();h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();
        await h.settle();assert.equal(calls,1);
        assert.equal(button.disabled,true);
        assert.equal(button.textContent,'Способ оплаты не сохранён');
        assert.equal(h.node('qpNoticeTitle').textContent,autoRenew?'Способ оплаты удалён':'Способ оплаты не сохранён');
      }else assert.equal(calls,0);
      assert.deepEqual(h.errors,[]);
    }
  }
});

test('clear-data desktop colors reuse export/import winners without coarse or geometry overrides',()=>{
  const css=postcss.parse(fs.readFileSync(path.join(__dirname,'../css/hero-overlap.css'),'utf8'));
  const scope=css.nodes.find(n=>n.type==='atrule'&&n.params==='(pointer:fine)');
  assert.ok(scope);
  const prefix='#incomeAnalytics .analytics-settings-host #settings ';
  const declarations=rule=>Object.fromEntries(rule.nodes.filter(n=>n.type==='decl').map(d=>[d.prop,[d.value.replace(/\s+/g,' '),!!d.important]]));
  for(const state of ['',':hover']){
    let source;
    css.walkRules(rule=>{
      if(rule.selector.startsWith(prefix+'.settings-card .btn-secondary:not(#qpAuthDeleteAccountBtn):not(#clearIncomeDataBtn)'+state+','))source=rule;
    });
    const target=scope.nodes.find(n=>n.selector===prefix+'#clearIncomeDataBtn'+state);
    assert.ok(source);assert.ok(target);
    const actual=declarations(target);
    for(const [property,value] of Object.entries(declarations(source)))assert.deepEqual(actual[property],value,property+state);
  }
  scope.walkDecls(d=>assert.ok(!/^(font|height|width|padding|margin|border-radius)/.test(d.prop),d.prop));
  scope.walkRules(rule=>assert.ok(rule.selector.includes('#clearIncomeDataBtn')));
});

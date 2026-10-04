(function(){
  'use strict';

  let accessState=null;
  let readOnly=false;
  let observer=null;

  const WRITE_CONTROL_SELECTOR=[
    '#openIncomeForm',
    '#saveIncome',
    '#importDataBtn',
    '#clearIncomeDataBtn',
    '#qpAppearanceCard button',
    '#qpAppearanceCard input',
    '.edit-income',
    '.delete-income',
    '.income-recent-edit',
    '.income-recent-mobile-edit',
    '.income-recent-mobile-delete',
    '.qp-category-delete',
    '.category-popup-create button',
    '.category-popup-create input'
  ].join(',');

  function ensureReadOnlyStyles(){
    if(document.getElementById('qpAccessReadOnlyStyles'))return;
    const style=document.createElement('style');
    style.id='qpAccessReadOnlyStyles';
    style.textContent=`
      .qp-access-readonly .edit-income,
      .qp-access-readonly .delete-income,
      .qp-access-readonly .income-recent-edit,
      .qp-access-readonly .income-recent-mobile-actions,
      .qp-access-readonly .category-popup-create{display:none!important}
      .qp-access-readonly #openIncomeForm:disabled,
      .qp-access-readonly #saveIncome:disabled,
      .qp-access-readonly #importDataBtn:disabled,
      .qp-access-readonly #clearIncomeDataBtn:disabled,
      .qp-access-readonly #qpAppearanceCard button:disabled,
      .qp-access-readonly #qpAppearanceCard input:disabled{opacity:.45!important;cursor:not-allowed!important;transform:none!important}
      #qpAccessReadOnlyBanner{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 18px;padding:16px 18px;border:1px solid color-mix(in srgb,var(--primary) 42%,var(--border));border-radius:16px;background:color-mix(in srgb,var(--primary) 8%,var(--panel));box-shadow:0 10px 28px rgba(0,0,0,.10);box-sizing:border-box}
      #qpAccessReadOnlyBanner[hidden]{display:none!important}
      #qpAccessReadOnlyBanner .qp-access-readonly-copy{min-width:0}
      #qpAccessReadOnlyBanner .qp-access-readonly-title{margin:0 0 4px;font-size:16px;font-weight:750;color:var(--text)}
      #qpAccessReadOnlyBanner .qp-access-readonly-text{margin:0;color:var(--text-muted);font-size:14px;line-height:1.45}
      #qpAccessReadOnlyBanner .qp-access-readonly-pending{display:block;margin-top:5px;font-size:12px;opacity:.82}
      #qpAccessReadOnlyBanner .qp-access-renew{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 15px;border-radius:11px;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;white-space:nowrap}
      #qpAccessReadOnlyBanner.qp-access-attention{animation:qpAccessPulse .7s ease}
      @keyframes qpAccessPulse{0%,100%{transform:translateY(0)}45%{transform:translateY(-2px)}}
      @media (max-width:700px) and (pointer:coarse){#qpAccessReadOnlyBanner{align-items:stretch;flex-direction:column;padding:14px;margin-bottom:14px}#qpAccessReadOnlyBanner .qp-access-renew{width:100%;box-sizing:border-box}}
    `;
    document.head.appendChild(style);
  }

  function pendingCount(){
    try{
      const userId=String(window.qPokoyAuthUserId||'');
      const journal=JSON.parse(localStorage.getItem('qPokoyIncomeWriteJournalV1')||'[]');
      if(!Array.isArray(journal))return 0;
      return journal.filter(item=>item&&(!userId||String(item.userId)===userId)).length;
    }catch(_){return 0;}
  }

  function ensureBanner(){
    let banner=document.getElementById('qpAccessReadOnlyBanner');
    if(banner)return banner;
    const host=document.querySelector('.content main')||document.querySelector('main');
    if(!host)return null;
    banner=document.createElement('section');
    banner.id='qpAccessReadOnlyBanner';
    banner.hidden=true;
    banner.setAttribute('role','status');
    banner.setAttribute('aria-live','polite');
    banner.innerHTML='<div class="qp-access-readonly-copy"><div class="qp-access-readonly-title">Доступ закончился</div><p class="qp-access-readonly-text">Данные доступны для просмотра и экспорта PDF. Чтобы снова добавлять и изменять доходы, оформите доступ.<span class="qp-access-readonly-pending" hidden></span></p></div><a class="qp-access-renew" href="pricing.html">Оформить доступ</a>';
    host.prepend(banner);
    return banner;
  }

  function syncPendingText(){
    const banner=ensureBanner();
    const pending=banner?.querySelector('.qp-access-readonly-pending');
    if(!pending)return;
    const count=pendingCount();
    pending.hidden=!count;
    pending.textContent=count?'Несинхронизированные изменения сохранены локально и будут отправлены после восстановления доступа.':'';
  }

  function focusAccessBanner(scroll=true){
    const banner=ensureBanner();
    if(!banner||!readOnly)return;
    banner.hidden=false;
    syncPendingText();
    if(scroll)banner.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    banner.classList.remove('qp-access-attention');
    requestAnimationFrame(()=>{
      banner.classList.add('qp-access-attention');
      setTimeout(()=>banner.classList.remove('qp-access-attention'),800);
    });
  }

  function setAccessDisabled(element,locked){
    if(!element||!('disabled' in element))return;
    if(locked){
      if(element.dataset.qpAccessLocked!=='1'){
        element.dataset.qpAccessLocked='1';
        element.dataset.qpAccessWasDisabled=element.disabled?'1':'0';
      }
      element.disabled=true;
      element.setAttribute('aria-disabled','true');
      if(element.id==='openIncomeForm')element.title='Доступ закончился';
    }else if(element.dataset.qpAccessLocked==='1'){
      element.disabled=element.dataset.qpAccessWasDisabled==='1';
      element.removeAttribute('aria-disabled');
      if(element.id==='openIncomeForm'&&element.title==='Доступ закончился')element.removeAttribute('title');
      delete element.dataset.qpAccessLocked;
      delete element.dataset.qpAccessWasDisabled;
    }
  }

  function syncWriteControls(){
    document.querySelectorAll(WRITE_CONTROL_SELECTOR).forEach(element=>setAccessDisabled(element,readOnly));
  }

  function applyAccess(next){
    accessState=next&&typeof next==='object'?next:null;
    const nextReadOnly=!!(accessState&&accessState.can_write===false);
    const changed=nextReadOnly!==readOnly;
    readOnly=nextReadOnly;
    document.body?.classList.toggle('qp-access-readonly',readOnly);
    const banner=ensureBanner();
    if(banner)banner.hidden=!readOnly;
    if(readOnly){
      const form=document.getElementById('incomeForm');
      if(form&&!form.hidden)document.getElementById('cancelIncome')?.click();
      syncPendingText();
    }
    syncWriteControls();
    if(changed){
      window.dispatchEvent(new CustomEvent('qpokoy:access-change',{detail:{access:accessState,readOnly}}));
    }
  }

  function accessError(){
    const error=new Error('Доступ закончился. Доступен режим просмотра данных.');
    error.status=402;
    error.code='subscription_required';
    error.qpAccessBlocked=true;
    return error;
  }

  function wrapApi(){
    const api=window.qPokoyApi;
    if(!api||api.__qPokoyAccessWrapped)return;
    api.__qPokoyAccessWrapped=true;

    if(typeof api.bootstrap==='function'){
      const original=api.bootstrap.bind(api);
      api.bootstrap=async function(...args){
        const result=await original(...args);
        if(result&&result.user)window.qPokoyAuthUserId=String(result.user.user_id||result.user.id||'');
        applyAccess(result?.billing||null);
        return result;
      };
    }
    if(typeof api.billingStatus==='function'){
      const original=api.billingStatus.bind(api);
      api.billingStatus=async function(...args){
        const result=await original(...args);
        applyAccess(result||null);
        return result;
      };
    }

    ['addIncome','updateIncome','deleteIncome','replaceIncomes','deleteAllIncomes','addCategory','deleteCategory','putSetting'].forEach(name=>{
      if(typeof api[name]!=='function')return;
      const original=api[name].bind(api);
      api[name]=function(...args){
        if(readOnly)return Promise.reject(accessError());
        return original(...args);
      };
    });

    if(typeof api.logout==='function'){
      const original=api.logout.bind(api);
      api.logout=async function(...args){
        try{return await original(...args);}
        finally{window.qPokoyAuthUserId='';applyAccess(null);}
      };
    }
    if(typeof api.deleteAccount==='function'){
      const original=api.deleteAccount.bind(api);
      api.deleteAccount=async function(...args){
        const result=await original(...args);
        window.qPokoyAuthUserId='';
        applyAccess(null);
        return result;
      };
    }
  }

  function wrapIncomeStore(){
    const store=window.IncomeStore;
    if(!store||store.__qPokoyAccessWrapped)return;
    store.__qPokoyAccessWrapped=true;

    ['add','update','addMany'].forEach(name=>{
      if(typeof store[name]!=='function')return;
      const original=store[name].bind(store);
      store[name]=function(...args){
        if(readOnly){focusAccessBanner();return store.load();}
        return original(...args);
      };
    });
    if(typeof store.remove==='function'){
      const original=store.remove.bind(store);
      store.remove=async function(...args){
        if(readOnly){focusAccessBanner();return null;}
        return original(...args);
      };
    }
  }

  function wrapNotice(){
    if(typeof window.qPokoyNotice!=='function'||window.qPokoyNotice.__qPokoyAccessWrapped)return false;
    const original=window.qPokoyNotice;
    const wrapped=function(title,text,type,...rest){
      if(readOnly&&title==='Ошибка синхронизации'&&/(Доступ закончился|Пробный период или подписка закончились)/i.test(String(text||''))){
        syncPendingText();
        return;
      }
      return original.call(this,title,text,type,...rest);
    };
    wrapped.__qPokoyAccessWrapped=true;
    window.qPokoyNotice=wrapped;
    return true;
  }

  function clearAllIncomeData(btn){
    if(readOnly){focusAccessBanner();return;}
    if(typeof window.qPokoyConfirm!=='function')return;
    window.qPokoyConfirm('Удалить все доходы?','Все доходы будут безвозвратно удалены из облака.',async function(){
      btn.disabled=true;
      try{
        if(typeof window.qPokoyCloudDeleteAll==='function')await window.qPokoyCloudDeleteAll();
      }finally{btn.disabled=false;syncWriteControls();}
    });
  }

  function bindClearButton(){
    const btn=document.getElementById('clearIncomeDataBtn');
    if(btn&&!btn.__qPokoyClearBound){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        clearAllIncomeData(btn);
      },true);
      btn.__qPokoyClearBound=true;
    }
  }

  function isWriteTarget(target){
    const element=target?.closest?.(WRITE_CONTROL_SELECTOR);
    if(!element)return false;
    if(element.closest?.('#qpAccessReadOnlyBanner'))return false;
    return true;
  }

  function blockWriteEvent(event){
    if(!readOnly||!isWriteTarget(event.target))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    focusAccessBanner();
  }

  function init(){
    ensureReadOnlyStyles();
    ensureBanner();
    wrapApi();
    wrapIncomeStore();
    bindClearButton();
    syncWriteControls();
    document.addEventListener('click',blockWriteEvent,true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' ')blockWriteEvent(event);
    },true);
    observer=new MutationObserver(()=>{
      syncWriteControls();
      wrapNotice();
    });
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(wrapNotice,0);
    window.addEventListener('load',wrapNotice,{once:true});
  }

  window.qPokoyCanWrite=function(){return !readOnly;};
  window.qPokoyFocusAccessNotice=focusAccessBanner;
  window.qPokoyAccessState=function(){return accessState?{...accessState}:null;};

  init();
})();

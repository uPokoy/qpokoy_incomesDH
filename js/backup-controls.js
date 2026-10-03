
(function qPokoyBackupInit(){
  const KEY='incomes';

  function canonicalDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(m)return m[1]+'.'+m[2]+'.'+m[3].slice(-2);
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return m[3]+'.'+m[2]+'.'+m[1].slice(-2);
    return s;
  }

  function readCurrentIncomes(){
    // Prefer the live array because it is what the visible site is currently using.
    if(Array.isArray(window.incomes) && window.incomes.length){
      return window.incomes.map(x=>Object.assign({},x,{date:canonicalDate(x.date)}));
    }
    // If the live array is empty, read the app's actual localStorage key.
    try{
      const raw=JSON.parse(localStorage.getItem(KEY)||'[]');
      return Array.isArray(raw)
        ? raw.map(x=>Object.assign({},x,{date:canonicalDate(x.date)}))
        : [];
    }catch(e){
      return [];
    }
  }

  function exportData(){
    const incomes=readCurrentIncomes();
    const payload={
      format:'qPokoy-income-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      incomes:incomes
    };
    const json=JSON.stringify(payload,null,2);
    const blob=new Blob([json],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='income-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  async function importData(file){
    if(!file) return;
    if(window.IncomeBackup && typeof window.IncomeBackup.importData==='function'){
      try{
        await window.IncomeBackup.importData(file);
        if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Импорт завершён','Данные успешно загружены из файла.','success');
      }catch(e){
        console.error('qPokoy import error:',e);
        if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Ошибка импорта',e && e.message ? e.message : 'Не удалось импортировать файл. Проверьте формат JSON.','error');
      }
      return;
    }
    throw new Error('Модуль импорта недоступен.');
  }

  function formatBillingDate(value){
    if(!value)return '';
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return '';
    return date.toLocaleDateString('ru-RU');
  }

  function mountBillingSettings(){
    const card=document.getElementById('qpAccountCard');
    if(!card || document.getElementById('qpBillingSettings'))return;

    const block=document.createElement('div');
    block.id='qpBillingSettings';
    block.style.cssText='margin-top:10px;padding-top:0;border-top:0;';
    block.innerHTML=''
      +'<div id="qpBillingTerm" style="display:block;width:100%;margin:0;padding:0 4px;color:var(--text-muted);font-size:13px;line-height:1.35;font-weight:400;">Подписка: проверяем…</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">'
      +'<button type="button" id="qpBillingPurchase" style="background:var(--primary);color:#fff;border-color:transparent;">Оформить подписку</button>'
      +'</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">'
      +'<button type="button" class="btn-secondary" id="qpBillingDisableRenew">Отключить автопродление</button>'
      +'<button type="button" class="btn-secondary" id="qpBillingUnlinkCard">Отвязать карту</button>'
      +'</div>'
      +'<div id="qpBillingStatus" class="settings-card-subtitle" style="margin-top:10px;">Проверяем состояние подписки…</div>'
      +'<div class="settings-card-subtitle" style="margin-top:8px;">Отвязка карты отключает автопродление. Уже оплаченный период сохраняется.</div>';
    card.appendChild(block);

    const api=window.qPokoyApi;
    const term=document.getElementById('qpBillingTerm');
    const accountEmail=document.getElementById('qpAccountEmail');
    if(accountEmail&&term)accountEmail.insertAdjacentElement('afterend',term);
    const purchase=document.getElementById('qpBillingPurchase');
    const status=document.getElementById('qpBillingStatus');
    const disable=document.getElementById('qpBillingDisableRenew');
    const unlink=document.getElementById('qpBillingUnlinkCard');
    const planNames={monthly:'Месяц',yearly:'Год',lifetime:'Бессрочный доступ',trial:'Пробный период'};
    let autoRenewEnabled=false;
    let paymentMethodSaved=null;

    function inferPaymentMethodSaved(access){
      if(typeof access?.payment_method_saved==='boolean')return access.payment_method_saved;
      if(access?.auto_renew===true)return true;
      if(!['monthly','yearly'].includes(access?.plan))return false;
      return null;
    }

    function syncBillingButtons(){
      disable.textContent=autoRenewEnabled?'Отключить автопродление':'Подключить автопродление';
      if(paymentMethodSaved===false){
        unlink.textContent='Карта не привязана';
        unlink.disabled=true;
        disable.disabled=true;
      }else{
        unlink.textContent='Отвязать карту';
        unlink.disabled=false;
        disable.disabled=false;
      }
    }

    function syncPurchaseButton(access){
      const lifetime=access?.plan==='lifetime'||access?.mode==='lifetime';
      purchase.hidden=lifetime;
      if(lifetime)return;
      const activePaid=['paid','grace'].includes(access?.mode)&&['monthly','yearly'].includes(access?.plan);
      purchase.textContent=activePaid?'Продлить подписку':'Оформить подписку';
    }

    function syncBillingTerm(access){
      if(access?.mode==='prelaunch'){
        const until=formatBillingDate(access?.trial_ends_at);
        term.textContent=until?'Пробный период: до '+until:'Пробный период: 14 дней после запуска';
        return;
      }
      if(access?.plan==='lifetime'||access?.mode==='lifetime'){
        term.textContent='Подписка: бессрочный доступ';
        return;
      }
      if(access?.plan==='trial'||access?.mode==='trial'){
        const until=formatBillingDate(access?.trial_ends_at);
        term.textContent=until?'Пробный период: до '+until:'Пробный период: активен';
        return;
      }
      if(access?.plan==='monthly'||access?.plan==='yearly'){
        const until=formatBillingDate(access?.paid_until);
        if(until){
          term.textContent=(access?.mode==='expired'?'Подписка закончилась: ':'Подписка: до ')+until;
          return;
        }
      }
      term.textContent='Подписка: нет';
    }

    function billingErrorMessage(error,fallback){
      const message=String(error?.message||'');
      if(/failed to fetch|networkerror|load failed/i.test(message))return 'Не удалось связаться с сервером. Попробуйте ещё раз.';
      return message||fallback;
    }

    function showBillingNotice(title,message,type='success'){
      status.textContent=message;
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice(title,message,type);
    }

    function confirmBillingAction(title,message,confirmLabel,onConfirm){
      if(typeof window.qPokoyConfirm==='function'){
        window.qPokoyConfirm(title,message,onConfirm,{cancelLabel:'Отмена',confirmLabel});
        return;
      }
      if(window.confirm(title+'\n\n'+message))onConfirm();
    }

    function showBillingProgress(title,message){
      status.textContent=message;
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice(title,'Пожалуйста, подождите…');
    }

    async function refresh(){
      if(!api?.getToken?.()){
        term.textContent='Подписка: войдите в аккаунт';
        purchase.hidden=false;
        purchase.textContent='Оформить подписку';
        status.textContent='Войдите в аккаунт, чтобы управлять подпиской.';
        disable.disabled=true;
        unlink.disabled=true;
        return;
      }
      disable.disabled=true;
      unlink.disabled=true;
      try{
        const access=await api.billingStatus();
        autoRenewEnabled=access?.auto_renew===true;
        paymentMethodSaved=inferPaymentMethodSaved(access);
        syncBillingButtons();
        syncPurchaseButton(access);
        syncBillingTerm(access);
        if(access?.mode==='prelaunch'){
          status.textContent='';
          return;
        }
        if(access?.plan==='lifetime'){
          status.textContent='Тариф: бессрочный доступ.';
          disable.disabled=true;
          unlink.disabled=true;
          return;
        }
        if(access?.plan==='trial'){
          const until=formatBillingDate(access.trial_ends_at);
          status.textContent='Пробный период'+(until?' до '+until:'.');
          disable.disabled=true;
          unlink.disabled=true;
          return;
        }
        if(access?.plan==='monthly'||access?.plan==='yearly'){
          const until=formatBillingDate(access.paid_until);
          status.textContent='Тариф: '+planNames[access.plan]+(until?' · до '+until:'')+' · автопродление '+(autoRenewEnabled?'включено':'выключено')+'.';
          return;
        }
        status.textContent='Активной подписки нет.';
        disable.disabled=true;
        if(paymentMethodSaved!==true)unlink.disabled=true;
      }catch(error){
        term.textContent='Подписка: не удалось проверить';
        purchase.hidden=false;
        purchase.textContent='Оформить подписку';
        if(error?.status===401){
          status.textContent='Войдите в аккаунт, чтобы управлять подпиской.';
        }else{
          status.textContent=billingErrorMessage(error,'Не удалось проверить состояние подписки.');
        }
        disable.disabled=true;
        unlink.disabled=true;
      }
    }

    purchase.addEventListener('click',()=>{
      window.location.href='./pricing.html';
    });

    disable.addEventListener('click',()=>{
      if(!api?.getToken?.()||paymentMethodSaved===false)return;
      const enable=!autoRenewEnabled;
      confirmBillingAction(
        enable?'Подключить автопродление?':'Отключить автопродление?',
        enable
          ?'Следующее продление подписки будет списываться автоматически с сохранённого способа оплаты.'
          :'Следующее автоматическое списание будет отключено. Оплаченный период сохранится.',
        enable?'Подключить':'Отключить',
        async()=>{
          disable.disabled=true;
          showBillingProgress(enable?'Подключаем автопродление':'Отключаем автопродление',enable?'Подключаем автопродление…':'Отключаем автопродление…');
          try{
            const updated=await api.setBillingAutoRenew(enable);
            autoRenewEnabled=typeof updated?.auto_renew==='boolean'?updated.auto_renew:enable;
            if(autoRenewEnabled)paymentMethodSaved=true;
            syncBillingButtons();
            showBillingNotice(
              autoRenewEnabled?'Автопродление подключено':'Автопродление отключено',
              autoRenewEnabled?'Следующее продление будет выполнено автоматически.':'Оплаченный период сохранён.'
            );
          }catch(error){
            if(error?.code==='payment_method_required'){
              paymentMethodSaved=false;
              autoRenewEnabled=false;
              syncBillingButtons();
            }
            const message=billingErrorMessage(error,'Не удалось изменить автопродление.');
            showBillingNotice('Ошибка',message,'error');
          }finally{
            if(paymentMethodSaved!==false)disable.disabled=false;
          }
        }
      );
    });

    unlink.addEventListener('click',()=>{
      if(!api?.getToken?.()||paymentMethodSaved===false)return;
      confirmBillingAction(
        'Отвязать карту?',
        'Сохранённый способ оплаты будет удалён, автопродление отключится. Оплаченный период сохранится.',
        'Отвязать',
        async()=>{
          unlink.disabled=true;
          showBillingProgress('Отвязываем карту','Отвязываем карту…');
          try{
            const result=await api.request('DELETE','/billing/payment-method');
            const unlinked=result?.data?.unlinked??result?.unlinked;
            paymentMethodSaved=false;
            autoRenewEnabled=false;
            syncBillingButtons();
            if(unlinked){
              showBillingNotice('Карта отвязана','Автопродление отключено. Оплаченный период сохранён.');
            }else{
              showBillingNotice('Карта не привязана','Сохранённая карта не была привязана.');
            }
          }catch(error){
            const message=billingErrorMessage(error,'Не удалось отвязать карту.');
            showBillingNotice('Ошибка',message,'error');
          }finally{
            if(paymentMethodSaved!==false){
              unlink.disabled=false;
              disable.disabled=false;
            }
          }
        }
      );
    });

    syncBillingButtons();
    refresh();
  }

  function bind(){
    const exp=document.getElementById('exportDataBtn');
    const imp=document.getElementById('importDataBtn');
    const input=document.getElementById('importDataInput');

    if(exp && !exp.__qPokoyBackup){
      exp.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        exportData();
      },true);
      exp.__qPokoyBackup=true;
    }

    if(imp && input && !imp.__qPokoyBackup){
      imp.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        input.click();
      },true);
      imp.__qPokoyBackup=true;
      input.addEventListener('change',function(){
        if(input.files && input.files[0])importData(input.files[0]);
        input.value='';
      });
    }

    mountBillingSettings();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bind);
  }else{
    bind();
  }
})();

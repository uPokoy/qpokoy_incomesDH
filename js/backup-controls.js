
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
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">'
      +'<button type="button" class="btn-secondary" id="qpBillingDisableRenew">Отключить автопродление</button>'
      +'<button type="button" class="btn-secondary" id="qpBillingUnlinkCard">Отвязать карту</button>'
      +'</div>'
      +'<div id="qpBillingStatus" class="settings-card-subtitle" style="margin-top:10px;">Проверяем состояние подписки…</div>'
      +'<div class="settings-card-subtitle" style="margin-top:8px;">Отвязка карты отключает автопродление. Уже оплаченный период сохраняется.</div>';
    card.appendChild(block);

    const api=window.qPokoyApi;
    const status=document.getElementById('qpBillingStatus');
    const disable=document.getElementById('qpBillingDisableRenew');
    const unlink=document.getElementById('qpBillingUnlinkCard');
    const planNames={monthly:'Месяц',yearly:'Год',lifetime:'Бессрочный доступ',trial:'Пробный период'};

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
        status.textContent='Войдите в аккаунт, чтобы управлять подпиской.';
        disable.disabled=true;
        unlink.disabled=true;
        return;
      }
      disable.disabled=false;
      unlink.disabled=false;
      try{
        const access=await api.billingStatus();
        if(access?.mode==='prelaunch'){
          status.textContent='Платный режим пока не запущен.';
          return;
        }
        if(access?.plan==='lifetime'){
          status.textContent='Тариф: бессрочный доступ.';
          return;
        }
        if(access?.plan==='trial'){
          const until=formatBillingDate(access.trial_ends_at);
          status.textContent='Пробный период'+(until?' до '+until:'.');
          return;
        }
        if(access?.plan==='monthly'||access?.plan==='yearly'){
          const until=formatBillingDate(access.paid_until);
          status.textContent='Тариф: '+planNames[access.plan]+(until?' · до '+until:'')+' · автопродление '+(access.auto_renew?'включено':'выключено')+'.';
          return;
        }
        status.textContent='Активной подписки нет.';
      }catch(error){
        if(error?.status===401){
          status.textContent='Войдите в аккаунт, чтобы управлять подпиской.';
          disable.disabled=true;
          unlink.disabled=true;
        }else{
          status.textContent='Не удалось проверить состояние подписки.';
          disable.disabled=false;
          unlink.disabled=false;
        }
      }
    }

    disable.addEventListener('click',()=>{
      if(!api?.getToken?.())return;
      confirmBillingAction(
        'Отключить автопродление?',
        'Следующее автоматическое списание будет отключено. Оплаченный период сохранится.',
        'Отключить',
        async()=>{
          disable.disabled=true;
          showBillingProgress('Отключаем автопродление','Отключаем автопродление…');
          try{
            await api.setBillingAutoRenew(false);
            showBillingNotice('Автопродление отключено','Оплаченный период сохранён.');
          }catch(error){
            const message=error?.message||'Не удалось отключить автопродление.';
            showBillingNotice('Ошибка',message,'error');
          }finally{
            disable.disabled=false;
          }
        }
      );
    });

    unlink.addEventListener('click',()=>{
      if(!api?.getToken?.())return;
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
            if(unlinked){
              showBillingNotice('Карта отвязана','Автопродление отключено. Оплаченный период сохранён.');
            }else{
              showBillingNotice('Карта не привязана','Сохранённая карта не была привязана.');
            }
          }catch(error){
            const message=error?.message||'Не удалось отвязать карту.';
            showBillingNotice('Ошибка',message,'error');
          }finally{
            unlink.disabled=false;
            disable.disabled=false;
          }
        }
      );
    });

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

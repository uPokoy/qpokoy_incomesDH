(function(){
  'use strict';
  const api=window.qPokoyApi;
  const controls=document.getElementById('adminControls'),card=document.getElementById('adminUser');
  const message=document.getElementById('adminMessage'),details=document.getElementById('adminDetails');
  const renew=document.getElementById('adminAutoRenew'),saveRenew=document.getElementById('adminSaveRenew');
  let target=null,busy=false;
  function say(text,error=false){message.textContent=text;message.dataset.error=String(error);}
  function lock(value){busy=value;controls.querySelectorAll('button,input').forEach(e=>{e.disabled=value;});if(!value)renewDisabled();}
  function renewDisabled(){const allowed=target&&['monthly','yearly'].includes(target.assignment?.plan);renew.disabled=!allowed;saveRenew.disabled=!allowed;}
  function clearTarget(){target=null;card.hidden=true;details.replaceChildren();renew.checked=false;renewDisabled();}
  function error(e){if(e.status===401||e.status===403){clearTarget();controls.hidden=true;}say(e.status===401?'Ошибка доступа':e.status===403?'Нет доступа. Администратор должен быть разрешён на сервере.':e.code==='not_found'?'Пользователь не найден.':e.status===429?'Слишком много запросов. Повторите позже.':e.message||'Не удалось выполнить запрос.',true);}
  function date(v){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';}
  function show(user){
    target=user;details.replaceChildren();const a=user.assignment||user.billing;
    const fields=[['Email',user.email],['user_id',user.user_id],['Статус аккаунта',user.status],['Создан',date(user.created_at)],['Пробный период до',date(user.trial_ends_at)],['Статус доступа',user.billing.status],['Режим',user.billing.mode],['План назначения',a.plan||'—'],['Оплачено до',date(a.paid_until)],['Льготный период до',date(a.grace_until)],['Автопродление',a.auto_renew?'Включено':'Выключено'],['Источник',a.source||'—']];
    for(const [label,value] of fields){
      const group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
      group.className='admin-detail-card';dt.textContent=label;dd.textContent=value;group.append(dt,dd);details.append(group);
    }
    renew.checked=!!a.auto_renew;card.hidden=false;renewDisabled();
  }
  document.getElementById('adminSearch').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;clearTarget();lock(true);try{show(await api.adminFindUser(document.getElementById('adminEmail').value.trim()));say('Пользователь найден.');}catch(e){error(e);}finally{lock(false);}});
  const labels={month:'выдать доступ на месяц',year:'выдать доступ на год',lifetime:'выдать бессрочный доступ',until:'установить доступ по выбранную дату',reset:'сбросить ручное назначение и вернуть обычный расчёт доступа',auto_renew:'изменить автопродление'};
  async function change(action){
    if(busy||!target)return;
    const body={action};if(action==='until'){const input=document.getElementById('adminUntil');if(!input.value||!input.checkValidity()){say('Укажите корректную дату.',true);return;}body.date=input.value;}
    if(action==='auto_renew')body.auto_renew=renew.checked;
    if(!window.confirm('Подтвердите: '+labels[action]+' для '+target.email+'?')){renew.checked=!!target.assignment?.auto_renew;return;}
    const id=target.user_id;lock(true);try{show(await api.adminSetAccess(id,body));say('Доступ обновлён.');}catch(e){error(e);}finally{lock(false);}
  }
  controls.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>change(b.dataset.action)));
  saveRenew.addEventListener('click',()=>change('auto_renew'));
  clearTarget();
  (async()=>{if(!api?.getToken()){say('Ошибка доступа',true);return;}try{await api.adminSession();controls.hidden=false;say('Доступ подтверждён');}catch(e){error(e);}})();
})();

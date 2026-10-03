(function(){
  'use strict';
  const api=window.qPokoyApi;
  const controls=document.getElementById('adminControls'),card=document.getElementById('adminUser');
  const message=document.getElementById('adminMessage'),details=document.getElementById('adminDetails');
  const renew=document.getElementById('adminAutoRenew'),saveRenew=document.getElementById('adminSaveRenew');
  const adminUntil=document.getElementById('adminUntil');
  const calendarPopup=document.getElementById('adminCalendarPopup');
  const calendarDays=document.getElementById('adminCalendarDays');
  const calendarMonth=document.getElementById('adminCalendarMonth');
  const calendarPrev=document.getElementById('adminCalendarPrev');
  const calendarNext=document.getElementById('adminCalendarNext');
  const datePicker=document.querySelector('.admin-date-picker');
  let target=null,busy=false,calendarView=new Date();

  function say(text,error=false){message.textContent=text;message.dataset.error=String(error);}
  function lock(value){busy=value;controls.querySelectorAll('button,input').forEach(e=>{e.disabled=value;});if(!value)renewDisabled();}
  function renewDisabled(){const allowed=target&&['monthly','yearly'].includes(target.assignment?.plan);renew.disabled=!allowed;saveRenew.disabled=!allowed;}
  function clearTarget(){target=null;card.hidden=true;details.replaceChildren();renew.checked=false;adminUntil.value='';adminUntil.dataset.iso='';closeCalendar();renewDisabled();}
  function error(e){if(e.status===401||e.status===403){clearTarget();controls.hidden=true;}say(e.status===401?'Ошибка доступа':e.status===403?'Нет доступа. Администратор должен быть разрешён на сервере.':e.code==='not_found'?'Пользователь не найден.':e.status===429?'Слишком много запросов. Повторите позже.':e.message||'Не удалось выполнить запрос.',true);}
  function date(v){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';}
  function accountStatus(v){return ({active:'Активен',disabled:'Отключён',blocked:'Заблокирован'})[v]||v||'—';}
  function accessStatus(v){return ({active:'Активен',grace:'Период продления',expired:'Доступ истёк'})[v]||v||'—';}
  function accessMode(v){return ({prelaunch:'До запуска оплаты',paid:'Оплачено',grace:'Период продления',trial:'Пробный период',lifetime:'Бессрочный',expired:'Доступ истёк'})[v]||v||'—';}
  function plan(v){return ({monthly:'Месяц',yearly:'Год',lifetime:'Бессрочный',trial:'Пробный период'})[v]||v||'—';}
  function source(v){return ({admin:'admin',legacy:'Ранее зарегистрирован',payment:'Оплата'})[v]||v||'—';}

  function isoLocal(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function displayIso(iso){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
    return match?match[3]+'.'+match[2]+'.'+match[1]:'';
  }
  function selectedDate(){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(adminUntil.dataset.iso||'');
    if(!match)return null;
    const d=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
    return Number.isFinite(d.getTime())?d:null;
  }
  function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
  function renderCalendar(){
    const y=calendarView.getFullYear(),m=calendarView.getMonth();
    calendarMonth.textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(calendarView);
    calendarDays.replaceChildren();
    const first=new Date(y,m,1);
    const offset=(first.getDay()+6)%7;
    const start=new Date(y,m,1-offset);
    const today=new Date();
    const selected=selectedDate();
    for(let i=0;i<42;i++){
      const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
      const button=document.createElement('button');
      button.type='button';
      button.className='admin-calendar-day';
      if(d.getMonth()!==m)button.classList.add('other');
      if(sameDay(d,today))button.classList.add('today');
      if(sameDay(d,selected))button.classList.add('selected');
      button.textContent=String(d.getDate());
      button.setAttribute('aria-label',new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(d));
      button.addEventListener('click',()=>{
        const iso=isoLocal(d);
        adminUntil.dataset.iso=iso;
        adminUntil.value=displayIso(iso);
        closeCalendar();
      });
      calendarDays.append(button);
    }
  }
  function openCalendar(){
    if(busy)return;
    const selected=selectedDate();
    calendarView=selected?new Date(selected.getFullYear(),selected.getMonth(),1):new Date(new Date().getFullYear(),new Date().getMonth(),1);
    renderCalendar();
    calendarPopup.classList.add('open');
    adminUntil.setAttribute('aria-expanded','true');
  }
  function closeCalendar(){
    calendarPopup?.classList.remove('open');
    adminUntil?.setAttribute('aria-expanded','false');
  }

  adminUntil.addEventListener('click',e=>{e.stopPropagation();openCalendar();});
  adminUntil.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();openCalendar();}
    if(e.key==='Escape')closeCalendar();
  });
  calendarPrev.addEventListener('click',e=>{e.stopPropagation();calendarView.setMonth(calendarView.getMonth()-1);renderCalendar();});
  calendarNext.addEventListener('click',e=>{e.stopPropagation();calendarView.setMonth(calendarView.getMonth()+1);renderCalendar();});
  calendarPopup.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',e=>{if(!datePicker.contains(e.target))closeCalendar();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCalendar();});

  function show(user){
    target=user;details.replaceChildren();const a=user.assignment||user.billing;
    const fields=[['Email',user.email],['user_id',user.user_id],['Статус аккаунта',accountStatus(user.status)],['Создан',date(user.created_at)],['Пробный период до',date(user.trial_ends_at)],['Статус доступа',accessStatus(user.billing.status)],['Режим',accessMode(user.billing.mode)],['План назначения',plan(a.plan)],['Оплачено до',date(a.paid_until)],['Льготный период до',date(a.grace_until)],['Автопродление',a.auto_renew?'Включено':'Выключено'],['Источник',source(a.source)]];
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
    const body={action};
    if(action==='until'){
      const iso=adminUntil.dataset.iso||'';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){say('Выберите дату.',true);return;}
      body.date=iso;
    }
    if(action==='auto_renew')body.auto_renew=renew.checked;
    if(!window.confirm('Подтвердите: '+labels[action]+' для '+target.email+'?')){renew.checked=!!target.assignment?.auto_renew;return;}
    const id=target.user_id;lock(true);try{show(await api.adminSetAccess(id,body));say('Доступ обновлён.');}catch(e){error(e);}finally{lock(false);}
  }
  controls.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>change(b.dataset.action)));
  saveRenew.addEventListener('click',()=>change('auto_renew'));
  clearTarget();
  (async()=>{if(!api?.getToken()){say('Ошибка доступа',true);return;}try{await api.adminSession();controls.hidden=false;say('Доступ подтверждён');}catch(e){error(e);}})();
})();

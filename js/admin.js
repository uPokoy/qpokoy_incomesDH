(function(){
  'use strict';
  const api=window.qPokoyApi;
  const controls=document.getElementById('adminControls'),card=document.getElementById('adminUser');
  const message=document.getElementById('adminMessage'),details=document.getElementById('adminDetails');
  const renew=document.getElementById('adminAutoRenew'),saveAccess=document.getElementById('adminSaveAccess');
  const resetAccess=document.getElementById('adminResetAccess');
  const choiceButtons=[...document.querySelectorAll('[data-choice]')];
  const adminUntil=document.getElementById('adminUntil'),dateClear=document.getElementById('adminDateClear');
  const calendarPopup=document.getElementById('adminCalendarPopup');
  const calendarDays=document.getElementById('adminCalendarDays');
  const calendarMonth=document.getElementById('adminCalendarMonth');
  const calendarPrev=document.getElementById('adminCalendarPrev');
  const calendarNext=document.getElementById('adminCalendarNext');
  const datePicker=document.querySelector('.admin-date-picker');
  let target=null,busy=false,calendarView=new Date(),pendingAction=null,originalRenew=false;

  function say(text,error=false){message.textContent=text;message.dataset.error=String(error);}
  function assignment(){return target&&(target.assignment||target.billing)||null;}
  function renewAllowed(){
    if(!target)return false;
    if(pendingAction)return ['month','year','until'].includes(pendingAction);
    return ['monthly','yearly'].includes(assignment()?.plan);
  }
  function isDirty(){return !!pendingAction||renew.checked!==originalRenew;}
  function refreshControls(){
    choiceButtons.forEach(button=>{
      button.disabled=busy||!target;
      button.classList.toggle('selected',pendingAction===button.dataset.choice);
    });
    resetAccess.disabled=busy||!target;
    resetAccess.classList.toggle('selected',pendingAction==='reset');
    adminUntil.disabled=busy||!target;
    dateClear.disabled=busy||!target;
    renew.disabled=busy||!renewAllowed();
    saveAccess.disabled=busy||!target||!isDirty();
  }
  function lock(value){
    busy=value;
    controls.querySelectorAll('button,input').forEach(element=>{element.disabled=value;});
    if(!value)refreshControls();
  }
  function clearDate(){
    adminUntil.value='';
    adminUntil.dataset.iso='';
    dateClear.hidden=true;
  }
  function clearTarget(){
    target=null;pendingAction=null;originalRenew=false;card.hidden=true;details.replaceChildren();renew.checked=false;clearDate();closeCalendar();refreshControls();
  }
  function error(e){
    if(e.status===401||e.status===403){clearTarget();controls.hidden=true;}
    say(e.status===401?'Ошибка доступа':e.status===403?'Нет доступа. Администратор должен быть разрешён на сервере.':e.code==='not_found'?'Пользователь не найден.':e.status===429?'Слишком много запросов. Повторите позже.':e.message||'Не удалось выполнить запрос.',true);
  }
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
  function positionCalendar(){
    if(!calendarPopup.classList.contains('open'))return;
    calendarPopup.classList.remove('open-up','open-down');
    calendarPopup.classList.add('open-down');
    const rect=datePicker.getBoundingClientRect();
    const popupHeight=calendarPopup.offsetHeight||310;
    const spaceBelow=window.innerHeight-rect.bottom;
    const spaceAbove=rect.top;
    if(spaceBelow<popupHeight+12&&spaceAbove>spaceBelow){
      calendarPopup.classList.remove('open-down');
      calendarPopup.classList.add('open-up');
    }
  }
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
        const previous=pendingAction;
        const iso=isoLocal(d);
        adminUntil.dataset.iso=iso;
        adminUntil.value=displayIso(iso);
        dateClear.hidden=false;
        pendingAction='until';
        if(previous==='lifetime'||previous==='reset')renew.checked=originalRenew;
        closeCalendar();
        refreshControls();
      });
      calendarDays.append(button);
    }
    requestAnimationFrame(positionCalendar);
  }
  function openCalendar(){
    if(busy||!target)return;
    const selected=selectedDate();
    const now=new Date();
    calendarView=selected?new Date(selected.getFullYear(),selected.getMonth(),1):new Date(now.getFullYear(),now.getMonth(),1);
    renderCalendar();
    calendarPopup.classList.add('open','open-down');
    adminUntil.setAttribute('aria-expanded','true');
    requestAnimationFrame(positionCalendar);
  }
  function closeCalendar(){
    calendarPopup?.classList.remove('open','open-up','open-down');
    adminUntil?.setAttribute('aria-expanded','false');
  }

  adminUntil.addEventListener('click',e=>{e.stopPropagation();openCalendar();});
  adminUntil.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();openCalendar();}
    if(e.key==='Delete'||e.key==='Backspace'){
      e.preventDefault();dateClear.click();
    }
    if(e.key==='Escape')closeCalendar();
  });
  dateClear.addEventListener('click',e=>{
    e.stopPropagation();
    clearDate();
    if(pendingAction==='until'){
      pendingAction=null;
      renew.checked=originalRenew;
    }
    closeCalendar();
    refreshControls();
  });
  calendarPrev.addEventListener('click',e=>{e.stopPropagation();calendarView.setMonth(calendarView.getMonth()-1);renderCalendar();});
  calendarNext.addEventListener('click',e=>{e.stopPropagation();calendarView.setMonth(calendarView.getMonth()+1);renderCalendar();});
  calendarPopup.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',e=>{if(!datePicker.contains(e.target))closeCalendar();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCalendar();});
  window.addEventListener('resize',()=>requestAnimationFrame(positionCalendar),{passive:true});
  window.addEventListener('scroll',()=>requestAnimationFrame(positionCalendar),{passive:true});

  function show(user){
    target=user;details.replaceChildren();const a=user.assignment||user.billing;
    const fields=[['Email',user.email],['user_id',user.user_id],['Статус аккаунта',accountStatus(user.status)],['Создан',date(user.created_at)],['Пробный период до',date(user.trial_ends_at)],['Статус доступа',accessStatus(user.billing.status)],['Режим',accessMode(user.billing.mode)],['План назначения',plan(a.plan)],['Оплачено до',date(a.paid_until)],['Льготный период до',date(a.grace_until)],['Автопродление',a.auto_renew?'Включено':'Выключено'],['Источник',source(a.source)]];
    for(const [label,value] of fields){
      const group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
      group.className='admin-detail-card';dt.textContent=label;dd.textContent=value;group.append(dt,dd);details.append(group);
    }
    originalRenew=!!a.auto_renew;
    renew.checked=originalRenew;
    pendingAction=null;
    clearDate();
    closeCalendar();
    card.hidden=false;
    refreshControls();
  }

  choiceButtons.forEach(button=>button.addEventListener('click',()=>{
    if(busy||!target)return;
    const previous=pendingAction;
    pendingAction=button.dataset.choice;
    clearDate();
    closeCalendar();
    if(pendingAction==='lifetime')renew.checked=false;
    else if(previous==='lifetime'||previous==='reset')renew.checked=originalRenew;
    refreshControls();
  }));

  resetAccess.addEventListener('click',()=>{
    if(busy||!target)return;
    pendingAction='reset';
    clearDate();
    closeCalendar();
    renew.checked=false;
    refreshControls();
  });

  renew.addEventListener('change',()=>refreshControls());

  saveAccess.addEventListener('click',async()=>{
    if(busy||!target||!isDirty())return;
    const action=pendingAction;
    const desiredRenew=renew.checked;
    const id=target.user_id;
    let body=null;
    if(action){
      body={action};
      if(action==='until'){
        const iso=adminUntil.dataset.iso||'';
        if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){say('Выберите дату.',true);return;}
        body.date=iso;
      }
    }
    lock(true);
    try{
      let updated=target;
      if(body)updated=await api.adminSetAccess(id,body);
      const after=updated.assignment||updated.billing;
      const canRenew=action?['month','year','until'].includes(action):['monthly','yearly'].includes(assignment()?.plan);
      if(canRenew&&!!after?.auto_renew!==desiredRenew){
        updated=await api.adminSetAccess(id,{action:'auto_renew',auto_renew:desiredRenew});
      }
      show(updated);
      say('Изменения сохранены.');
    }catch(e){error(e);}finally{lock(false);}
  });

  document.getElementById('adminSearch').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;clearTarget();lock(true);
    try{show(await api.adminFindUser(document.getElementById('adminEmail').value.trim()));say('Пользователь найден.');}
    catch(e){error(e);}finally{lock(false);}
  });

  clearTarget();
  (async()=>{if(!api?.getToken()){say('Ошибка доступа',true);return;}try{await api.adminSession();controls.hidden=false;say('Доступ подтверждён');}catch(e){error(e);}})();
})();

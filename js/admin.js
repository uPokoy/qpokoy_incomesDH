(function(){
  'use strict';
  const api=window.qPokoyApi;
  const controls=document.getElementById('adminControls'),card=document.getElementById('adminUser');
  const message=document.getElementById('adminMessage'),details=document.getElementById('adminDetails');
  const saveMessage=document.getElementById('adminSaveMessage');
  const renew=document.getElementById('adminAutoRenew'),saveAccess=document.getElementById('adminSaveAccess');
  const resetAccess=document.getElementById('adminResetAccess');
  const choiceButtons=[...document.querySelectorAll('[data-choice]')];
  const adminUntil=document.getElementById('adminUntil'),dateClear=document.getElementById('adminDateClear');
  const calendarPopup=document.getElementById('adminCalendarPopup');
  const calendarDays=document.getElementById('adminCalendarDays');
  const calendarYears=document.getElementById('adminCalendarYears');
  const calendarWeekdays=document.getElementById('adminCalendarWeekdays');
  const calendarMonth=document.getElementById('adminCalendarMonth');
  const calendarYearButton=document.getElementById('adminCalendarYearButton');
  const calendarPrev=document.getElementById('adminCalendarPrev');
  const calendarNext=document.getElementById('adminCalendarNext');
  const datePicker=document.querySelector('.admin-date-picker');
  const refreshButton=document.getElementById('adminRefresh');
  const listSearch=document.getElementById('adminListSearch');
  const statusFilter=document.getElementById('adminStatusFilter');
  const accessFilter=document.getElementById('adminAccessFilter');
  const renewFilter=document.getElementById('adminRenewFilter');
  const resetFilters=document.getElementById('adminResetFilters');
  const usersBody=document.getElementById('adminUsersBody');
  const usersEmpty=document.getElementById('adminUsersEmpty');
  const usersCount=document.getElementById('adminUsersCount');
  const pagination=document.getElementById('adminPagination');
  const generatedAt=document.getElementById('adminGeneratedAt');
  const statTotal=document.getElementById('statTotal');
  const statActive=document.getElementById('statActive');
  const statTrial=document.getElementById('statTrial');
  const statExpired=document.getElementById('statExpired');
  const closeUser=document.getElementById('adminCloseUser');
  const userTitle=document.getElementById('adminUserTitle');
  const exactSearch=document.getElementById('adminExactSearch');
  const adminEmail=document.getElementById('adminEmail');
  const isAndroid=/Android/i.test(navigator.userAgent||'');
  const pageSize=10;
  let target=null,busy=false,listBusy=false,calendarView=new Date(),calendarMode='days',yearPageStart=0,pendingAction=null,originalRenew=false;
  let touchStartX=0,touchStartY=0,touchActive=false,swipeSuppressUntil=0;
  let users=[],page=1,serverStats={total:0,active:0,trial:0,expired:0};

  function say(text,error=false){message.textContent=text;message.dataset.error=String(error);}
  function clearSaveMessage(){saveMessage.hidden=true;saveMessage.textContent='';saveMessage.dataset.error='false';}
  function showSaveMessage(text,error=false){saveMessage.textContent=text;saveMessage.dataset.error=String(error);saveMessage.hidden=false;}
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
    card.querySelectorAll('button,input').forEach(element=>{element.disabled=value;});
    if(!value)refreshControls();
  }
  function setListBusy(value){
    listBusy=value;
    refreshButton.disabled=value;
    refreshButton.textContent=value?'Обновляем…':'↻  Обновить';
  }
  function clearDate(){
    adminUntil.value='';
    adminUntil.dataset.iso='';
    dateClear.hidden=true;
  }
  function clearTarget(){
    target=null;pendingAction=null;originalRenew=false;card.hidden=true;details.replaceChildren();renew.checked=false;clearDate();clearSaveMessage();closeCalendar();refreshControls();
  }
  function error(e){
    if(e.status===401||e.status===403){clearTarget();controls.hidden=true;}
    say(e.status===401?'Ошибка доступа':e.status===403?'Нет доступа. Администратор должен быть разрешён на сервере.':e.code==='not_found'?'Пользователь не найден.':e.status===429?'Слишком много запросов. Повторите позже.':e.message||'Не удалось выполнить запрос.',true);
  }
  function date(v){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';}
  function dateOnly(v){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'—';}
  function accountStatus(v){return ({active:'Активен',pending_email:'Ждёт подтверждения',disabled:'Отключён',blocked:'Заблокирован'})[v]||v||'—';}
  function accessStatus(v){return ({active:'Активен',grace:'Период продления',expired:'Доступ истёк'})[v]||v||'—';}
  function accessMode(v){return ({prelaunch:'До запуска оплаты',paid:'Оплачено',grace:'Период продления',trial:'Пробный период',lifetime:'Бессрочный',expired:'Доступ истёк'})[v]||v||'—';}
  function plan(v){return ({monthly:'Месяц',yearly:'Год',lifetime:'Бессрочный',trial:'Пробный период'})[v]||v||'—';}
  function source(v){return ({admin:'admin',legacy:'Ранее зарегистрирован',payment:'Оплата'})[v]||v||'—';}

  function accessKind(user){
    const billing=user?.billing||{};
    if(billing.mode==='lifetime'||(user.assignment||{}).plan==='lifetime')return 'lifetime';
    if(billing.mode==='trial')return 'trial';
    if(billing.status==='expired')return 'expired';
    return 'active';
  }
  function accessLabel(user){
    const billing=user?.billing||{},a=user?.assignment||billing;
    if(billing.mode==='lifetime'||a.plan==='lifetime')return 'Бессрочный';
    if(billing.mode==='trial')return 'Пробный период';
    if(billing.status==='expired')return 'Без доступа';
    if(billing.mode==='grace')return 'Период продления';
    if(a.plan==='monthly')return 'Месячный';
    if(a.plan==='yearly')return 'Годовой';
    if(billing.mode==='prelaunch')return 'Активен';
    return accessStatus(billing.status);
  }
  function accessClass(user){
    const kind=accessKind(user);
    if(kind==='lifetime')return 'lifetime';
    if(kind==='trial')return 'trial';
    if(kind==='expired')return 'expired';
    if(user?.billing?.mode==='grace')return 'grace';
    return 'active';
  }
  function statusClass(status){
    if(status==='active')return 'active';
    if(status==='pending_email')return 'pending';
    if(status==='blocked')return 'blocked';
    return 'neutral';
  }
  function renewalState(user){
    const a=user?.assignment||user?.billing||{};
    if(!['monthly','yearly'].includes(a.plan))return null;
    return !!a.auto_renew;
  }
  function paidUntil(user){
    const a=user?.assignment||user?.billing||{};
    if(a.plan==='lifetime'||user?.billing?.mode==='lifetime')return '∞';
    if(a.paid_until)return dateOnly(a.paid_until);
    if(user?.billing?.mode==='trial')return dateOnly(user?.billing?.trial_ends_at||user?.trial_ends_at);
    return '—';
  }
  function pill(text,className){
    const span=document.createElement('span');
    span.className='admin-pill '+className;
    span.textContent=text;
    return span;
  }

  function filteredUsers(){
    const query=listSearch.value.trim().toLowerCase();
    return users.filter(user=>{
      if(query&&!String(user.email||'').toLowerCase().includes(query)&&!String(user.user_id||'').toLowerCase().includes(query))return false;
      if(statusFilter.value!=='all'&&user.status!==statusFilter.value)return false;
      if(accessFilter.value!=='all'&&accessKind(user)!==accessFilter.value)return false;
      const renewState=renewalState(user);
      if(renewFilter.value==='yes'&&renewState!==true)return false;
      if(renewFilter.value==='no'&&renewState!==false)return false;
      return true;
    });
  }
  function renderStats(){
    statTotal.textContent=String(serverStats.total??users.length);
    statActive.textContent=String(serverStats.active??0);
    statTrial.textContent=String(serverStats.trial??0);
    statExpired.textContent=String(serverStats.expired??0);
  }
  function paginationButton(label,targetPage,active=false,disabled=false){
    const button=document.createElement('button');
    button.type='button';button.className='admin-page-button'+(active?' active':'');button.textContent=label;button.disabled=disabled;
    button.addEventListener('click',()=>{page=targetPage;renderUsers();});
    return button;
  }
  function renderPagination(totalPages){
    pagination.replaceChildren();
    if(totalPages<=1)return;
    pagination.append(paginationButton('‹',Math.max(1,page-1),false,page===1));
    const wanted=[1,page-1,page,page+1,totalPages].filter(n=>n>=1&&n<=totalPages);
    const pages=[...new Set(wanted)].sort((a,b)=>a-b);
    let previous=0;
    for(const value of pages){
      if(previous&&value-previous>1){const dots=document.createElement('span');dots.textContent='…';dots.setAttribute('aria-hidden','true');pagination.append(dots);}
      pagination.append(paginationButton(String(value),value,value===page));
      previous=value;
    }
    pagination.append(paginationButton('›',Math.min(totalPages,page+1),false,page===totalPages));
  }
  function renderUsers(){
    const list=filteredUsers();
    const totalPages=Math.max(1,Math.ceil(list.length/pageSize));
    if(page>totalPages)page=totalPages;
    const start=(page-1)*pageSize;
    const visible=list.slice(start,start+pageSize);
    usersBody.replaceChildren();
    for(const user of visible){
      const tr=document.createElement('tr');
      const emailTd=document.createElement('td');
      const emailWrap=document.createElement('div');emailWrap.className='admin-email-cell';
      const emailStrong=document.createElement('strong');emailStrong.textContent=user.email||'—';
      const idSmall=document.createElement('small');idSmall.textContent='ID: '+(user.user_id||'—');
      emailWrap.append(emailStrong,idSmall);emailTd.append(emailWrap);

      const statusTd=document.createElement('td');statusTd.append(pill(accountStatus(user.status),statusClass(user.status)));
      const accessTd=document.createElement('td');accessTd.append(pill(accessLabel(user),accessClass(user)));
      const renewTd=document.createElement('td');
      const r=renewalState(user);
      renewTd.append(r===null?pill('—','neutral'):pill(r?'Включено':'Выключено',r?'renew-on':'renew-off'));
      const paidTd=document.createElement('td');paidTd.className='admin-table-date';paidTd.textContent=paidUntil(user);
      const createdTd=document.createElement('td');createdTd.className='admin-table-date';createdTd.textContent=dateOnly(user.created_at);
      const actionTd=document.createElement('td');
      const open=document.createElement('button');open.type='button';open.className='admin-open-user';open.textContent='Открыть';
      open.addEventListener('click',()=>openUser(user.email,open));actionTd.append(open);
      tr.append(emailTd,statusTd,accessTd,renewTd,paidTd,createdTd,actionTd);usersBody.append(tr);
    }
    usersEmpty.hidden=list.length!==0;
    const shownFrom=list.length?start+1:0,shownTo=Math.min(start+pageSize,list.length);
    usersCount.textContent=`Показано ${shownFrom}–${shownTo} из ${list.length}`;
    renderPagination(totalPages);
  }

  async function loadUsers(){
    if(listBusy)return;
    setListBusy(true);
    try{
      const payload=await api.request('GET','/admin/users');
      const data=payload?.data||{};
      users=Array.isArray(data.users)?data.users:[];
      serverStats=data.stats||{total:users.length,active:0,trial:0,expired:0};
      page=1;
      exactSearch.hidden=true;
      generatedAt.textContent=data.generated_at?'Обновлено: '+date(data.generated_at):'';
      renderStats();renderUsers();say('Доступ подтверждён');
    }catch(e){
      if(e.status===401||e.status===403){error(e);return;}
      users=[];serverStats={total:0,active:0,trial:0,expired:0};renderStats();renderUsers();
      exactSearch.hidden=false;
      say(e.status===400?'Список появится после обновления backend. Поиск по email доступен ниже.':e.message||'Не удалось загрузить список пользователей.',true);
    }finally{setListBusy(false);}
  }
  async function openUser(email,button){
    if(busy||!email)return;
    const oldText=button?.textContent;
    if(button){button.disabled=true;button.textContent='…';}
    try{
      show(await api.adminFindUser(email));
      say('Пользователь открыт.');
      card.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){error(e);}finally{if(button){button.disabled=false;button.textContent=oldText;}}
  }

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
    if(spaceBelow<popupHeight+12&&spaceAbove>spaceBelow){calendarPopup.classList.remove('open-down');calendarPopup.classList.add('open-up');}
  }
  function renderCalendarDays(){
    const y=calendarView.getFullYear(),m=calendarView.getMonth();
    calendarMode='days';calendarMonth.hidden=false;
    calendarMonth.textContent=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(calendarView);
    calendarYearButton.textContent=String(y)+' г.';calendarYearButton.setAttribute('aria-label','Выбрать год');
    calendarWeekdays.hidden=false;calendarDays.hidden=false;calendarYears.hidden=true;calendarDays.replaceChildren();
    const first=new Date(y,m,1),offset=(first.getDay()+6)%7,start=new Date(y,m,1-offset),today=new Date(),selected=selectedDate();
    for(let i=0;i<42;i++){
      const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),button=document.createElement('button');
      button.type='button';button.className='admin-calendar-day';
      if(d.getMonth()!==m)button.classList.add('other');if(sameDay(d,today))button.classList.add('today');if(sameDay(d,selected))button.classList.add('selected');
      button.textContent=String(d.getDate());button.setAttribute('aria-label',new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(d));
      button.addEventListener('click',()=>{
        const previous=pendingAction,iso=isoLocal(d);adminUntil.dataset.iso=iso;adminUntil.value=displayIso(iso);dateClear.hidden=false;pendingAction='until';
        if(previous==='lifetime'||previous==='reset')renew.checked=originalRenew;
        clearSaveMessage();closeCalendar();refreshControls();
      });
      calendarDays.append(button);
    }
    requestAnimationFrame(positionCalendar);
  }
  function renderYearPicker(){
    calendarMode='years';calendarMonth.hidden=true;calendarWeekdays.hidden=true;calendarDays.hidden=true;calendarYears.hidden=false;
    calendarYearButton.textContent=yearPageStart+'–'+(yearPageStart+11);calendarYearButton.setAttribute('aria-label','Вернуться к выбору даты');calendarYears.replaceChildren();
    const selectedYear=selectedDate()?.getFullYear(),viewYear=calendarView.getFullYear();
    for(let year=yearPageStart;year<yearPageStart+12;year++){
      const button=document.createElement('button');button.type='button';button.className='admin-calendar-year';
      if(year===viewYear)button.classList.add('current');if(year===selectedYear)button.classList.add('selected');
      button.textContent=String(year);button.setAttribute('aria-label','Выбрать '+year+' год');button.addEventListener('click',()=>{calendarView.setFullYear(year);renderCalendarDays();});calendarYears.append(button);
    }
    requestAnimationFrame(positionCalendar);
  }
  function changeCalendarPage(delta){if(calendarMode==='years'){yearPageStart+=delta*12;renderYearPicker();}else{calendarView.setMonth(calendarView.getMonth()+delta);renderCalendarDays();}}
  function openCalendar(){
    if(busy||!target)return;const selected=selectedDate(),now=new Date();
    calendarView=selected?new Date(selected.getFullYear(),selected.getMonth(),1):new Date(now.getFullYear(),now.getMonth(),1);calendarMode='days';renderCalendarDays();calendarPopup.classList.add('open','open-down');adminUntil.setAttribute('aria-expanded','true');requestAnimationFrame(positionCalendar);
  }
  function closeCalendar(){calendarPopup?.classList.remove('open','open-up','open-down');adminUntil?.setAttribute('aria-expanded','false');}

  adminUntil.addEventListener('click',e=>{e.stopPropagation();openCalendar();});
  adminUntil.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCalendar();}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();dateClear.click();}if(e.key==='Escape')closeCalendar();});
  dateClear.addEventListener('click',e=>{e.stopPropagation();clearDate();if(pendingAction==='until'){pendingAction=null;renew.checked=originalRenew;}clearSaveMessage();closeCalendar();refreshControls();});
  calendarYearButton.addEventListener('click',e=>{e.stopPropagation();if(calendarMode==='years')renderCalendarDays();else{yearPageStart=calendarView.getFullYear()-5;renderYearPicker();}});
  calendarPrev.addEventListener('click',e=>{e.stopPropagation();changeCalendarPage(-1);});
  calendarNext.addEventListener('click',e=>{e.stopPropagation();changeCalendarPage(1);});
  calendarPopup.addEventListener('click',e=>{if(isAndroid&&Date.now()<swipeSuppressUntil){e.preventDefault();e.stopPropagation();}},true);
  calendarPopup.addEventListener('click',e=>e.stopPropagation());
  if(isAndroid){
    calendarPopup.addEventListener('touchstart',e=>{if(e.touches.length!==1){touchActive=false;return;}touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;touchActive=true;},{passive:true});
    calendarPopup.addEventListener('touchend',e=>{if(!touchActive||!e.changedTouches.length)return;touchActive=false;const dx=e.changedTouches[0].clientX-touchStartX,dy=e.changedTouches[0].clientY-touchStartY;if(Math.abs(dx)<48||Math.abs(dx)<=Math.abs(dy)*1.15)return;swipeSuppressUntil=Date.now()+450;changeCalendarPage(dx<0?1:-1);},{passive:true});
    calendarPopup.addEventListener('touchcancel',()=>{touchActive=false;},{passive:true});
  }
  document.addEventListener('click',e=>{if(!datePicker.contains(e.target))closeCalendar();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCalendar();});
  window.addEventListener('resize',()=>requestAnimationFrame(positionCalendar),{passive:true});
  window.addEventListener('scroll',()=>requestAnimationFrame(positionCalendar),{passive:true});

  function show(user){
    target=user;details.replaceChildren();const a=user.assignment||user.billing||{};
    userTitle.textContent=user.email||'Пользователь';
    const fields=[['Email',user.email],['user_id',user.user_id],['Статус аккаунта',accountStatus(user.status)],['Создан',date(user.created_at)],['Пробный период до',date(user.trial_ends_at)],['Статус доступа',accessStatus(user.billing?.status)],['Режим',accessMode(user.billing?.mode)],['План назначения',plan(a.plan)],['Оплачено до',date(a.paid_until)],['Льготный период до',date(a.grace_until)],['Автопродление',a.auto_renew?'Включено':'Выключено'],['Источник',source(a.source)]];
    for(const [label,value] of fields){const group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');group.className='admin-detail-card';dt.textContent=label;dd.textContent=value||'—';group.append(dt,dd);details.append(group);}
    originalRenew=!!a.auto_renew;renew.checked=originalRenew;pendingAction=null;clearDate();closeCalendar();card.hidden=false;refreshControls();
  }

  choiceButtons.forEach(button=>button.addEventListener('click',()=>{
    if(busy||!target)return;const previous=pendingAction;pendingAction=button.dataset.choice;clearDate();clearSaveMessage();closeCalendar();
    if(pendingAction==='lifetime')renew.checked=false;else if(previous==='lifetime'||previous==='reset')renew.checked=originalRenew;refreshControls();
  }));
  resetAccess.addEventListener('click',()=>{if(busy||!target)return;pendingAction='reset';clearDate();clearSaveMessage();closeCalendar();renew.checked=false;refreshControls();});
  renew.addEventListener('change',()=>{clearSaveMessage();refreshControls();});

  saveAccess.addEventListener('click',async()=>{
    if(busy||!target||!isDirty())return;
    const action=pendingAction,desiredRenew=renew.checked,id=target.user_id;let body=null;
    if(action){body={action};if(action==='until'){const iso=adminUntil.dataset.iso||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){showSaveMessage('Выберите дату.',true);return;}body.date=iso;}}
    clearSaveMessage();lock(true);
    try{
      let updated=target;if(body)updated=await api.adminSetAccess(id,body);
      const after=updated.assignment||updated.billing;
      const canRenew=action?['month','year','until'].includes(action):['monthly','yearly'].includes(assignment()?.plan);
      if(canRenew&&!!after?.auto_renew!==desiredRenew)updated=await api.adminSetAccess(id,{action:'auto_renew',auto_renew:desiredRenew});
      show(updated);showSaveMessage('Изменения сохранены.');
      try{await loadUsers();}catch(_){/* Details remain usable even if the list refresh fails. */}
    }catch(e){if(e.status===401||e.status===403)error(e);else showSaveMessage(e.status===429?'Слишком много запросов. Повторите позже.':e.message||'Не удалось сохранить изменения.',true);}finally{lock(false);}
  });

  refreshButton.addEventListener('click',loadUsers);
  listSearch.addEventListener('input',()=>{page=1;renderUsers();});
  statusFilter.addEventListener('change',()=>{page=1;renderUsers();});
  accessFilter.addEventListener('change',()=>{page=1;renderUsers();});
  renewFilter.addEventListener('change',()=>{page=1;renderUsers();});
  resetFilters.addEventListener('click',()=>{listSearch.value='';statusFilter.value='all';accessFilter.value='all';renewFilter.value='all';page=1;renderUsers();});
  closeUser.addEventListener('click',clearTarget);
  exactSearch.addEventListener('submit',async e=>{e.preventDefault();adminEmail.blur();if(busy)return;clearTarget();lock(true);try{show(await api.adminFindUser(adminEmail.value.trim()));say('Пользователь открыт.');card.scrollIntoView({behavior:'smooth',block:'start'});}catch(err){error(err);}finally{lock(false);}});

  clearTarget();renderStats();renderUsers();
  (async()=>{
    if(!api?.getToken()){say('Ошибка доступа',true);return;}
    try{await api.adminSession();controls.hidden=false;say('Доступ подтверждён');await loadUsers();}
    catch(e){error(e);}
  })();
})();

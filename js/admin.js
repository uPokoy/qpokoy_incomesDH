(function(){
'use strict';

const api=window.qPokoyApi;
const bootStatus=document.getElementById('bootStatus');
const selfInfo=document.getElementById('selfInfo');
const adminPanel=document.getElementById('adminPanel');
const searchForm=document.getElementById('searchForm');
const emailInput=document.getElementById('emailInput');
const message=document.getElementById('message');
const userCard=document.getElementById('userCard');
const userData=document.getElementById('userData');
const customUntil=document.getElementById('customUntil');
const setCustomUntil=document.getElementById('setCustomUntil');
let selectedUser=null;

function showMessage(text,type=''){
  message.textContent=text;
  message.className='notice'+(type?' '+type:'');
  message.hidden=!text;
}
function formatDate(value){
  if(!value)return '—';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(date);
}
function modeLabel(billing){
  const mode=billing?.mode;
  if(mode==='prelaunch')return 'Доступ открыт до запуска оплаты';
  if(mode==='trial')return 'Пробный период';
  if(mode==='paid')return 'Оплаченный доступ';
  if(mode==='grace')return 'Льготный период';
  if(mode==='lifetime')return billing?.source==='legacy'?'Пожизненный — старый пользователь':'Бессрочный';
  if(mode==='expired')return 'Доступ закончился';
  return mode||'—';
}
function planLabel(plan){
  return ({monthly:'Месяц',yearly:'Год',lifetime:'Бессрочно',manual:'До выбранной даты',trial:'Пробный'})[plan]||'—';
}
function renderUser(payload){
  selectedUser=payload?.user||null;
  if(!selectedUser){userCard.hidden=true;return;}
  const billing=payload.billing||{};
  const manual=payload.manual||null;
  const rows=[
    ['Email',selectedUser.email||'—'],
    ['ID аккаунта',selectedUser.user_id||'—'],
    ['Аккаунт создан',formatDate(selectedUser.created_at)],
    ['Пробный период до',formatDate(selectedUser.trial_ends_at)],
    ['Текущий режим',modeLabel(billing)],
    ['Тариф',planLabel(billing.plan)],
    ['Доступ оплачен/выдан до',formatDate(billing.paid_until)],
    ['Льготный период до',formatDate(billing.grace_until)],
    ['Автопродление',billing.auto_renew?'Включено':'Выключено'],
    ['Источник ручной записи',manual?.source==='admin'?'Админ-панель':manual?.source||'—']
  ];
  userData.replaceChildren();
  for(const [key,value] of rows){
    const k=document.createElement('div');
    const v=document.createElement('div');
    k.textContent=key;
    if(key==='ID аккаунта'){
      const code=document.createElement('code');
      code.textContent=value;
      v.appendChild(code);
    }else{
      v.textContent=value;
    }
    userData.append(k,v);
  }
  userCard.hidden=false;
}
async function findUser(){
  const email=String(emailInput.value||'').trim().toLowerCase();
  if(!email)return;
  showMessage('Ищу пользователя…');
  userCard.hidden=true;
  try{
    const payload=await api.adminFindUser(email);
    renderUser(payload);
    showMessage('');
  }catch(error){
    selectedUser=null;
    showMessage(error?.message||'Не удалось найти пользователя.','error');
  }
}
async function applyAction(action,extra={}){
  if(!selectedUser?.user_id)return;
  const labels={
    grant_month:'выдать доступ на 1 месяц',
    grant_year:'выдать доступ на 1 год',
    grant_lifetime:'выдать бессрочный доступ',
    clear_manual:'сбросить ручной доступ',
    set_until:'установить выбранную дату окончания доступа'
  };
  if(!window.confirm(`Подтвердить: ${labels[action]||action}?`))return;
  showMessage('Сохраняю изменение…');
  try{
    const payload=await api.adminSetBilling(selectedUser.user_id,{action,...extra});
    renderUser(payload);
    showMessage('Изменение сохранено.','ok');
  }catch(error){
    showMessage(error?.message||'Не удалось сохранить изменение.','error');
  }
}

searchForm?.addEventListener('submit',event=>{
  event.preventDefault();
  findUser();
});
document.querySelectorAll('[data-action]').forEach(button=>{
  button.addEventListener('click',()=>applyAction(button.dataset.action));
});
setCustomUntil?.addEventListener('click',()=>{
  const value=customUntil?.value||'';
  if(!value){showMessage('Сначала выбери дату.','error');return;}
  applyAction('set_until',{until:value});
});

(async()=>{
  if(!api?.getToken?.()){
    bootStatus.textContent='Сначала войди в свой аккаунт qPokoy.';
    selfInfo.hidden=false;
    selfInfo.innerHTML='Открой <a href="/">главную страницу</a>, войди в аккаунт и затем вернись сюда.';
    return;
  }
  try{
    const status=await api.adminStatus();
    if(!status?.is_admin){
      bootStatus.textContent='Для этого аккаунта админ-доступ не включён.';
      selfInfo.hidden=false;
      selfInfo.replaceChildren();
      const text=document.createElement('div');
      text.textContent='ID текущего аккаунта:';
      const code=document.createElement('code');
      code.textContent=status?.user_id||'не определён';
      selfInfo.append(text,code);
      return;
    }
    bootStatus.textContent=`Администратор: ${status.email||''}`;
    adminPanel.hidden=false;
  }catch(error){
    bootStatus.textContent=error?.message||'Не удалось проверить админ-доступ.';
  }
})();
})();

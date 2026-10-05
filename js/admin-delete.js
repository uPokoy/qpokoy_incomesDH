(function(){
  'use strict';
  const api=window.qPokoyApi;
  const card=document.getElementById('adminUser');
  const details=document.getElementById('adminDetails');
  const closeButton=document.getElementById('adminCloseUser');
  const refreshButton=document.getElementById('adminRefresh');
  const message=document.getElementById('adminMessage');
  if(!api||!card||!details)return;

  const section=document.createElement('section');
  section.className='admin-delete-zone';
  section.setAttribute('aria-labelledby','adminDeleteTitle');
  section.innerHTML=`
    <div class="admin-delete-head">
      <div>
        <h2 id="adminDeleteTitle">Удаление пользователя</h2>
        <p>Полностью удаляет аккаунт и все данные пользователя из qPokoy.</p>
      </div>
      <button type="button" id="adminDeleteUser" class="admin-delete-user" disabled>Удалить пользователя</button>
    </div>
    <div id="adminDeleteConfirm" class="admin-delete-confirm" hidden>
      <p class="admin-delete-warning"><strong>Удаление необратимо.</strong> Для подтверждения введите email пользователя:</p>
      <p id="adminDeleteTarget" class="admin-delete-target"></p>
      <input id="adminDeleteEmail" type="email" autocomplete="off" spellcheck="false" aria-label="Email для подтверждения удаления">
      <div class="admin-delete-actions">
        <button type="button" id="adminDeleteCancel" class="admin-delete-cancel">Отмена</button>
        <button type="button" id="adminDeleteConfirmButton" class="admin-delete-confirm-button" disabled>Удалить навсегда</button>
      </div>
      <p id="adminDeleteMessage" class="admin-delete-message" role="status" aria-live="polite" hidden></p>
    </div>`;
  card.append(section);

  const deleteButton=section.querySelector('#adminDeleteUser');
  const confirmBox=section.querySelector('#adminDeleteConfirm');
  const targetText=section.querySelector('#adminDeleteTarget');
  const confirmInput=section.querySelector('#adminDeleteEmail');
  const cancelButton=section.querySelector('#adminDeleteCancel');
  const confirmButton=section.querySelector('#adminDeleteConfirmButton');
  const deleteMessage=section.querySelector('#adminDeleteMessage');
  let current=null;
  let deleting=false;

  function detailValue(label){
    for(const item of details.querySelectorAll('.admin-detail-card')){
      const dt=item.querySelector('dt');
      const dd=item.querySelector('dd');
      if(dt?.textContent.trim()===label)return dd?.textContent.trim()||'';
    }
    return '';
  }
  function resetConfirm(){
    confirmBox.hidden=true;
    confirmInput.value='';
    targetText.textContent='';
    deleteMessage.hidden=true;
    deleteMessage.textContent='';
    deleteMessage.dataset.error='false';
    confirmButton.disabled=true;
  }
  function syncTarget(){
    const id=detailValue('user_id');
    const email=detailValue('Email');
    current=id&&email&&id!=='—'&&email!=='—'?{id,email}:null;
    deleteButton.disabled=deleting||!current;
    resetConfirm();
  }
  function setDeleting(value){
    deleting=value;
    deleteButton.disabled=value||!current;
    confirmInput.disabled=value;
    cancelButton.disabled=value;
    confirmButton.disabled=value||!current||confirmInput.value.trim().toLowerCase()!==current.email.toLowerCase();
    deleteButton.textContent=value?'Удаляем…':'Удалить пользователя';
    confirmButton.textContent=value?'Удаляем…':'Удалить навсегда';
  }
  function showDeleteMessage(text,error=false){
    deleteMessage.textContent=text;
    deleteMessage.dataset.error=String(error);
    deleteMessage.hidden=false;
  }

  deleteButton.addEventListener('click',()=>{
    if(!current||deleting)return;
    resetConfirm();
    confirmBox.hidden=false;
    targetText.textContent=current.email;
    confirmInput.placeholder=current.email;
    confirmInput.focus();
  });
  cancelButton.addEventListener('click',()=>{if(!deleting)resetConfirm();});
  confirmInput.addEventListener('input',()=>{
    deleteMessage.hidden=true;
    confirmButton.disabled=deleting||!current||confirmInput.value.trim().toLowerCase()!==current.email.toLowerCase();
  });
  confirmInput.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!deleting)resetConfirm();
  });
  confirmButton.addEventListener('click',async()=>{
    if(!current||deleting||confirmInput.value.trim().toLowerCase()!==current.email.toLowerCase())return;
    const deletingTarget={...current};
    setDeleting(true);
    try{
      await api.request('DELETE','/admin/users/'+encodeURIComponent(deletingTarget.id));
      closeButton?.click();
      if(message){message.textContent='Пользователь '+deletingTarget.email+' удалён.';message.dataset.error='false';}
      refreshButton?.click();
    }catch(error){
      showDeleteMessage(error?.message||'Не удалось удалить пользователя.',true);
    }finally{
      setDeleting(false);
    }
  });

  new MutationObserver(syncTarget).observe(details,{childList:true,subtree:true});
  syncTarget();
})();

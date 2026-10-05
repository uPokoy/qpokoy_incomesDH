(function(){
  'use strict';
  const api=window.qPokoyApi;
  const card=document.getElementById('adminUser');
  const details=document.getElementById('adminDetails');
  const closeButton=document.getElementById('adminCloseUser');
  const refreshButton=document.getElementById('adminRefresh');
  const message=document.getElementById('adminMessage');
  const title=document.getElementById('adminUserTitle');
  const accessPanel=card?.querySelector('.access-panel');
  if(!api||!card||!details||!title||!accessPanel)return;

  const titleRow=document.createElement('div');
  titleRow.className='admin-user-title-row';
  title.parentNode.insertBefore(titleRow,title);
  titleRow.append(title);

  const deleteButton=document.createElement('button');
  deleteButton.type='button';
  deleteButton.id='adminDeleteUser';
  deleteButton.className='admin-delete-user';
  deleteButton.textContent='Удалить';
  deleteButton.disabled=true;
  titleRow.append(deleteButton);

  const confirmBox=document.createElement('section');
  confirmBox.id='adminDeleteConfirm';
  confirmBox.className='admin-delete-confirm';
  confirmBox.hidden=true;
  confirmBox.innerHTML=`
    <p class="admin-delete-warning"><strong>Удаление необратимо.</strong> Для подтверждения введите email пользователя:</p>
    <p id="adminDeleteTarget" class="admin-delete-target"></p>
    <input id="adminDeleteEmail" type="email" autocomplete="off" spellcheck="false" aria-label="Email для подтверждения удаления">
    <div class="admin-delete-actions">
      <button type="button" id="adminDeleteCancel" class="admin-delete-cancel">Отмена</button>
      <button type="button" id="adminDeleteConfirmButton" class="admin-delete-confirm-button" disabled>Удалить навсегда</button>
    </div>
    <p id="adminDeleteMessage" class="admin-delete-message" role="status" aria-live="polite" hidden></p>`;
  accessPanel.insertAdjacentElement('afterend',confirmBox);

  const targetText=confirmBox.querySelector('#adminDeleteTarget');
  const confirmInput=confirmBox.querySelector('#adminDeleteEmail');
  const cancelButton=confirmBox.querySelector('#adminDeleteCancel');
  const confirmButton=confirmBox.querySelector('#adminDeleteConfirmButton');
  const deleteMessage=confirmBox.querySelector('#adminDeleteMessage');
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
    deleteButton.textContent=value?'Удаляем…':'Удалить';
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
      await api.request('POST','/admin/users/'+encodeURIComponent(deletingTarget.id)+'/delete',{confirm_email:deletingTarget.email});
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

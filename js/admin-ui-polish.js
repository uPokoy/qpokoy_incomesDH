(function(){
  'use strict';
  const message=document.getElementById('adminMessage');
  const usersBody=document.getElementById('adminUsersBody');
  const details=document.getElementById('adminDetails');

  function tidyMessage(){
    if(message?.textContent.trim()==='Пользователь открыт.')message.textContent='';
  }

  function tidyRows(){
    if(!usersBody)return;
    for(const row of usersBody.querySelectorAll('tr')){
      const cells=row.cells;
      const renewPill=cells[3]?.querySelector('.admin-pill');
      if(renewPill&&renewPill.textContent.trim()==='—')renewPill.textContent='Не подключено';
      if(cells[4]&&cells[4].textContent.trim()==='—')cells[4].textContent='Не задано';
    }
  }

  function tidyDetails(){
    if(!details)return;
    for(const item of details.querySelectorAll('.admin-detail-card')){
      const label=item.querySelector('dt')?.textContent.trim();
      const value=item.querySelector('dd');
      if(label==='Оплачено до'&&value?.textContent.trim()==='—')value.textContent='Не задано';
    }
  }

  if(message){
    new MutationObserver(tidyMessage).observe(message,{childList:true,characterData:true,subtree:true});
    tidyMessage();
  }
  if(usersBody){
    new MutationObserver(tidyRows).observe(usersBody,{childList:true,subtree:true});
    tidyRows();
  }
  if(details){
    new MutationObserver(tidyDetails).observe(details,{childList:true,subtree:true});
    tidyDetails();
  }
})();

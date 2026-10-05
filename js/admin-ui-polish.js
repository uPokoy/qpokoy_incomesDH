(function(){
  'use strict';
  const message=document.getElementById('adminMessage');
  const usersBody=document.getElementById('adminUsersBody');
  const details=document.getElementById('adminDetails');
  const filterSelects=[...document.querySelectorAll('.admin-filter-field select')];
  let openFilter=null;

  function tidyMessage(){
    if(message?.textContent.trim()==='Пользователь открыт.')message.textContent='Доступ подтверждён';
  }

  function tidyRows(){
    if(!usersBody)return;
    for(const row of usersBody.querySelectorAll('tr')){
      let cells=row.cells;
      const actionButton=cells[6]?.querySelector('.admin-open-user');
      if(actionButton&&!row.dataset.openReady){
        row.dataset.openReady='true';
        row.tabIndex=0;
        row.setAttribute('role','button');
        row.setAttribute('aria-label','Открыть пользователя '+(cells[0]?.querySelector('strong')?.textContent.trim()||''));
        const openRow=()=>{if(!actionButton.disabled)actionButton.click();};
        row.addEventListener('click',openRow);
        row.addEventListener('keydown',event=>{
          if(event.key==='Enter'||event.key===' '){event.preventDefault();openRow();}
        });
      }
      if(cells[6])cells[6].remove();
      cells=row.cells;

      const renewPill=cells[3]?.querySelector('.admin-pill');
      if(renewPill&&renewPill.textContent.trim()==='—')renewPill.textContent='Не подключено';

      const paidCell=cells[4];
      if(paidCell){
        const paidText=paidCell.textContent.trim();
        const accessText=cells[2]?.textContent.trim()||'';
        if(paidText==='∞')paidCell.textContent='Бессрочно';
        else if(paidText==='—'||paidText==='Не требуется')paidCell.textContent=accessText==='Бессрочный'?'Бессрочно':'Нет даты';
      }
    }
  }

  function detailValue(label){
    if(!details)return '';
    for(const item of details.querySelectorAll('.admin-detail-card')){
      if(item.querySelector('dt')?.textContent.trim()===label)return item.querySelector('dd')?.textContent.trim()||'';
    }
    return '';
  }

  function tidyDetails(){
    if(!details)return;
    for(const item of details.querySelectorAll('.admin-detail-card')){
      const label=item.querySelector('dt')?.textContent.trim();
      const value=item.querySelector('dd');
      if(label!=='Оплачено до'||!value)continue;
      const text=value.textContent.trim();
      const plan=detailValue('План назначения');
      const mode=detailValue('Режим');
      if(text==='∞')value.textContent='Бессрочно';
      else if(text==='—'||text==='Не требуется')value.textContent=plan==='Бессрочный'||mode==='Бессрочный'?'Бессрочно':'Нет даты';
    }
  }

  function closeCustomFilter(){
    if(!openFilter)return;
    openFilter.classList.remove('open');
    openFilter.querySelector('.admin-custom-filter-button')?.setAttribute('aria-expanded','false');
    openFilter.querySelector('.admin-custom-filter-menu')?.setAttribute('hidden','');
    openFilter=null;
  }

  function buildCustomFilter(select){
    const field=select.closest('.admin-filter-field');
    if(!field||field.querySelector('.admin-custom-filter'))return;
    select.classList.add('admin-native-filter');

    const custom=document.createElement('div');
    custom.className='admin-custom-filter';
    const button=document.createElement('button');
    button.type='button';
    button.className='admin-custom-filter-button';
    button.setAttribute('aria-haspopup','listbox');
    button.setAttribute('aria-expanded','false');
    const value=document.createElement('span');
    value.className='admin-custom-filter-value';
    button.append(value);

    const menu=document.createElement('div');
    menu.className='admin-custom-filter-menu';
    menu.setAttribute('role','listbox');
    menu.hidden=true;

    function sync(){
      const current=[...select.options].find(option=>option.value===select.value)||select.options[0];
      value.textContent=current?.textContent||'';
      for(const optionButton of menu.querySelectorAll('.admin-custom-filter-option')){
        const selected=optionButton.dataset.value===select.value;
        optionButton.classList.toggle('selected',selected);
        optionButton.setAttribute('aria-selected',String(selected));
      }
    }

    for(const option of select.options){
      const optionButton=document.createElement('button');
      optionButton.type='button';
      optionButton.className='admin-custom-filter-option';
      optionButton.dataset.value=option.value;
      optionButton.textContent=option.textContent;
      optionButton.setAttribute('role','option');
      optionButton.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        sync();
        closeCustomFilter();
        button.focus();
      });
      menu.append(optionButton);
    }

    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen=openFilter!==custom;
      closeCustomFilter();
      if(shouldOpen){
        custom.classList.add('open');
        button.setAttribute('aria-expanded','true');
        menu.hidden=false;
        openFilter=custom;
      }
    });
    select.addEventListener('change',sync);
    custom.append(button,menu);
    field.append(custom);
    sync();
  }

  filterSelects.forEach(buildCustomFilter);
  document.addEventListener('click',event=>{if(openFilter&&!openFilter.contains(event.target))closeCustomFilter();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeCustomFilter();});

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

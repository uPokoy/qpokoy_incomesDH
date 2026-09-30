
(function(){
  function clearAllIncomeData(){
    if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Действие недоступно','Полное удаление доходов пока не поддерживается сервером. Данные не изменены.','error');
  }

  function bindClearButton(){
    const btn=document.getElementById('clearIncomeDataBtn');
    if(btn && !btn.__qPokoyClearBound){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        clearAllIncomeData();
      },true);
      btn.__qPokoyClearBound=true;
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bindClearButton);
  }else{
    bindClearButton();
  }
})();

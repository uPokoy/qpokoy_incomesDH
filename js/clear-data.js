
(function(){
  function clearAllIncomeData(){
    if(typeof window.qPokoyConfirm==='function'){
      window.qPokoyConfirm('Подтвердите действие','Удалить все данные доходов? Это действие нельзя отменить.',function(){
        localStorage.removeItem('incomes');
        if(typeof window.qPokoyCloudReplace==='function') window.qPokoyCloudReplace([]);

        if(Array.isArray(window.incomes)){
          window.incomes.splice(0,window.incomes.length);
        }

        if(typeof window.applyIncomeHeaderFilters==='function'){
          window.applyIncomeHeaderFilters();
        }else if(typeof window.renderIncomes==='function'){
          window.renderIncomes([]);
        }

        if(typeof window.renderDashboard==='function')window.renderDashboard();
        if(typeof window.renderAnalytics==='function')window.renderAnalytics();

        if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Данные удалены','Все данные доходов удалены.','success');
      });
    }
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

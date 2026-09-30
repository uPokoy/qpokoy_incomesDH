
(function(){
  function clearAllIncomeData(btn){
    if(typeof window.qPokoyConfirm!=='function')return;
    window.qPokoyConfirm('Удалить все доходы?','Все доходы будут безвозвратно удалены из облака.',async function(){
      btn.disabled=true;
      try{
        if(typeof window.qPokoyCloudDeleteAll==='function')await window.qPokoyCloudDeleteAll();
      }finally{btn.disabled=false;}
    });
  }

  function bindClearButton(){
    const btn=document.getElementById('clearIncomeDataBtn');
    if(btn && !btn.__qPokoyClearBound){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        clearAllIncomeData(btn);
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

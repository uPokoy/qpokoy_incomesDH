(function(){
  const label=document.getElementById('analyticsYearControl');
  const prev=document.getElementById('analyticsYearPrev');
  const next=document.getElementById('analyticsYearNext');
  const sourceYear=document.getElementById('incomeChartYear');
  if(!label||!prev||!next)return;

  function readYear(){
    try{
      const period=window.qPokoyGetSelectedIncomePeriod?.();
      if(Number.isInteger(period?.year))return period.year;
    }catch(e){}
    const fallback=Number(sourceYear?.textContent);
    return Number.isInteger(fallback)?fallback:new Date().getFullYear();
  }
  function sync(event){
    const eventYear=Number(event?.detail?.period?.year);
    label.textContent=String(Number.isInteger(eventYear)?eventYear:readYear());
  }
  function changeYear(delta){
    if(typeof window.qPokoyChangeSelectedIncomeYear==='function'){
      window.qPokoyChangeSelectedIncomeYear(delta);
      return;
    }
    const button=document.getElementById(delta<0?'chartYearPrev':'chartYearNext');
    if(button)button.click();
    sync();
  }

  prev.addEventListener('click',()=>changeYear(-1));
  next.addEventListener('click',()=>changeYear(1));
  window.addEventListener('qpokoy:income-period-change',sync);
  sync();
})();

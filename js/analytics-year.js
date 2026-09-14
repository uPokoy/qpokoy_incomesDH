
(function(){
  const label=document.getElementById('analyticsYearControl');
  const prev=document.getElementById('analyticsYearPrev');
  const next=document.getElementById('analyticsYearNext');
  const sourceYear=document.getElementById('incomeChartYear');
  if(!label||!prev||!next)return;

  function sync(){
    const value=sourceYear?.textContent?.trim();
    if(value) label.textContent=value;
  }
  function forward(id){
    const button=document.getElementById(id);
    if(!button)return;
    button.click();
    setTimeout(sync,0);
  }

  prev.addEventListener('click',()=>forward('chartYearPrev'));
  next.addEventListener('click',()=>forward('chartYearNext'));
  sync();

  if(sourceYear && window.MutationObserver){
    new MutationObserver(sync).observe(sourceYear,{childList:true,characterData:true,subtree:true});
  }
})();

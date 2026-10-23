/* Android header gesture; replaces the bundled frontend's sum-only handler. */
(function(){
  const mq=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
  const header=document.querySelector('#income .income-top');
  if(!header||header.dataset.qpMonthSwipeBound==='1')return;
  header.dataset.qpMonthSwipeBound='1';
  let active=false,startX=0,startY=0,suppressUntil=0;
  const area=target=>target?.closest?.('.income-month-block,.income-month-chart');
  header.addEventListener('touchstart',event=>{
    active=false;suppressUntil=0;
    if(!mq.matches||event.touches.length!==1||!area(event.target))return;
    // Period pickers already own their month/year swipe handlers; never fire twice.
    const control=event.target.closest('button,input,select,textarea,a,[role="button"],.month-switcher,.income-chart-year-switcher');
    if(control&&!control.matches('.income-chart-bar'))return;
    active=true;startX=event.touches[0].clientX;startY=event.touches[0].clientY;
  },{passive:true});
  header.addEventListener('touchmove',event=>{
    if(!active)return;
    if(event.touches.length!==1){active=false;return;}
    const dx=Math.abs(event.touches[0].clientX-startX),dy=Math.abs(event.touches[0].clientY-startY);
    // Once a vertical scroll starts, a later diagonal tail must not change months.
    if(dy>12&&dy>=dx)active=false;
  },{passive:true});
  header.addEventListener('touchcancel',()=>{active=false;},{passive:true});
  header.addEventListener('touchend',event=>{
    const started=active;active=false;
    if(!started||event.defaultPrevented||!mq.matches||!event.changedTouches.length)return;
    const dx=event.changedTouches[0].clientX-startX,dy=event.changedTouches[0].clientY-startY;
    if(Math.abs(dx)<44||Math.abs(dx)<=Math.abs(dy)*1.15)return;
    if(typeof window.qPokoyChangeSelectedIncomeMonth!=='function')return;
    event.preventDefault();suppressUntil=Date.now()+450;
    window.qPokoyChangeSelectedIncomeMonth(dx<0?1:-1);
  },{passive:false});
  header.addEventListener('click',event=>{
    if(area(event.target)&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}
  },true);
})();

/* DEV79: layout-only collision prevention for month/year hero totals.
   No income calculations, storage, click handlers or percentage data changes. */
(function(){
  "use strict";
  const root=document.getElementById('incomeAnalytics');
  if(!root)return;

  const parts=[
    {head:root.querySelector('.annual-total-desktop-head'),
     amount:document.getElementById('annualHeroTotal'),
     badge:root.querySelector('.annual-total-desktop-head .annual-total-growth')},
    {head:root.querySelector('.monthly-total-head'),
     amount:document.getElementById('monthlyHeroTotal'),
     badge:root.querySelector('.monthly-total-head .monthly-total-growth')}
  ].filter(item=>item.head&&item.amount&&item.badge);

  const context=document.createElement('canvas').getContext('2d');
  let frame=0;
  function measure(value,fontSize,style){
    if(!context)return value.length*fontSize*.65;
    context.font=[style.fontStyle,style.fontWeight,fontSize+'px',style.fontFamily].join(' ');
    const spacing=parseFloat(style.letterSpacing)||0;
    return context.measureText(value).width+Math.max(0,value.length-1)*spacing+4;
  }
  function fit(item){
    const {head,amount,badge}=item;
    if(!head.getClientRects().length)return;
    // Read the normal CSS font, not the previously reduced inline font.
    amount.style.removeProperty('font-size');
    const style=getComputedStyle(amount);
    const baseSize=parseFloat(style.fontSize);
    if(!Number.isFinite(baseSize)||baseSize<=0)return;

    const fullText=amount.textContent.trim();
    const headRect=head.getBoundingClientRect();
    const headWidth=headRect.width;
    const badgeVisible=!badge.hidden&&badge.getClientRects().length>0;
    if(!badgeVisible||!fullText||headWidth<=48){
      head.classList.remove('qp-hero-avoid-growth');
      head.style.removeProperty('--qp-hero-growth-reserve');
      return;
    }
    const badgeRect=badge.getBoundingClientRect();
    const badgeLeft=badgeRect.left-headRect.left;
    const naturalWidth=measure(fullText,baseSize,style);
    // Both approved hero layouts center the amount 10px left of the card center.
    const centeredRight=(headWidth+naturalWidth)/2-10;
    const needsSpace=centeredRight+12>badgeLeft;

    if(!needsSpace){
      head.classList.remove('qp-hero-avoid-growth');
      head.style.removeProperty('--qp-hero-growth-reserve');
      return;
    }

    const reserve=Math.ceil(Math.max(0,headRect.right-badgeRect.left))+12;
    const available=Math.max(48,headWidth-reserve-5);
    const minSize=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)').matches?15:17;
    let size=baseSize;
    while(size>minSize&&measure(fullText,size,style)>available)size=Math.max(minSize,size-1);

    head.style.setProperty('--qp-hero-growth-reserve',reserve+'px');
    head.classList.add('qp-hero-avoid-growth');
    if(size<baseSize)amount.style.setProperty('font-size',size+'px','important');
  }
  function scan(){parts.forEach(fit);}
  function schedule(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;scan();});
  }

  // Only watch the displayed text and badge visibility, never classes/styles we set on heads.
  if(typeof MutationObserver==='function'){
    const observer=new MutationObserver(schedule);
    parts.forEach(({amount,badge})=>{
      observer.observe(amount,{subtree:true,childList:true,characterData:true});
      observer.observe(badge,{attributes:true,attributeFilter:['hidden']});
    });
    observer.observe(root,{attributes:true,attributeFilter:['class']});
  }
  if(typeof ResizeObserver==='function'){
    const ro=new ResizeObserver(schedule);
    parts.forEach(({head,badge})=>{ro.observe(head);ro.observe(badge);});
  }
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('orientationchange',schedule,{passive:true});
  window.addEventListener('qpokoy:income-data-rendered',schedule);
  window.addEventListener('qpokoy:income-period-change',schedule);
  schedule();
})();

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

/* Keep the running income odometer visible while cloud sync redraws the total.
   Data synchronization continues normally; only the temporary odometer DOM is protected. */
(function(){
  "use strict";
  const total=document.getElementById('incomeTotal');
  if(!total||typeof MutationObserver!=='function')return;

  let odometer=null;
  let restoring=false;
  const observer=new MutationObserver(function(){
    if(restoring)return;
    const active=total.classList.contains('qp-odometer-active');
    const current=total.querySelector(':scope > .qp-odometer');

    if(active&&current){
      odometer=current;
      return;
    }
    if(active&&odometer&&!total.contains(odometer)){
      restoring=true;
      total.replaceChildren(odometer);
      restoring=false;
      return;
    }
    if(!active)odometer=null;
  });

  observer.observe(total,{childList:true,attributes:true,attributeFilter:['class']});
})();

/* Keep the unchanged prefix still, but once the first changed digit is reached
   let that digit and every lower position to its right roll as one odometer block. */
(function(){
  "use strict";
  const total=document.getElementById('incomeTotal');
  if(!total||typeof MutationObserver!=='function')return;

  function freezeUnchangedPrefix(){
    if(!total.classList.contains('qp-odometer-active'))return;
    const wrapper=total.querySelector(':scope > .qp-odometer');
    if(!wrapper)return;

    const boxes=[...wrapper.querySelectorAll('.qp-odometer-digit')];
    let firstChanged=-1;
    for(let i=0;i<boxes.length;i++){
      const track=boxes[i].querySelector(':scope > .qp-odometer-track');
      if(!track||track.children.length<2)continue;
      const start=track.firstElementChild?.textContent||'';
      const end=track.lastElementChild?.textContent||'';
      if(start!==end){firstChanged=i;break;}
    }
    if(firstChanged<0)return;

    boxes.slice(0,firstChanged).forEach(function(box){
      const track=box.querySelector(':scope > .qp-odometer-track');
      if(!track||track.children.length<2)return;
      const end=track.lastElementChild?.textContent||'';
      const fixed=document.createElement('span');
      fixed.className='qp-odometer-fixed';
      fixed.textContent=end;
      box.replaceWith(fixed);
    });
  }

  const observer=new MutationObserver(freezeUnchangedPrefix);
  observer.observe(total,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
})();

/* Edit/delete odometer: editing follows the direction of the total change;
   deleting rolls the affected odometer block backwards. */
(function(){
  "use strict";
  const total=document.getElementById('incomeTotal');
  const save=document.getElementById('saveIncome');
  const form=document.getElementById('incomeForm');
  const formTitle=document.querySelector('.form-title');
  if(!total||!save||!form||!formTitle||typeof MutationObserver!=='function')return;

  let armed=null;
  let armTimer=0;
  let animating=false;
  let animationToken=0;

  function parseMoney(text){
    const normalized=String(text||'').replace(/₽/g,'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
    const value=Number(normalized);
    return Number.isFinite(value)?value:null;
  }

  function clearArm(){
    clearTimeout(armTimer);
    armTimer=0;
    armed=null;
  }

  function arm(kind,ttl){
    if(animating||total.classList.contains('qp-odometer-active'))return;
    const before=parseMoney(total.textContent);
    if(before===null)return;
    clearArm();
    armed={kind:kind,value:before,text:total.textContent,expires:Date.now()+ttl};
    armTimer=setTimeout(clearArm,ttl+100);
  }

  function armEdit(){
    if(form.hidden||save.disabled||formTitle.textContent.trim()!=='Редактировать доход')return;
    arm('edit',7000);
  }

  function makeTrack(start,end,direction){
    const box=document.createElement('span');
    box.className='qp-odometer-digit';
    const track=document.createElement('span');
    track.className='qp-odometer-track';
    let steps;

    if(direction>0){
      steps=10+((end-start+10)%10);
      for(let step=0;step<=steps;step++){
        const cell=document.createElement('span');
        cell.textContent=String((start+step)%10);
        track.appendChild(cell);
      }
      track.style.transform='translate3d(0,0,0)';
    }else{
      steps=10+((start-end+10)%10);
      for(let index=0;index<=steps;index++){
        const cell=document.createElement('span');
        cell.textContent=String((start-steps+index+1000)%10);
        track.appendChild(cell);
      }
      track.style.transform='translate3d(0,-'+steps+'em,0)';
    }
    box.appendChild(track);
    return {box:box,track:track,steps:steps};
  }

  function runOdometer(from,to,startText,finalText){
    const token=++animationToken;
    const direction=to>=from?1:-1;
    const rawOld=String(Math.abs(Math.round(from)));
    const rawNew=String(Math.abs(Math.round(to)));
    const width=Math.max(rawOld.length,rawNew.length);
    const oldDigits=rawOld.padStart(width,'0');
    const newDigits=rawNew.padStart(width,'0');
    const template=(direction<0&&rawOld.length>=rawNew.length)?startText:finalText;
    const chars=[...template];
    const wrapper=document.createElement('span');
    wrapper.className='qp-odometer';
    let digitIndex=0;
    let maxDuration=0;

    total.classList.add('qp-odometer-active');
    total.setAttribute('aria-label',finalText);
    total.replaceChildren(wrapper);

    chars.forEach(function(char){
      if(!/\d/.test(char)){
        const fixed=document.createElement('span');
        fixed.className='qp-odometer-fixed';
        fixed.textContent=char;
        wrapper.appendChild(fixed);
        return;
      }

      const start=Number(oldDigits[digitIndex]||0);
      const end=Number(newDigits[digitIndex]||char);
      const built=makeTrack(start,end,direction);
      wrapper.appendChild(built.box);

      const duration=2800+digitIndex*20;
      maxDuration=Math.max(maxDuration,duration);
      requestAnimationFrame(function(){
        if(token!==animationToken)return;
        const fromTransform=direction>0?'translate3d(0,0,0)':'translate3d(0,-'+built.steps+'em,0)';
        const toTransform=direction>0?'translate3d(0,-'+built.steps+'em,0)':'translate3d(0,0,0)';
        if(typeof built.track.animate==='function'){
          built.track.animate(
            [{transform:fromTransform},{transform:toTransform}],
            {duration:duration,easing:'cubic-bezier(.42,0,.58,1)',fill:'forwards'}
          );
        }else{
          built.track.style.transition='transform '+duration+'ms cubic-bezier(.42,0,.58,1)';
          requestAnimationFrame(function(){built.track.style.transform=toTransform;});
        }
      });
      digitIndex++;
    });

    setTimeout(function(){
      if(token!==animationToken)return;
      total.classList.remove('qp-odometer-active');
      total.removeAttribute('aria-label');
      total.textContent=finalText;
      animating=false;
    },maxDuration+120);
  }

  save.addEventListener('pointerdown',armEdit,true);
  save.addEventListener('click',function(){
    if(!armed||Date.now()>armed.expires)armEdit();
  },true);

  document.addEventListener('pointerdown',function(event){
    const button=event.target.closest&&event.target.closest('.delete-income,.income-recent-mobile-delete');
    if(button)arm('delete',20000);
  },true);
  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('.delete-income,.income-recent-mobile-delete');
    if(button&&(!armed||Date.now()>armed.expires))arm('delete',20000);
  },true);

  window.addEventListener('qpokoy:income-period-change',clearArm);

  const observer=new MutationObserver(function(){
    if(animating||!armed||Date.now()>armed.expires||total.classList.contains('qp-odometer-active'))return;
    const next=parseMoney(total.textContent);
    if(next===null||next===armed.value)return;
    if(armed.kind==='delete'&&next>armed.value)return;

    const before=armed;
    const finalText=total.textContent;
    clearArm();
    animating=true;
    runOdometer(before.value,next,before.text,finalText);
  });
  observer.observe(total,{childList:true,characterData:true,subtree:true});
})();

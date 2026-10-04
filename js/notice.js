
(function(){
  function close(){
    const overlay=document.getElementById('qpNoticeOverlay');
    if(overlay) overlay.remove();
    document.removeEventListener('keydown',onKey,true);
  }
  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();close();}
  }
  window.qPokoyNotice=function(title,message,type){
    close();
    const overlay=document.createElement('div');
    overlay.id='qpNoticeOverlay';
    overlay.className='qp-notice-overlay';
    overlay.innerHTML='<div class="qp-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="qpNoticeTitle" aria-describedby="qpNoticeMessage">'+
      '<h3 class="qp-notice-title" id="qpNoticeTitle"></h3>'+
      '<p class="qp-notice-message" id="qpNoticeMessage"></p>'+
      '<div class="qp-notice-actions"><button type="button" class="qp-notice-btn" data-notice-close>Закрыть</button></div>'+
      '</div>';
    const dialog=overlay.firstElementChild;
    if(type) dialog.setAttribute('data-type',type);
    document.body.appendChild(overlay);
    overlay.querySelector('#qpNoticeTitle').textContent=title||'Уведомление';
    overlay.querySelector('#qpNoticeMessage').textContent=message||'';
    overlay.querySelector('[data-notice-close]').addEventListener('click',close);
    overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    document.addEventListener('keydown',onKey,true);
    const btn=overlay.querySelector('[data-notice-close]');
    if(btn) requestAnimationFrame(function(){btn.focus();});
  };

  function bindStatisticsSwipe(){
    const root=document.getElementById('incomeAnalytics');
    const monthBtn=document.getElementById('analyticsModeMonth');
    const yearBtn=document.getElementById('analyticsModeYear');
    if(!root||!monthBtn||!yearBtn||root.__qPokoyModeSwipe)return;

    const mobile=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
    let startX=null;
    let startY=null;
    let startTime=0;

    root.addEventListener('touchstart',function(event){
      if(!mobile.matches||event.touches.length!==1)return;
      if(event.target.closest('button,input,textarea,select,a,[contenteditable="true"]'))return;
      const touch=event.touches[0];
      startX=touch.clientX;
      startY=touch.clientY;
      startTime=Date.now();
    },{passive:true});

    root.addEventListener('touchend',function(event){
      if(startX===null||startY===null||!mobile.matches||event.changedTouches.length!==1){
        startX=null;
        startY=null;
        return;
      }
      const touch=event.changedTouches[0];
      const dx=touch.clientX-startX;
      const dy=touch.clientY-startY;
      const elapsed=Date.now()-startTime;
      startX=null;
      startY=null;

      if(elapsed>700||Math.abs(dx)<55||Math.abs(dx)<=Math.abs(dy)*1.2)return;
      if(dx<0&&monthBtn.classList.contains('active'))yearBtn.click();
      if(dx>0&&yearBtn.classList.contains('active'))monthBtn.click();
    },{passive:true});

    root.__qPokoyModeSwipe=true;
  }

  function bindIncomeDateSelectionDismiss(){
    const input=document.getElementById('incomeDate');
    const calendarButton=document.getElementById('openCalendar');
    const form=document.getElementById('incomeForm');
    if(!input||input.__qPokoySelectionDismiss)return;

    const mobile=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
    const nativeSelect=typeof input.select==='function'?input.select.bind(input):null;

    if(nativeSelect){
      input.select=function(){
        if(!mobile.matches)return nativeSelect();
      };
    }

    function clearSelection(){
      if(!mobile.matches)return;
      try{
        const end=String(input.value||'').length;
        if(typeof input.setSelectionRange==='function')input.setSelectionRange(end,end);
      }catch(e){}
      if(document.activeElement===input)input.blur();
      try{
        const selection=window.getSelection&&window.getSelection();
        if(selection&&selection.rangeCount)selection.removeAllRanges();
      }catch(e){}
    }

    if(calendarButton)calendarButton.addEventListener('pointerdown',clearSelection,{capture:true,passive:true});
    if(form)form.addEventListener('touchmove',clearSelection,{passive:true});
    window.addEventListener('scroll',function(){
      if(document.activeElement===input||input.selectionStart!==input.selectionEnd)clearSelection();
    },{passive:true});
    input.addEventListener('blur',function(){
      try{
        const end=String(input.value||'').length;
        if(typeof input.setSelectionRange==='function')input.setSelectionRange(end,end);
      }catch(e){}
    });

    input.__qPokoySelectionDismiss=true;
  }

  function bindIncomeOdometerAnimation(){
    const form=document.getElementById('incomeForm');
    const save=document.getElementById('saveIncome');
    const total=document.getElementById('incomeTotal');
    const formTitle=document.querySelector('.form-title');
    if(!form||!save||!total||!formTitle||save.__qPokoyOdometerAnimation)return;

    let armed=null;
    let armedTimer=0;
    let animationToken=0;
    let animating=false;

    if(!document.getElementById('qpIncomeOdometerStyle')){
      const style=document.createElement('style');
      style.id='qpIncomeOdometerStyle';
      style.textContent=
        '#incomeTotal.qp-odometer-active{display:flex!important;align-items:center;justify-content:center;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:visible}'+
        '#incomeTotal .qp-odometer{display:inline-flex;align-items:baseline;white-space:nowrap;line-height:1}'+
        '#incomeTotal .qp-odometer-digit{display:inline-block;height:1em;overflow:hidden;line-height:1em;vertical-align:bottom}'+
        '#incomeTotal .qp-odometer-track{display:flex;flex-direction:column;line-height:1em;will-change:transform;transform:translate3d(0,0,0);backface-visibility:hidden}'+
        '#incomeTotal .qp-odometer-track>span{display:block;height:1em;line-height:1em;text-align:center}'+
        '#incomeTotal .qp-odometer-fixed{display:inline-block;white-space:pre;line-height:1em}';
      document.head.appendChild(style);
    }

    function parseMoney(text){
      const normalized=String(text||'').replace(/₽/g,'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
      const value=Number(normalized);
      return Number.isFinite(value)?value:null;
    }

    function arm(){
      if(animating||form.hidden||save.disabled||formTitle.textContent.trim()!=='Новый доход')return;
      const before=parseMoney(total.textContent);
      if(before===null)return;
      clearTimeout(armedTimer);
      armed={value:before,text:total.textContent,expires:Date.now()+6000};
      armedTimer=setTimeout(function(){
        if(armed&&Date.now()>=armed.expires)armed=null;
      },6050);
    }

    function runOdometer(from,to,finalText){
      const token=++animationToken;
      const newDigits=String(Math.abs(Math.round(to)));
      const oldDigits=String(Math.abs(Math.round(from))).padStart(newDigits.length,'0').slice(-newDigits.length);
      const chars=[...finalText];
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
        const steps=10+((end-start+10)%10);
        const box=document.createElement('span');
        box.className='qp-odometer-digit';
        const track=document.createElement('span');
        track.className='qp-odometer-track';
        for(let step=0;step<=steps;step++){
          const cell=document.createElement('span');
          cell.textContent=String((start+step)%10);
          track.appendChild(cell);
        }
        box.appendChild(track);
        wrapper.appendChild(box);

        const delay=0;
        const duration=1850+digitIndex*15;
        maxDuration=Math.max(maxDuration,delay+duration);
        requestAnimationFrame(function(){
          if(token!==animationToken)return;
          if(typeof track.animate==='function'){
            track.animate(
              [{transform:'translate3d(0,0,0)'},{transform:'translate3d(0,-'+steps+'em,0)'}],
              {duration:duration,delay:delay,easing:'cubic-bezier(.42,0,.58,1)',fill:'forwards'}
            );
          }else{
            track.style.transition='transform '+duration+'ms cubic-bezier(.42,0,.58,1) '+delay+'ms';
            requestAnimationFrame(function(){track.style.transform='translate3d(0,-'+steps+'em,0)';});
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

    save.addEventListener('pointerdown',arm,true);
    save.addEventListener('click',function(){
      if(!armed||Date.now()>armed.expires)arm();
    },true);

    const observer=new MutationObserver(function(){
      if(animating||!armed||Date.now()>armed.expires)return;
      const next=parseMoney(total.textContent);
      if(next===null||next<=armed.value)return;

      const before=armed;
      const finalText=total.textContent;
      armed=null;
      clearTimeout(armedTimer);
      armedTimer=0;
      animating=true;
      total.textContent=before.text;

      setTimeout(function(){
        runOdometer(before.value,next,finalText);
      },650);
    });
    observer.observe(total,{childList:true,characterData:true,subtree:true});

    save.__qPokoyOdometerAnimation=true;
  }

  function bindIncomeCalendarNavigation(){
    const popup=document.getElementById('calendarPopup');
    const monthHost=document.getElementById('calendarMonth');
    const days=document.getElementById('calendarDays');
    const prev=document.getElementById('calendarPrev');
    const next=document.getElementById('calendarNext');
    const input=document.getElementById('incomeDate');
    const weekdays=popup?.querySelector('.calendar-weekdays');
    if(!popup||!monthHost||!days||!prev||!next||!weekdays||popup.__qPokoyCalendarNavigation)return;

    const mobile=window.matchMedia('(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)');
    const years=document.createElement('div');
    years.className='qp-calendar-years';
    years.hidden=true;
    popup.appendChild(years);

    if(!document.getElementById('qpIncomeCalendarNavigationStyle')){
      const style=document.createElement('style');
      style.id='qpIncomeCalendarNavigationStyle';
      style.textContent=
        '#calendarPopup{touch-action:pan-y}'+
        '@media (max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse){#calendarPopup{max-height:none!important;overflow:visible!important}}'+
        '#calendarDays .calendar-day.other{visibility:hidden!important;pointer-events:none!important}'+
        '#calendarMonth.qp-calendar-heading{display:flex;align-items:center;justify-content:center;gap:4px;min-width:160px}'+
        '#calendarMonth .qp-calendar-month-label{font-size:14px;font-weight:600;text-transform:capitalize}'+
        '#calendarMonth .qp-calendar-year-button{width:auto;min-width:0;min-height:28px;padding:2px 5px;border:0;border-radius:6px;background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer}'+
        '#calendarMonth .qp-calendar-year-button:hover{background:var(--active)}'+
        '.qp-calendar-years{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:4px 0 2px}'+
        '.qp-calendar-year{width:100%;min-height:40px;padding:7px 6px;border:0;border-radius:9px;background:var(--panel-muted);color:var(--text);font-size:13px;cursor:pointer}'+
        '.qp-calendar-year:hover{background:var(--active)}'+
        '.qp-calendar-year.current{outline:1px solid var(--primary)}'+
        '.qp-calendar-year.selected{background:var(--primary);color:#fff}';
      document.head.appendChild(style);
    }

    let mode='days';
    let yearPageStart=0;
    let internalNav=false;
    let touchStartX=0;
    let touchStartY=0;
    let touchLastX=0;
    let touchLastY=0;
    let touchActive=false;
    let touchMoved=false;
    let touchTarget=null;
    let wasOpen=popup.classList.contains('open');

    function currentParts(){
      const current=[...days.querySelectorAll('.calendar-day[data-date]')].find(button=>
        !button.classList.contains('other')&&button.textContent.trim()==='1'
      );
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(current?.dataset.date||'');
      if(match)return {year:Number(match[1]),month:Number(match[2])-1};
      const savedYear=Number(monthHost.dataset.qpYear);
      const savedMonth=Number(monthHost.dataset.qpMonth);
      if(Number.isInteger(savedYear)&&Number.isInteger(savedMonth))return {year:savedYear,month:savedMonth};
      const now=new Date();
      return {year:now.getFullYear(),month:now.getMonth()};
    }

    function selectedYear(){
      const match=String(input?.value||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
      if(!match)return null;
      let year=Number(match[3]);
      if(year<100)year+=2000;
      return year;
    }

    function decorateHeading(){
      if(mode!=='days')return;
      const parts=currentParts();
      const key=parts.year+'-'+parts.month;
      if(monthHost.dataset.qpDecoratedKey===key&&monthHost.querySelector('.qp-calendar-year-button'))return;
      monthHost.dataset.qpYear=String(parts.year);
      monthHost.dataset.qpMonth=String(parts.month);
      monthHost.dataset.qpDecoratedKey=key;
      monthHost.classList.add('qp-calendar-heading');
      const monthName=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(new Date(parts.year,parts.month,1));
      monthHost.innerHTML='<span class="qp-calendar-month-label"></span><button type="button" class="qp-calendar-year-button" aria-label="Выбрать год"></button>';
      monthHost.querySelector('.qp-calendar-month-label').textContent=monthName;
      monthHost.querySelector('.qp-calendar-year-button').textContent=parts.year+' г.';
    }

    function showDays(){
      mode='days';
      years.hidden=true;
      weekdays.hidden=false;
      days.hidden=false;
      monthHost.dataset.qpDecoratedKey='';
      decorateHeading();
    }

    function renderYears(){
      const parts=currentParts();
      mode='years';
      weekdays.hidden=true;
      days.hidden=true;
      years.hidden=false;
      monthHost.classList.add('qp-calendar-heading');
      monthHost.innerHTML='<button type="button" class="qp-calendar-year-button" aria-label="Вернуться к месяцу"></button>';
      monthHost.querySelector('.qp-calendar-year-button').textContent=parts.year+' г.';
      const activeYear=selectedYear();
      const currentYear=new Date().getFullYear();
      const start=Math.floor(parts.year/12)*12;
      yearPageStart=start;
      years.innerHTML=Array.from({length:12},(_,index)=>{
        const year=start+index;
        return '<button type="button" class="qp-calendar-year'+(year===currentYear?' current':'')+(year===activeYear?' selected':'')+'" data-year="'+year+'">'+year+'</button>';
      }).join('');
    }

    monthHost.addEventListener('click',function(event){
      const button=event.target.closest('.qp-calendar-year-button');
      if(!button)return;
      if(mode==='days')renderYears();
      else showDays();
    });

    years.addEventListener('click',function(event){
      const button=event.target.closest('.qp-calendar-year[data-year]');
      if(!button)return;
      const parts=currentParts();
      const year=Number(button.dataset.year);
      internalNav=true;
      monthHost.dataset.qpYear=String(year);
      monthHost.dataset.qpMonth=String(parts.month);
      prev.click();
      next.click();
      internalNav=false;
      showDays();
    });

    function navigate(direction){
      if(mode==='years'){
        yearPageStart+=direction*12;
        years.innerHTML=Array.from({length:12},(_,index)=>{
          const year=yearPageStart+index;
          const activeYear=selectedYear();
          const currentYear=new Date().getFullYear();
          return '<button type="button" class="qp-calendar-year'+(year===currentYear?' current':'')+(year===activeYear?' selected':'')+'" data-year="'+year+'">'+year+'</button>';
        }).join('');
        return;
      }
      internalNav=true;
      (direction<0?prev:next).click();
      internalNav=false;
      requestAnimationFrame(decorateHeading);
    }

    popup.addEventListener('touchstart',function(event){
      if(!mobile.matches||event.touches.length!==1)return;
      const touch=event.touches[0];
      touchStartX=touchLastX=touch.clientX;
      touchStartY=touchLastY=touch.clientY;
      touchActive=true;
      touchMoved=false;
      touchTarget=event.target;
    },{passive:true});

    popup.addEventListener('touchmove',function(event){
      if(!touchActive||!mobile.matches||!event.touches.length)return;
      const touch=event.touches[0];
      touchLastX=touch.clientX;
      touchLastY=touch.clientY;
      if(Math.hypot(touchLastX-touchStartX,touchLastY-touchStartY)>28)touchMoved=true;
    },{passive:true});

    popup.addEventListener('touchend',function(event){
      if(!touchActive||!mobile.matches||event.changedTouches.length!==1){touchActive=false;return;}
      const touch=event.changedTouches[0];
      const dx=touch.clientX-touchStartX;
      const dy=touch.clientY-touchStartY;
      touchActive=false;
      if(touchMoved&&Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2){
        navigate(dx<0?1:-1);
        touchTarget=null;
        return;
      }
      const target=touchTarget;
      touchTarget=null;
      if(target&&target.closest('.calendar-day[data-date]:not(.other)')){
        target.closest('.calendar-day[data-date]:not(.other)').click();
      }
    },{passive:true});

    popup.addEventListener('touchcancel',function(){touchActive=false;touchTarget=null;},{passive:true});

    const observer=new MutationObserver(function(){
      const open=popup.classList.contains('open');
      if(open&&!wasOpen){mode='days';years.hidden=true;weekdays.hidden=false;days.hidden=false;requestAnimationFrame(decorateHeading);}
      wasOpen=open;
      if(internalNav||mode!=='days')return;
      requestAnimationFrame(decorateHeading);
    });
    observer.observe(popup,{attributes:true,attributeFilter:['class']});
    observer.observe(days,{childList:true,subtree:true});

    requestAnimationFrame(decorateHeading);
    popup.__qPokoyCalendarNavigation=true;
  }

  function init(){
    bindStatisticsSwipe();
    bindIncomeDateSelectionDismiss();
    bindIncomeOdometerAnimation();
    bindIncomeCalendarNavigation();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

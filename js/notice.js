
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
    let touchActive=false;
    let swipeSuppressUntil=0;
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
      requestAnimationFrame(decorateHeading);
    }

    function renderYears(){
      const parts=currentParts();
      mode='years';
      weekdays.hidden=true;
      days.hidden=true;
      years.hidden=false;
      monthHost.classList.add('qp-calendar-heading');
      monthHost.innerHTML='<button type="button" class="qp-calendar-year-button" aria-label="Вернуться к выбору даты"></button>';
      monthHost.querySelector('.qp-calendar-year-button').textContent=yearPageStart+'–'+(yearPageStart+11);
      years.replaceChildren();
      const chosenYear=selectedYear();
      for(let year=yearPageStart;year<yearPageStart+12;year++){
        const button=document.createElement('button');
        button.type='button';
        button.className='qp-calendar-year';
        if(year===parts.year)button.classList.add('current');
        if(year===chosenYear)button.classList.add('selected');
        button.textContent=String(year);
        button.setAttribute('aria-label','Выбрать '+year+' год');
        button.addEventListener('click',function(event){
          event.preventDefault();
          event.stopPropagation();
          const current=currentParts();
          const delta=year-current.year;
          internalNav=true;
          try{
            const buttonToClick=delta>0?next:prev;
            for(let i=0;i<Math.abs(delta)*12;i++)buttonToClick.click();
          }finally{
            internalNav=false;
          }
          showDays();
        });
        years.appendChild(button);
      }
    }

    function changeYearPage(delta){
      yearPageStart+=delta*12;
      renderYears();
    }

    monthHost.addEventListener('click',function(event){
      const button=event.target.closest('.qp-calendar-year-button');
      if(!button)return;
      event.preventDefault();
      event.stopPropagation();
      if(mode==='years'){
        showDays();
        return;
      }
      yearPageStart=currentParts().year-5;
      renderYears();
    });

    prev.addEventListener('click',function(event){
      if(mode!=='years'||internalNav)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeYearPage(-1);
    },true);
    next.addEventListener('click',function(event){
      if(mode!=='years'||internalNav)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeYearPage(1);
    },true);

    popup.addEventListener('click',function(event){
      if(Date.now()<swipeSuppressUntil){
        event.preventDefault();
        event.stopPropagation();
      }
    },true);

    popup.addEventListener('touchstart',function(event){
      if(!mobile.matches||event.touches.length!==1){touchActive=false;return;}
      touchStartX=event.touches[0].clientX;
      touchStartY=event.touches[0].clientY;
      touchActive=true;
    },{passive:true});
    popup.addEventListener('touchend',function(event){
      if(!touchActive||!mobile.matches||!event.changedTouches.length)return;
      touchActive=false;
      const dx=event.changedTouches[0].clientX-touchStartX;
      const dy=event.changedTouches[0].clientY-touchStartY;
      if(Math.abs(dx)<48||Math.abs(dx)<=Math.abs(dy)*1.15)return;
      if(mode==='years'){
        changeYearPage(dx<0?1:-1);
        swipeSuppressUntil=Date.now()+450;
      }else{
        (dx<0?next:prev).click();
        swipeSuppressUntil=Date.now()+450;
      }
    },{passive:true});
    popup.addEventListener('touchcancel',function(){touchActive=false;},{passive:true});

    const headingObserver=new MutationObserver(function(){
      if(mode==='days')requestAnimationFrame(decorateHeading);
    });
    headingObserver.observe(monthHost,{childList:true,characterData:true,subtree:true});

    const popupObserver=new MutationObserver(function(){
      const open=popup.classList.contains('open');
      if(open&&!wasOpen)showDays();
      wasOpen=open;
    });
    popupObserver.observe(popup,{attributes:true,attributeFilter:['class']});

    if(wasOpen)showDays();
    else decorateHeading();
    popup.__qPokoyCalendarNavigation=true;
  }

  function bindEnhancements(){
    bindStatisticsSwipe();
    bindIncomeDateSelectionDismiss();
    bindIncomeCalendarNavigation();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindEnhancements);
  else bindEnhancements();
})();
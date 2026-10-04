
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

  function bindMobileFixes(){
    bindStatisticsSwipe();
    bindIncomeDateSelectionDismiss();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindMobileFixes);
  else bindMobileFixes();
})();

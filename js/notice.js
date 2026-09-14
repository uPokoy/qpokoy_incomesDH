
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
})();

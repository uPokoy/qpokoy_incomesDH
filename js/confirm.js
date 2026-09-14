
(function(){
  function close(){
    const overlay=document.getElementById('qpConfirmOverlay');
    if(overlay) overlay.remove();
    document.removeEventListener('keydown',onKey,true);
  }
  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();close();}
  }
  window.qPokoyConfirm=function(title,message,onConfirm){
    close();
    const overlay=document.createElement('div');
    overlay.id='qpConfirmOverlay';
    overlay.className='qp-confirm-overlay';
    overlay.setAttribute('role','presentation');
    overlay.innerHTML=`<div class="qp-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="qpConfirmTitle" aria-describedby="qpConfirmMessage">
      <h3 class="qp-confirm-title" id="qpConfirmTitle"></h3>
      <p class="qp-confirm-message" id="qpConfirmMessage"></p>
      <div class="qp-confirm-actions">
        <button type="button" class="qp-confirm-btn" data-confirm-cancel>Нет</button>
        <button type="button" class="qp-confirm-btn qp-confirm-btn-primary" data-confirm-ok>Да</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#qpConfirmTitle').textContent=title||'Подтвердите действие';
    overlay.querySelector('#qpConfirmMessage').textContent=message||'';
    overlay.querySelector('[data-confirm-cancel]').addEventListener('click',close);
    overlay.querySelector('[data-confirm-ok]').addEventListener('click',function(){
      const fn=onConfirm;
      close();
      if(typeof fn==='function') fn();
    });
    overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    document.addEventListener('keydown',onKey,true);
    requestAnimationFrame(()=>overlay.querySelector('[data-confirm-ok]')?.focus());
  };
})();

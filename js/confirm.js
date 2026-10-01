(function(){
  function close(){
    const overlay=document.getElementById('qpConfirmOverlay');
    if(overlay) overlay.remove();
    document.removeEventListener('keydown',onKey,true);
  }
  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();close();}
  }
  function mount(overlay){
    document.body.appendChild(overlay);
    overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    document.addEventListener('keydown',onKey,true);
  }

  window.qPokoyConfirm=function(title,message,onConfirm,options={}){
    close();
    const overlay=document.createElement('div');
    overlay.id='qpConfirmOverlay';
    overlay.className='qp-confirm-overlay';
    overlay.setAttribute('role','presentation');
    overlay.innerHTML=`<div class="qp-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="qpConfirmTitle" aria-describedby="qpConfirmMessage">
      <h3 class="qp-confirm-title" id="qpConfirmTitle"></h3>
      <p class="qp-confirm-message" id="qpConfirmMessage"></p>
      <div class="qp-confirm-actions">
        <button type="button" class="qp-confirm-btn" data-confirm-cancel></button>
        <button type="button" class="qp-confirm-btn qp-confirm-btn-primary" data-confirm-ok></button>
      </div>
    </div>`;
    const cancel=overlay.querySelector('[data-confirm-cancel]');
    const ok=overlay.querySelector('[data-confirm-ok]');
    overlay.querySelector('#qpConfirmTitle').textContent=title||'Подтвердите действие';
    overlay.querySelector('#qpConfirmMessage').textContent=message||'';
    cancel.textContent=options.cancelLabel||'Нет';
    ok.textContent=options.confirmLabel||'Да';
    if(options.danger){
      ok.classList.remove('qp-confirm-btn-primary');
      ok.classList.add('qp-confirm-btn-danger');
    }
    cancel.addEventListener('click',close);
    ok.addEventListener('click',function(){
      const fn=onConfirm;
      close();
      if(typeof fn==='function') fn();
    });
    mount(overlay);
    requestAnimationFrame(()=>ok.focus());
  };

  window.qPokoyConfirmPhrase=function(title,message,phrase,onConfirm,options={}){
    close();
    const expected=String(phrase||'');
    const overlay=document.createElement('div');
    overlay.id='qpConfirmOverlay';
    overlay.className='qp-confirm-overlay';
    overlay.setAttribute('role','presentation');
    overlay.innerHTML=`<div class="qp-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="qpConfirmTitle" aria-describedby="qpConfirmMessage">
      <h3 class="qp-confirm-title" id="qpConfirmTitle"></h3>
      <p class="qp-confirm-message" id="qpConfirmMessage"></p>
      <form class="qp-confirm-phrase-form" data-confirm-phrase-form>
        <label class="qp-confirm-phrase-label" for="qpConfirmPhraseInput"></label>
        <input class="qp-confirm-input" id="qpConfirmPhraseInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <div class="qp-confirm-actions">
          <button type="button" class="qp-confirm-btn" data-confirm-cancel></button>
          <button type="submit" class="qp-confirm-btn qp-confirm-btn-danger" data-confirm-phrase-ok disabled></button>
        </div>
      </form>
    </div>`;
    const form=overlay.querySelector('[data-confirm-phrase-form]');
    const input=overlay.querySelector('#qpConfirmPhraseInput');
    const cancel=overlay.querySelector('[data-confirm-cancel]');
    const ok=overlay.querySelector('[data-confirm-phrase-ok]');
    overlay.querySelector('#qpConfirmTitle').textContent=title||'Подтвердите действие';
    overlay.querySelector('#qpConfirmMessage').textContent=message||'';
    overlay.querySelector('.qp-confirm-phrase-label').textContent=options.inputLabel||('Введите «'+expected+'»');
    input.placeholder=expected;
    cancel.textContent=options.cancelLabel||'Отмена';
    ok.textContent=options.confirmLabel||'Подтвердить';
    function syncButton(){ok.disabled=input.value!==expected;}
    input.addEventListener('input',syncButton);
    cancel.addEventListener('click',close);
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(input.value!==expected)return;
      const fn=onConfirm;
      close();
      if(typeof fn==='function') fn();
    });
    mount(overlay);
    requestAnimationFrame(()=>input.focus());
  };
})();

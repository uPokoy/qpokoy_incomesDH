/* Android-only adapter, loaded by bundled pages on the trusted local origin.
 * The production HTML, CSS, auth, CRUD and API client are not modified. */
(function(){
  if(window.qPokoyAndroidAdapter||!window.qPokoyAndroid)return;
  window.qPokoyAndroidAdapter=true;
  const send=message=>window.qPokoyAndroid.postMessage(JSON.stringify(message));
  // Android-only content inset: leave backgrounds and the WebView at y=0.
  // Native handling zeroes env(safe-area-inset-top), preventing a second inset.
  if(document.body){
    const root=document.documentElement;
    root.style.setProperty('--qp-android-page-top',getComputedStyle(document.body).paddingTop);
    const style=document.createElement('style');
    style.id='qpAndroidSafeArea';
    style.textContent='body{padding-top:calc(var(--qp-android-page-top) + var(--qp-android-top,0px)) !important}'
      +'#qpAuthGate{padding-top:calc(var(--qp-android-auth-top,0px) + var(--qp-android-top,0px)) !important}';
    const captureAuth=()=>{
      if(!document)return;
      const gate=document.getElementById('qpAuthGate');
      if(gate&&!gate.dataset.qpAndroidInset){
        // Disable our rule briefly to read the current site's own spacing.
        style.disabled=true;
        root.style.setProperty('--qp-android-auth-top',getComputedStyle(gate).paddingTop);
        style.disabled=false;gate.dataset.qpAndroidInset='true';
      }
    };
    captureAuth();document.head.appendChild(style);
    const authObserver=new MutationObserver(captureAuth);
    authObserver.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('pagehide',()=>authObserver.disconnect(),{once:true});
    window.qPokoyAndroidSetTopInset=top=>{
      root.style.setProperty('--qp-android-top',`${Number.isFinite(top)?Math.max(0,top):0}px`);
      captureAuth();
    };
  }
  // Android-only pending icon; it is a direct child of the card surface.
  const pendingStyle=document.createElement('style');pendingStyle.id='qpAndroidPendingIcon';
  pendingStyle.textContent=`
    .income-recent-card,.history-card-surface,#incomeList>.income-row:not(.history-swipe-row){position:relative}
    #income .income-recent-card>.qp-android-pending,#incomeList .qp-android-pending{position:absolute;right:12px;bottom:10px;width:16px;height:16px;display:block;opacity:.5;color:#8a9fb7;pointer-events:none;line-height:0}
    .qp-android-pending>svg{width:16px;height:16px;display:block}
    .income-recent-card:has(>.qp-android-pending) .income-recent-description,.history-card-surface:has(>.qp-android-pending)>div:nth-child(4){padding-right:24px}
  `;document.head.appendChild(pendingStyle);
  // Tell the native refresh container when the page/inner scroll is at its top.
  // Native code owns the gesture and spinner; JS never moves or reloads the page.
  const visible=node=>node&&!node.hidden&&getComputedStyle(node).display!=='none';
  let lastPullAllowed=null,pullFrame=null;
  function publishPullState(target){
    if(!window.document||!document.body)return;
    let allowed=Boolean(window.qPokoyAndroidCache?.displayed && window.qPokoyAuth?.getUser?.() && !document.body.classList.contains('qp-auth-locked') && document.visibilityState!=='hidden');
    if(!/^\/(?:index\.html)?$/.test(location.pathname)||document.querySelector('#qpConfirmOverlay')||visible(document.getElementById('incomeForm'))||document.querySelector('#categoryPopup.open,#calendarPopup.open'))allowed=false;
    if(target?.closest?.('input,textarea,select,button,[contenteditable="true"]'))allowed=false;
    for(let node=target;allowed&&node&&node!==document.body;node=node.parentElement)if(node.scrollTop>0)allowed=false;
    if(allowed!==lastPullAllowed){lastPullAllowed=allowed;send({kind:'pullSyncState',allowed});}
  }
  const schedulePullState=()=>{if(pullFrame===null)pullFrame=requestAnimationFrame(()=>{pullFrame=null;publishPullState();});};
  document.addEventListener('pointerdown',event=>publishPullState(event.target),true);
  document.addEventListener('pointerup',schedulePullState,true);
  document.addEventListener('pointercancel',schedulePullState,true);
  document.addEventListener('scroll',event=>publishPullState(event.target),true);
  document.addEventListener('visibilitychange',schedulePullState);
  const pullObserver=new MutationObserver(schedulePullState);
  pullObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
  window.addEventListener('pagehide',()=>{pullObserver.disconnect();if(pullFrame!==null)cancelAnimationFrame(pullFrame);send({kind:'pullSyncState',allowed:false});},{once:true});
  publishPullState();
  window.addEventListener('beforeinstallprompt',event=>event.preventDefault());
  window.print=()=>send({kind:'print'});
  const originalOpen=window.open.bind(window);
  window.open=function(url,...args){
    if(typeof url==='string'&&url.startsWith('blob:')){
      fetch(url).then(response=>response.text()).then(html=>send({kind:'report',html})).catch(()=>alert('Не удалось открыть отчёт.'));
      return null;
    }
    if(url){
      const target=new URL(url,location.href);
      if(target.origin===location.origin)location.assign(target.href);
      else if(target.origin==='https://qpokoy.ru'&&/^\/(?:index\.html|pricing\.html|service\.html|offer\.html|privacy\.html|about\.html)?$/.test(target.pathname))location.assign(target.pathname+target.search+target.hash);
      else send({kind:'external',url:target.href});
      return null;
    }
    return originalOpen(url,...args);
  };
  window.qPokoyAndroidDownload=function(url,filename,mime){
    fetch(url).then(response=>response.blob()).then(blob=>{
      if(blob.size>25*1024*1024)throw new Error('File too large');
      const reader=new FileReader();
      reader.onload=()=>send({kind:'download',filename,mime:blob.type||mime,data:reader.result.split(',')[1]});
      reader.onerror=()=>alert('Не удалось подготовить файл.');
      reader.readAsDataURL(blob);
    }).catch(()=>alert('Не удалось скачать файл.'));
  };
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[download]');
    if(!link||!link.href.startsWith('blob:'))return;
    event.preventDefault();
    window.qPokoyAndroidDownload(link.href,link.download||'qpokoy-export','application/octet-stream');
  },true);
  window.qPokoyAndroidBack=function(){
    const visible=node=>node&&!node.hidden&&getComputedStyle(node).display!=='none';
    const click=selector=>{const node=document.querySelector(selector);if(!visible(node))return false;node.click();return true;};
    if(click('#qpConfirmOverlay [data-confirm-cancel]'))return true;
    const notice=document.querySelector('#qpConfirmOverlay');
    if(notice){notice.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;}
    if(document.querySelector('#categoryPopup.open'))return click('#categorySelect');
    if(document.querySelector('#calendarPopup.open'))return click('#openCalendar');
    if(visible(document.querySelector('#incomeForm')))return click('#cancelIncome');
    if(document.querySelector('#analyticsSettingsToggle[aria-expanded="true"]'))return click('#analyticsSettingsToggle');
    if(document.querySelector('#incomeRecent.is-history-open'))return click('#incomeRecentHistory');
    return false;
  };
})();

/* Android-only adapter, injected by MainActivity into the trusted qPokoy origin.
 * The production HTML, CSS, auth, CRUD and API client are not modified. */
(function(){
  if(window.qPokoyAndroidAdapter||!window.qPokoyAndroid)return;
  window.qPokoyAndroidAdapter=true;
  const send=message=>window.qPokoyAndroid.postMessage(JSON.stringify(message));
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
      if(target.origin==='https://qpokoy.ru')location.assign(target.href);
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

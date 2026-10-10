/* Android-only prelude: runs before website scripts, no production changes. */
(function(){
  'use strict';
  window.qPokoyAndroidBundled=true;
  // Legacy UI storage is only a working buffer; never display it before identity.
  for(const key of ['incomes','qPokoyIncomeOwnerId','qPokoyIncomeWriteJournalV1'])localStorage.removeItem(key);
  window.addEventListener('beforeinstallprompt',event=>event.preventDefault());
  // Do not create a second cache/offline layer on the Capacitor asset server.
  if(navigator.serviceWorker){
    navigator.serviceWorker.register=()=>Promise.reject(new Error('PWA disabled in Android'));
  }
  window.qPokoyAndroidStartOAuth=()=>Promise.reject(new Error('Вход через Яндекс в Android пока недоступен. Используйте email и пароль.'));
  let state='unknown',readJob=null,revision=0;
  function accept(value){
    const next=['offline','online','unknown'].includes(value?.state)?value.state:'unknown';
    revision++;state=next;return {state};
  }
  function deadline(promise,milliseconds,status=0){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=window.setTimeout(()=>{
      const error=new Error('Не удалось подключиться к серверу. Время ожидания истекло.');
      error.code=status?'android_response_body':'android_transport';error.status=status;reject(error);
    },milliseconds);});
    return Promise.race([promise,timeout]).finally(()=>window.clearTimeout(timer));
  }
  async function readNetwork(){
    if(readJob)return readJob;
    const run=revision;
    const job=(async()=>{
      try{
        if(!window.Capacitor?.nativePromise)return {state};
        const result=await deadline(window.Capacitor.nativePromise('QPokoyReadCache','getNetworkState',{}),2000);
        if(run===revision)accept(result);
      }catch(_){if(run===revision)accept({state:'unknown'});}
      return {state};
    })();
    readJob=job;try{return await job;}finally{if(readJob===job)readJob=null;}
  }
  // The native result wins over stale WebView onLine. Unknown remains distinct.
  window.qPokoyAndroidNetwork={read:readNetwork,accept,get state(){return state;},
    get available(){return state==='online'||state==='unknown'&&navigator.onLine!==false;}};
  const originalFetch=window.fetch.bind(window);
  const apiOrigin='https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net';
  window.fetch=async function(input,options){
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==apiOrigin)return originalFetch(input,options);
    await readNetwork();
    if(!window.qPokoyAndroidNetwork.available){const error=new Error('Нет подключения к интернету. Повторите после восстановления сети.');error.code='android_transport';error.status=0;throw error;}
    let response;
    try{response=await deadline(originalFetch(input,options),30000);}
    catch(_){const error=new Error('Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.');error.code='android_transport';error.status=0;throw error;}
    // A truncated successful body is a lost response; an HTTP error is never offline success.
    if(typeof response.text==='function'){
      const text=response.text.bind(response);
      response.text=()=>deadline(text(),30000,response.ok?0:response.status).catch(cause=>{
        const error=new Error('Не удалось прочитать ответ сервера.');
        error.status=response.ok?0:response.status;error.code=response.ok?'android_transport':'android_response_body';throw error;
      });
    }
    return response;
  };
})();

/* Android-only prelude: runs before website scripts, no production changes. */
(function(){
  'use strict';
  window.qPokoyAndroidBundled=true;
  window.addEventListener('beforeinstallprompt',event=>event.preventDefault());
  // Do not create a second cache/offline layer on the Capacitor asset server.
  if(navigator.serviceWorker){
    navigator.serviceWorker.register=()=>Promise.reject(new Error('PWA disabled in Android'));
  }
  window.qPokoyAndroidStartOAuth=()=>Promise.reject(new Error('Вход через Яндекс в Android пока недоступен. Используйте email и пароль.'));
  const originalFetch=window.fetch.bind(window);
  const apiOrigin='https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net';
  window.fetch=function(input,options){
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==apiOrigin)return originalFetch(input,options);
    if(!navigator.onLine)return Promise.reject(new Error('Нет подключения к интернету. Повторите после восстановления сети.'));
    return originalFetch(input,options).catch(()=>{throw new Error('Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.');});
  };
})();

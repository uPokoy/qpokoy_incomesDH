/* Android-only OAuth delivery. Native storage owns attempts until acknowledgement. */
(function(w){
  'use strict';
  let attached=false;
  w.qPokoyAndroidOAuth={cancel:()=>w.Capacitor.nativePromise('QPokoyOAuth','cancel',{}).catch(()=>{}),attach({api,ready,getUser,sync,message}){
    if(attached)return;attached=true;
    const native=(method,args={})=>w.Capacitor.nativePromise('QPokoyOAuth',method,args);
    let flight=null,timer=null,retries=0,stopped=false,queued=false;
    const acknowledge=attempt_id=>native('acknowledge',{attempt_id});
    async function process(){
      await ready();
      const pending=await native('pending');
      if(!pending?.attempt_id)return;
      // Also covers a successful login whose bootstrap has not painted yet.
      if(getUser()||api.getToken()){await native('cancel');return;}
      if(pending.error){await acknowledge(pending.attempt_id);message('Вход через Яндекс отменён или не завершён. Повторите вход.');return;}
      let exchanged=false;
      try{
        const user=await api.exchangeOAuthTicket(pending.ticket,{attempt_id:pending.attempt_id,code_verifier:pending.code_verifier});
        exchanged=true;
        // saveSession has committed the normal session. A crash before this ack
        // is safe: on restart an existing session makes the callback obsolete.
        await acknowledge(pending.attempt_id);
        await sync(user);
        retries=0;
      }catch(error){
        if(getUser()||api.getToken()){await native('cancel');return;}
        const transient=!exchanged&&(error?.status===0||error?.status>=500||error?.status===429||error?.code==='android_transport');
        if(transient){
          message('Нет ответа сервера. Вход будет повторён после восстановления соединения.');
          if(retries<3&&!stopped){const delay=[1000,3000,8000][retries++];timer=w.setTimeout(()=>{timer=null;void pump();},delay);}
        }else{
          await acknowledge(pending.attempt_id);
          message('Ссылка входа недействительна или уже использована. Повторите вход через Яндекс.');
        }
      }
    }
    function pump(){
      if(stopped)return Promise.resolve();
      if(flight){queued=true;return flight;}
      flight=process().catch(()=>{message('Не удалось обработать вход через Яндекс. Повторите попытку.');}).finally(()=>{flight=null;if(queued){queued=false;void pump();}});
      return flight;
    }
    // Events carry no credentials; getter also handles delivery before listeners.
    const listener=w.Capacitor.addListener('QPokoyOAuth','available',()=>{void pump();});
    w.addEventListener('online',pump);
    const visible=()=>{if(w.document.visibilityState==='visible')void pump();};
    w.document.addEventListener('visibilitychange',visible);
    w.addEventListener('pagehide',()=>{stopped=true;if(timer)w.clearTimeout(timer);Promise.resolve(listener).then(handle=>handle?.remove()).catch(()=>{});w.removeEventListener('online',pump);w.document.removeEventListener('visibilitychange',visible);},{once:true});
    void pump();
  }};
})(window);

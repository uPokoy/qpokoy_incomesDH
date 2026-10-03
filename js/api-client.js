(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.qPokoyApi=api.createApiClient();
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const API_BASE_URL='https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net';
  const TOKEN_KEY='qPokoyYdbSessionTokenV1';
  const BOOTSTRAP_CACHE_KEY='qPokoyBootstrapCacheV1';
  const CACHE_VERSION=1;

  class ApiError extends Error{
    constructor(status,code,message){super(message);this.name='ApiError';this.status=status;this.code=code;}
  }
  function createApiClient(options={}){
    const baseUrl=(options.baseUrl||API_BASE_URL).replace(/\/$/,'');
    const storage=options.storage||(typeof localStorage!=='undefined'?localStorage:null);
    const fetcher=options.fetchImpl||(typeof fetch!=='undefined'?fetch.bind(globalThis):null);
    let unauthorizedHandler=null;
    function clearBootstrapCache(){try{storage?.removeItem(BOOTSTRAP_CACHE_KEY);}catch(_){}}
    function sessionId(){return String(getToken()||'').split('.')[0];}
    function validData(data,uid){
      const owned=row=>row&&(!row.user_id||row.user_id===uid);
      return Array.isArray(data.incomes)&&data.incomes.every(row=>owned(row)&&typeof row.id==='string'
        &&typeof row.income_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.income_date)
        &&typeof row.category==='string'&&typeof row.description==='string'
        &&Number.isFinite(row.amount)&&row.amount>0&&row.amount<=1e12)
        &&Array.isArray(data.categories)&&data.categories.every(row=>owned(row)&&typeof row.id==='string'&&typeof row.name==='string')
        &&Array.isArray(data.settings)&&data.settings.every(row=>owned(row)&&typeof row.setting_key==='string'&&typeof row.setting_value==='string');
    }
    // Detect truncated/accidentally modified bundles; this is not an auth mechanism.
    function checksum(data){
      const text=JSON.stringify([data.version,data.sessionId,data.user_id,data.revision,data.incomes,data.categories,data.settings]);
      let hash=2166136261;
      for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
      return (hash>>>0).toString(16);
    }
    function readBootstrapCache(){
      try{
        const cache=JSON.parse(storage?.getItem(BOOTSTRAP_CACHE_KEY)||'null');
        if(cache&&cache.version===CACHE_VERSION&&cache.sessionId===sessionId()
          &&typeof cache.user_id==='string'&&cache.user_id&&typeof cache.revision==='string'&&cache.revision&&cache.revision.length<=128
          &&validData(cache,cache.user_id)&&cache.checksum===checksum(cache))return cache;
      }catch(_){}
      clearBootstrapCache();
      return null;
    }
    function saveBootstrapCache(data){
      if(typeof data.revision!=='string'||!data.revision||data.revision.length>128||!validData(data,data.user.user_id)){
        clearBootstrapCache();return;
      }
      const cache={version:CACHE_VERSION,sessionId:sessionId(),user_id:data.user.user_id,revision:data.revision,
        incomes:data.incomes,categories:data.categories,settings:data.settings};
      cache.checksum=checksum(cache);
      try{storage?.setItem(BOOTSTRAP_CACHE_KEY,JSON.stringify(cache));}catch(_){clearBootstrapCache();}
    }
    function getToken(){try{return storage?.getItem(TOKEN_KEY)||null;}catch(_){return null;}}
    function setToken(token){
      if(!storage)throw new Error('Локальное хранилище недоступно. Сессию нельзя сохранить.');
      storage.setItem(TOKEN_KEY,token);
    }
    function clearToken(){clearBootstrapCache();try{storage?.removeItem(TOKEN_KEY);}catch(_){}}
    async function request(method,path,body,authenticated=true){
      if(!fetcher)throw new Error('Fetch недоступен.');
      const headers={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(authenticated){
        const token=getToken();
        if(!token)throw new ApiError(401,'unauthorized','Требуется вход в аккаунт.');
        headers.Authorization=`Bearer ${token}`;
        // Invalidate before sending: the server may commit even if the response is lost.
        if(method!=='GET'&&/^\/(incomes|categories|settings)(\/|$)/.test(path))clearBootstrapCache();
      }
      const response=await fetcher(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.status===401&&authenticated){
        clearToken();
        if(unauthorizedHandler)unauthorizedHandler();
      }
      let payload=null;
      if(response.status!==204){
        const raw=await response.text();
        if(raw){try{payload=JSON.parse(raw);}catch(_){throw new ApiError(response.status,'invalid_response','Сервер вернул некорректный ответ.');}}
      }
      if(!response.ok){
        throw new ApiError(response.status,payload?.error?.code||'http_error',payload?.error?.message||`Ошибка сервера (${response.status}).`);
      }
      return payload;
    }
    function saveSession(payload){
      if(!payload?.token||!payload?.user)throw new ApiError(0,'invalid_response','Сервер не вернул сессию.');
      clearBootstrapCache();
      setToken(payload.token);
      return payload.user;
    }
    return {
      getToken,clearToken,request,
      setUnauthorizedHandler(handler){unauthorizedHandler=handler;},
      async register(email,password){
        const payload=await request('POST','/auth/register',{email,password},false);
        return payload?.token&&payload?.user ? saveSession(payload) : payload;
      },
      async login(email,password){return saveSession(await request('POST','/auth/login',{email,password},false));},
      async startOAuth(provider){
        if(provider!=='yandex')throw new ApiError(0,'invalid_provider','Неизвестный OAuth-провайдер.');
        const payload=await request('GET',`/auth/oauth/${provider}/start`,undefined,false);
        if(!payload?.url)throw new ApiError(0,'invalid_response','Сервер не вернул адрес OAuth-авторизации.');
        return payload.url;
      },
      async exchangeOAuthTicket(ticket){
        return saveSession(await request('POST','/auth/oauth/exchange',{ticket},false));
      },
      async resendEmailVerification(email){return request('POST','/auth/email-verification/resend',{email},false);},
      async confirmEmailVerification(token){return request('POST','/auth/email-verification/confirm',{token},false);},
      async requestPasswordReset(email){return request('POST','/auth/password-reset/request',{email},false);},
      async confirmPasswordReset(token,password){return request('POST','/auth/password-reset/confirm',{token,password},false);},
      async restoreSession(){
        if(!getToken())return null;
        try{return (await request('GET','/auth/me')).user;}
        catch(error){if(error.status===401)return null;throw error;}
      },
      async bootstrap(){
        if(!getToken())return null;
        const token=getToken();
        const cache=readBootstrapCache();
        try{
          let payload=await request('GET','/bootstrap'+(cache?'?revision='+encodeURIComponent(cache.revision):''));
          if(token!==getToken())throw new ApiError(0,'session_changed','Сессия изменилась во время загрузки.');
          if(payload?.not_modified===true){
            if(cache&&payload.user?.user_id===cache.user_id&&payload.revision===cache.revision){
              return {...payload,incomes:cache.incomes,categories:cache.categories,settings:cache.settings};
            }
            // One full fetch only for a mismatched cache response, never a retry for 500/RU errors.
            clearBootstrapCache();
            payload=await request('GET','/bootstrap');
            if(token!==getToken())throw new ApiError(0,'session_changed','Сессия изменилась во время загрузки.');
          }
          if(!payload?.user?.user_id||!Array.isArray(payload.incomes)||!Array.isArray(payload.categories)||!Array.isArray(payload.settings)){
            throw new ApiError(0,'invalid_response','Сервер не вернул данные для запуска приложения.');
          }
          if(payload.not_modified===true)throw new ApiError(0,'invalid_response','Сервер не вернул полные данные.');
          saveBootstrapCache(payload);
          return payload;
        }catch(error){if(error.status===401)return null;throw error;}
      },
      async logout(){try{await request('POST','/auth/logout');}finally{clearToken();}},
      async deleteAccount(){await request('DELETE','/auth/me');clearToken();},
      async billingStatus(){return (await request('GET','/billing/status')).data;},
      async listIncomes(){return (await request('GET','/incomes')).data;},
      async replaceIncomes(incomes){return (await request('POST','/incomes/replace',{incomes})).data;},
      async deleteAllIncomes(){return request('DELETE','/incomes');},
      async addIncome(row){return (await request('POST','/incomes',row)).data;},
      async updateIncome(id,row){return (await request('PUT',`/incomes/${encodeURIComponent(id)}`,row)).data;},
      async deleteIncome(id){return request('DELETE',`/incomes/${encodeURIComponent(id)}`);},
      async listCategories(){return (await request('GET','/categories')).data;},
      async addCategory(name){return (await request('POST','/categories',{name})).data;},
      async deleteCategory(id){return request('DELETE',`/categories/${encodeURIComponent(id)}`);},
      async listSettings(){return (await request('GET','/settings')).data;},
      async putSetting(key,value){return (await request('PUT',`/settings/${encodeURIComponent(key)}`,{setting_value:value})).data;}
    };
  }
  return {API_BASE_URL,TOKEN_KEY,BOOTSTRAP_CACHE_KEY,ApiError,createApiClient};
});

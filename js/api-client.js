(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.qPokoyApi=api.createApiClient();
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const API_BASE_URL='https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net';
  const TOKEN_KEY='qPokoyYdbSessionTokenV1';

  class ApiError extends Error{
    constructor(status,code,message){super(message);this.name='ApiError';this.status=status;this.code=code;}
  }
  function createApiClient(options={}){
    const baseUrl=(options.baseUrl||API_BASE_URL).replace(/\/$/,'');
    const storage=options.storage||(typeof localStorage!=='undefined'?localStorage:null);
    const fetcher=options.fetchImpl||(typeof fetch!=='undefined'?fetch.bind(globalThis):null);
    let unauthorizedHandler=null;
    function getToken(){try{return storage?.getItem(TOKEN_KEY)||null;}catch(_){return null;}}
    function setToken(token){
      if(!storage)throw new Error('Локальное хранилище недоступно. Сессию нельзя сохранить.');
      storage.setItem(TOKEN_KEY,token);
    }
    function clearToken(){try{storage?.removeItem(TOKEN_KEY);}catch(_){}}
    async function request(method,path,body,authenticated=true){
      if(!fetcher)throw new Error('Fetch недоступен.');
      const headers={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(authenticated){
        const token=getToken();
        if(!token)throw new ApiError(401,'unauthorized','Требуется вход в аккаунт.');
        headers.Authorization=`Bearer ${token}`;
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
      setToken(payload.token);
      return payload.user;
    }
    return {
      getToken,clearToken,request,
      setUnauthorizedHandler(handler){unauthorizedHandler=handler;},
      async register(email,password){return saveSession(await request('POST','/auth/register',{email,password},false));},
      async login(email,password){return saveSession(await request('POST','/auth/login',{email,password},false));},
      async restoreSession(){
        if(!getToken())return null;
        try{return (await request('GET','/auth/me')).user;}
        catch(error){if(error.status===401)return null;throw error;}
      },
      async logout(){try{await request('POST','/auth/logout');}finally{clearToken();}},
      async listIncomes(){return (await request('GET','/incomes')).data;},
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
  return {API_BASE_URL,TOKEN_KEY,ApiError,createApiClient};
});

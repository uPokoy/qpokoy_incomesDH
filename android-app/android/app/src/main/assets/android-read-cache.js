/* Android-only SQLite read snapshots. Server wins; credentials stay in api-client. */
(function(root,factory){
  const exported=factory();
  if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root?.qPokoyApi&&root.Capacitor){
    const native=method=>options=>root.Capacitor.nativePromise('QPokoyReadCache',method,options||{});
    const cache=exported.create({api:root.qPokoyApi,db:{read:native('read'),write:native('write'),clear:native('clear')},
      fingerprint:async token=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join(''),
      online:()=>root.navigator.onLine,clock:()=>Date.now(),notify:()=>root.qPokoyNotice?.('Нет подключения к интернету','Дождитесь подключения и завершения синхронизации.','error')});
    root.qPokoyAndroidCache=cache;
    cache.install(root);
  }
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const schemaVersion=1;
  function snapshot(data,now){
    const uid=data?.user?.user_id;
    if(typeof uid!=='string'||!uid)throw new Error('Missing account identity');
    const own=row=>{if(!row||row.user_id!==uid)throw new Error('Cross-account cache row');};
    const incomes=data.incomes.map(row=>{
      own(row);if(typeof row.id!=='string'||typeof row.income_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.income_date)||typeof row.category!=='string'||typeof row.description!=='string'||!Number.isFinite(row.amount)||row.amount<=0)throw new Error('Invalid income');
      return {id:row.id,user_id:uid,income_date:row.income_date,category:row.category,description:row.description,amount:row.amount};
    });
    const categories=data.categories.map(row=>{own(row);if(typeof row.id!=='string'||typeof row.name!=='string')throw new Error('Invalid category');return {id:row.id,user_id:uid,name:row.name};});
    const settings=data.settings.filter(row=>! /^(auth|system|billing|rate)\./.test(row.setting_key)).map(row=>{own(row);if(typeof row.setting_key!=='string'||typeof row.setting_value!=='string')throw new Error('Invalid setting');return {user_id:uid,setting_key:row.setting_key,setting_value:row.setting_value};});
    if(new Set(incomes.map(row=>row.id)).size!==incomes.length||new Set(categories.map(row=>row.id)).size!==categories.length)throw new Error('Duplicate cache IDs');
    return {schemaVersion,user:{user_id:uid,email:String(data.user.email||''),onboarding_completed:data.user.onboarding_completed===true},incomes,categories,settings,lastSuccessfulSync:now};
  }
  const signature=s=>JSON.stringify([s.user,s.incomes,s.categories,s.settings]);
  function create({api,db,fingerprint,online,clock=Date.now,notify=()=>{}}){
    const bootstrap=api.bootstrap.bind(api);
    let epoch=0,current=null,binding=null,validatedToken=null,displayed=false,renderedSignature=null,hydrate=null,refreshJob=null,refreshEpoch=0,clearJob=Promise.resolve(),mutations=0,view=null;
    const metrics={};
    async function identity(token){return token?fingerprint(token):null;}
    async function save(value,token,run){
      const hash=await identity(token);
      if(run!==epoch||token!==api.getToken())return false;
      await clearJob.catch(()=>{});
      if(run!==epoch||token!==api.getToken())return false;
      await db.write({sessionHash:hash,snapshot:value});
      if(run!==epoch||token!==api.getToken())return false;
      current=value;binding=hash;return true;
    }
    function purge(){
      epoch++;current=null;binding=null;validatedToken=null;displayed=false;renderedSignature=null;
      if(view){
        view.qPokoyAuth?.showGate(true);view.IncomeStore.save([]);void view.qPokoyLoadCategories?.(null);
        view.applyIncomeHeaderFilters?.();view.renderIncomeAnalytics?.();
      }
      clearJob=clearJob.catch(()=>{}).then(()=>db.clear());return clearJob;
    }
    function canWrite(){return online()&&validatedToken===api.getToken()&&!!validatedToken;}
    function requireWrite(){if(!canWrite()){notify();const error=new Error('Нет подключения к интернету или синхронизация ещё не завершена.');error.code='android_read_only';throw error;}}
    async function fetchSnapshot(){
      const token=api.getToken(),run=epoch;if(!token)return null;
      await clearJob.catch(()=>{});
      const data=await bootstrap();
      if(run!==epoch||token!==api.getToken())return undefined;
      if(!data){await purge();return null;}
      const value=snapshot(data,clock());
      const old=renderedSignature;
      // A storage failure must not make a successful server response unusable.
      try{await save(value,token,run);}catch(_){if(run===epoch&&token===api.getToken()){current=value;binding=await identity(token);}}
      if(run!==epoch||token!==api.getToken())return undefined;
      validatedToken=token;metrics.serverRefresh=performance.now();
      return {data,value,changed:old!==signature(value)};
    }
    async function refresh(){
      if(refreshJob){
        const job=refreshJob,run=refreshEpoch;await job;
        if(run!==epoch)return refresh();
        return;
      }
      if(mutations||!online())return;
      refreshEpoch=epoch;
      const job=(async()=>{
        try{
          const result=await fetchSnapshot();
          if(result===undefined)return;
          if(result===null){displayed=false;await hydrate?.(null,false);return;}
          if(!displayed||result.changed){await hydrate?.(result.data,false);displayed=true;renderedSignature=signature(result.value);}
        }catch(error){
          if(!displayed)throw error;
          // Keep the last successful snapshot during transient network/5xx errors.
          if(error.status===401){await purge();await hydrate?.(null,false);}
        }
      })();
      refreshJob=job;try{return await job;}finally{if(refreshJob===job)refreshJob=null;}
    }
    async function start(apply){
      hydrate=apply;displayed=false;current=null;binding=null;validatedToken=null;renderedSignature=null;metrics.started=performance.now();
      const token=api.getToken(),run=epoch;
      await clearJob.catch(()=>{});
      if(token){
        const hash=await identity(token);
        try{
          const {snapshot:cached}=await db.read({sessionHash:hash});
          if(cached&&cached.schemaVersion===schemaVersion&&Number.isFinite(cached.lastSuccessfulSync)&&run===epoch&&token===api.getToken()){
            const clean=snapshot(cached,cached.lastSuccessfulSync);
            current=clean;binding=hash;displayed=true;
            await apply({...clean,user:{...clean.user,onboarding_completed:true}},true);
            renderedSignature=signature(clean);
            metrics.cachedDisplay=performance.now();
          }else if(cached){await purge();}
        }catch(_){await purge().catch(()=>{});}
      }
      if(!online()&&displayed)return;
      await refresh();
      if(!online()&&!displayed)throw new Error('Нет подключения к интернету');
    }
    async function confirmed(name,args,result,token,run){
      if(!current||token!==api.getToken()||run!==epoch)return;
      const value=JSON.parse(JSON.stringify(current));
      const upsert=(rows,row,key)=>{const index=rows.findIndex(x=>x[key]===row[key]);if(index<0)rows.push(row);else rows[index]=row;};
      if(name==='addIncome'||name==='updateIncome')upsert(value.incomes,result,'id');
      else if(name==='deleteIncome')value.incomes=value.incomes.filter(row=>row.id!==String(args[0]));
      else if(name==='deleteAllIncomes')value.incomes=[];
      else if(name==='replaceIncomes')value.incomes=result;
      else if(name==='addCategory')upsert(value.categories,result,'id');
      else if(name==='deleteCategory')value.categories=value.categories.filter(row=>row.id!==String(args[0]));
      else if(name==='putSetting')upsert(value.settings,result,'setting_key');
      else if(name==='completeOnboarding')value.user.onboarding_completed=true;
      await save(snapshot(value,clock()),token,run).catch(()=>{});
    }
    function install(w){
      view=w;
      const originalClear=api.clearToken.bind(api);
      api.clearToken=function(){originalClear();void purge().catch(()=>{});};
      for(const name of ['login','register','exchangeOAuthTicket']){
        const original=api[name].bind(api);api[name]=async(...args)=>{await purge();return original(...args);};
      }
      const originalLogout=api.logout.bind(api);
      api.logout=async(...args)=>{await purge().catch(()=>{});try{return await originalLogout(...args);}finally{await purge().catch(()=>{});}};
      const originalDelete=api.deleteAccount.bind(api);
      api.deleteAccount=async(...args)=>{requireWrite();const result=await originalDelete(...args);await purge();return result;};
      api.bootstrap=async()=>{const result=await fetchSnapshot();if(result===undefined)throw new Error('Сессия изменилась');return result?.data||null;};
      // Guard every existing server mutation, including direct API callers.
      for(const name of ['addIncome','updateIncome','deleteIncome','deleteAllIncomes','replaceIncomes','addCategory','deleteCategory','putSetting','completeOnboarding','createPayment']){
        const original=api[name]?.bind(api);if(!original)continue;
        api[name]=async(...args)=>{
          requireWrite();const token=api.getToken();const run=++epoch;mutations++;
          try{const result=await original(...args);await confirmed(name,args,result,token,run).catch(()=>{});return result;}
          finally{mutations--;w.setTimeout(()=>{if(!mutations)void (refreshJob||Promise.resolve()).catch(()=>{}).then(()=>refresh()).catch(()=>{});},0);}
        };
      }
      // Replace optimistic local/journal writes in Android with server-acknowledged writes.
      const store=w.IncomeStore;
      const rowToUi=row=>({id:String(row.id),date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description});
      const uiToRow=record=>{const parts=record.date.split('.');return {...record,income_date:(parts[2].length===2?'20'+parts[2]:parts[2])+'-'+parts[1]+'-'+parts[0]};};
      for(const name of ['add','update'])store[name]=async(...args)=>{
        requireWrite();const token=api.getToken();const record=name==='add'?args[0]:args[1];
        const saved=await (name==='add'?api.addIncome(uiToRow(record)):api.updateIncome(args[0],uiToRow(record)));
        if(token!==api.getToken())throw new Error('Сессия изменилась');
        const rows=store.load().filter(row=>String(row.id)!==String(saved.id));return store.save([rowToUi(saved),...rows]);
      };
      store.remove=async id=>{requireWrite();const token=api.getToken();await api.deleteIncome(id);if(token!==api.getToken())return null;const rows=store.save(store.load().filter(row=>String(row.id)!==String(id)));w.applyIncomeHeaderFilters?.();w.renderIncomeAnalytics?.();return rows;};
      store.addMany=async records=>{requireWrite();for(const record of records)await store.add(record);return store.load();};
      const blocked='#openIncomeForm,.edit-income,.delete-income,#saveIncome,#qpCategoryAdd,.qp-category-delete,.category-popup-create-btn,#clearIncomeDataBtn,#qpAuthDeleteAccountBtn';
      w.document.addEventListener('click',event=>{if(!canWrite()&&event.target.closest?.(blocked)){event.preventDefault();event.stopImmediatePropagation();notify();}},true);
      w.addEventListener('online',()=>{void (refreshJob||Promise.resolve()).catch(()=>{}).then(()=>refresh()).catch(()=>{});});
      w.document.addEventListener('visibilitychange',()=>{if(w.document.visibilityState==='visible')void refresh().catch(()=>{});});
    }
    return {start,refresh,purge,install,requireWrite,metrics,get displayed(){return displayed;},get snapshot(){return current;},get binding(){return binding;},get canWrite(){return canWrite();}};
  }
  return {create,snapshot,schemaVersion};
});

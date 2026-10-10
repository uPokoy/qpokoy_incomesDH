/* Android-only confirmed SQLite snapshots and durable create-only outbox. Credentials stay in api-client. */
(function(root,factory){
  const exported=factory();
  if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root?.qPokoyApi&&root.Capacitor){
    const native=method=>options=>root.Capacitor.nativePromise('QPokoyReadCache',method,options||{});
    const cache=exported.create({api:root.qPokoyApi,db:{read:native('read'),write:native('write'),clear:native('clear'),enqueue:native('enqueue'),pendingState:native('pendingState'),pendingCount:native('pendingCount')},
      fingerprint:async token=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join(''),
      online:()=>root.qPokoyAndroidNetwork.available,networkState:()=>root.qPokoyAndroidNetwork.read(),clock:()=>Date.now(),notify:()=>root.qPokoyNotice?.('Нет подключения к интернету','Дождитесь подключения и завершения синхронизации.','error')});
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
  const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function incomeValue(row){
    const date=row?.income_date,day=typeof date==='string'?new Date(date+'T00:00:00.000Z'):null;
    const input=typeof row?.amount==='string'?row.amount.replace(/[\s\u00a0\u202f]/g,'').replace(',','.'):row?.amount;
    if((typeof input!=='number'&&(typeof input!=='string'||!/^\d+(?:\.\d+)?$/.test(input)))||!Number.isFinite(Number(input))||Math.trunc(Number(input))<=0||Number(input)>1e12
      ||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(day?.getTime())||day.toISOString().slice(0,10)!==date
      ||typeof row.category!=='string'||!row.category.trim()||row.category.trim().length>80||typeof row.description!=='string'||row.description.length>5000)throw new Error('Некорректные данные дохода');
    return {income_date:date,amount:Math.trunc(Number(input)),category:row.category.trim(),description:row.description.trim()};
  }
  function transportError(error){
    if(Number(error?.status)>0)return false;
    return error?.code==='android_transport'||error?.status===undefined&&(
      ['AbortError','TimeoutError'].includes(error?.name)||error?.name==='TypeError'&&/fetch|network|connection|dns|socket/i.test(error.message||''));
  }
  function create({api,db,fingerprint,online,networkState=async()=>{},clock=Date.now,notify=()=>{},uuid=()=>globalThis.crypto.randomUUID()}){
    const bootstrap=api.bootstrap.bind(api);
    const sendAdd=api.addIncome?.bind(api);
    let epoch=0,current=null,binding=null,validatedToken=null,displayed=false,renderedSignature=null,hydrate=null,refreshJob=null,refreshEpoch=0,clearJob=Promise.resolve(),mutations=0,view=null;
    let pending=[],syncJob=null,retryTimer=null;
    const metrics={};
    const pendingWarning='Есть доходы, которые ещё не синхронизированы. Подключитесь к интернету и дождитесь синхронизации перед выходом.';
    function setPending(rows,uid){
      if(!Array.isArray(rows))return;
      if(rows.some(row=>row.user_id!==uid||!uuidPattern.test(row.income_id)||!uuidPattern.test(row.operation_id)))throw new Error('Invalid pending account binding');
      pending=rows;
    }
    function combined(){
      if(!current)return null;
      const ids=new Set(current.incomes.map(row=>row.id));
      return {...current,incomes:[...current.incomes,...pending.filter(row=>!ids.has(row.income_id)).map(row=>({id:row.income_id,user_id:row.user_id,...incomeValue(row)}))]};
    }
    const shownSignature=()=>current?signature(combined())+JSON.stringify(pending.map(row=>[row.income_id,row.status,row.error_code])):null;
    async function paint(cached=false){
      const data=combined();if(!data)return;
      const next=shownSignature();if(!displayed||renderedSignature!==next){await hydrate?.(cached?{...data,user:{...data.user,onboarding_completed:true}}:data,cached);displayed=true;renderedSignature=next;}
    }
    function pendingLabel(id){const row=pending.find(row=>row.income_id===String(id));return !row?'':row.status==='error'?'Не синхронизирован: ошибка сервера':row.status==='auth_required'?'Требуется вход для синхронизации':'Ожидает синхронизации';}
    async function guardPending(){
      if(pending.length||(binding&&db.pendingCount&&(await db.pendingCount({sessionHash:binding})).count)){
        const error=new Error(pendingWarning);error.code='android_pending_logout';view?.qPokoyNotice?.('Несинхронизированные доходы',pendingWarning,'error');throw error;
      }
    }
    async function identity(token){return token?fingerprint(token):null;}
    async function save(value,token,run){
      const hash=await identity(token);
      if(run!==epoch||token!==api.getToken())return false;
      await clearJob.catch(()=>{});
      if(run!==epoch||token!==api.getToken())return false;
      const stored=await db.write({sessionHash:hash,snapshot:value});
      if(run!==epoch||token!==api.getToken())return false;
      current=value;binding=hash;setPending(stored?.pending,value.user.user_id);return true;
    }
    function purge(){
      epoch++;current=null;binding=null;validatedToken=null;displayed=false;renderedSignature=null;pending=[];
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
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
      return {data:combined(),value,changed:old!==shownSignature()};
    }
    async function refresh(){
      await networkState();
      if(refreshJob){
        const job=refreshJob,run=refreshEpoch;await job;
        if(run!==epoch)return refresh();
        return;
      }
      if(mutations||!online())return;
      if(!api.getToken())return;
      refreshEpoch=epoch;
      const job=(async()=>{
        try{
          const result=await fetchSnapshot();
          if(result===undefined)return;
          if(result===null){displayed=false;await hydrate?.(null,false);return;}
          if(!displayed||result.changed)await paint();
        }catch(error){
          if(!displayed)throw error;
          // Keep the last successful snapshot during transient network/5xx errors.
          if(error.status===401){await purge();await hydrate?.(null,false);}
        }
      })();
      refreshJob=job;try{await job;}finally{if(refreshJob===job)refreshJob=null;}
      await syncPending();
    }
    async function start(apply){
      hydrate=apply;displayed=false;current=null;binding=null;validatedToken=null;renderedSignature=null;pending=[];metrics.started=performance.now();
      const token=api.getToken(),run=epoch;
      await clearJob.catch(()=>{});
      if(!token){await apply(null,false);return;}
      if(token){
        const hash=await identity(token);
        try{
          const {snapshot:cached,pending:queued}=await db.read({sessionHash:hash});
          if(cached&&cached.schemaVersion===schemaVersion&&Number.isFinite(cached.lastSuccessfulSync)&&run===epoch&&token===api.getToken()){
            const clean=snapshot(cached,cached.lastSuccessfulSync);
            current=clean;binding=hash;setPending(queued,clean.user.user_id);displayed=true;
            await paint(true);
            metrics.cachedDisplay=performance.now();
          }else if(cached){await purge();}
        }catch(_){await purge().catch(()=>{});}
      }
      if(!online()&&displayed)return;
      await refresh();
      if(!online()&&!displayed)throw new Error('Нет подключения к интернету');
    }
    async function enqueue(record,failedTransport=false){
      const token=api.getToken(),uid=current?.user.user_id,hash=binding;
      const digest=await identity(token);
      if((online()&&!failedTransport)||!db.enqueue||!current||!hash||!token||hash!==digest||token!==api.getToken()||uid!==current.user.user_id||binding!==hash)throw new Error('Офлайн-добавление недоступно: сначала войдите и загрузите данные с сервера.');
      const value=incomeValue(record),id=record.id||uuid();
      if(!uuidPattern.test(id)||current.incomes.some(row=>row.id===id)||pending.some(row=>row.income_id===id))throw new Error('Некорректный или повторный ID дохода');
      if(!current.categories.some(row=>row.name===value.category))throw new Error('Выберите ранее загруженную категорию.');
      const run=++epoch;
      const result=await db.enqueue({sessionHash:hash,userId:uid,income:{operation_id:uuid(),income_id:id,...value,created_at:clock()}});
      // SQLite commit precedes any success UI. An interrupted UI can reload this row.
      if(run!==epoch||token!==api.getToken())return;
      setPending(result.pending,uid);await paint(true);scheduleRetry();
    }
    function scheduleRetry(){
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
      if(!canWrite()||view?.document.visibilityState==='hidden')return;
      const waiting=pending.filter(row=>row.status!=='error');if(!waiting.length)return;
      const due=Math.min(...waiting.map(row=>row.next_attempt_at||0));
      retryTimer=setTimeout(()=>{retryTimer=null;void refresh().catch(()=>{});},Math.max(1000,Math.min(300000,due-clock())));
      retryTimer.unref?.();
    }
    async function syncPending(){
      if(syncJob){const active=syncJob;await active;if(canWrite()&&pending.some(row=>row.status!=='error'&&(row.next_attempt_at||0)<=clock()))return syncPending();return;}
      if(!canWrite()||!pending.length||!sendAdd||mutations||view?.document.visibilityState==='hidden')return;
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
      const token=api.getToken(),run=epoch,uid=current.user.user_id,hash=binding;
      const job=(async()=>{
        for(const operation of [...pending]){
          if(run!==epoch||!canWrite()||operation.status==='error'||(operation.next_attempt_at||0)>clock())continue;
          let timeout;
          try{
            const payload={id:operation.income_id,client_mutation_id:operation.income_id,...incomeValue(operation)};
            let saved;
            try{
              saved=await Promise.race([sendAdd(payload),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('network_timeout')),30000);timeout.unref?.();})]);
            }catch(error){
              // Existing deployments return 409 for duplicate UUIDs. Reconcile by
              // authoritative account-scoped ID, never by amount/date/description.
              if(error.status!==409)throw error;
              saved=(await api.listIncomes()).find(row=>row.id===operation.income_id&&row.user_id===uid);
              if(!saved)throw error;
            }finally{clearTimeout(timeout);}
            if(run!==epoch||token!==api.getToken())break;
            if(!saved||saved.id!==operation.income_id||saved.user_id!==uid)throw new Error('invalid_server_response');
            const value={...current,incomes:[...current.incomes.filter(row=>row.id!==saved.id),saved]};
            // SQLite atomically stores confirmed row and removes its pending UUID.
            if(!await save(snapshot(value,clock()),token,run))break;
            await paint();
          }catch(error){
            const status=Number(error.status)||0,auth=status===401,permanent=status>=400&&status<500&&![401,408,429].includes(status);
            const next=auth||permanent?0:clock()+Math.min(300000,5000*2**Math.min(operation.attempts||0,6));
            const code=status?'http_'+status:'network';
            await db.pendingState({sessionHash:hash,userId:uid,operationId:operation.operation_id,status:auth?'auth_required':permanent?'error':'pending',nextAttempt:next,code});
            if(run===epoch&&token===api.getToken()){
              pending=pending.map(row=>row.operation_id===operation.operation_id?{...row,status:auth?'auth_required':permanent?'error':'pending',attempts:(row.attempts||0)+1,next_attempt_at:next,error_code:code}:row);
              await paint();
            }
            if(auth||!permanent||status===402||status===403)break;
          }
        }
      })();
      syncJob=job;try{await job;}finally{if(syncJob===job)syncJob=null;scheduleRetry();}
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
      api.logout=async(...args)=>{await guardPending();await purge().catch(()=>{});try{return await originalLogout(...args);}finally{await purge().catch(()=>{});}};
      const originalDelete=api.deleteAccount.bind(api);
      api.deleteAccount=async(...args)=>{requireWrite();await guardPending();const result=await originalDelete(...args);await purge();return result;};
      api.bootstrap=async()=>{const result=await fetchSnapshot();if(result===undefined)throw new Error('Сессия изменилась');if(result)view?.setTimeout(()=>{void syncPending().catch(()=>{});},0);return result?.data||null;};
      // Guard every existing server mutation, including direct API callers.
      for(const name of ['addIncome','updateIncome','deleteIncome','deleteAllIncomes','replaceIncomes','addCategory','deleteCategory','putSetting','completeOnboarding','createPayment','setBillingAutoRenew']){
        const original=api[name]?.bind(api);if(!original)continue;
        api[name]=async(...args)=>{
          if(name==='deleteAllIncomes'||name==='replaceIncomes')await guardPending();
          requireWrite();const token=api.getToken();const run=++epoch;mutations++;
          let failedTransport=false;
          try{const result=await original(...args);await confirmed(name,args,result,token,run).catch(()=>{});return result;}
          catch(error){failedTransport=name==='addIncome'&&transportError(error);throw error;}
          // Fallback must commit first; do not race an immediate refresh against enqueue.
          finally{mutations--;if(!failedTransport)w.setTimeout(()=>{if(!mutations)void (refreshJob||Promise.resolve()).catch(()=>{}).then(()=>refresh()).catch(()=>{});},0);}
        };
      }
      // Online writes await server ACK; offline creation awaits its SQLite commit.
      const store=w.IncomeStore;
      const rowToUi=row=>({id:String(row.id),date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description});
      const uiToRow=record=>{const parts=record.date.split('.');return {...record,income_date:(parts[2].length===2?'20'+parts[2]:parts[2])+'-'+parts[1]+'-'+parts[0]};};
      for(const name of ['add','update'])store[name]=async(...args)=>{
        await networkState();
        const record=name==='add'?args[0]:args[1];
        const row=uiToRow(record),token=api.getToken(),uid=current?.user.user_id;
        if(name==='add'){
          row.id=row.id||uuid();if(!uuidPattern.test(row.id))throw new Error('Некорректный ID дохода');
          Object.assign(row,incomeValue(row));row.client_mutation_id=row.id;
          if(!online()){await enqueue(row);return store.load();}
        }
        requireWrite();
        if(name==='update'&&pending.some(row=>row.income_id===String(args[0])))throw new Error('Дождитесь синхронизации дохода.');
        let saved;
        try{saved=await (name==='add'?api.addIncome(row):api.updateIncome(args[0],row));}
        catch(error){
          if(name!=='add'||!transportError(error))throw error;
          if(token!==api.getToken()||uid!==current?.user.user_id)throw new Error('Сессия изменилась');
          await enqueue(row,true);return store.load();
        }
        if(token!==api.getToken())throw new Error('Сессия изменилась');
        const rows=store.load().filter(row=>String(row.id)!==String(saved.id));return store.save([rowToUi(saved),...rows]);
      };
      store.remove=async id=>{requireWrite();if(pending.some(row=>row.income_id===String(id)))throw new Error('Дождитесь синхронизации дохода.');const token=api.getToken();await api.deleteIncome(id);if(token!==api.getToken())return null;const rows=store.save(store.load().filter(row=>String(row.id)!==String(id)));w.applyIncomeHeaderFilters?.();w.renderIncomeAnalytics?.();return rows;};
      store.addMany=async records=>{requireWrite();for(const record of records)await store.add(record);return store.load();};
      const blocked='.edit-income,.delete-income,.income-recent-edit,.income-recent-delete,.income-recent-mobile-edit,.income-recent-mobile-delete,#qpCategoryAdd,.qp-category-delete,.category-popup-create-btn,#clearIncomeDataBtn,#qpAuthDeleteAccountBtn';
      w.document.addEventListener('click',event=>{
        const target=event.target.closest?.(blocked),id=target?.getAttribute('data-id');
        if(target&&(!canWrite()||pending.some(row=>row.income_id===id))){event.preventDefault();event.stopImmediatePropagation();notify();}
        if(event.target.closest?.('#qpAuthLogoutBtn')&&pending.length){event.preventDefault();event.stopImmediatePropagation();w.qPokoyNotice?.('Несинхронизированные доходы',pendingWarning,'error');}
      },true);
      w.addEventListener('online',()=>{void (refreshJob||Promise.resolve()).catch(()=>{}).then(()=>refresh()).catch(()=>{});});
      w.document.addEventListener('visibilitychange',()=>{if(w.document.visibilityState==='visible')void refresh().catch(()=>{});else if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}});
      // One JS subscription per document; one OS callback per resumed native plugin.
      if(w.Capacitor?.addListener){
        let removed=false,listener;
        const remove=()=>{removed=true;if(listener)void listener.remove().catch(()=>{});};
        w.addEventListener('pagehide',remove,{once:true});
        listener=w.Capacitor.addListener('QPokoyReadCache','networkStateChange',state=>{
          if(removed||!state)return;
          w.qPokoyAndroidNetwork.accept(state);
          if(hydrate&&state.state!=='offline'&&w.document.visibilityState!=='hidden')void refresh().catch(()=>{});
        });
      }
    }
    const pendingMarkup=id=>{const label=pendingLabel(id);return label?'<small data-android-pending style="display:block;opacity:.7">'+label+'</small>':'';};
    return {start,refresh,purge,install,requireWrite,enqueue,syncPending,pendingLabel,pendingMarkup,metrics,get pending(){return pending.map(row=>({...row}));},get displayed(){return displayed;},get snapshot(){return current;},get binding(){return binding;},get canWrite(){return canWrite();}};
  }
  return {create,snapshot,incomeValue,transportError,schemaVersion};
});

/* Android-only confirmed SQLite snapshots and durable create/update/delete outbox. Credentials stay in api-client. */
(function(root,factory){
  const exported=factory();
  if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root?.qPokoyApi&&root.Capacitor){
    const native=method=>options=>root.Capacitor.nativePromise('QPokoyReadCache',method,options||{});
    const cache=exported.create({api:root.qPokoyApi,db:{read:native('read'),write:native('write'),clear:native('clear'),enqueue:native('enqueue'),enqueueEdit:native('enqueueEdit'),enqueueDelete:native('enqueueDelete'),beginSend:native('beginSend'),pendingState:native('pendingState'),pendingCount:native('pendingCount')},
      fingerprint:async token=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join(''),
      online:()=>root.qPokoyAndroidNetwork.available,networkState:options=>root.qPokoyAndroidNetwork.read(options),clock:()=>Date.now(),notify:()=>root.qPokoyNotice?.('Нет подключения к интернету','Дождитесь подключения и завершения синхронизации.','error')});
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
      return {id:row.id,user_id:uid,income_date:row.income_date,category:row.category,description:row.description,amount:row.amount,...(typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at))?{created_at:row.created_at}:{})};
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
    const sendAdd=api.addIncome?.bind(api),sendUpdate=api.updateIncome?.bind(api),sendDelete=api.deleteIncome?.bind(api);
    let epoch=0,current=null,binding=null,validatedToken=null,displayed=false,renderedSignature=null,hydrate=null,refreshJob=null,refreshEpoch=0,clearJob=Promise.resolve(),mutations=0,view=null;
    let pending=[],syncJob=null,retryTimer=null;
    const inFlight=new Set(),activeWrites=new Map();
    const metrics={};
    // Safe stage-only diagnostics: never log account IDs, tokens or income data.
    const diagnostic={stage:'idle',code:null};
    const pendingWarning='Есть доходы, которые ещё не синхронизированы. Подключитесь к интернету и дождитесь синхронизации перед выходом.';
    function setPending(rows,uid){
      if(!Array.isArray(rows))return;
      if(rows.some(row=>row.user_id!==uid||!uuidPattern.test(row.income_id)||!uuidPattern.test(row.operation_id)||!['add','update','delete'].includes(row.kind)))throw new Error('Invalid pending account binding');
      pending=rows;
    }
    function combined(){
      if(!current)return null;
      const rowsById=new Map(current.incomes.map(row=>[row.id,row]));
      for(const row of pending){
        if(row.kind==='delete'){rowsById.delete(row.income_id);continue;}
        const old=rowsById.get(row.income_id);
        rowsById.set(row.income_id,{...old,id:row.income_id,user_id:row.user_id,...incomeValue(row),created_at:old?.created_at||new Date(row.created_at).toISOString()});
      }
      const rows=[...rowsById.values()];
      // Same date/creation ordering as cloud history; pending status is not a sort key.
      rows.sort((a,b)=>b.income_date.localeCompare(a.income_date)||(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
      return {...current,incomes:rows};
    }
    const shownSignature=()=>current?signature(combined())+JSON.stringify(pending.map(row=>[row.income_id,row.kind,row.status,row.error_code])):null;
    async function paint(cached=false){
      const data=combined();if(!data)return;
      const next=shownSignature();if(!displayed||renderedSignature!==next){await hydrate?.(cached?{...data,user:{...data.user,onboarding_completed:true}}:data,cached);displayed=true;renderedSignature=next;}
    }
    function pendingLabel(id){
      const row=pending.find(row=>row.income_id===String(id));
      return !row||row.kind==='delete'?'':row.status==='error'?'Не синхронизирован: ошибка сервера':row.status==='auth_required'?'Требуется вход для синхронизации':'Ожидает синхронизации';
    }
    async function guardPending(){
      if(pending.length||(binding&&db.pendingCount&&(await db.pendingCount({sessionHash:binding})).count)){
        const error=new Error(pendingWarning);error.code='android_pending_logout';view?.qPokoyNotice?.('Несинхронизированные доходы',pendingWarning,'error');throw error;
      }
    }
    async function identity(token){return token?fingerprint(token):null;}
    async function save(value,token,run,deleteAck){
      const hash=await identity(token);
      if(run!==epoch||token!==api.getToken())return false;
      await clearJob.catch(()=>{});
      if(run!==epoch||token!==api.getToken())return false;
      const stored=await db.write({sessionHash:hash,snapshot:value,deleteAck});
      if(run!==epoch||token!==api.getToken())return false;
      current=value;binding=hash;setPending(stored?.pending,value.user.user_id);return true;
    }
    function purge(){
      epoch++;current=null;binding=null;validatedToken=null;displayed=false;renderedSignature=null;pending=[];inFlight.clear();
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
      await networkState({fresh:true});
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
    async function enqueue(record,edit=false){
      diagnostic.stage='account-binding';
      const token=api.getToken(),uid=current?.user.user_id,hash=binding;
      const digest=await identity(token);
      if(!(edit?db.enqueueEdit:db.enqueue)||!current||!hash||!token||hash!==digest||token!==api.getToken()||uid!==current.user.user_id||binding!==hash)throw new Error('Локальное добавление недоступно: сначала войдите и загрузите данные с сервера.');
      const value=incomeValue(record),id=record.id||uuid();
      if(!uuidPattern.test(id)||(!edit&&(current.incomes.some(row=>row.id===id)||pending.some(row=>row.income_id===id))))throw new Error('Некорректный или повторный ID дохода');
      if(edit&&!combined().incomes.some(row=>row.id===id))throw new Error('Доход недоступен локально');
      if(!current.categories.some(row=>row.name===value.category))throw new Error('Выберите ранее загруженную категорию.');
      const run=++epoch;
      diagnostic.stage='sqlite-enqueue';
      const result=await (edit?db.enqueueEdit:db.enqueue)({sessionHash:hash,userId:uid,income:{operation_id:uuid(),income_id:id,...value,created_at:clock()}});
      metrics.sqliteCommit=performance.now();
      // SQLite commit precedes any success UI. An interrupted UI can reload this row.
      if(run!==epoch||token!==api.getToken())return;
      diagnostic.stage='render-after-commit';
      setPending(result.pending,uid);
      if(edit&&view){
        // The save handler renders after this promise. Avoid re-running full
        // Auth/category/settings hydration for a local edit, and rendering twice.
        view.IncomeStore.save(combined().incomes.map(row=>({id:row.id,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description})));
        displayed=true;renderedSignature=shownSignature();
      }else await paint(true);
      scheduleRetry();
      diagnostic.stage='committed';
      // Leave the submit continuation free to close the form first. The network
      // is only used in this later task; even a hung request cannot delay the commit.
      view?.setTimeout(()=>{if(online())void (canWrite()?syncPending():refresh()).catch(()=>{});},0);
    }
    async function enqueueDelete(id){
      diagnostic.stage='delete-account-binding';diagnostic.code=null;
      const token=api.getToken(),uid=current?.user.user_id,hash=binding,incomeId=String(id);
      const digest=await identity(token);
      if(!db.enqueueDelete)throw new Error('Нет подключения к интернету или локальное удаление недоступно.');
      if(!current||!hash||!token||hash!==digest||token!==api.getToken()||uid!==current.user.user_id||binding!==hash)throw new Error('Локальное удаление недоступно: сначала войдите и загрузите данные с сервера.');
      if(!uuidPattern.test(incomeId))throw new Error('Некорректный ID дохода');
      const existing=pending.find(row=>row.income_id===incomeId);
      if(existing?.kind==='delete')return view?.IncomeStore.load?.()||[];
      if(!combined().incomes.some(row=>row.id===incomeId))throw new Error('Доход недоступен локально');
      // Only a never-attempted ADD that is not currently in-flight is guaranteed
      // to be absent from the server and may collapse to nothing.
      const collapseUnsentAdd=existing?.kind==='add'&&(existing.attempts||0)===0&&!existing.sent&&!inFlight.has(existing.operation_id);
      const run=++epoch;
      diagnostic.stage='sqlite-delete';
      const result=await db.enqueueDelete({sessionHash:hash,userId:uid,operationId:uuid(),incomeId,createdAt:clock(),collapseUnsentAdd});
      metrics.sqliteCommit=performance.now();
      if(run!==epoch||token!==api.getToken())return view?.IncomeStore.load?.()||[];
      setPending(result.pending,uid);
      const rows=combined().incomes.map(row=>({id:row.id,date:row.income_date.slice(8,10)+'.'+row.income_date.slice(5,7)+'.'+row.income_date.slice(2,4),amount:row.amount,category:row.category,description:row.description}));
      if(view){
        view.IncomeStore.save(rows);displayed=true;renderedSignature=shownSignature();
      }else await paint(true);
      scheduleRetry();diagnostic.stage='delete-committed';
      // DELETE is local-first too: never await transport before hiding the row.
      view?.setTimeout(()=>{if(online())void (canWrite()?syncPending():refresh()).catch(()=>{});},0);
      return rows;
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
      if(syncJob){const active=syncJob;await active;if(canWrite()&&pending.some(row=>row.status!=='error'&&(row.next_attempt_at||0)<=clock()&&!(row.kind==='delete'&&activeWrites.has(current.user.user_id+':'+row.income_id))))return syncPending();return;}
      if(!canWrite()||!pending.length||mutations||view?.document.visibilityState==='hidden')return;
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
      const token=api.getToken(),uid=current.user.user_id,hash=binding;let run=epoch;
      const job=(async()=>{
        for(const operation of [...pending]){
          if(run!==epoch||!canWrite()||operation.status==='error'||(operation.next_attempt_at||0)>clock())continue;
          if(operation.kind==='add'&&!sendAdd||operation.kind==='update'&&!sendUpdate||operation.kind==='delete'&&!sendDelete)continue;
          if(operation.kind==='delete'&&activeWrites.has(uid+':'+operation.income_id))continue;
          let timeout;
          inFlight.add(operation.operation_id);
          try{
            if(db.beginSend && !(await db.beginSend({sessionHash:hash,userId:uid,operationId:operation.operation_id})).allowed)continue;
            if(run!==epoch||token!==api.getToken())break;
            if(operation.kind==='delete'){
              try{
                await Promise.race([sendDelete(operation.income_id),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('network_timeout')),30000);timeout.unref?.();})]);
              }catch(error){
                // The backend returns 404/not_found only when this account-scoped
                // UUID is already absent, which is the desired final state.
                if(!(error.status===404&&error.code==='not_found'))throw error;
              }finally{clearTimeout(timeout);}
              if(run!==epoch||token!==api.getToken())break;
              const value={...current,incomes:current.incomes.filter(row=>row.id!==operation.income_id)};
              // Invalidate older bootstrap responses before acknowledging this DELETE.
              run=++epoch;
              if(!await save(snapshot(value,clock()),token,run,operation.operation_id))break;
              await paint();
              continue;
            }
            const payload={id:operation.income_id,client_mutation_id:operation.income_id,...incomeValue(operation)};
            let saved;
            try{
              const key=uid+':'+operation.income_id;
              const request=operation.kind==='update'?sendUpdate(operation.income_id,incomeValue(operation)):sendAdd(payload);
              activeWrites.set(key,request);
              const settled=()=>{if(activeWrites.get(key)===request)activeWrites.delete(key);view?.setTimeout(()=>{if(canWrite())void refresh().catch(()=>{});},0);};
              request.then(settled,settled);
              saved=await Promise.race([request,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('network_timeout')),30000);timeout.unref?.();})]);
            }catch(error){
              // Existing deployments return 409 for duplicate UUIDs. Reconcile by
              // authoritative account-scoped ID, never by amount/date/description.
              if(error.status!==409||operation.kind==='update')throw error;
              saved=(await api.listIncomes()).find(row=>row.id===operation.income_id&&row.user_id===uid);
              if(!saved)throw error;
            }finally{clearTimeout(timeout);}
            if(run!==epoch||token!==api.getToken())break;
            if(!saved||saved.id!==operation.income_id||saved.user_id!==uid)throw new Error('invalid_server_response');
            const value={...current,incomes:[...current.incomes.filter(row=>row.id!==saved.id),saved]};
            // SQLite confirms only a matching desired payload; newer edits survive.
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
          }finally{inFlight.delete(operation.operation_id);}
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
      // Guard every existing direct server mutation, including direct API callers.
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
      // Android CREATE, UPDATE and DELETE all await SQLite only.
      const store=w.IncomeStore;
      const uiToRow=record=>{const parts=record.date.split('.');return {...record,income_date:(parts[2].length===2?'20'+parts[2]:parts[2])+'-'+parts[1]+'-'+parts[0]};};
      for(const name of ['add','update'])store[name]=async(...args)=>{
        diagnostic.stage='network-state';diagnostic.code=null;
        try{
        const record=name==='add'?args[0]:args[1];
        const row=uiToRow(record);
        if(name==='add'){
          metrics.createStarted=performance.now();
          row.id=row.id||uuid();if(!uuidPattern.test(row.id))throw new Error('Некорректный ID дохода');
          Object.assign(row,incomeValue(row));row.client_mutation_id=row.id;
          await enqueue(row);return store.load();
        }
        metrics.editStarted=performance.now();
        row.id=String(args[0]);
        await enqueue(row,true);return store.load();
        }catch(error){
          diagnostic.code=typeof error.code==='string'?error.code:'android_save_failed';
          console.warn('[qPokoy Android save]',JSON.stringify(diagnostic));
          throw error;
        }
      };
      store.remove=async id=>{
        try{return await enqueueDelete(id);}
        catch(error){
          diagnostic.code=typeof error.code==='string'?error.code:'android_delete_failed';
          console.warn('[qPokoy Android delete]',JSON.stringify(diagnostic));
          throw error;
        }
      };
      store.addMany=async records=>{requireWrite();for(const record of records)await store.add(record);return store.load();};
      const blocked='#qpCategoryAdd,.qp-category-delete,.category-popup-create-btn,#clearIncomeDataBtn,#qpAuthDeleteAccountBtn';
      w.document.addEventListener('click',event=>{
        const target=event.target.closest?.(blocked);
        if(target&&!canWrite()){event.preventDefault();event.stopImmediatePropagation();notify();}
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
    const pendingMarkup=id=>{const label=pendingLabel(id);return label?'<small data-android-pending style="display:block;opacity:.7;white-space:normal;overflow-wrap:anywhere;line-height:1.2">'+label+'</small>':'';};
    return {start,refresh,purge,install,requireWrite,enqueue,enqueueDelete,syncPending,pendingLabel,pendingMarkup,metrics,get diagnostic(){return {...diagnostic};},get pending(){return pending.map(row=>({...row}));},get displayed(){return displayed;},get snapshot(){return current;},get binding(){return binding;},get canWrite(){return canWrite();}};
  }
  return {create,snapshot,incomeValue,transportError,schemaVersion};
});

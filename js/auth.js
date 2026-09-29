
(function(){
  const SUPABASE_URL='https://jrpialhwbliicbsmzmvb.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_KXwgGRgVxKUmlLvTlFs3HQ_3Wz6kcAt';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
  });
  window.qPokoySupabase=client;

  const gate=document.getElementById('qpAuthGate');
  const form=document.getElementById('qpAuthForm');
  const submit=document.getElementById('qpAuthSubmit');
  const yandexButton=document.getElementById('qpAuthYandex');
  const googleButton=document.getElementById('qpAuthGoogle');
  const reset=document.getElementById('qpAuthReset');
  const resetMessage=document.getElementById('qpAuthResetMessage');
  const oauthDivider=document.getElementById('qpAuthOAuthDivider');
  const email=document.getElementById('qpAuthEmail');
  const password=document.getElementById('qpAuthPassword');
  const confirm=document.getElementById('qpAuthPasswordConfirm');
  const confirmWrap=document.getElementById('qpAuthPasswordConfirmWrap');
  const message=document.getElementById('qpAuthMessage');
  const tabs=[...document.querySelectorAll('[data-auth-mode]')];
  let mode='login';
  function oauthLabel(button){return button.querySelector('.qp-auth-oauth-label');}
  function setOAuthButtonText(button,text){oauthLabel(button).textContent=text;}
  function resetOAuthButtons(){
    googleButton.disabled=false;
    setOAuthButtonText(googleButton,'Вход через Google');
    yandexButton.disabled=false;
    setOAuthButtonText(yandexButton,'Вход через Яндекс');
  }
  window.addEventListener('pageshow',resetOAuthButtons);

  function setResetMessage(text,type){
    resetMessage.textContent=text||'';
    resetMessage.className='qp-auth-reset-message'+(text&&type?' '+type:'');
  }

  function setMessage(text,type){
    message.textContent=text||'';
    message.className='qp-auth-message'+(type?' '+type:'');
  }
  function setMode(next){
    mode=next;
    tabs.forEach(t=>t.classList.toggle('active',t.dataset.authMode===mode));
    const signup=mode==='signup';
    submit.textContent=signup?'Регистрация':'Вход';
    reset.hidden=signup;
    oauthDivider.hidden=false;
    yandexButton.hidden=false;
    googleButton.hidden=false;
    confirmWrap.hidden=!signup;
    // Exclude the registration-only password confirmation from login autofill.
    confirm.disabled=!signup;
    password.autocomplete=signup?'new-password':'current-password';
    setMessage('');
    setResetMessage('');
  }
  function showGate(show,checking=false){
    gate.hidden=!show;
    document.body.classList.toggle('qp-auth-locked',show);
    document.body.classList.toggle('qp-auth-checking',show&&checking);
  }
  function friendlyError(error){
    const msg=(error&&error.message)||'Не удалось выполнить действие.';
    const map={
      'Invalid login credentials':'Неверный email или пароль.',
      'Email not confirmed':'Подтвердите email по ссылке из письма.',
      'User already registered':'Аккаунт с таким email уже существует.',
      'Password should be at least 6 characters.':'Пароль должен содержать минимум 6 символов.'
    };
    return map[msg]||msg;
  }

  tabs.forEach(t=>t.addEventListener('click',()=>setMode(t.dataset.authMode)));
  yandexButton.addEventListener('click',async function(){
    const originalText=oauthLabel(yandexButton).textContent;
    setMessage('');
    yandexButton.disabled=true;
    setOAuthButtonText(yandexButton,'Переходим в Яндекс…');
    try{
      const redirectTo=location.origin+location.pathname;
      const {error}=await client.auth.signInWithOAuth({
        provider:'custom:yandex',
        options:{redirectTo}
      });
      if(error) throw error;
    }catch(err){
      setMessage(friendlyError(err),'error');
      setOAuthButtonText(yandexButton,originalText);
      yandexButton.disabled=false;
    }
  });

  googleButton.addEventListener('click',async function(){
    const originalText=oauthLabel(googleButton).textContent;
    setMessage('');
    setResetMessage('');
    googleButton.disabled=true;
    setOAuthButtonText(googleButton,'Переходим в Google…');
    try{
      const redirectTo=location.origin+location.pathname;
      const {error}=await client.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo}
      });
      if(error) throw error;
    }catch(err){
      setMessage(friendlyError(err),'error');
      setOAuthButtonText(googleButton,originalText);
      googleButton.disabled=false;
    }
  });
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    setMessage('');
    const mail=email.value.trim();
    const pass=password.value;
    if(!mail||!email.checkValidity()){setMessage('Введите корректный email.','error');return;}
    if(pass.length<6){setMessage('Пароль должен содержать минимум 6 символов.','error');return;}
    if(mode==='signup' && pass!==confirm.value){setMessage('Пароли не совпадают.','error');return;}

    submit.disabled=true;
    try{
      if(mode==='signup'){
        const {data,error}=await client.auth.signUp({
          email:mail,password:pass
        });
        if(error) throw error;
        if(data.user && typeof window.qPokoySeedDefaultCategories==='function'){
          await window.qPokoySeedDefaultCategories(data.user.id);
        }
        if(data.session){
          setMessage('Аккаунт создан. Проверьте почту и подтвердите email','success');
        }else{
          setMessage('Аккаунт создан. Проверьте почту и подтвердите email','success');
          form.reset();
        }
      }else{
        const {error}=await client.auth.signInWithPassword({email:mail,password:pass});
        if(error) throw error;
      }
    }catch(err){
      if(mode==='signup' && err && err.message==='User already registered'){
        setMode('login');
        setMessage('Аккаунт с таким email уже существует. Введите пароль и выполните вход.','error');
      }else{
        setMessage(friendlyError(err),'error');
      }
    }finally{
      submit.disabled=false;
    }
  });

  reset.addEventListener('click',async function(){
    setResetMessage('');
    const mail=email.value.trim();
    if(!mail||!email.checkValidity()){
      setResetMessage('Сначала введите email, для которого нужно восстановить пароль.','error');
      return;
    }
    reset.disabled=true;
    try{
      const redirectTo=(location.protocol==='http:'||location.protocol==='https:')?location.href:null;
      const options=redirectTo?{redirectTo}:undefined;
      const {error}=await client.auth.resetPasswordForEmail(mail,options);
      if(error) throw error;
      setResetMessage('Если аккаунт существует, письмо для восстановления отправлено на указанный email.','success');
    }catch(err){
      setResetMessage(friendlyError(err),'error');
    }finally{
      reset.disabled=false;
    }
  });

  const logout=document.getElementById('qpAuthLogoutBtn');
  const accountEmail=document.getElementById('qpAccountEmail');

  if(logout){
    logout.addEventListener('click',async function(){
      logout.disabled=true;
      try{
        const {error}=await client.auth.signOut();
        if(error) throw error;
      }catch(error){
        cloudError('Не удалось выйти из аккаунта.',error);
      }finally{
        logout.disabled=false;
      }
    });
  }

  // Cloud income storage: public.qpokoy_incomes, protected by RLS and linked to auth.uid().
  const CLOUD_TABLE='qpokoy_incomes';
  let cloudUser=null;
  let cloudReady=false;
  let cloudBusy=false;
  let pendingWriteFlush=null;
  let authSyncRun=0;
  const LOCAL_INCOME_OWNER_KEY='qPokoyIncomeOwnerId';
  // A durable per-user write journal survives immediate tab close and reload.
  // Never erase it when clearing the local cloud cache or changing accounts.
  const CLOUD_WRITE_JOURNAL_KEY='qPokoyIncomeWriteJournalV1';
  const CLOUD_FIELDS='id,user_id,income_date,category,description,amount';

  function clearLocalIncomeCache(){
    try{ localStorage.removeItem('incomes'); }catch(e){}
    try{ if(Array.isArray(window.incomes)) window.incomes.splice(0,window.incomes.length); }catch(e){}
  }
  function readPendingCloudWrites(){
    try{
      const data=JSON.parse(localStorage.getItem(CLOUD_WRITE_JOURNAL_KEY)||'[]');
      return Array.isArray(data)?data.filter(x=>x&&typeof x.userId==='string'&&x.record&&isUuid(x.record.id)&&(x.kind==='add'||x.kind==='update')):[];
    }catch(e){ console.error('[qPokoy cloud] damaged pending journal',e); return []; }
  }
  function savePendingCloudWrites(items){
    localStorage.setItem(CLOUD_WRITE_JOURNAL_KEY,JSON.stringify(items));
  }
  function pendingForUser(userId){
    return readPendingCloudWrites().filter(x=>x.userId===String(userId));
  }
  function samePendingRecord(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function enqueuePendingCloudWrite(userId,record,kind){
    if(!userId||!record||!isUuid(record.id))throw new Error('Невозможно защитить несохранённый доход: отсутствует идентификатор.');
    const journal=readPendingCloudWrites();
    const id=String(record.id);
    const idx=journal.findIndex(x=>x.userId===String(userId)&&String(x.record.id)===id);
    const item={userId:String(userId),kind:idx>=0&&journal[idx].kind==='add'?'add':kind,record:{...record}};
    if(idx>=0)journal[idx]=item;
    else journal.push(item);
    // Synchronous durable write: performed before the first network await.
    savePendingCloudWrites(journal);
  }

  function toIsoDate(value){
    const v=String(value||'').trim();
    const iso=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso)return v;
    const m=v.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(!m)return null;
    let y=Number(m[3]); if(y<100)y+=2000;
    return `${y}-${m[2]}-${m[1]}`;
  }
  function fromIsoDate(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?`${m[3]}.${m[2]}.${String(m[1]).slice(-2)}`:String(value||'');
  }
  function isUuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
  }
  function uiToRow(record,userId){
    return {
      ...(isUuid(record.id)?{id:record.id}:{}),
      user_id:userId,
      income_date:toIsoDate(record.date),
      category:String(record.category||'Другое').trim()||'Другое',
      description:String(record.description||'').trim(),
      amount:Number(record.amount)
    };
  }
  function rowToUi(row){
    return {
      id:String(row.id),
      date:fromIsoDate(row.income_date),
      description:String(row.description||''),
      category:String(row.category||'Другое'),
      amount:Number(row.amount)||0
    };
  }
  function samePendingAsCloud(record,row,userId){
    const expected=uiToRow(record,userId);
    return !!row&&String(row.id)===String(expected.id)&&
      String(row.user_id)===String(userId)&&
      String(row.income_date)===String(expected.income_date)&&
      String(row.category)===String(expected.category)&&
      String(row.description||'')===String(expected.description||'')&&
      Number(row.amount)===Number(expected.amount);
  }
  function cloudError(title,error){
    console.error('[qPokoy cloud]',title,error);
    if(window.qPokoyNotice) window.qPokoyNotice('Ошибка синхронизации',title+' '+((error&&error.message)||''),'error');
  }

  async function sendPendingCloudWrite(entry,userId){
    const row=uiToRow(entry.record,userId);
    if(!row.id||!row.income_date||!Number.isFinite(row.amount)||row.amount<=0)throw new Error('Некорректная дата, сумма или идентификатор ожидающего дохода.');
    if(entry.kind==='add'){
      // Explicit UUID makes retry idempotent when an old request reached
      // the server but its response was lost as the tab closed.
      const {data,error}=await client.from(CLOUD_TABLE).insert(row).select(CLOUD_FIELDS).single();
      if(error&&error.code==='23505'){
        const {data:existing,error:readError}=await client.from(CLOUD_TABLE).select(CLOUD_FIELDS)
          .eq('id',row.id).eq('user_id',userId).maybeSingle();
        if(readError||!existing)throw readError||error;
        return existing;
      }
      if(error||!data)throw error||new Error('Сервер не подтвердил сохранение дохода.');
      return data;
    }
    const {data,error}=await client.from(CLOUD_TABLE).update(row).eq('id',row.id)
      .eq('user_id',userId).select(CLOUD_FIELDS).single();
    if(error||!data)throw error||new Error('Сервер не подтвердил изменение дохода.');
    return data;
  }

  function flushPendingCloudRecords(){
    if(pendingWriteFlush)return pendingWriteFlush;
    if(!cloudUser||!cloudReady||cloudBusy||!pendingForUser(cloudUser.id).length)return Promise.resolve(false);
    const userId=String(cloudUser.id);
    const job=(async function(){
      while(cloudUser&&String(cloudUser.id)===userId&&cloudReady&&!cloudBusy){
        const entry=pendingForUser(userId)[0];
        if(!entry)break;
        let saved;
        try{saved=await sendPendingCloudWrite(entry,userId);}
        catch(error){
          cloudError('Не удалось синхронизировать доход. Запись сохранена локально и будет повторно отправлена при следующем входе.',error);
          return false;
        }
        if(!cloudUser||String(cloudUser.id)!==userId||!cloudReady)return false;
        const journal=readPendingCloudWrites();
        const idx=journal.findIndex(x=>x.userId===userId&&String(x.record.id)===String(entry.record.id));
        if(idx>=0){
          if(samePendingRecord(journal[idx].record,entry.record))journal.splice(idx,1);
          // Edited during an in-flight insert: the latest value needs an UPDATE.
          else if(entry.kind==='add')journal[idx].kind='update';
          savePendingCloudWrites(journal);
        }
        if(!pendingForUser(userId).some(x=>String(x.record.id)===String(entry.record.id))){
          const records=IncomeStore.load();
          const pos=records.findIndex(x=>String(x.id)===String(entry.record.id));
          if(pos>=0&&samePendingRecord(records[pos],entry.record)){
            records[pos]=rowToUi(saved);
            IncomeStore.save(records);
            if(typeof window.renderIncomes==='function')window.renderIncomes();
          }
        }
      }
      return !pendingForUser(userId).length;
    })();
    pendingWriteFlush=job.finally(function(){pendingWriteFlush=null;});
    return pendingWriteFlush;
  }

  async function loadCloudIncome(session,runId){
    if(!session||!session.user)return false;
    const requestedUserId=String(session.user.id||'');
    cloudUser=session.user;
    cloudReady=false;
    clearLocalIncomeCache();
    const {data,error}=await client.from(CLOUD_TABLE).select('id,user_id,income_date,category,description,amount,created_at,updated_at').eq('user_id',requestedUserId).order('income_date',{ascending:false}).order('created_at',{ascending:false});
    if(runId!==authSyncRun||!cloudUser||String(cloudUser.id||'')!==requestedUserId)return false;
    if(error){ cloudError('Не удалось загрузить доходы из облака.',error); return false; }

    const cloudRows=Array.isArray(data)?data:[];
    const mapped=cloudRows.map(rowToUi);
    const merged=new Map(mapped.map(record=>[String(record.id),record]));
    const byCloudId=new Map(cloudRows.map(row=>[String(row.id),row]));
    const journal=readPendingCloudWrites();
    let journalChanged=false;
    for(let i=journal.length-1;i>=0;i--){
      const entry=journal[i];
      if(entry.userId!==requestedUserId)continue;
      const serverRow=byCloudId.get(String(entry.record.id));
      if(serverRow&&samePendingAsCloud(entry.record,serverRow,requestedUserId)){
        journal.splice(i,1);
        journalChanged=true;
        continue;
      }
      // The create may have succeeded before the previous tab closed;
      // a more recent local edit now needs UPDATE, never a second INSERT.
      if(serverRow&&entry.kind==='add'){
        entry.kind='update';
        journalChanged=true;
      }
      merged.set(String(entry.record.id),entry.record);
    }
    if(journalChanged)savePendingCloudWrites(journal);
    IncomeStore.save([...merged.values()]);
    cloudReady=true;
    await flushPendingCloudRecords();
    if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
    else if(typeof window.renderIncomes==='function') window.renderIncomes();
    if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
    return true;
  }

  async function restoreBackupCloud(records,userId){
    if(!userId)return false;
    cloudBusy=true;
    try{
      const source=Array.isArray(records)?records:[];
      const rows=source.map(record=>{
        const row=uiToRow(record,userId);
        delete row.id;
        return row;
      });
      const valid=rows.filter(row=>row.income_date && Number.isFinite(row.amount) && row.amount>0);
      if(valid.length!==source.length){
        throw new Error('В резервной копии есть запись с некорректной датой или суммой.');
      }

      const {data:before,error:beforeError}=await client.from(CLOUD_TABLE).select('id').eq('user_id',userId);
      if(beforeError)throw beforeError;
      const oldIds=(Array.isArray(before)?before:[]).map(row=>String(row.id||'')).filter(Boolean);

      if(!cloudUser||String(cloudUser.id||'')!==String(userId)||!cloudReady){
        throw new Error('Сессия изменилась до начала восстановления.');
      }

      let inserted=[];
      if(valid.length){
        const {data,error}=await client.from(CLOUD_TABLE).insert(valid).select('id,user_id,income_date,category,description,amount,created_at,updated_at');
        if(error)throw error;
        inserted=Array.isArray(data)?data:[];
        if(inserted.length!==valid.length){
          throw new Error('Облако не подтвердило сохранение всех записей резервной копии.');
        }
      }

      if(!cloudUser||String(cloudUser.id||'')!==String(userId)||!cloudReady){
        throw new Error('Сессия изменилась во время восстановления. Старые данные не удалялись.');
      }

      for(let i=0;i<oldIds.length;i+=100){
        const batch=oldIds.slice(i,i+100);
        const {data:deleted,error:deleteError}=await client.from(CLOUD_TABLE).delete().eq('user_id',userId).in('id',batch).select('id');
        if(deleteError)throw deleteError;
        if(!Array.isArray(deleted)||deleted.length!==batch.length){
          throw new Error('Не удалось подтвердить удаление прежних записей. Повторите импорт.');
        }
      }

      if(!cloudUser||String(cloudUser.id||'')!==String(userId)||!cloudReady){
        throw new Error('Сессия изменилась после восстановления.');
      }

      const {data:finalRows,error:finalError}=await client.from(CLOUD_TABLE)
        .select('id,user_id,income_date,category,description,amount,created_at,updated_at')
        .eq('user_id',userId)
        .order('income_date',{ascending:false})
        .order('created_at',{ascending:false});
      if(finalError)throw finalError;

      const expectedIds=new Set(inserted.map(row=>String(row.id)));
      const actualRows=Array.isArray(finalRows)?finalRows:[];
      if(actualRows.length!==inserted.length || actualRows.some(row=>!expectedIds.has(String(row.id)))){
        throw new Error('Облачные доходы изменились параллельно восстановлению. Данные не скрыты; обновите страницу и повторите импорт.');
      }

      IncomeStore.save(actualRows.map(rowToUi));
      cloudReady=true;
      if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
      else if(typeof window.renderIncomes==='function') window.renderIncomes();
      if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
      return true;
    }catch(error){
      cloudError('Не удалось безопасно восстановить резервную копию.',error);
      if(cloudUser&&String(cloudUser.id||'')===String(userId)){
        try{
          const {data,error:reloadError}=await client.from(CLOUD_TABLE)
            .select('id,user_id,income_date,category,description,amount,created_at,updated_at')
            .eq('user_id',userId)
            .order('income_date',{ascending:false})
            .order('created_at',{ascending:false});
          if(!reloadError){
            IncomeStore.save((Array.isArray(data)?data:[]).map(rowToUi));
            if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
            else if(typeof window.renderIncomes==='function') window.renderIncomes();
            if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
          }else{
            console.error('[qPokoy cloud] Не удалось перечитать доходы после ошибки восстановления.',reloadError);
          }
        }catch(reloadError){
          console.error('[qPokoy cloud] Не удалось перечитать доходы после ошибки восстановления.',reloadError);
        }
      }
      return false;
    }finally{
      cloudBusy=false;
    }
  }

  window.qPokoyCloudRestoreBackup=function(records){
    if(cloudUser&&cloudReady&&!cloudBusy) return restoreBackupCloud(records,cloudUser.id);
    return Promise.resolve(false);
  };

  async function replaceCloud(records,userId){
    if(!userId)return;
    cloudBusy=true;
    try{
      const {error:delError}=await client.from(CLOUD_TABLE).delete().eq('user_id',userId);
      if(delError)throw delError;
      const valid=(Array.isArray(records)?records:[]).map(r=>uiToRow(r,userId)).filter(r=>r.income_date && Number.isFinite(r.amount) && r.amount>0);
      if(valid.length){
        const {data,error}=await client.from(CLOUD_TABLE).insert(valid).select('id,user_id,income_date,category,description,amount,created_at,updated_at');
        if(error)throw error;
        IncomeStore.save((data||[]).map(rowToUi));
      }else{
        IncomeStore.save([]);
      }
      cloudReady=true;
      if(typeof window.applyIncomeHeaderFilters==='function') window.applyIncomeHeaderFilters();
      else if(typeof window.renderIncomes==='function') window.renderIncomes();
      if(typeof window.renderIncomeAnalytics==='function') window.renderIncomeAnalytics();
    }catch(error){
      cloudError('Не удалось сохранить данные доходов в облаке.',error);
    }finally{ cloudBusy=false; }
  }

  window.qPokoyCloudReplace=function(records){
    if(cloudUser && cloudReady) return replaceCloud(records,cloudUser.id);
    return Promise.resolve();
  };
  window.qPokoyCloudAdd=function(record){
    const userId=cloudUser&&String(cloudUser.id||'');
    try{enqueuePendingCloudWrite(userId,record,'add');}
    catch(error){cloudError('Не удалось поставить доход в очередь синхронизации.',error);return Promise.resolve(false);}
    return flushPendingCloudRecords();
  };
  window.qPokoyCloudUpdate=function(id,record){
    const userId=cloudUser&&String(cloudUser.id||'');
    try{enqueuePendingCloudWrite(userId,{...record,id:String(id)},'update');}
    catch(error){cloudError('Не удалось поставить изменение дохода в очередь синхронизации.',error);return Promise.resolve(false);}
    return flushPendingCloudRecords();
  };
  window.qPokoyCloudRemove=async function(id){
    try{
      if(!cloudUser||!cloudReady||cloudBusy||!isUuid(id)) throw new Error('Дождитесь авторизации и синхронизации доходов, затем повторите удаление.');
      const userId=cloudUser.id;
      if(pendingForUser(userId).some(x=>String(x.record.id)===String(id))){
        await flushPendingCloudRecords();
        if(pendingForUser(userId).some(x=>String(x.record.id)===String(id))){
          throw new Error('Доход ещё ожидает синхронизации. Повторите удаление после подключения к сети.');
        }
      }
      const {data,error}=await client.from(CLOUD_TABLE).delete().eq('id',id).eq('user_id',userId).select('id');
      if(error)throw error;
      if(!data||data.length!==1||String(data[0].id)!==String(id)) throw new Error('Удаление не подтверждено. Обновите страницу для синхронизации.');
      if(!cloudUser||cloudUser.id!==userId||!cloudReady) throw new Error('Сессия изменилась. Обновите страницу для синхронизации.');
      return true;
    }catch(error){ cloudError('Не удалось удалить доход.',error); return false; }
  };
  window.qPokoyCloudAddMany=async function(records){
    if(!cloudUser||!cloudReady||cloudBusy||!records.length)return;
    try{
      const rows=records.map(r=>{const row=uiToRow(r,cloudUser.id); delete row.id; return row;}).filter(r=>r.income_date && Number.isFinite(r.amount) && r.amount>0);
      if(!rows.length)return;
      const {data,error}=await client.from(CLOUD_TABLE).insert(rows).select('id,user_id,income_date,category,description,amount');
      if(error)throw error;
      const appended=(data||[]).map(rowToUi);
      const old=IncomeStore.load().filter(x=>!records.some(r=>String(r.id)===String(x.id)));
      IncomeStore.save([...old,...appended]);
    }catch(error){ cloudError('Не удалось импортировать доходы в облако.',error); }
  };

  async function sync(session){
    const runId=++authSyncRun;
    if(session&&session.user){
      const nextUserId=String(session.user.id||'');
      let previousOwner='';
      try{ previousOwner=localStorage.getItem(LOCAL_INCOME_OWNER_KEY)||''; }catch(e){}
      if(previousOwner!==nextUserId) clearLocalIncomeCache();
      try{ localStorage.setItem(LOCAL_INCOME_OWNER_KEY,nextUserId); }catch(e){}
      showGate(true,true);
      if(accountEmail) accountEmail.textContent=session.user.email||'';
      const loaded=await loadCloudIncome(session,runId);
      if(runId!==authSyncRun)return;
      if(!loaded){
        if(cloudUser&&String(cloudUser.id||'')===nextUserId){
          showGate(true);
          setMessage('Не удалось загрузить данные. Проверьте соединение и обновите страницу.','error');
        }
        return;
      }
      await flushPendingCloudRecords();
      if(runId===authSyncRun&&cloudUser&&String(cloudUser.id||'')===nextUserId&&cloudReady) showGate(false);
    }else{
      cloudUser=null; cloudReady=false;
      clearLocalIncomeCache();
      try{ localStorage.removeItem(LOCAL_INCOME_OWNER_KEY); }catch(e){}
      showGate(true);
      if(accountEmail) accountEmail.textContent='—';
    }
  }

  function isRoutineSessionRefresh(event,session){
    if(event!=='SIGNED_IN'&&event!=='TOKEN_REFRESHED') return false;
    if(!session||!session.user||!cloudUser||!cloudReady) return false;
    return String(session.user.id||'')===String(cloudUser.id||'');
  }

  client.auth.onAuthStateChange(function(event,session){
    if(isRoutineSessionRefresh(event,session)){
      cloudUser=session.user;
      if(accountEmail) accountEmail.textContent=session.user.email||'';
      return;
    }
    sync(session);
  });

  client.auth.getSession().then(function(result){
    if(result.error){
      showGate(true);
      setMessage(result.error.message,'error');
      return;
    }
    sync(result.data.session);
  });

  window.qPokoyAuth={client,showGate,setMode};
})();
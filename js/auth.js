
(function(){
  const api=window.qPokoyApi;

  const gate=document.getElementById('qpAuthGate');
  const form=document.getElementById('qpAuthForm');
  const signupForm=document.getElementById('qpAuthSignupForm');
  const resetForm=document.getElementById('qpAuthResetForm');
  const submit=document.getElementById('qpAuthSubmit');
  const signupSubmit=document.getElementById('qpAuthSignupSubmit');
  const resetSubmit=document.getElementById('qpAuthResetSubmit');
  const yandexButton=document.getElementById('qpAuthYandex');
  const googleButton=document.getElementById('qpAuthGoogle');
  const reset=document.getElementById('qpAuthReset');
  const resetMessage=document.getElementById('qpAuthResetMessage');
  const resetPassword=document.getElementById('qpAuthResetPassword');
  const resetPasswordConfirm=document.getElementById('qpAuthResetPasswordConfirm');
  const resetConfirmMessage=document.getElementById('qpAuthResetConfirmMessage');
  const resetBack=document.getElementById('qpAuthResetBack');
  const oauthDivider=document.getElementById('qpAuthOAuthDivider');
  const email=document.getElementById('qpAuthEmail');
  const password=document.getElementById('qpAuthPassword');
  const signupEmail=document.getElementById('qpAuthSignupEmail');
  const signupPassword=document.getElementById('qpAuthSignupPassword');
  const confirm=document.getElementById('qpAuthPasswordConfirm');
  const message=document.getElementById('qpAuthMessage');
  const signupMessage=document.getElementById('qpAuthSignupMessage');
  const tabs=[...document.querySelectorAll('[data-auth-mode]')];
  const params=new URLSearchParams(location.search);
  const resetToken=params.get('reset_token')||'';
  const verifyToken=params.get('verify_token')||'';
  const oauthTicket=params.get('oauth_ticket')||'';
  const oauthError=params.get('oauth_error')||'';
  const oauthProvider=params.get('oauth_provider')||'';
  let mode=resetToken?'reset':'login';
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

  function setMessage(text,type,target){
    const box=target||(mode==='signup'?signupMessage:(mode==='reset'?resetConfirmMessage:message));
    box.textContent=text||'';
    box.className='qp-auth-message'+(type?' '+type:'');
  }
  function setMode(next){
    mode=next;
    tabs.forEach(t=>t.classList.toggle('active',t.dataset.authMode===mode));
    const signup=mode==='signup';
    const resetting=mode==='reset';
    gate.classList.toggle('qp-auth-reset-mode',resetting);
    form.hidden=signup||resetting;
    signupForm.hidden=!signup;
    resetForm.hidden=!resetting;
    reset.hidden=signup||resetting;
    oauthDivider.hidden=resetting;
    yandexButton.hidden=resetting;
    googleButton.hidden=resetting;
    setMessage('',null,message);
    setMessage('',null,signupMessage);
    setMessage('',null,resetConfirmMessage);
    setResetMessage('');
  }
  function showGate(show,checking=false){
    gate.hidden=!show;
    document.body.classList.toggle('qp-auth-locked',show);
    document.body.classList.toggle('qp-auth-checking',show&&checking);
  }
  function friendlyError(error){
    if(error&&error.code==='rate_limited')return 'Слишком много попыток. Попробуйте позже.';
    if(error&&error.code==='internal_error')return 'Сервер временно недоступен. Попробуйте обновить страницу через несколько секунд.';
    const msg=(error&&error.message)||'Не удалось выполнить действие.';
    const map={
      'Invalid email or password':'Неверный email или пароль.',
      'Email already registered':'Аккаунт с таким email уже существует.',
      'Password must be 8–1024 characters':'Пароль должен содержать минимум 8 символов.',
      'OAuth provider is not configured':'Этот способ входа пока не настроен.'
    };
    return map[msg]||msg;
  }
  function apiUser(user){return user?{...user,id:String(user.user_id||user.id)}:null;}

  tabs.forEach(t=>t.addEventListener('click',()=>setMode(t.dataset.authMode)));

  async function beginOAuth(provider,button,label){
    setMessage('');
    setResetMessage('');
    button.disabled=true;
    setOAuthButtonText(button,'Переход…');
    try{
      const url=await api.startOAuth(provider);
      location.assign(url);
    }catch(error){
      button.disabled=false;
      setOAuthButtonText(button,label);
      if(error&&error.code==='oauth_not_configured'){
        setMessage('Этот способ входа пока не настроен.','error');
      }else{
        setMessage(friendlyError(error),'error');
      }
    }
  }

  yandexButton.addEventListener('click',()=>beginOAuth('yandex',yandexButton,'Вход через Яндекс'));
  googleButton.addEventListener('click',()=>beginOAuth('google',googleButton,'Вход через Google'));
  async function handleAuthSubmit(e){
    e.preventDefault();
    const isSignup=e.currentTarget===signupForm;
    const formEmail=isSignup?signupEmail:email;
    const formPassword=isSignup?signupPassword:password;
    const formSubmit=isSignup?signupSubmit:submit;
    const feedback=isSignup?signupMessage:message;
    setMessage('',null,feedback);
    const mail=formEmail.value.trim();
    const pass=formPassword.value;
    if(!mail||!formEmail.checkValidity()){setMessage('Введите корректный email.','error',feedback);return;}
    if(pass.length<8){setMessage('Пароль должен содержать минимум 8 символов.','error',feedback);return;}
    if(isSignup && pass!==confirm.value){setMessage('Пароли не совпадают.','error',feedback);return;}

    formSubmit.disabled=true;
    try{
      if(isSignup){
        const result=await api.register(mail,pass);
        signupForm.reset();
        if(result&&result.verification_required){
          setMode('login');
          email.value=mail;
          setMessage('Проверьте почту и подтвердите email','success',message);
        }else{
          await sync({user:apiUser(result)});
        }
      }else{
        const user=await api.login(mail,pass);
        setResetMessage('');
        await sync({user:apiUser(user)});
      }
    }catch(err){
      if(isSignup && err && err.code==='email_exists'){
        setMode('login');
        email.value=mail;
        setMessage('Аккаунт с таким email уже существует. Введите пароль и выполните вход.','error');
      }else if(isSignup && err && err.code==='verification_email_failed'){
        setMode('login');
        email.value=mail;
        setMessage('Аккаунт создан, но письмо подтверждения не удалось отправить. Попробуйте позже.','error',message);
      }else if(!isSignup && err && err.code==='email_not_verified'){
        setMessage('Подтвердите email по ссылке из письма.','error',feedback);
      }else{
        setMessage(friendlyError(err),'error',feedback);
      }
    }finally{
      formSubmit.disabled=false;
    }
  }
  form.addEventListener('submit',handleAuthSubmit);
  signupForm.addEventListener('submit',handleAuthSubmit);



  reset.addEventListener('click',async function(){
    setResetMessage('');
    const mail=email.value.trim();
    if(!mail||!email.checkValidity()){
      setResetMessage('Введите email аккаунта выше.','error');
      email.focus();
      return;
    }
    reset.disabled=true;
    try{
      await api.requestPasswordReset(mail);
      setResetMessage('Письмо для восстановления отправлено.','success');
    }catch(error){
      setResetMessage(error&&error.code==='rate_limited'?friendlyError(error):'Не удалось отправить запрос. Проверьте соединение и повторите попытку.','error');
    }finally{
      reset.disabled=false;
    }
  });

  resetForm.addEventListener('submit',async function(event){
    event.preventDefault();
    setMessage('',null,resetConfirmMessage);
    const pass=resetPassword.value;
    if(pass.length<8){
      setMessage('Пароль должен содержать минимум 8 символов.','error',resetConfirmMessage);
      return;
    }
    if(pass!==resetPasswordConfirm.value){
      setMessage('Пароли не совпадают.','error',resetConfirmMessage);
      return;
    }
    if(!resetToken){
      setMessage('Ссылка восстановления недействительна. Запросите новую.','error',resetConfirmMessage);
      return;
    }
    resetSubmit.disabled=true;
    try{
      await api.confirmPasswordReset(resetToken,pass);
      api.clearToken();
      const url=new URL(location.href);
      url.searchParams.delete('reset_token');
      history.replaceState(null,'',url.pathname+url.search+url.hash);
      resetForm.reset();
      setMode('login');
      showGate(true);
      setMessage('Пароль изменён. Теперь войдите с новым паролем.','success',message);
    }catch(error){
      if(error&&error.code==='invalid_reset_token'){
        setMessage('Ссылка недействительна или уже истекла. Запросите восстановление заново.','error',resetConfirmMessage);
      }else{
        setMessage(friendlyError(error),'error',resetConfirmMessage);
      }
    }finally{
      resetSubmit.disabled=false;
    }
  });
  resetBack.addEventListener('click',function(){
    const url=new URL(location.href);
    url.searchParams.delete('reset_token');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    setMode('login');
    showGate(true);
  });

  const logout=document.getElementById('qpAuthLogoutBtn');
  const deleteAccount=document.getElementById('qpAuthDeleteAccountBtn');
  const accountEmail=document.getElementById('qpAccountEmail');

  if(logout){
    logout.addEventListener('click',function(){
      if(typeof window.qPokoyConfirm!=='function')return;
      window.qPokoyConfirm(
        'Выйти из аккаунта?',
        'Вы уверены, что хотите выйти из аккаунта?',
        async function(){
          logout.disabled=true;
          try{
            await api.logout();
            await sync(null);
          }catch(error){
            cloudError('Не удалось выйти из аккаунта.',error);
            await sync(null);
          }finally{
            logout.disabled=false;
          }
        },
        {
          cancelLabel:'Отмена',
          confirmLabel:'Выйти'
        }
      );
    });
  }

  // Cloud income storage is scoped by the REST API's bearer session.
  let cloudUser=null;
  let cloudReady=false;
  let cloudBusy=false;
  let pendingWriteFlush=null;
  let authSyncRun=0;
  let cloudSettings=[];
  const LOCAL_INCOME_OWNER_KEY='qPokoyIncomeOwnerId';
  // A durable per-user write journal survives immediate tab close and reload.
  // Never erase it when clearing the local cloud cache or changing accounts.
  const CLOUD_WRITE_JOURNAL_KEY='qPokoyIncomeWriteJournalV1';

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
  function clearPendingForUser(userId){
    savePendingCloudWrites(readPendingCloudWrites().filter(x=>x.userId!==String(userId)));
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
  function validIsoDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
    if(!match)return false;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
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
  function refreshIncomeViews(){
    if(typeof window.applyIncomeHeaderFilters==='function')window.applyIncomeHeaderFilters();
    else if(typeof window.renderIncomes==='function')window.renderIncomes();
    if(typeof window.renderIncomeAnalytics==='function')window.renderIncomeAnalytics();
    if(typeof window.renderDashboard==='function')window.renderDashboard();
    if(typeof window.renderAnalytics==='function')window.renderAnalytics();
  }

  async function sendPendingCloudWrite(entry,userId){
    const row=uiToRow(entry.record,userId);
    if(!row.id||!row.income_date||!Number.isInteger(row.amount)||row.amount<=0)throw new Error('Некорректная дата, сумма или идентификатор ожидающего дохода. Сумма должна быть указана целыми рублями.');
    if(entry.kind==='add'){
      // Explicit UUID makes retry idempotent when an old request reached
      // the server but its response was lost as the tab closed.
      try{
        const saved=await api.addIncome(row);
        if(!saved)throw new Error('Сервер не подтвердил сохранение дохода.');
        return saved;
      }catch(error){
        if(error.status!==409||error.code!=='income_exists')throw error;
        const existing=(await api.listIncomes()).find(item=>String(item.id)===String(row.id));
        if(!existing)throw error;
        return existing;
      }
    }
    const saved=await api.updateIncome(row.id,row);
    if(!saved)throw new Error('Сервер не подтвердил изменение дохода.');
    return saved;
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

  async function loadCloudIncome(session,runId,data){
    if(!session||!session.user)return false;
    const requestedUserId=String(session.user.id||'');
    cloudUser=session.user;
    cloudReady=false;
    clearLocalIncomeCache();
    if(runId!==authSyncRun||!cloudUser||String(cloudUser.id||'')!==requestedUserId)return false;

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
        delete row.user_id;
        return row;
      });
      if(rows.some(row=>!validIsoDate(row.income_date)||!Number.isInteger(row.amount)||row.amount<=0)){
        throw new Error('В резервной копии есть некорректная дата или сумма. Суммы должны быть целыми рублями без копеек.');
      }
      if(!cloudUser||String(cloudUser.id||'')!==String(userId)||!cloudReady){
        throw new Error('Сессия изменилась до начала восстановления.');
      }
      const finalRows=await api.replaceIncomes(rows);
      if(!Array.isArray(finalRows)||finalRows.length!==rows.length)throw new Error('Сервер не подтвердил полную замену доходов.');
      if(!cloudUser||String(cloudUser.id||'')!==String(userId)||!cloudReady){
        throw new Error('Сессия изменилась после восстановления.');
      }
      clearPendingForUser(userId);
      IncomeStore.save(finalRows.map(rowToUi));
      cloudReady=true;
      refreshIncomeViews();
      return true;
    }catch(error){
      cloudError('Не удалось безопасно восстановить резервную копию.',error);
      return false;
    }finally{
      cloudBusy=false;
    }
  }

  window.qPokoyCloudRestoreBackup=function(records){
    if(cloudUser&&cloudReady&&!cloudBusy){
      const userId=cloudUser.id;
      return flushPendingCloudRecords().then(()=>{
        if(cloudBusy||!cloudUser||String(cloudUser.id)!==String(userId)||!cloudReady||pendingForUser(userId).length)return false;
        return restoreBackupCloud(records,userId);
      });
    }
    return Promise.resolve(false);
  };

  window.qPokoyCloudDeleteAll=async function(){
    if(!cloudUser||!cloudReady||cloudBusy)return false;
    const userId=String(cloudUser.id);
    await flushPendingCloudRecords();
    if(cloudBusy||!cloudUser||String(cloudUser.id)!==userId||!cloudReady||pendingForUser(userId).length){
      cloudError('Дождитесь синхронизации доходов перед удалением.');
      return false;
    }
    cloudBusy=true;
    try{
      await api.deleteAllIncomes();
      if(!cloudUser||String(cloudUser.id)!==userId||!cloudReady)throw new Error('Сессия изменилась во время удаления.');
      clearPendingForUser(userId);
      IncomeStore.save([]);
      refreshIncomeViews();
      return true;
    }catch(error){cloudError('Не удалось удалить доходы.',error);return false;}
    finally{cloudBusy=false;}
  };

  if(deleteAccount){
    deleteAccount.addEventListener('click',function(){
      if(typeof window.qPokoyConfirm!=='function'||typeof window.qPokoyConfirmPhrase!=='function')return;
      window.qPokoyConfirm(
        'Удалить аккаунт?',
        'Все доходы, категории и настройки будут удалены без возможности восстановления.',
        function(){
          window.qPokoyConfirmPhrase(
            'Подтверждение удаления',
            'Для подтверждения введите УДАЛИТЬ.',
            'УДАЛИТЬ',
            async function(){
              if(!cloudUser||!cloudReady||cloudBusy)return;
              deleteAccount.disabled=true;
              const userId=String(cloudUser.id);
              try{
                await pendingWriteFlush;
                if(!cloudUser||String(cloudUser.id)!==userId||cloudBusy)return;
                cloudBusy=true;
                await api.deleteAccount();
                clearPendingForUser(userId);
                IncomeStore.save([]);
                await sync(null);
              }catch(error){cloudError('Не удалось удалить аккаунт.',error);}
              finally{cloudBusy=false;deleteAccount.disabled=false;}
            },
            {
              inputLabel:'Введите слово «УДАЛИТЬ»',
              cancelLabel:'Отмена',
              confirmLabel:'Удалить аккаунт навсегда'
            }
          );
        },
        {
          cancelLabel:'Отмена',
          confirmLabel:'Удалить',
          danger:true
        }
      );
    });
  }

  window.qPokoyCloudReplace=function(){
    if(window.qPokoyNotice)window.qPokoyNotice('Действие недоступно','Полная замена данных пока не поддерживается сервером.','error');
    return Promise.resolve(false);
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
      await api.deleteIncome(id);
      if(!cloudUser||cloudUser.id!==userId||!cloudReady) throw new Error('Сессия изменилась. Обновите страницу для синхронизации.');
      return true;
    }catch(error){ cloudError('Не удалось удалить доход.',error); return false; }
  };
  window.qPokoyCloudAddMany=async function(records){
    if(!cloudUser||!cloudReady||cloudBusy||!records.length)return;
    try{
      const rows=records.map(r=>{const row=uiToRow(r,cloudUser.id); delete row.id; return row;}).filter(r=>r.income_date && Number.isInteger(r.amount) && r.amount>0);
      if(!rows.length)return;
      const appended=[];
      for(const row of rows)appended.push(rowToUi(await api.addIncome(row)));
      const old=IncomeStore.load().filter(x=>!records.some(r=>String(r.id)===String(x.id)));
      IncomeStore.save([...old,...appended]);
    }catch(error){ cloudError('Не удалось импортировать доходы в облако.',error); }
  };

  async function sync(session,startup=null){
    const runId=++authSyncRun;
    if(session&&session.user){
      showGate(true,true);
      startup=startup||await api.bootstrap();
      if(runId!==authSyncRun)return;
      if(!startup){await sync(null);return;}
      session={user:apiUser(startup.user)};
      const nextUserId=String(session.user.id||'');
      let previousOwner='';
      try{ previousOwner=localStorage.getItem(LOCAL_INCOME_OWNER_KEY)||''; }catch(e){}
      if(previousOwner!==nextUserId) clearLocalIncomeCache();
      try{ localStorage.setItem(LOCAL_INCOME_OWNER_KEY,nextUserId); }catch(e){}
      showGate(true,true);
      if(accountEmail) accountEmail.textContent=session.user.email||'';
      const loaded=await loadCloudIncome(session,runId,startup.incomes);
      if(runId!==authSyncRun)return;
      if(!loaded){
        if(cloudUser&&String(cloudUser.id||'')===nextUserId){
          showGate(true);
          setMessage('Не удалось загрузить данные. Проверьте соединение и обновите страницу.','error');
        }
        return;
      }
      if(typeof window.qPokoyLoadCategories==='function'){
        try{await window.qPokoyLoadCategories(session.user,startup.categories);}
        catch(error){
          cloudError('Не удалось загрузить категории.',error);
          showGate(true);
          setMessage('Не удалось загрузить категории. Проверьте соединение и обновите страницу.','error');
          return;
        }
      }
      if(runId!==authSyncRun)return;
      cloudSettings=startup.settings.map(row=>({...row}));
      const pendingFlush=flushPendingCloudRecords();
      if(runId===authSyncRun&&cloudUser&&String(cloudUser.id||'')===nextUserId&&cloudReady) showGate(false);
      await pendingFlush;
    }else{
      cloudUser=null; cloudReady=false;
      cloudSettings=[];
      clearLocalIncomeCache();
      try{ localStorage.removeItem(LOCAL_INCOME_OWNER_KEY); }catch(e){}
      showGate(true);
      if(accountEmail) accountEmail.textContent='—';
      if(typeof window.qPokoyLoadCategories==='function')window.qPokoyLoadCategories(null);
    }
  }
  api.setUnauthorizedHandler(()=>sync(null));
  if(resetToken){
    setMode('reset');
    showGate(true);
  }else if(verifyToken){
    setMode('login');
    showGate(true,true);
    api.confirmEmailVerification(verifyToken).then(()=>{
      api.clearToken();
      const url=new URL(location.href);
      url.searchParams.delete('verify_token');
      history.replaceState(null,'',url.pathname+url.search+url.hash);
      setMode('login');
      showGate(true);
      setMessage('Почта подтверждена. Теперь войдите в аккаунт.','success',message);
    }).catch(error=>{
      const url=new URL(location.href);
      url.searchParams.delete('verify_token');
      history.replaceState(null,'',url.pathname+url.search+url.hash);
      setMode('login');
      showGate(true);
      setMessage(error&&error.code==='invalid_verification_token'
        ?'Ссылка подтверждения недействительна или уже истекла.'
        :friendlyError(error),'error',message);
    });
  }else if(oauthTicket){
    setMode('login');
    showGate(true,true);
    const cleanUrl=new URL(location.href);
    cleanUrl.searchParams.delete('oauth_ticket');
    history.replaceState(null,'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    api.exchangeOAuthTicket(oauthTicket).then(user=>sync({user:apiUser(user)})).catch(error=>{
      showGate(true);
      setMessage(error&&error.code==='invalid_oauth_ticket'
        ?'Ссылка входа недействительна или уже истекла. Повторите вход.'
        :friendlyError(error),'error',message);
    });
  }else if(oauthError){
    setMode('login');
    showGate(true);
    const cleanUrl=new URL(location.href);
    cleanUrl.searchParams.delete('oauth_error');
    cleanUrl.searchParams.delete('oauth_provider');
    history.replaceState(null,'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    const providerName=oauthProvider==='google'?'Google':(oauthProvider==='yandex'?'Яндекс':'OAuth');
    const errorText=oauthError==='oauth_cancelled'
      ?'Вход через '+providerName+' отменён.'
      :(oauthError==='oauth_not_configured'
        ?'Вход через '+providerName+' пока не настроен.'
        :(oauthError==='rate_limited'
          ?'Слишком много попыток входа. Попробуйте позже.'
          :'Не удалось войти через '+providerName+'. Попробуйте ещё раз.'));
    setMessage(errorText,'error',message);
  }else{
    api.bootstrap().then(startup=>sync(startup?{user:apiUser(startup.user)}:null,startup)).catch(error=>{
      showGate(true);
      setMessage(friendlyError(error),'error');
    });
  }

  window.qPokoyAuth={client:api,showGate,setMode,getSettings:()=>cloudSettings.map(row=>({...row}))};
})();

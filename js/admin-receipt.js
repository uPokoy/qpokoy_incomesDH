(function(){
  'use strict';
  const api=window.qPokoyApi;
  const card=document.getElementById('adminUser');
  const title=document.getElementById('adminUserTitle');
  const details=document.getElementById('adminDetails');
  const panel=document.getElementById('adminReceiptPanel');
  const summary=document.getElementById('adminReceiptSummary');
  const button=document.getElementById('adminPrepareReceipt');
  const receiptUrl=document.getElementById('adminReceiptUrl');
  const message=document.getElementById('adminReceiptMessage');
  if(!api||!card||!title||!details||!panel||!summary||!button||!receiptUrl||!message)return;

  const prices={monthly:149,yearly:1190,lifetime:1790};
  const labels={monthly:'Доступ к сервису qPokoy на 1 месяц',yearly:'Доступ к сервису qPokoy на 1 год',lifetime:'Бессрочный доступ к сервису qPokoy'};
  let current=null,refreshTimer=null,refreshSeq=0,sending=false;

  function showMessage(text,error=false){message.textContent=text;message.dataset.error=String(error);message.hidden=false;}
  function clearMessage(){message.textContent='';message.dataset.error='false';message.hidden=true;}
  function formatDate(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';}
  function validReceipt(user){
    const a=user?.assignment;
    if(a?.source!=='payment'||!Object.hasOwn(prices,a.plan))return null;
    const paymentId=String(a.last_payment_id||'');
    const paidAt=new Date(a.last_paid_at||'');
    if(!/^[A-Za-z0-9-]{10,80}$/.test(paymentId)||!Number.isFinite(paidAt.getTime()))return null;
    return {user_id:String(user.user_id||''),email:String(user.email||''),payment_id:paymentId,plan:a.plan,amount_rub:prices[a.plan],service_name:labels[a.plan],operation_time:paidAt.toISOString(),customer_type:'individual',payment_type:'account'};
  }
  function setReceiptState(record){
    if(record?.payment_id===current?.payment_id&&record.status==='sent'){
      receiptUrl.value=record.receipt_url||'';receiptUrl.readOnly=true;receiptUrl.disabled=false;button.disabled=true;
      showMessage(`Чек сохранён и отправлен на ${current.email}${record.sent_at?' · '+formatDate(record.sent_at):''}.`);return;
    }
    receiptUrl.readOnly=false;receiptUrl.disabled=false;button.disabled=false;
  }
  function render(user){
    current=validReceipt(user);clearMessage();sending=false;
    if(!current){panel.hidden=true;button.disabled=true;receiptUrl.disabled=true;return;}
    summary.textContent=`${current.amount_rub} ₽ · ${formatDate(current.operation_time)} · ${current.service_name}`;
    panel.hidden=false;receiptUrl.disabled=false;receiptUrl.readOnly=false;receiptUrl.value='';button.disabled=false;
  }
  async function refresh(){
    if(card.hidden){current=null;panel.hidden=true;return;}
    const email=String(title.textContent||'').trim();
    if(!email||!email.includes('@')){current=null;panel.hidden=true;return;}
    const seq=++refreshSeq;
    try{const user=await api.adminFindUser(email);if(seq===refreshSeq&&!card.hidden)render(user);}
    catch(_){if(seq===refreshSeq){current=null;panel.hidden=true;}}
  }
  function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,120);}

  async function sendReceipt(url){
    if(!current||sending||receiptUrl.readOnly)return;
    const value=String(url||'').trim();if(!value)return;
    sending=true;receiptUrl.value=value;receiptUrl.disabled=true;showMessage(`Сохраняем чек и отправляем его на ${current.email}…`);
    try{
      const payload=await api.request('POST','/admin/users/'+encodeURIComponent(current.user_id)+'/access',{action:'receipt',payment_id:current.payment_id,receipt_url:value});
      if(payload?.data?.status==='sent')setReceiptState(payload.data);
      else{receiptUrl.disabled=false;receiptUrl.readOnly=false;showMessage('Отправка уже выполняется. Подождите немного и вставьте ссылку ещё раз.');}
    }catch(error){receiptUrl.disabled=false;receiptUrl.readOnly=false;showMessage(error?.message||'Не удалось отправить чек.',true);}
    finally{sending=false;}
  }

  new MutationObserver(scheduleRefresh).observe(card,{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(scheduleRefresh).observe(title,{childList:true,characterData:true,subtree:true});
  new MutationObserver(scheduleRefresh).observe(details,{childList:true,subtree:true});
  receiptUrl.addEventListener('paste',event=>{if(!current||receiptUrl.readOnly)return;const value=event.clipboardData?.getData('text')||'';if(!value)return;event.preventDefault();receiptUrl.value=value.trim();sendReceipt(receiptUrl.value);});
  receiptUrl.addEventListener('change',()=>sendReceipt(receiptUrl.value));

  button.addEventListener('click',()=>{
    if(!current)return;clearMessage();
    const requestId=typeof crypto?.randomUUID==='function'?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2);
    const payload={...current,request_id:requestId};
    const tab=window.open('about:blank','_blank');let finished=false;
    const navigate=()=>{try{if(tab&&!tab.closed)tab.location.href='https://lknpd.nalog.ru/';}catch(_){}};
    const listener=(event)=>{if(event.source!==window||event.origin!==location.origin)return;const data=event.data;if(data?.source!=='qpokoy-extension'||data?.type!=='npd-receipt-stored'||data?.request_id!==requestId)return;finished=true;window.removeEventListener('message',listener);navigate();showMessage('Данные переданы. В «Мой налог» проверьте их и нажмите «Выдать чек». После создания вставьте ссылку сюда — письмо уйдёт автоматически.');};
    window.addEventListener('message',listener);window.postMessage({source:'qpokoy-admin',type:'prepare-npd-receipt',payload},location.origin);
    setTimeout(async()=>{if(finished)return;window.removeEventListener('message',listener);navigate();const text=[current.service_name,`Сумма: ${current.amount_rub} ₽`,`Дата оплаты: ${formatDate(current.operation_time)}`].join('\n');try{await navigator.clipboard.writeText(text);}catch(_){}showMessage('Расширение для автозаполнения не отвечает. «Мой налог» открыт, данные платежа скопированы.',true);},1300);
  });
  scheduleRefresh();
})();

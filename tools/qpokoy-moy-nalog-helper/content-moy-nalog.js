(function(){
  'use strict';
  const KEY='qpokoy_pending_receipt_v1';
  const MAX_AGE=48*60*60*1000;
  const normalize=value=>String(value||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const visible=element=>{
    if(!element||!element.isConnected)return false;
    const style=getComputedStyle(element),rect=element.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
  };
  function contextText(element){
    const parts=[element.getAttribute?.('aria-label'),element.getAttribute?.('placeholder'),element.getAttribute?.('name')];
    if(element.id){const label=document.querySelector(`label[for="${CSS.escape(element.id)}"]`);if(label)parts.push(label.textContent);}
    let node=element.parentElement;
    for(let i=0;node&&i<2;i++,node=node.parentElement)parts.push(node.textContent);
    return normalize(parts.filter(Boolean).join(' '));
  }
  function editableControls(){return [...document.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"],select')].filter(visible);}
  function findField(words){
    const normalized=words.map(normalize);
    return editableControls().find(element=>normalized.some(word=>contextText(element).includes(word)))||null;
  }
  function setNativeValue(element,value){
    if(element.tagName==='SELECT'){
      const wanted=normalize(value);
      const option=[...element.options].find(item=>normalize(item.textContent).includes(wanted)||normalize(item.value).includes(wanted));
      if(!option)return false;
      element.value=option.value;element.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }
    if(element.isContentEditable){
      element.focus();element.textContent=String(value);element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));element.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }
    const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if(setter)setter.call(element,String(value));else element.value=String(value);
    element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));element.blur();return true;
  }
  function clickableByText(words,exact=false){
    const wanted=words.map(normalize);
    const nodes=[...document.querySelectorAll('button,[role="button"],a,label')].filter(visible);
    return nodes.find(element=>{
      const text=normalize(element.textContent);
      return wanted.some(word=>exact?text===word:text.includes(word));
    })||null;
  }
  function clickChoice(words){const element=clickableByText(words);if(!element)return false;element.click();return true;}
  function moscowDate(value){
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
    const parts=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get=type=>parts.find(item=>item.type===type)?.value||'';
    return {iso:`${get('year')}-${get('month')}-${get('day')}`,ru:`${get('day')}.${get('month')}.${get('year')}`};
  }
  function fillDate(receipt){
    const date=moscowDate(receipt.operation_time);if(!date)return false;
    const field=findField(['дата продажи','дата расчета','дата получения дохода','дата операции']);
    if(!field)return false;
    if(field.tagName==='SELECT')return false;
    if(field.type==='date')return setNativeValue(field,date.iso);
    if(field.type==='datetime-local')return setNativeValue(field,date.iso+'T12:00');
    return setNativeValue(field,date.ru);
  }
  function toast(text,warn=false){
    document.getElementById('qpokoy-npd-helper-toast')?.remove();
    const box=document.createElement('div');box.id='qpokoy-npd-helper-toast';box.textContent=text;
    Object.assign(box.style,{position:'fixed',zIndex:'2147483647',left:'50%',bottom:'24px',transform:'translateX(-50%)',maxWidth:'560px',padding:'14px 18px',borderRadius:'12px',font:'14px/1.45 Arial,sans-serif',boxShadow:'0 8px 30px rgba(0,0,0,.28)',background:warn?'#5a3415':'#173b2b',color:'#fff',border:'1px solid rgba(255,255,255,.22)',textAlign:'center'});
    document.documentElement.append(box);setTimeout(()=>box.remove(),12000);
  }

  chrome.storage.local.get(KEY,result=>{
    const receipt=result?.[KEY];
    if(!receipt||!Number.isFinite(Number(receipt.saved_at))||Date.now()-Number(receipt.saved_at)>MAX_AGE){chrome.storage.local.remove(KEY);return;}
    if(!Number.isFinite(Number(receipt.amount_rub))||!receipt.service_name||!Number.isFinite(Date.parse(receipt.operation_time||''))){chrome.storage.local.remove(KEY);return;}
    let completed=false,filling=false,saleClicked=false,attempts=0,observer=null,timer=null;
    const finish=(dateFilled)=>{
      if(completed)return;completed=true;filling=false;
      observer?.disconnect();if(timer)clearInterval(timer);chrome.storage.local.remove(KEY);
      toast(dateFilled?'qPokoy: данные подставлены. Проверьте их и нажмите «Выдать чек».':'qPokoy: сумма и услуга подставлены. Проверьте дату оплаты и нажмите «Выдать чек».',!dateFilled);
    };
    const tryFill=()=>{
      if(completed||filling)return;
      attempts++;
      const service=findField(['наименование услуги','наименование','название услуги','товар или услуга']);
      const amount=findField(['стоимость','сумма','цена']);
      if(!service||!amount){
        if(!saleClicked){
          const start=clickableByText(['новая продажа','добавить продажу']);
          if(start){saleClicked=true;start.click();}
        }
        if(attempts>180){observer?.disconnect();if(timer)clearInterval(timer);toast('qPokoy: не удалось найти форму продажи. Откройте «Добавить продажу» вручную и повторите оформление чека.',true);}
        return;
      }
      filling=true;
      observer?.disconnect();if(timer){clearInterval(timer);timer=null;}
      setNativeValue(service,String(receipt.service_name));
      setNativeValue(amount,String(Number(receipt.amount_rub)).replace('.',','));
      clickChoice(['физическому лицу','физическое лицо']);
      clickChoice(['безналичный расчет','безналичный']);
      const dateFilled=fillDate(receipt);
      setTimeout(()=>finish(dateFilled),250);
    };
    observer=new MutationObserver(tryFill);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','aria-hidden']});
    timer=setInterval(tryFill,500);tryFill();
  });
})();

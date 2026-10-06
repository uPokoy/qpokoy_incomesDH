(function(){
  'use strict';
  const KEY='qpokoy_pending_receipt_v1';
  function valid(payload){
    if(!payload||typeof payload!=='object')return false;
    if(!/^[A-Za-z0-9-]{10,80}$/.test(String(payload.payment_id||'')))return false;
    if(!/^[0-9a-f-]{16,80}$/i.test(String(payload.request_id||'')))return false;
    if(!['monthly','yearly','lifetime'].includes(payload.plan))return false;
    if(!Number.isFinite(Number(payload.amount_rub))||Number(payload.amount_rub)<=0||Number(payload.amount_rub)>1000000)return false;
    if(typeof payload.service_name!=='string'||!payload.service_name.trim()||payload.service_name.length>160)return false;
    if(!Number.isFinite(Date.parse(payload.operation_time||'')))return false;
    return payload.customer_type==='individual'&&payload.payment_type==='account';
  }
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin)return;
    const message=event.data;
    if(message?.source!=='qpokoy-admin'||message?.type!=='prepare-npd-receipt'||!valid(message.payload))return;
    const receipt={...message.payload,saved_at:Date.now()};
    chrome.storage.local.set({[KEY]:receipt},()=>{
      if(chrome.runtime.lastError)return;
      window.postMessage({source:'qpokoy-extension',type:'npd-receipt-stored',request_id:receipt.request_id},location.origin);
    });
  });
})();

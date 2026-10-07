'use strict';
// Deploy this entry point as a SEPARATE PRIVATE function. No API Gateway route.
const {createYdbStore}=require('./ydb');
const {createYooKassaClient}=require('./yookassa');
const {createPaymentRouter}=require('./payment-router');
const {hasValidPrechargeNoticeForUser}=require('./precharge-notifications');
function createRenewalWorker(store,router,options={}){
  return async function run(event={}){
    if(options.enabled!==true)return {disabled:true};
    if(event.httpMethod||event.requestContext?.http)throw new Error('Renewal worker must not be public HTTP');
    let after=typeof event.cursor==='string'?event.cursor:'';
    if(after&&!/^[0-9a-f-]{36}$/i.test(after))throw new Error('Invalid renewal cursor');
    const result={checked:0,processed:0,failed:0,next_cursor:null};
    const elapsedNow=options.elapsedNow||Date.now;
    const deadline=elapsedNow()+(options.budgetMs||180000);
    // Bound one invocation. For >500 accounts, private orchestration must pass
    // next_cursor until null, then start a new cycle. Never log user/method IDs.
    for(let page=0;page<5;page++){
      const rows=await store.listPaymentRenewalUsers(after);
      for(const row of rows){
        if(elapsedNow()>=deadline){result.next_cursor=after;return result;}
        result.checked++;
        try{
          if(options.requirePrechargeNotice===true&&!await hasValidPrechargeNoticeForUser(store,row.user_id)){
            after=row.user_id;
            continue;
          }
          const r=await router.renewUser(row.user_id);if(!r.skipped)result.processed++;
        }catch(_){result.failed++;}
        after=row.user_id;
      }
      if(rows.length<100)return result;
      after=rows.at(-1).user_id;
    }
    result.next_cursor=after;return result;
  };
}
let worker;
async function handler(event={}){
  if(process.env.YOOKASSA_RENEWALS_ENABLED!=='true')return {disabled:true};
  if(!worker){const store=createYdbStore(),router=createPaymentRouter(store,{
    client:createYooKassaClient({shopId:process.env.YOOKASSA_SHOP_ID||'',secretKey:process.env.YOOKASSA_SECRET_KEY||''}),
    appBaseUrl:process.env.APP_BASE_URL||'https://qpokoy.ru/'});
    worker=createRenewalWorker(store,router,{enabled:true,requirePrechargeNotice:true});}
  try { return await worker(event); } catch (_) { return {failed:true,code:'renewal_worker_failed'}; }
}
module.exports={handler,createRenewalWorker};

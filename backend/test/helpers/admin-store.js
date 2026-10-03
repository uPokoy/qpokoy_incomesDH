'use strict';
const { randomUUID } = require('node:crypto');
const { newSession } = require('../../security');
function adminFixture(){
  const users=new Map(),sessions=new Map(),settings=new Map(),limits=new Map(),audit=[];
  const key=(u,k)=>u+':'+k;
  function account(email,created='2026-10-03T00:00:00Z'){
    const id=randomUUID(),session=newSession();
    users.set(id,{user_id:id,email,status:'active',created_at:created,trial_ends_at:'2026-10-17T00:00:00Z'});
    sessions.set(session.sessionId,{session_id:session.sessionId,user_id:id,secret_hash:session.secretHash,expires_at:'2035-01-01T00:00:00Z'});
    return {id,headers:{authorization:'Bearer '+session.token}};
  }
  const admin=account('admin@example.invalid'),target=account('target@example.invalid'),ordinary=account('ordinary@example.invalid');
  const store={
    getSession:async id=>sessions.get(id),getUser:async id=>users.get(id),
    getIdentity:async(provider,email)=>{const u=[...users.values()].find(u=>u.email===email);return u?{user_id:u.user_id}:null;},
    getSetting:async(uid,k)=>settings.get(key(uid,k)),listSettings:async uid=>[...settings.values()].filter(r=>r.user_id===uid),
    putSetting:async r=>settings.set(key(r.user_id,r.setting_key),r),
    consumeRateLimit:async(bucket,limit,windowMs)=>{const count=limits.get(bucket)||0;limits.set(bucket,count+1);return{allowed:count<limit,retry_after_seconds:60};},
    applyAdminBillingChange:async({targetId,settingKey,value,audit:row,timestamp})=>{
      if(store.failAudit)throw Error('audit unavailable');
      if(value===null)settings.delete(key(targetId,settingKey));
      else settings.set(key(targetId,settingKey),{user_id:targetId,setting_key:settingKey,setting_value:JSON.stringify(value),updated_at:timestamp});
      settings.set(key(row.user_id,row.setting_key),row);audit.push(JSON.parse(row.setting_value));
    },
    loadBootstrap:async(sessionId,validate,revision)=>{const session=sessions.get(sessionId),user=users.get(session?.user_id);validate({session,user});return{session,user,revision:'same',not_modified:revision==='same',incomes:[],categories:[],settings:[...settings.values()].filter(r=>r.user_id===user.user_id)};},
    listIncomes:async()=>{throw Error('Admin must not read financial records');},
    listCategories:async()=>{throw Error('Admin must not read categories');}
  };
  return{store,admin,target,ordinary,users,settings,audit,key,account};
}
module.exports={adminFixture};

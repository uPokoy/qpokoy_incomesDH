'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const MOBILE='(max-width:900px) and (pointer:coarse), (orientation:landscape) and (max-height:560px) and (pointer:coarse)';
const DESKTOP='(hover:hover) and (pointer:fine), (pointer:coarse) and (min-width:901px) and (max-width:1200px)';
function matches(query,{width=1440,height=900,pointer='fine'}={}){
  return query.split(',').some(branch=>branch.split(/\s+and\s+/).every(part=>{
    const condition=part.trim().match(/^\(([^:]+):\s*([^)]*)\)$/);
    if(!condition)throw new Error('Unsupported test media query: '+part);
    const [,key,value]=condition;
    if(key==='pointer')return value===pointer;
    if(key==='hover')return value===(pointer==='fine'?'hover':'none');
    if(key==='orientation')return value===(width>height?'landscape':'portrait');
    if(/^(min|max)-(width|height)$/.test(key)){
      const dimension=key.endsWith('width')?width:height;
      return key.startsWith('min')?dimension>=parseFloat(value):dimension<=parseFloat(value);
    }
    throw new Error('Unsupported test media feature: '+key);
  }));
}
const userA={user_id:'11111111-1111-4111-8111-111111111111',email:'a@example.test'};
const userB={user_id:'22222222-2222-4222-8222-222222222222',email:'b@example.test'};
function row(user,amount=100,description='Seed income'){
  return {id:randomUUID(),user_id:user.user_id,income_date:'2026-10-07',category:'Зарплата',description,amount};
}
async function createHarness(options={}){
  const errors=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(options.html??fs.readFileSync(path.join(root,'index.html'),'utf8'),{
    url:'https://qpokoy.example/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc
  });
  const w=dom.window;
  // No resource loading, production requests, layout simulation, or real payments.
  await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
  w.console.error=(...args)=>errors.push(args.map(String).join(' '));
  w.scrollTo=()=>{};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLCanvasElement.prototype.getContext=()=>({measureText:text=>({width:String(text).length*8})});
  const downloads=[];
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:https://qpokoy.example/test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.matchMedia=query=>({media:query,matches:matches(query,options),addEventListener(){},addListener(){},removeEventListener(){}});
  w.innerWidth=options.width||1440;w.innerHeight=options.height||900;
  const users=[userA,userB];
  const records=new Map(users.map(user=>[user.user_id,[row(user,user===userA?100:700,user.email)]]));
  const categories=new Map(users.map(user=>[user.user_id,[{id:randomUUID(),user_id:user.user_id,name:'Зарплата'}]]));
  let current=options.signedOut?null:userA;
  let hold=null;
  const calls=[];
  const billing={mode:'active',plan:'monthly',can_write:options.readOnly!==true,auto_renew:true,payment_method_saved:true,paid_until:'2026-11-07T00:00:00Z'};
  const tokenKey='qPokoyYdbSessionTokenV1';
  w.localStorage.setItem('incomeSelectedPeriod',JSON.stringify({month:10,year:2026}));
  if(options.localIncomes)w.localStorage.setItem('incomes',JSON.stringify(options.localIncomes));
  if(current)w.localStorage.setItem(tokenKey,'session-a.secret');
  const api={
    getToken:()=>w.localStorage.getItem(tokenKey),
    setUnauthorizedHandler(handler){this.unauthorized=handler;},
    async bootstrap(){calls.push('bootstrap');if(options.bootstrapGate)await options.bootstrapGate;return current?{user:current,incomes:records.get(current.user_id).map(x=>({...x})),categories:categories.get(current.user_id),settings:[],billing}:null;},
    async login(email){current=users.find(user=>user.email===email);if(!current)throw Error('Unknown fixture user');w.localStorage.setItem(tokenKey,'session-'+current.user_id+'.secret');return current;},
    async logout(){current=null;w.localStorage.removeItem(tokenKey);w.localStorage.removeItem('qPokoyBootstrapCacheV1');},
    async billingStatus(){return {...billing};},
    async listIncomes(){return records.get(current.user_id);},
    async addIncome(value){
      const owner=current.user_id;calls.push('addIncome');
      const created={...value,user_id:owner};records.get(owner).push(created);
      if(hold){const pending=hold;hold=null;await pending.promise;if(pending.fail)throw Error('lost response');}
      return created;
    },
    async updateIncome(id,value){calls.push('updateIncome');const list=records.get(current.user_id);const index=list.findIndex(x=>x.id===id);list[index]={...value,id,user_id:current.user_id};return list[index];},
    async deleteIncome(id){calls.push('deleteIncome');records.set(current.user_id,records.get(current.user_id).filter(x=>x.id!==id));},
    async addCategory(name){calls.push('addCategory');const created={id:randomUUID(),user_id:current.user_id,name};categories.get(current.user_id).push(created);return created;},
    async deleteCategory(id){categories.set(current.user_id,categories.get(current.user_id).filter(x=>x.id!==id));},
    async replaceIncomes(values){calls.push('replaceIncomes');const rows=values.map(value=>({...value,id:value.id||randomUUID(),user_id:current.user_id}));records.set(current.user_id,rows);return rows;},
    async deleteAllIncomes(){records.set(current.user_id,[]);},
    async putSetting(){},
    async setBillingAutoRenew(enabled){billing.auto_renew=enabled;return {...billing};},
    async request(){return {data:{unlinked:true}};}
  };
  w.qPokoyApi=api;
  const scripts=[...w.document.querySelectorAll('script[src]')].map(node=>node.getAttribute('src').split('?')[0]);
  try{
    for(const script of scripts){if(script==='js/api-client.js')continue;w.eval(fs.readFileSync(path.join(root,script),'utf8')+'\n//# sourceURL='+script);}
  }catch(error){w.close();throw error;}
  const h={dom,w,api,records,categories,calls,errors,billing,downloads,
    node:id=>w.document.getElementById(id),
    async settle(){await new Promise(resolve=>setTimeout(resolve,70));},
    async login(user=userA){h.node('qpAuthEmail').value=user.email;h.node('qpAuthPassword').value='fixture-only-password';h.node('qpAuthForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await h.settle();},
    async logout(){h.node('qpAuthLogoutBtn').click();h.node('qpConfirmOverlay').querySelector('[data-confirm-ok]').click();await h.settle();},
    add(amount=123,description='New test income',category='Зарплата'){h.node('openIncomeForm').click();h.node('incomeDate').value='07.10.26';h.node('incomeAmount').value=String(amount);h.node('incomeCategory').value=category;h.node('incomeDescription').value=description;h.node('saveIncome').click();},
    holdAdd({fail=false}={}){let release;const promise=new Promise(resolve=>{release=resolve;});hold={promise,fail};return release;},
    close(){w.close();}
  };
  await h.settle();
  return h;
}
module.exports={createHarness,matches,MOBILE,DESKTOP,userA,userB};

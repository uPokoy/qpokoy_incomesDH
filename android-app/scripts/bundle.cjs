'use strict';
// Android-only, reproducible asset build. Never writes to the website or backend.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const repo=path.resolve(root,'..');
const out=path.join(root,'www');
const sourceArg=process.argv.indexOf('--source-ref');
const ref=sourceArg===-1?'origin/main':process.argv[sourceArg+1];
if(!ref)throw new Error('--source-ref requires a Git ref');
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024});
const commit=git('rev-parse','--verify',ref+'^{commit}').toString().trim();
// Mirror only the production workflow's version preparation, never its deploy.
const workflow=git('show',commit+':.github/workflows/frontend-deploy.yml').toString();
const baseline=workflow.match(/dev_base_sha="([a-f0-9]{40})"/);
const baseNumber=workflow.match(/dev_base_number=(\d+)/);
if(!baseline||!baseNumber)throw new Error('Frontend version preparation needs review');
const count=Number(git('rev-list','--count',baseline[1]+'..'+commit).toString().trim());
const sourceVersion=git('show','-s','--format=%cs',commit).toString().trim().replaceAll('-','.')+'.'+(Number(baseNumber[1])+count);
const files=new Set(git('ls-tree','-r','--name-only',commit).toString().trim().split(/\r?\n/));
const pages=['index.html','pricing.html','service.html','offer.html','privacy.html','about.html'];
const queue=[...pages];
const copied=new Set();
const outputs=new Map();
function adapt(name,text){
  if(name.endsWith('.html')){
    text=text.replace(/((?:src|href)="(?:\.\/)?(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g,'$1?v=dev-'+sourceVersion+'"');
    text=text.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>\s*/gi,'');
    text=text.replace(/<head>/i,'<head>\n<script src="/android-platform.js"></script>');
    text=text.replace(/<\/body>/i,'<script src="/android-adapter.js"></script>\n</body>');
  }
  if(name==='index.html')text=text.replace(/(<strong id="qPokoyDevVersion">)dev-\d{4}\.\d{2}\.\d{2}\.\d+(<\/strong>)/,'$1'+sourceVersion+'$2');
  if(name==='index.html')text=text.replace('<script id="qPokoyAuth"','<script src="/android-read-cache.js"></script>\n<script id="qPokoyAuth"');
  if(name==='js/app.js'){
    // Keep older source refs compatible; current main already uses one card.
    const pageSize=".matches?2:RECENT_INCOME_PAGE_SIZE";
    if(!text.includes(pageSize)&&!text.includes('.matches?1:RECENT_INCOME_PAGE_SIZE'))throw new Error('Mobile recent pagination adaptation needs review');
    text=text.replace(pageSize,'.matches?1:RECENT_INCOME_PAGE_SIZE');
    const pattern=/const qPokoyDevVersion='dev-\d{4}\.\d{2}\.\d{2}\.\d+';/;
    if(!pattern.test(text))throw new Error('DEV adaptation needs review');
    text=text.replace(pattern,"const qPokoyDevVersion='"+sourceVersion+"';");
    text=text.replace("saveBtn.addEventListener('click',(e)=>{","saveBtn.addEventListener('click',async(e)=>{");
    const old="  if(editingIncomeId!==null){\n    IncomeStore.update(editingIncomeId,record);\n  }else{\n    IncomeStore.add(record);\n  }";
    if(!text.includes(old))throw new Error('Android confirmed-save adaptation needs review');
    text=text.replace(old,"  if(saveBtn.disabled)return;\n  saveBtn.disabled=true;\n  try{\n    if(editingIncomeId!==null)await IncomeStore.update(editingIncomeId,record);\n    else await IncomeStore.add(record);\n  }catch(error){window.qPokoyNotice?.('Не удалось сохранить доход',error.message,'error');return;}\n  finally{saveBtn.disabled=false;}");
    const recent='<div class="income-recent-date">${escapeHtml(formatDateShort(item.date))}</div>';
    const history="${escapeHtml(item.description||'')}</div>`;";
    if(!text.includes(recent)||!text.includes(history))throw new Error('Android pending status markup needs review');
    text=text.replace(recent,'<div class="income-recent-date">${escapeHtml(formatDateShort(item.date))}${window.qPokoyAndroidCache?.pendingMarkup(item.id)||\'\'}</div>');
    text=text.replace(history,"${escapeHtml(item.description||'')}${window.qPokoyAndroidCache?.pendingMarkup(item.id)||''}</div>`;");
  }
  if(name==='js/auth.js'){
    const needle='const url=await api.startOAuth(provider);';
    if(!text.includes(needle))throw new Error('OAuth adaptation needs review');
    text=text.replace(needle,'const url=await window.qPokoyAndroidStartOAuth(provider);');
    const startup="api.bootstrap().then(startup=>sync(startup?{user:apiUser(startup.user)}:null,startup))";
    if(!text.includes(startup))throw new Error('Android cache hydration adaptation needs review');
    text=text.replace(startup,"window.qPokoyAndroidCache.start((startup,cached)=>sync(startup?{user:apiUser(startup.user)}:null,startup,cached))");
    const start=text.indexOf('  async function sync(session,startup=null){'),end=text.indexOf('  api.setUnauthorizedHandler',start);
    if(start<0||end<0)throw new Error('Android auth sync adaptation needs review');
    let sync=text.slice(start,end).replace('sync(session,startup=null)','sync(session,startup=null,cached=false)');
    sync=sync.replaceAll('showGate(true,true);','if(!window.qPokoyAndroidCache.displayed)showGate(true,true);');
    sync=sync.replace('    }else{\n      cloudUser=null;',"    }else{\n      void window.qPokoyAndroidCache.purge().catch(()=>{});\n      cloudUser=null;");
    text=text.slice(0,start)+sync+text.slice(end);
    const logoutCatch="cloudError('Не удалось выйти из аккаунта.',error);\n            await sync(null);";
    if(!text.includes(logoutCatch))throw new Error('Android pending logout guard needs review');
    text=text.replace(logoutCatch,"cloudError('Не удалось выйти из аккаунта.',error);\n            if(error.code!=='android_pending_logout')await sync(null);");
    // Disable the website journal; Android has its own durable create-only SQLite outbox.
    text=text.replace(/function readPendingCloudWrites\(\)\{[\s\S]*?\n  function savePendingCloudWrites/, 'function readPendingCloudWrites(){return [];}\n  function savePendingCloudWrites');
    text=text.replace(/function enqueuePendingCloudWrite\(userId,record,kind\)\{[\s\S]*?\n  function toIsoDate/,"function enqueuePendingCloudWrite(){throw new Error('Android требует подтверждение сервера.');}\n\n  function toIsoDate");
  }
  if(name==='css/mobile.css'){
    const grid='/* Exactly one row with two recent-income cards. */\n  #income .income-recent.qp-mobile-recent-stack .income-recent-grid{\n    grid-template-columns:repeat(2,minmax(0,1fr)) !important;';
    const single='/* One full-width recent-income card per mobile page. */\n  #income .income-recent.qp-mobile-recent-stack .income-recent-grid{\n    grid-template-columns:minmax(0,1fr) !important;';
    if(!text.includes(grid)&&!text.includes(single))throw new Error('Mobile recent grid adaptation needs review');
    text=text.replace(grid,single);
  }
  if(name==='css/oauth-brand.css')text=text.replace('https://upload.wikimedia.org/wikipedia/commons/8/81/Yandex_ID_icon.svg','/vendor/yandex-id.svg');
  if(name==='js/report-print.js'){
    const needle='https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
    if(!text.includes(needle))throw new Error('PDF adaptation needs review');
    text=text.replace(needle,'https://localhost/vendor/html2pdf.bundle.min.js');
  }
  return text;
}
function reference(value,base){
  if(!value||/^(?:[a-z]+:|\/\/|#)/i.test(value))return;
  const clean=value.split(/[?#]/)[0];
  if(!clean)return;
  const name=path.posix.normalize(clean.startsWith('/')?clean.slice(1):path.posix.join(path.posix.dirname(base),clean));
  if(name==='.'||name==='')return;
  if(name.startsWith('../'))throw new Error('Asset escapes frontend: '+value);
  if(files.has(name)&&!copied.has(name))queue.push(name);
  else if(/\.(?:css|js|png|svg|woff2?|html)$/.test(name)&&!files.has(name))throw new Error('Missing frontend asset: '+name);
}
while(queue.length){
  const name=queue.shift();if(copied.has(name))continue;
  if(!files.has(name))throw new Error('Missing page: '+name);
  copied.add(name);
  let data=git('show',commit+':'+name);
  if(/\.(?:html|css|js)$/.test(name)){
    const original=data.toString('utf8');
    // Parse references before injecting Android-local assets.
    for(const match of original.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)){
      if(match[1].split('?')[0]!=='manifest.json')reference(match[1],name.endsWith('.js')?'index.html':name);
    }
    for(const match of original.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))reference(match[1],name);
    data=Buffer.from(adapt(name,original));
  }
  outputs.set(name,data);
}
// A fixed Android-only path, checked before replacing generated output.
if(path.resolve(out)!==path.join(repo,'android-app','www'))throw new Error('Invalid bundle destination');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
for(const [name,data] of outputs){const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);}
for(const name of ['android-platform.js','android-adapter.js','android-read-cache.js'])fs.copyFileSync(path.join(root,'android/app/src/main/assets',name),path.join(out,name));
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
fs.copyFileSync(require.resolve('html2pdf.js/dist/html2pdf.bundle.min.js'),path.join(out,'vendor/html2pdf.bundle.min.js'));
fs.copyFileSync(path.join(root,'android/app/src/main/assets/vendor/yandex-id.svg'),path.join(out,'vendor/yandex-id.svg'));
fs.copyFileSync(path.join(root,'node_modules/html2pdf.js/LICENSE'),path.join(out,'vendor/html2pdf.LICENSE'));
fs.writeFileSync(path.join(out,'bundle-info.json'),JSON.stringify({sourceCommit:commit,sourceVersion,origin:'https://localhost',files:[...copied].sort()},null,2)+'\n');
console.log('Bundled '+copied.size+' frontend files from '+commit+' for https://localhost');

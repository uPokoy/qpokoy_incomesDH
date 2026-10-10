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
  if(name==='js/app.js'){
    const pattern=/const qPokoyDevVersion='dev-\d{4}\.\d{2}\.\d{2}\.\d+';/;
    if(!pattern.test(text))throw new Error('DEV adaptation needs review');
    text=text.replace(pattern,"const qPokoyDevVersion='"+sourceVersion+"';");
  }
  if(name==='js/auth.js'){
    const needle='const url=await api.startOAuth(provider);';
    if(!text.includes(needle))throw new Error('OAuth adaptation needs review');
    text=text.replace(needle,'const url=await window.qPokoyAndroidStartOAuth(provider);');
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
for(const name of ['android-platform.js','android-adapter.js'])fs.copyFileSync(path.join(root,'android/app/src/main/assets',name),path.join(out,name));
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
fs.copyFileSync(require.resolve('html2pdf.js/dist/html2pdf.bundle.min.js'),path.join(out,'vendor/html2pdf.bundle.min.js'));
fs.copyFileSync(path.join(root,'android/app/src/main/assets/vendor/yandex-id.svg'),path.join(out,'vendor/yandex-id.svg'));
fs.copyFileSync(path.join(root,'node_modules/html2pdf.js/LICENSE'),path.join(out,'vendor/html2pdf.LICENSE'));
fs.writeFileSync(path.join(out,'bundle-info.json'),JSON.stringify({sourceCommit:commit,sourceVersion,origin:'https://localhost',files:[...copied].sort()},null,2)+'\n');
console.log('Bundled '+copied.size+' frontend files from '+commit+' for https://localhost');

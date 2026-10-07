'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const postcss=require('postcss');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
function list(folder){return fs.readdirSync(path.join(root,folder),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(path.join(folder,entry.name)):[path.join(folder,entry.name)]);}
function checkProject(){
  const js=list('js').filter(file=>file.endsWith('.js'));
  for(const file of js)new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  const css=list('css').filter(file=>file.endsWith('.css'));
  for(const file of css){
    const ast=postcss.parse(fs.readFileSync(path.join(root,file),'utf8'),{from:file});
    ast.walkAtRules('import',rule=>{
      const ref=rule.params.match(/^(?:url\(\s*)?["']([^"']+)["']/)?.[1];
      if(ref&&!/^(https?:|data:|\/\/)/.test(ref))assert.ok(fs.existsSync(path.resolve(root,path.dirname(file),ref.split(/[?#]/)[0])),file+': missing import '+ref);
    });
  }
  const html=fs.readdirSync(root).filter(file=>file.endsWith('.html'));
  for(const file of html){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const tag of ['script','style'])assert.equal((source.match(new RegExp('<'+tag+'\\b','gi'))||[]).length,(source.match(new RegExp('</'+tag+'\\s*>','gi'))||[]).length,file+': balanced '+tag);
    const dom=new JSDOM(source);const ids=new Set();
    try{
      for(const node of dom.window.document.querySelectorAll('[id]')){assert.ok(!ids.has(node.id),file+': duplicate ID '+node.id);ids.add(node.id);}
      for(const [index,node] of [...dom.window.document.querySelectorAll('script:not([src])')].entries()){
        if(!node.type||['text/javascript','application/javascript'].includes(node.type))new vm.Script(node.textContent,{filename:file+':inline-'+index});
      }
      for(const node of dom.window.document.querySelectorAll('style'))postcss.parse(node.textContent,{from:file+':style'});
      for(const node of dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"][href]')){
        const ref=node.getAttribute('src')||node.getAttribute('href');
        if(/^(https?:|data:|\/\/)/.test(ref))continue;
        assert.ok(fs.existsSync(path.resolve(root,ref.split(/[?#]/)[0])),file+': missing asset '+ref);
      }
    }finally{dom.window.close();}
  }
  return {frontendJS:js.length,css:css.length,html:html.length};
}
if(require.main===module)console.log('Project syntax/structure OK:',checkProject());
module.exports={checkProject};

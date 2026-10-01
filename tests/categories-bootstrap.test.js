'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('categories consume bootstrap rows without GET and retain explicit reload support',async()=>{
  let reads=0;
  const win={qPokoyApi:{async listCategories(){reads++;return [{id:'server',name:'Прочее'}];}}};
  const document={readyState:'complete',querySelector:()=>null,getElementById:()=>null};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/categories.js'),'utf8'),{window:win,document});
  await win.qPokoyLoadCategories({id:'user-1'},[{id:'other',name:'Подработка'},{id:'salary',name:'Зарплата'}]);
  assert.equal(reads,0);
  assert.equal(win.qPokoyGetCategories()[0].name,'Зарплата');
  await win.qPokoyLoadCategories({id:'user-1'},[]);
  assert.equal(reads,0);
  assert.equal(win.qPokoyGetCategories().length,0);
  await win.qPokoyLoadCategories({id:'user-1'});
  assert.equal(reads,1);
  assert.equal(win.qPokoyGetCategories()[0].name,'Прочее');
  await win.qPokoyLoadCategories(null);
  assert.equal(win.qPokoyGetCategories().length,0);
});

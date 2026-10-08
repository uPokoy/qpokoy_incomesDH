'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function extract(source,name){
  const match=new RegExp('function '+name+'\\([^)]*\\)\\{').exec(source);
  assert.ok(match,'missing production helper '+name);
  // Selected helper bodies contain no braces in string/regexp literals.
  let depth=1,index=match.index+match[0].length;
  for(;depth&&index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}')depth--;
  }
  assert.equal(depth,0);
  return source.slice(match.index,index);
}
const formatter=extract(read('js/app.js'),'formatMoney');
const reportMoney=extract(read('js/report-print.js'),'money');
const monthlyMoney=extract(read('js/analytics-month.js'),'money');
// Evaluate each declaration as a function expression in its own VM context.
// Equal declaration names cannot hoist over or replace another implementation.
const context={
  amount:vm.runInNewContext('('+formatter+')'),
  report:vm.runInNewContext('('+reportMoney+')')
};
context.monthly=vm.runInNewContext('('+monthlyMoney+')',{formatMoney:context.amount});

test('app amount candidate retains exact strings without DOM or app state',()=>{
  const expected=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  for(const value of [0,-0,1,-1,12.5,-12.5,1000000,1000000000,Number.MAX_SAFE_INTEGER,'1234.5','',null,undefined,NaN,Infinity,-Infinity,123n]){
    assert.equal(context.amount(value),expected.format(value)+' ₽');
  }
  assert.equal(context.amount(1000),'1\u00a0000 ₽');
  assert.equal(context.amount(NaN),'не\u00a0число ₽');
});

test('report and monthly amount candidates have equivalent coercion, output and throws',()=>{
  assert.notEqual(context.report,context.monthly);
  assert.equal(context.report.toString(),reportMoney);
  assert.equal(context.monthly.toString(),monthlyMoney);
  // Exact previous report implementation; kept as an independent equivalence oracle.
  const old=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0)+' ₽';
  const values=[undefined,null,'',' ','0','-0','1234.5','1,5','bad',NaN,0,-0,-1234.5,1.5,Infinity,-Infinity,1e9,123n,true,false,[],[25],{},new Date(0),{valueOf(){return 42;}}];
  for(const value of values){
    assert.equal(context.report(value),old(value));
    assert.equal(context.monthly(value),old(value));
  }
  for(const fn of [old,context.report,context.monthly]){
    assert.throws(()=>fn(Symbol('invalid')),e=>e.name==='TypeError');
    const error=new Error('coercion failed');
    assert.throws(()=>fn({valueOf(){throw error;}}),e=>e===error);
  }
  assert.equal(context.report(NaN),'0 ₽');
  assert.equal(context.report(-0),'0 ₽');
});

test('app and report formatting must not be merged without retaining distinct inputs',()=>{
  assert.equal(context.amount(undefined),'не\u00a0число ₽');
  assert.equal(context.report(undefined),'0 ₽');
  assert.equal(context.amount(NaN),'не\u00a0число ₽');
  assert.equal(context.report(NaN),'0 ₽');
  assert.equal(context.amount(-0),'-0 ₽');
  assert.equal(context.report(-0),'0 ₽');
  for(const [input,expected] of [[1234,'1\u00a0234 ₽'],[0,'0 ₽'],[-1234,'-1\u00a0234 ₽']]){
    assert.equal(context.amount(input),expected);
    assert.equal(context.report(input),expected);
    assert.equal(context.monthly(input),expected);
  }
  for(const input of [undefined,NaN,-0])assert.equal(context.monthly(input),'0 ₽');
  // The monthly adapter also retains its legacy standalone fallback.
  const standalone=vm.createContext({});
  vm.runInContext(monthlyMoney+'\nthis.money=money;',standalone);
  for(const value of [undefined,NaN,-0,0,'bad','1234',1e9])assert.equal(standalone.money(value),context.report(value));
});

test('odometer text parsers are pure equivalent candidates, including failure cases',()=>{
  const hero=vm.runInNewContext('('+extract(read('js/hero-overlap.js'),'parseMoney')+')');
  const notice=vm.runInNewContext('('+extract(read('js/notice.js'),'parseMoney')+')');
  assert.notEqual(hero,notice);
  for(const [input,expected] of [[undefined,0],[null,0],['',0],[0,0],[-42,-42],['1\u00a0000 ₽',1000],['1\u202f000,25 ₽',1000.25],['-0',-0],['1,2,3',null],['bad',null],[Infinity,null],[NaN,0],['2026-10-08',null]]){
    assert.equal(hero(input),expected);assert.equal(notice(input),expected);
  }
  const error=new Error('string conversion failed');
  for(const fn of [hero,notice])assert.throws(()=>fn({toString(){throw error;}}),e=>e===error);
});

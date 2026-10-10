'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),postcss=require('postcss');
const {createHarness,MOBILE}=require('./helpers/frontend-harness');
for(const width of [320,360,375,390,412,430])test(`mobile ${width}: one card and 1/3 → 2/3 → 3/3`,async t=>{
  const h=await createHarness({width,pointer:'coarse',empty:true});t.after(()=>h.close());
  for(let i=0;i<3;i++){h.add(100+i,'Mobile '+i,'Зарплата');await h.settle();
    assert.equal(h.node('incomeRecentGrid').querySelectorAll('.income-recent-card').length,1);
    assert.equal(h.node('incomeRecentPageIndicator').textContent,`1 / ${i+1}`);}
  for(let page=2;page<=3;page++){h.node('incomeRecentNext').click();assert.equal(h.node('incomeRecentPageIndicator').textContent,`${page} / 3`);}
  h.node('incomeRecentPrev').click();assert.equal(h.node('incomeRecentPageIndicator').textContent,'2 / 3');
  assert.deepEqual(h.errors,[]);
});
for(const width of [320,900,1024,1440])test(`fine pointer ${width}: desktop keeps four cards per page`,async t=>{
  const h=await createHarness({width,pointer:'fine',empty:true});t.after(()=>h.close());
  for(let i=0;i<5;i++){h.add(100+i);await h.settle();}
  assert.equal(h.node('incomeRecentGrid').querySelectorAll('.income-recent-card').length,4);
  assert.equal(h.node('incomeRecentPageIndicator').textContent,'1 / 2');
});
test('single-column override is scoped to existing coarse mobile media only',()=>{
  const root=postcss.parse(fs.readFileSync('css/mobile.css','utf8'));let rule;
  root.walkRules('#income .income-recent.qp-mobile-recent-stack .income-recent-grid',candidate=>{
    if(candidate.nodes.some(n=>n.prop==='grid-template-columns'&&n.value==='minmax(0,1fr)'))rule=candidate;
  });assert.ok(rule);assert.equal(rule.parent.name,'media');assert.equal(rule.parent.params.replaceAll(/\s/g,''),MOBILE.replaceAll(/\s/g,''));
});

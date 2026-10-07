'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHarness,MOBILE,DESKTOP}=require('./helpers/frontend-harness');
const cases=[
  {width:320,height:800,pointer:'fine',mobile:false,desktop:true},
  {width:375,height:800,pointer:'coarse',mobile:true,desktop:false},
  {width:900,height:1100,pointer:'coarse',mobile:true,desktop:false},
  {width:901,height:1300,pointer:'coarse',mobile:false,desktop:true},
  {width:1024,height:1300,pointer:'coarse',mobile:false,desktop:true},
  {width:1200,height:1300,pointer:'coarse',mobile:false,desktop:true},
  {width:1201,height:1300,pointer:'coarse',mobile:false,desktop:false},
  {width:1024,height:500,pointer:'coarse',mobile:true,desktop:true},
  {width:1440,height:500,pointer:'coarse',mobile:true,desktop:false},
  {width:1440,height:900,pointer:'fine',mobile:false,desktop:true}
];
test('HTML stylesheet gate and current JS use the same mobile condition',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
  const link=html.match(/<link[^>]+href="css\/mobile\.css[^>]+>/)[0];
  assert.ok(link.includes(`media="${MOBILE}"`));
  assert.ok(app.includes(`const historyNativeSwipeMedia=window.matchMedia('${MOBILE}')`));
  assert.ok(app.includes(`window.matchMedia('${DESKTOP}')`));
});
for(const fixture of cases)test(`responsive DOM contract ${fixture.width}x${fixture.height} ${fixture.pointer}`,async t=>{
  const h=await createHarness(fixture);t.after(()=>h.close());
  assert.equal(h.w.matchMedia(MOBILE).matches,fixture.mobile);
  assert.equal(h.w.matchMedia(DESKTOP).matches,fixture.desktop);
  assert.equal(h.node('incomeList').querySelectorAll('.history-swipe-row').length,fixture.mobile?1:0);
  assert.equal(h.node('incomeList').querySelectorAll('.history-card-surface').length,fixture.mobile?1:0);
  h.node('analyticsSettingsToggle').click();
  assert.equal(h.node('analyticsSettingsHost').hidden,!(fixture.mobile||fixture.desktop));
  assert.deepEqual(h.errors,[]);
});

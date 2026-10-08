'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('chart and analytics bar retain unconditional same-specificity overflow winners',()=>{
  const ast=postcss.parse(read('css/main.css'));
  for(const [selector,value] of [['#incomeChartSvg','visible'],['.analytics-bar','hidden']]){
    const rules=ast.nodes.filter(n=>n.type==='rule'&&n.selector===selector);
    assert.equal(rules.length,2);
    const overflow=rules.flatMap(r=>r.nodes.filter(n=>n.type==='decl'&&n.prop==='overflow'));
    assert.equal(overflow.length,1);
    assert.equal(overflow[0].parent,rules[1]);
    assert.equal(overflow[0].value,value);
    assert.equal(!!overflow[0].important,false);
    // The surviving declaration is outside media/state/layer conditions and
    // therefore applies in every state where the removed identical rule did.
    assert.equal(rules[1].parent.type,'root');
  }
});

test('scoped cascade snapshot retains geometry, visuals, states and coarse media',()=>{
  const scope=[];
  for(const file of fs.readdirSync(path.join(root,'css')).filter(f=>f.endsWith('.css')).sort()){
    postcss.parse(read('css/'+file)).walkRules(rule=>{
      if(!/#incomeChartSvg|\.analytics-bar(?:\b|\s)/.test(rule.selector))return;
      const parents=[];
      for(let n=rule.parent;n&&n.type!=='root';n=n.parent)parents.unshift([n.name,n.params]);
      scope.push([file,parents,rule.selector,rule.nodes.filter(n=>n.type==='decl').map(d=>[d.prop,d.value,!!d.important])]);
    });
  }
  // DEV369 scope with ONLY the two proven-redundant early overflow entries
  // removed. Parsed selectors/declarations/conditions, not source formatting.
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  assert.equal(fingerprint,'90d97b1ea75b1ca1809cabc5ea45611d49d49cce8f9fdc01f4f18ec8277a52d5');
});

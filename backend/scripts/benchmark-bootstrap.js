'use strict';

// Synthetic benchmark only: no network, credentials, or real user records.
// Usage: node scripts/benchmark-bootstrap.js <baseline SHA>
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { TypedValues } = require('ydb-sdk');
const { newSession } = require('../security');
const base = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(base || '')) throw new Error('Provide the full baseline commit SHA');
function baseline(file) {
  const filename = path.join(__dirname, '..', file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(execFileSync('git', ['show', base + ':backend/' + file], { encoding: 'utf8' }), filename);
  return mod.exports;
}
const versions = [
  ['before', baseline('app.js'), baseline('ydb-core.js')],
  ['after', require('../app'), require('../ydb-core')]
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rpcMs = 25, readyMs = 60;
function set(rows) {
  const typed = value => value instanceof Date ? TypedValues.timestamp(value) : TypedValues.utf8(String(value));
  const keys = Object.keys(rows[0] || {});
  return { columns: keys.map(name => ({name,type:typed(rows[0][name]).type})),
    rows: rows.map(row => ({items:keys.map(key => typed(row[key]).value)})) };
}
async function run(createApp, createYdbStore, revision) {
  const issued = newSession();
  const auth = {session_id:issued.sessionId,user_id:'synthetic',secret_hash:issued.secretHash,
    email:'synthetic@example.invalid',status:'active',created_at:new Date('2026-09-01'),
    expires_at:new Date('2026-11-01'),trial_ends_at:new Date('2026-10-15')};
  const settings = [['auth.onboarding_completed','false'],['billing.access',JSON.stringify({plan:'lifetime'})],['theme','dark']]
    .map(([setting_key,setting_value]) => ({user_id:auth.user_id,setting_key,setting_value}));
  let rpcs = 0;
  const rpc = async () => { rpcs++; await delay(rpcMs); };
  class FakeDriver {
    async ready() { await delay(readyMs); return true; }
    tableClient = {withSession:async callback => callback({
      beginTransaction:async () => { await rpc(); return {id:'synthetic-tx'}; },
      commitTransaction:rpc,rollbackTransaction:rpc,
      executeQuery:async (sql, params) => {
        await rpc();
        if (sql.includes('FROM `sessions`')) return {resultSets:[set([auth]),set([auth]),set([{setting_value:'revision-a'}])]};
        assert.equal(params.$uid.value.textValue,auth.user_id);
        if (sql.includes('FROM `incomes`')) return {resultSets:[set([]),set([]),set(settings)]};
        const key = params.$key?.value.textValue;
        return {resultSets:[set(key ? settings.filter(row => row.setting_key === key) : settings.filter(row => row.setting_key !== 'theme'))]};
      }
    })};
  }
  const app = createApp(createYdbStore({ENDPOINT:'grpcs://example.invalid:2135',DATABASE:'/synthetic'},FakeDriver),
    {now:() => new Date('2026-10-10')});
  const samples = [], counts = [];
  let payload;
  for (let i=0;i<6;i++) {
    rpcs=0;
    const started=performance.now();
    const result=await app.handle('GET','/bootstrap' + (revision ? '?revision=' + revision : ''), {}, {authorization:'Bearer ' + issued.token});
    assert.equal(result.status,200);
    samples.push(performance.now()-started);counts.push(rpcs);payload=result.body;
  }
  return {payload,cold_simulated_ms:Math.round(samples[0]),warm_mean_ms:Math.round(samples.slice(1).reduce((a,b)=>a+b,0)/5),rpcs:counts[0]};
}
(async () => {
  console.log(JSON.stringify({synthetic:true,rpc_delay_ms:rpcMs,driver_ready_delay_ms:readyMs,warm_samples:5}));
  for (const [scenario,revision] of [['first',''],['stale','stale'],['hit','revision-a']]) {
    let original;
    for (const [version,app,store] of versions) {
      const {payload,...metrics}=await run(app.createApp,store.createYdbStore,revision);
      if (original) assert.deepEqual(payload,original); else original=payload;
      console.log(JSON.stringify({scenario,version,...metrics}));
    }
  }
})().catch(error => { console.error(error);process.exitCode=1; });

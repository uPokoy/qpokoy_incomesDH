'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createYdbStore } = require('../ydb');

function fakeStore(failOn) {
  const calls = [];
  class FakeDriver {
    async ready() { return true; }
    tableClient = { withSession: async (callback) => callback({
      beginTransaction: async (settings) => { calls.push({ action: 'begin', settings }); return { id: 'tx-1' }; },
      executeQuery: async (sql, params, control) => {
        calls.push({ action: 'query', sql, params, control });
        if (failOn && sql.includes(failOn)) throw new Error('simulated write failure');
        return { resultSets: [] };
      },
      commitTransaction: async (control) => { calls.push({ action: 'commit', control }); },
      rollbackTransaction: async (control) => { calls.push({ action: 'rollback', control }); }
    }) };
  }
  return { store: createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver), calls };
}

test('replace deletes then upserts with bound parameters in one explicit transaction', async () => {
  const { store, calls } = fakeStore();
  const timestamp = new Date('2026-09-30T08:00:00.000Z');
  const row = { user_id: 'user-1', id: 'id-1', income_date: '2026-09-15', category: 'Зарплата',
    description: 'русский текст', amount: 123.45, created_at: timestamp, updated_at: timestamp };
  assert.deepEqual(await store.replaceIncomes('user-1', [row]), [row]);
  assert.deepEqual(calls.map((call) => call.action), ['begin', 'query', 'query', 'query', 'commit']);
  assert.deepEqual(calls[0].settings, { serializableReadWrite: {} });
  assert.match(calls[1].sql, /DELETE FROM `incomes` WHERE user_id=\$uid/);
  assert.match(calls[2].sql, /UPSERT INTO `incomes`/);
  assert.equal(calls[1].control.txId, 'tx-1');
  assert.equal(calls[2].control.txId, 'tx-1');
  assert.equal(calls[3].control.txId, 'tx-1');
  assert.match(calls[3].sql, /UPSERT INTO `settings`/);
  assert.equal(calls[3].params.$revisionKey.value.textValue, 'system.data_revision');
  assert.equal(calls[2].params.$description0.value.textValue, 'русский текст');
  assert.doesNotMatch(calls[2].sql, /русский текст|user-1|id-1/);
});

test('failed replace rolls back; empty replace commits scoped delete and revision together', async () => {
  const timestamp = new Date();
  const row = { user_id: 'user-1', id: 'id-1', income_date: '2026-09-15', category: 'Зарплата',
    description: '', amount: 1, created_at: timestamp, updated_at: timestamp };
  const failed = fakeStore('UPSERT INTO');
  await assert.rejects(failed.store.replaceIncomes('user-1', [row]), /simulated write failure/);
  assert.deepEqual(failed.calls.map((call) => call.action), ['begin', 'query', 'query', 'rollback']);
  const empty = fakeStore();
  assert.deepEqual(await empty.store.replaceIncomes('user-1', []), []);
  assert.deepEqual(empty.calls.map((call) => call.action), ['begin', 'query', 'query', 'commit']);
  assert.match(empty.calls[2].sql, /UPSERT INTO `settings`/);
});

test('account deletion uses the same transaction for every user-owned table', async () => {
  const { store, calls } = fakeStore();
  await store.deleteAccount('user-1');
  const queries = calls.filter((call) => call.action === 'query');
  assert.deepEqual(queries.map((call) => /DELETE FROM `([^`]+)`/.exec(call.sql)[1]),
    ['incomes', 'categories', 'settings', 'sessions', 'password_reset_tokens', 'auth_identities', 'users']);
  assert.ok(queries.every((call) => call.sql.includes('WHERE user_id=$uid') && call.control.txId === 'tx-1'));
  assert.equal(calls.at(-1).action, 'commit');
  const failed = fakeStore('`sessions`');
  await assert.rejects(failed.store.deleteAccount('user-1'), /simulated write failure/);
  assert.equal(failed.calls.at(-1).action, 'rollback');
  assert.ok(!failed.calls.some((call) => call.action === 'commit'));
});

test('DELETE /incomes runs one scoped auto-commit query', async () => {
  const { store, calls } = fakeStore();
  await store.deleteAllIncomes('user-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /DELETE FROM `incomes` WHERE user_id=\$uid/);
  assert.equal(calls[0].params.$uid.value.textValue, 'user-1');
  assert.match(calls[0].sql, /UPSERT INTO `settings`/);
  assert.equal(calls[0].params.$revisionKey.value.textValue, 'system.data_revision');
});

test('replace revision failure rolls back the entire income replacement', async () => {
  const failed = fakeStore('$revisionKey');
  await assert.rejects(failed.store.replaceIncomes('user-1', []), /simulated write failure/);
  assert.equal(failed.calls.at(-1).action, 'rollback');
  assert.ok(!failed.calls.some(call => call.action === 'commit'));
});

test('admin billing change and audit commit together with bound parameters, reset rolls back on audit failure',async()=>{
  const when=new Date('2026-10-03T12:00:00Z');
  const change={targetId:'target',settingKey:'billing.admin_override',value:{plan:'lifetime'},timestamp:when,
    audit:{user_id:'system.admin_audit',setting_key:'billing.admin_audit.test',setting_value:'{"action":"lifetime"}',updated_at:when}};
  const h=fakeStore();await h.store.applyAdminBillingChange(change);
  assert.deepEqual(h.calls.map(x=>x.action),['begin','query','query','commit']);assert.ok(h.calls.filter(x=>x.action==='query').every(x=>x.control.txId==='tx-1'));
  assert.equal(h.calls[1].params.$uid.value.textValue,'target');assert.equal(h.calls[2].params.$actor.value.textValue,'system.admin_audit');assert.doesNotMatch(h.calls[1].sql,/lifetime|target/);
  const failed=fakeStore('INSERT INTO');await assert.rejects(failed.store.applyAdminBillingChange({...change,value:null}));assert.equal(failed.calls.at(-1).action,'rollback');assert.ok(!failed.calls.some(x=>x.action==='commit'));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTO_TX, TypedValues } = require('ydb-sdk');
const { createYdbStore } = require('../ydb');

function harness({ existing = false, failRevision = false, resourceOnce = false } = {}) {
  const calls = [];
  const commits = [];
  class FakeDriver {
    async ready() { return true; }
    tableClient = { withSession: async callback => callback({
      executeQuery: async (sql, params, control = AUTO_TX) => {
        calls.push({ sql, params, control });
        if (/SELECT .*FROM `incomes`/s.test(sql)) {
          const id = TypedValues.utf8('id-1');
          return { resultSets: [{ columns: [{ name: 'id', type: id.type }],
            rows: existing ? [{ items: [id.value] }] : [] }] };
        }
        if (/INSERT|UPDATE|DELETE|UPSERT/.test(sql)) {
          if (resourceOnce && params.$revision) {
            resourceOnce = false;
            throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
          }
          // Model the AUTO_TX commit boundary, including injected revision failure.
          if (failRevision && params.$revision) throw new Error('revision write failed');
          commits.push({ sql, revision: params.$revision?.value.textValue });
        }
        return { resultSets: [] };
      }
    }) };
  }
  return { store: createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver), calls, commits };
}
const timestamp = new Date('2026-10-01T12:00:00Z');
const row = { user_id: 'user-1', id: 'id-1', income_date: '2026-09-15', category: 'Зарплата',
  description: 'Test', amount: 123, created_at: timestamp, updated_at: timestamp };
const mutations = [
  ['add income', false, store => store.addIncome(row), /INSERT INTO `incomes`/],
  ['update income', true, store => store.updateIncome(row.user_id, row.id, row, timestamp), /UPDATE `incomes`/],
  ['delete income', true, store => store.deleteIncome(row.user_id, row.id), /DELETE FROM `incomes`/],
  ['delete all', false, store => store.deleteAllIncomes(row.user_id), /DELETE FROM `incomes`/],
  ['add category', false, store => store.addCategory({ user_id: row.user_id, id: 'cat-1', name: 'Test', created_at: timestamp }), /INSERT INTO `categories`/],
  ['delete category', false, store => store.deleteCategory(row.user_id, 'cat-1'), /DELETE FROM `categories`/],
  ['user setting', false, store => store.putSetting({ user_id: row.user_id, setting_key: 'theme', setting_value: 'dark', updated_at: timestamp }), /UPSERT INTO `settings`/]
];
for (const [name, existing, mutate, pattern] of mutations) {
  test(name + ' commits data and revision in one serializable AUTO_TX query', async () => {
    const h = harness({ existing });
    await mutate(h.store);
    assert.equal(h.commits.length, 1);
    const write = h.calls.find(call => call.params.$revision);
    assert.match(write.sql, pattern);
    assert.match(write.sql, /UPSERT INTO `settings`/);
    assert.equal(write.params.$uid.value.textValue, row.user_id);
    assert.equal(write.params.$revisionKey.value.textValue, 'system.data_revision');
    assert.match(write.params.$revision.value.textValue, /^[0-9a-f-]{36}$/);
    assert.deepEqual(write.control, { beginTx: { serializableReadWrite: {} }, commitTx: true });
    const failed = harness({ existing, failRevision: true });
    await assert.rejects(mutate(failed.store), /revision write failed/);
    assert.equal(failed.commits.length, 0);
  });
}

test('internal auth/system/rate settings do not write revision; normal settings do', async () => {
  const h = harness();
  for (const setting_key of ['auth.oauth_ticket', 'auth.email_verification', 'system.internal', 'rate.bucket']) {
    await h.store.putSetting({ user_id: row.user_id, setting_key, setting_value: '{}', updated_at: timestamp });
    await h.store.deleteSetting(row.user_id, setting_key);
  }
  assert.ok(h.calls.every(call => !call.params.$revision));
  await h.store.putSetting({ user_id: row.user_id, setting_key: 'theme', setting_value: 'dark', updated_at: timestamp });
  const first = h.calls.at(-1).params.$revision.value.textValue;
  await h.store.putSetting({ user_id: row.user_id, setting_key: 'theme', setting_value: 'light', updated_at: timestamp });
  assert.notEqual(h.calls.at(-1).params.$revision.value.textValue, first);
});

test('duplicate insert and missing update/delete never bump revision', async () => {
  const duplicate = harness({ existing: true });
  assert.equal(await duplicate.store.addIncome(row), false);
  assert.equal(duplicate.commits.length, 0);
  const missing = harness();
  assert.equal(await missing.store.updateIncome(row.user_id, row.id, row, timestamp), false);
  assert.equal(await missing.store.deleteIncome(row.user_id, row.id), false);
  assert.equal(missing.commits.length, 0);
});

test('RESOURCE_EXHAUSTED write retry generates a fresh revision for each attempt', async () => {
  const h = harness({ resourceOnce: true });
  await h.store.deleteAllIncomes(row.user_id);
  assert.equal(h.calls.length, 2);
  assert.notEqual(h.calls[0].params.$revision.value.textValue, h.calls[1].params.$revision.value.textValue);
  assert.equal(h.commits.length, 1);
});

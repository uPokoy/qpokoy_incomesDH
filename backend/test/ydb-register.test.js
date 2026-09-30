'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createYdbStore } = require('../ydb');

test('registration writes identity, user and all defaults in one auto-commit YDB query', async () => {
  const calls = [];
  class FakeDriver {
    async ready() { return true; }
    tableClient = {
      withSession: async (fn) => fn({ executeQuery: async (sql, params) => {
        calls.push({ sql, params });
        return { resultSets: [] };
      } })
    };
  }
  const store = createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver);
  const created = new Date('2026-09-30T08:00:00.000Z');
  const user = { user_id: 'user-1', email: 'a@example.com', status: 'active',
    created_at: created, updated_at: created, trial_ends_at: new Date(created.getTime() + 14 * 86400000) };
  const defaults = ['Зарплата', 'Подработка', 'Прочее'].map((name, i) =>
    ({ user_id: user.user_id, id: `category-${i}`, name, created_at: created }));

  assert.equal(await store.register(user, 'hashed-password', defaults), true);
  assert.equal(calls.length, 2); // Identity lookup, then a single atomic DML query.
  const { sql, params } = calls[1];
  assert.equal((sql.match(/INSERT INTO/g) || []).length, 3);
  assert.match(sql, /INSERT INTO `auth_identities`/);
  assert.match(sql, /INSERT INTO `users`/);
  assert.match(sql, /INSERT INTO `categories`/);
  assert.deepEqual([params.$name0.value.textValue, params.$name1.value.textValue, params.$name2.value.textValue],
    ['Зарплата', 'Подработка', 'Прочее']);
});

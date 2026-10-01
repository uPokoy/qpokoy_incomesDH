'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TypedValues } = require('ydb-sdk');
const { createYdbStore } = require('../ydb');

function resultSet(rows) {
  const typed = (value) => value instanceof Date ? TypedValues.timestamp(value)
    : typeof value === 'number' ? TypedValues.double(value) : TypedValues.utf8(value);
  const keys = Object.keys(rows[0] || {});
  return { columns: keys.map(name => ({ name, type: typed(rows[0][name]).type })),
    rows: rows.map(row => ({ items: keys.map(key => typed(row[key]).value) })) };
}
function harness({ failOnce = false } = {}) {
  const calls = [];
  let sessions = 0;
  const auth = { session_id: 'session-1', user_id: 'user-1', secret_hash: 'hash',
    email: 'test@example.com', status: 'active', created_at: new Date('2026-09-01'),
    expires_at: new Date('2026-11-01'), trial_ends_at: new Date('2026-09-15') };
  const incomes = [{ user_id: 'user-1', id: 'income-1', amount: 123, description: 'Доход' }];
  const categories = [{ user_id: 'user-1', id: 'category-1', name: 'Зарплата' }];
  const settings = [{ user_id: 'user-1', setting_key: 'theme', setting_value: 'dark' }];
  class FakeDriver {
    async ready() { return true; }
    tableClient = { withSession: async callback => {
      sessions++;
      return callback({ executeQuery: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('INNER JOIN')) return { resultSets: [resultSet([auth])] };
        if (failOnce) { failOnce = false; throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 }); }
        return { resultSets: [resultSet(incomes), resultSet(categories), resultSet(settings)] };
      } });
    } };
  }
  return { store: createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver),
    calls, get sessions() { return sessions; } };
}

test('bootstrap uses two parameterized queries in one YDB session', async () => {
  const h = harness();
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', ({ session, user }) => {
    validated++;
    assert.equal(h.calls.length, 1); // No user data read before bearer validation.
    assert.equal(session.secret_hash, 'hash');
    assert.equal(user.user_id, 'user-1');
  });
  assert.equal(validated, 1);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].params.$id.value.textValue, 'session-1');
  assert.match(h.calls[0].sql, /FROM `sessions` WHERE session_id=\$id\) AS s/);
  assert.equal(h.calls[1].params.$uid.value.textValue, 'user-1');
  assert.equal((h.calls[1].sql.match(/WHERE user_id=\$uid/g) || []).length, 3);
  assert.equal((h.calls[1].sql.match(/SELECT /g) || []).length, 3);
  assert.equal(result.incomes[0].description, 'Доход');
  assert.equal(result.categories[0].name, 'Зарплата');
  assert.equal(result.settings[0].setting_value, 'dark');
});

test('failed validation stops bootstrap before the data query', async () => {
  const h = harness();
  await assert.rejects(h.store.loadBootstrap('session-1', () => { throw new Error('Invalid session'); }), /Invalid session/);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 1);
});

test('bootstrap retains RESOURCE_EXHAUSTED retry and revalidates before reading', async () => {
  const h = harness({ failOnce: true });
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', () => { validated++; });
  assert.equal(h.sessions, 2);
  assert.equal(h.calls.length, 4);
  assert.equal(validated, 2);
  assert.equal(result.incomes.length, 1);
});

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
function harness({ failOnce = false, revision = 'revision-a' } = {}) {
  const calls = [];
  let sessions = 0;
  const actions = [];
  const auth = { session_id: 'session-1', user_id: 'user-1', secret_hash: 'hash',
    email: 'test@example.com', status: 'active', created_at: new Date('2026-09-01'),
    expires_at: new Date('2026-11-01'), trial_ends_at: new Date('2026-09-15'),
    ...(revision ? { data_revision: revision } : {}) };
  const incomes = [{ user_id: 'user-1', id: 'income-1', amount: 123, description: 'Доход' }];
  const categories = [{ user_id: 'user-1', id: 'category-1', name: 'Зарплата' }];
  const settings = [{ user_id: 'user-1', setting_key: 'theme', setting_value: 'dark' }];
  class FakeDriver {
    async ready() { return true; }
    tableClient = { withSession: async callback => {
      sessions++;
      return callback({
        beginTransaction: async () => { actions.push('begin'); return { id: 'tx-' + sessions }; },
        commitTransaction: async () => { actions.push('commit'); },
        rollbackTransaction: async () => { actions.push('rollback'); },
        executeQuery: async (sql, params, control) => {
        calls.push({ sql, params, control });
        if (sql.includes('INNER JOIN')) return { resultSets: [resultSet([auth])] };
        if (failOnce) { failOnce = false; throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 }); }
        return { resultSets: [resultSet(incomes), resultSet(categories), resultSet(settings)] };
      } });
    } };
  }
  return { store: createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver),
    calls, actions, get sessions() { return sessions; } };
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
  assert.equal(result.revision, 'revision-a');
  assert.equal(result.not_modified, false);
  assert.deepEqual(h.actions, ['begin', 'commit']);
  assert.equal(h.calls[0].control.txId, h.calls[1].control.txId);
});

test('failed validation stops bootstrap before the data query', async () => {
  const h = harness();
  await assert.rejects(h.store.loadBootstrap('session-1', () => { throw new Error('Invalid session'); }), /Invalid session/);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.actions, ['begin', 'rollback']);
});

test('bootstrap retains RESOURCE_EXHAUSTED retry and revalidates before reading', async () => {
  const h = harness({ failOnce: true });
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', () => { validated++; });
  assert.equal(h.sessions, 2);
  assert.equal(h.calls.length, 4);
  assert.equal(validated, 2);
  assert.equal(result.incomes.length, 1);
  assert.deepEqual(h.actions, ['begin', 'rollback', 'begin', 'commit']);
});

test('cache hit has one session/query, validates bearer, and reads no data tables', async () => {
  const h = harness();
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', () => { validated++; }, 'revision-a');
  assert.equal(validated, 1);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].sql, /`incomes`|`categories`/);
  assert.match(h.calls[0].sql, /r.setting_key=s.revision_key/);
  assert.equal(h.calls[0].params.$revisionKey.value.textValue, 'system.data_revision');
  assert.equal(result.not_modified, true);
  assert.equal(result.incomes, undefined);
});

test('stale revision returns full data; legacy initialization shares the snapshot transaction', async () => {
  const stale = harness();
  assert.equal((await stale.store.loadBootstrap('session-1', () => {}, 'revision-old')).not_modified, false);
  assert.equal(stale.calls.length, 2);
  const legacy = harness({ revision: null });
  const result = await legacy.store.loadBootstrap('session-1', () => {});
  assert.equal(legacy.calls.length, 2);
  assert.match(legacy.calls[1].sql, /UPSERT INTO `settings`/);
  assert.equal(legacy.calls[1].params.$revision.value.textValue, result.revision);
  assert.equal(legacy.calls[0].control.txId, legacy.calls[1].control.txId);
});

test('forged bearer cannot take the cache-hit shortcut', async () => {
  const h = harness();
  await assert.rejects(h.store.loadBootstrap('session-1', () => { throw new Error('forged'); }, 'revision-a'), /forged/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.actions, ['begin', 'rollback']);
});

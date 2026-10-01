'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTO_TX, TableSession, TypedValues, Ydb } = require('ydb-sdk');
const { createYdbStore } = require('../ydb');
const { createApp } = require('../app');
const { newSession } = require('../security');

function resultSet(rows) {
  const typed = (value) => value instanceof Date ? TypedValues.timestamp(value)
    : typeof value === 'number' ? TypedValues.double(value) : TypedValues.utf8(value);
  const keys = Object.keys(rows[0] || {});
  return { columns: keys.map(name => ({ name, type: typed(rows[0][name]).type })),
    rows: rows.map(row => ({ items: keys.map(key => typed(row[key]).value) })) };
}
function harness({ failAt, revision = 'revision-a', uid = 'user-1', onBegin, authOverride = {}, absentSession = false } = {}) {
  const calls = [], actions = [], events = [];
  let sessions = 0;
  const auth = { session_id: 'session-1', user_id: uid, secret_hash: 'hash',
    email: 'test@example.com', status: 'active', created_at: new Date('2026-09-01'),
    expires_at: new Date('2026-11-01'), trial_ends_at: new Date('2026-09-15'), ...authOverride };
  const state = { revision, auth, amount: 123 };
  let snapshot;
  class FakeDriver {
    async ready() { return true; }
    tableClient = { withSession: async callback => {
      sessions++;
      return callback({
        beginTransaction: async () => {
          actions.push('begin'); events.push('begin');
          if (onBegin) onBegin(state);
          snapshot = structuredClone(state);
          return { id: 'tx-' + sessions };
        },
        commitTransaction: async () => { actions.push('commit'); events.push('commit'); },
        rollbackTransaction: async () => { actions.push('rollback'); events.push('rollback'); },
        executeQuery: async (sql, params, control = AUTO_TX) => {
          calls.push({ sql, params, control });
          const isAuth = sql.includes('FROM `sessions`');
          events.push(isAuth ? 'auth' : 'bundle');
          if (failAt === (isAuth ? 'auth' : 'bundle')) {
            failAt = null;
            throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
          }
          const current = control.txId ? snapshot : state;
          if (isAuth) {
            assert.equal(params.$id.value.textValue, current.auth.session_id);
            return { resultSets: [resultSet(absentSession ? [] : [current.auth]),
              resultSet(absentSession ? [] : [current.auth]),
              resultSet(current.revision ? [{ setting_value: current.revision }] : [])] };
          }
          assert.equal(params.$uid.value.textValue, current.auth.user_id);
          return { resultSets: [resultSet([{ user_id: uid, id: 'income-1', amount: current.amount, description: 'Доход' }]),
            resultSet([{ user_id: uid, id: 'category-1', name: 'Зарплата' }]),
            resultSet([{ user_id: uid, setting_key: 'theme', setting_value: 'dark' }])] };
        }
      });
    } };
  }
  return { store: createYdbStore({ ENDPOINT: 'grpcs://example.invalid:2135', DATABASE: '/test' }, FakeDriver),
    calls, actions, events, state, get sessions() { return sessions; } };
}

test('cache hit: one session/query, zero explicit transaction RPCs and no full data reads', async () => {
  const h = harness();
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', ({ session, user }) => {
    validated++;
    assert.equal(session.secret_hash, 'hash');
    assert.equal(user.user_id, 'user-1');
  }, 'revision-a');
  assert.equal(validated, 1);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.actions, []);
  assert.deepEqual(h.calls[0].control, AUTO_TX);
  assert.doesNotMatch(h.calls[0].sql, /JOIN|`incomes`|`categories`/);
  assert.match(h.calls[0].sql, /FROM `sessions` WHERE session_id=\$id/);
  assert.match(h.calls[0].sql, /FROM `users` WHERE user_id=\$uid/);
  assert.match(h.calls[0].sql, /FROM `settings` WHERE user_id=\$uid AND setting_key=\$revisionKey/);
  assert.equal((h.calls[0].sql.match(/FROM `settings`/g) || []).length, 1);
  assert.equal(h.calls[0].params.$revisionKey.value.textValue, 'system.data_revision');
  assert.equal(result.not_modified, true);
  assert.equal(result.incomes, undefined);
  assert.equal(result.categories, undefined);
  assert.equal(result.settings, undefined);
});

test('cache miss: one session, three queries, auth repeated inside bundle transaction', async () => {
  const h = harness();
  let validated = 0;
  const result = await h.store.loadBootstrap('session-1', () => {
    validated++;
    assert.ok(h.calls.every(call => !call.sql.includes('FROM `incomes`')));
  }, 'stale');
  assert.equal(validated, 2);
  assert.equal(h.sessions, 1);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.events, ['auth', 'begin', 'auth', 'bundle', 'commit']);
  assert.deepEqual(h.calls[0].control, AUTO_TX);
  assert.equal(h.calls[1].control.txId, h.calls[2].control.txId);
  assert.equal(h.calls[2].params.$uid.value.textValue, 'user-1');
  assert.equal((h.calls[2].sql.match(/WHERE user_id=\$uid/g) || []).length, 3);
  assert.equal(result.incomes[0].description, 'Доход');
  assert.equal(result.categories[0].name, 'Зарплата');
  assert.equal(result.settings[0].setting_value, 'dark');
  assert.equal(result.revision, 'revision-a');
  assert.equal(result.not_modified, false);
});

test('concurrent mutation between preflight and transaction returns the new revision and bundle together', async () => {
  const h = harness({ onBegin: state => { state.revision = 'revision-b'; state.amount = 456; } });
  const result = await h.store.loadBootstrap('session-1', () => {}, 'stale');
  assert.equal(result.revision, 'revision-b');
  assert.equal(result.incomes[0].amount, 456);
  assert.doesNotMatch(h.calls[2].sql, /UPSERT/);
});

test('legacy revision initializes inside snapshot; a concurrently created revision is not overwritten', async () => {
  const h = harness({ revision: null });
  const result = await h.store.loadBootstrap('session-1', () => {});
  assert.match(h.calls[2].sql, /UPSERT INTO `settings`/);
  assert.equal(h.calls[2].params.$revision.value.textValue, result.revision);
  assert.equal(h.calls[1].control.txId, h.calls[2].control.txId);
  const raced = harness({ revision: null, onBegin: state => { state.revision = 'revision-b'; } });
  assert.equal((await raced.store.loadBootstrap('session-1', () => {})).revision, 'revision-b');
  assert.doesNotMatch(raced.calls[2].sql, /UPSERT/);
});

test('failed preflight validates before opening a transaction or reading the bundle', async () => {
  const h = harness();
  await assert.rejects(h.store.loadBootstrap('session-1', () => { throw new Error('forged'); }, 'revision-a'), /forged/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.actions, []);
});

test('auth revoked after preflight rolls back without a bundle read', async () => {
  const h = harness({ onBegin: state => { state.auth.revoked_at = new Date(); } });
  await assert.rejects(h.store.loadBootstrap('session-1', ({ session }) => {
    if (session.revoked_at) throw new Error('revoked');
  }), /revoked/);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.actions, ['begin', 'rollback']);
});

for (const failAt of ['auth', 'bundle']) {
  test('RESOURCE_EXHAUSTED at ' + failAt + ' retries the whole operation and revalidates', async () => {
    const h = harness({ failAt });
    let validated = 0;
    const result = await h.store.loadBootstrap('session-1', () => { validated++; });
    assert.equal(h.sessions, 2);
    assert.equal(result.incomes.length, 1);
    assert.equal(validated, failAt === 'auth' ? 2 : 4);
    assert.deepEqual(h.actions, failAt === 'auth' ? ['begin', 'commit'] : ['begin', 'rollback', 'begin', 'commit']);
  });
}

test('each user gets only their scoped bundle regardless of the supplied revision', async () => {
  for (const uid of ['alice', 'bob']) {
    const h = harness({ uid });
    const result = await h.store.loadBootstrap('session-1', () => {}, 'other-user-revision');
    assert.equal(result.user.user_id, uid);
    for (const rows of [result.incomes, result.categories, result.settings]) assert.ok(rows.every(row => row.user_id === uid));
    assert.equal(h.calls[2].params.$uid.value.textValue, uid);
  }
});

for (const kind of ['invalid secret', 'expired', 'revoked', 'inactive', 'absent']) {
  test(kind + ' session returns 401 through the YDB bootstrap path before bundle reads', async () => {
    const issued = newSession();
    const now = new Date('2026-10-01T12:00:00Z');
    const authOverride = { session_id: issued.sessionId, secret_hash: issued.secretHash };
    if (kind === 'invalid secret') authOverride.secret_hash = '0'.repeat(64);
    if (kind === 'expired') authOverride.expires_at = new Date(now.getTime() - 1);
    if (kind === 'revoked') authOverride.revoked_at = now;
    if (kind === 'inactive') authOverride.status = 'pending_email';
    const h = harness({ authOverride, absentSession: kind === 'absent' });
    const app = createApp(h.store, { now: () => now });
    const response = await app.handle('GET', '/bootstrap?revision=revision-a', {}, { authorization: 'Bearer ' + issued.token });
    assert.equal(response.status, 401);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.actions, []);
  });
}

test('installed SDK encodes the cache-hit AUTO_TX into ExecuteDataQuery without begin/commit RPCs', async () => {
  const requests = [];
  const sdkSession = new TableSession({ executeDataQuery: async request => {
    requests.push(request);
    return { operation: { status: Ydb.StatusIds.StatusCode.SUCCESS,
      result: { value: Ydb.Table.ExecuteQueryResult.encode({ resultSets: [] }).finish() } } };
  } }, {}, 'sdk-session', { trace() {} }, () => null);
  await sdkSession.executeQuery('SELECT 1;');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].txControl, { beginTx: { serializableReadWrite: {} }, commitTx: true });
});

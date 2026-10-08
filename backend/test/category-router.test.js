'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCategoryRouter } = require('../category-router');
const { createApp } = require('../app');
const { newSession } = require('../security');
const uid = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const when = new Date('2026-10-08T00:00:00Z');
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function dependencies(config = {}) {
  const calls = [];
  const track = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    if (config.fail === name) throw config.error;
    return result;
  };
  const deps = {
    store: {
      listCategories: track('list', [{ user_id: uid, id, name: 'Прочее' }]),
      addCategory: track('add', !config.duplicate),
      getCategory: track('get', config.missing ? null : { user_id: uid, id, name: config.name || 'Прочее' }),
      deleteCategory: track('delete', true)
    },
    requireWriteAccess: track('writeAccess', true),
    requiredString(value, field, max) {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, 'bad_request', `Invalid ${field}`);
      return value.trim();
    },
    uuidValue(value) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) throw new HttpError(400, 'bad_request', 'Invalid id');
      return value;
    },
    randomUUID() { calls.push(['uuid']); return id; },
    now() { calls.push(['now']); return when; },
    HttpError,
    response: (status, body, headers = {}) => ({ status, body, headers })
  };
  return { deps, calls };
}
// Compile the pre-refactor block independently, not the new router twice.
const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/stage8-category-baseline.txt'), 'utf8');
const oldFactory = new Function('deps', `const {store,requireWriteAccess,requiredString,uuidValue,randomUUID,now,HttpError,response}=deps;
  return {handle:async function(method,pathname,body,user){const userId=user.user_id;
  ${baseline}
  return null;}};`);
async function capture(router, args) {
  try { return { result: await router.handle(...args) }; }
  catch (error) { return { error: { status: error.status, code: error.code, message: error.message, name: error.name } }; }
}

test('category routes match the independent DEV370 block: exact results and ordered dependency calls', async () => {
  const scenarios = [
    ['GET', '/categories', {}, {}, 200],
    ['POST', '/categories', { name: '  Тест   категория  ' }, {}, 201],
    ['POST', '/categories', { name: 'Тест' }, { duplicate: true }, 409],
    ['POST', '/categories', { name: '' }, {}, 400],
    ['POST', '/categories', { name: 'x'.repeat(81) }, {}, 400],
    ['POST', '/categories', null, {}, undefined],
    ['DELETE', '/categories/' + id, {}, {}, 204],
    ['DELETE', '/categories/' + id, {}, { missing: true }, 404],
    ['DELETE', '/categories/' + id, {}, { name: 'ЗАРПЛАТА' }, 403],
    ['DELETE', '/categories/invalid', {}, {}, 400],
    ['PATCH', '/categories/' + id, {}, {}, null],
    ['GET', '/settings', {}, {}, null],
    ['DELETE', '/categories/' + id + '/extra', {}, {}, null]
  ];
  for (const [method, pathname, body, config, status] of scenarios) {
    const old = dependencies(config), next = dependencies(config);
    const args = [method, pathname, body, { user_id: uid }];
    const expected = await capture(oldFactory(old.deps), args);
    const actual = await capture(createCategoryRouter(next.deps), args);
    assert.deepEqual(actual, expected, method + ' ' + pathname);
    assert.deepEqual(next.calls, old.calls);
    if (status === null) assert.equal(actual.result, null);
    else assert.equal(actual.result?.status ?? actual.error?.status, status);
  }
  const { deps, calls } = dependencies();
  await createCategoryRouter(deps).handle('POST', '/categories', { name: '  Тест   категория ' }, { user_id: uid });
  assert.deepEqual(calls, [['writeAccess', { user_id: uid }], ['uuid'], ['now'],
    ['add', { user_id: uid, id, name: 'Тест категория', created_at: when }], ['get', uid, id]]);
});

test('category router preserves thrown error identity and stops subsequent side effects', async () => {
  for (const [fail, method] of [['writeAccess', 'POST'], ['add', 'POST'], ['get', 'POST'], ['get', 'DELETE'], ['delete', 'DELETE'], ['list', 'GET']]) {
    const error = new Error('store failure');
    const previous = dependencies({ fail, error }), next = dependencies({ fail, error });
    const args = [method, method === 'DELETE' ? '/categories/' + id : '/categories', { name: 'Тест' }, { user_id: uid }];
    await assert.rejects(oldFactory(previous.deps).handle(...args), e => e === error);
    await assert.rejects(createCategoryRouter(next.deps).handle(...args), e => e === error);
    assert.deepEqual(next.calls, previous.calls);
  }
});

function application(config = {}) {
  const { deps, calls } = dependencies(config);
  const session = newSession();
  const user = { user_id: uid, status: 'active', trial_ends_at: config.expired ? '2020-01-01' : '2030-01-01' };
  const store = { ...deps.store,
    getSession: async () => ({ session_id: session.sessionId, user_id: uid, secret_hash: session.secretHash, expires_at: '2030-01-01' }),
    getUser: async () => user,
    getSetting: async () => null,
    listSettings: async () => []
  };
  const errors = [];
  return { app: createApp(store, { now: () => when, onError: e => errors.push(e) }),
    headers: { Authorization: 'Bearer ' + session.token }, calls, errors };
}
test('app retains authentication, subscription errors and internal-error serialization', async () => {
  const signedOut = application();
  assert.deepEqual(await signedOut.app.handle('GET', '/categories'), {
    status: 401, body: { error: { code: 'unauthorized', message: 'Authentication required' } }, headers: {}
  });
  assert.deepEqual(signedOut.calls, []);
  const invalid = application();
  for (const body of [{ name: '' }, { name: 123 }]) {
    assert.deepEqual(await invalid.app.handle('POST', '/categories', body, invalid.headers), {
      status: 400, body: { error: { code: 'bad_request', message: 'Invalid name' } }, headers: {}
    });
  }
  assert.deepEqual(await invalid.app.handle('POST', '/categories', null, invalid.headers), {
    status: 400, body: { error: { code: 'bad_request', message: 'Expected JSON object' } }, headers: {}
  });
  assert.deepEqual(invalid.calls, []);
  const expired = application({ expired: true });
  const blocked = await expired.app.handle('POST', '/categories', { name: 'Тест' }, expired.headers);
  assert.equal(blocked.status, 402); assert.equal(blocked.body.error.code, 'subscription_required');
  assert.deepEqual(expired.calls, []);
  assert.equal((await expired.app.handle('GET', '/categories', {}, expired.headers)).status, 200);
  const error = new Error('database error');
  const broken = application({ fail: 'list', error });
  assert.deepEqual(await broken.app.handle('GET', '/categories', {}, broken.headers), {
    status: 500, body: { error: { code: 'internal_error', message: 'Internal server error' } }, headers: {}
  });
  assert.deepEqual(broken.errors, [error]);
});
test('app normalizes category paths and keeps unrelated/admin routes and unsupported methods in their old dispatch positions', async () => {
  const { app, headers, calls } = application();
  assert.equal((await app.handle('GET', '/categories/?ignored=1', {}, headers)).status, 200);
  assert.deepEqual(calls, [['list', uid]]);
  calls.length = 0;
  assert.deepEqual(await app.handle('GET', '/settings', {}, headers), { status: 200, body: { data: [] }, headers: {} });
  assert.equal((await app.handle('GET', '/admin/categories', {}, headers)).status, 403);
  assert.deepEqual(await app.handle('PUT', '/categories/' + id, {}, headers), {
    status: 404, body: { error: { code: 'not_found', message: 'Route not found' } }, headers: {}
  });
  assert.deepEqual(calls, []);
});
test('app category deletion stays user-scoped and protects salary before writes', async () => {
  const protectedUser = application({ name: 'Зарплата' });
  const result = await protectedUser.app.handle('DELETE', '/categories/' + id, {}, protectedUser.headers);
  assert.deepEqual(result, { status: 403, body: { error: { code: 'protected_category', message: 'Salary category cannot be deleted' } }, headers: {} });
  assert.deepEqual(protectedUser.calls, [['get', uid, id]]);
  const other = application({ missing: true });
  assert.deepEqual(await other.app.handle('DELETE', '/categories/' + id, {}, other.headers), {
    status: 404, body: { error: { code: 'not_found', message: 'Category not found' } }, headers: {}
  });
  assert.deepEqual(other.calls, [['get', uid, id]]);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

function memoryStore() {
  const users = new Map();
  const identities = new Map();
  const sessions = new Map();
  const incomes = new Map();
  const categories = new Map();
  const settings = new Map();
  const owned = (map, uid) => [...map.values()].filter((row) => row.user_id === uid);
  const key = (uid, id) => `${uid}:${id}`;
  return {
    health: async () => {},
    register: async (user, hash) => {
      if (identities.has(user.email)) return false;
      users.set(user.user_id, user);
      identities.set(user.email, { user_id: user.user_id, password_hash: hash });
      return true;
    },
    getIdentity: async (_provider, email) => identities.get(email),
    getUser: async (id) => users.get(id),
    addSession: async (row) => { sessions.set(row.session_id, row); },
    getSession: async (id) => sessions.get(id),
    revokeSession: async (id, when) => { sessions.get(id).revoked_at = when; },
    listIncomes: async (uid) => owned(incomes, uid),
    getIncome: async (uid, id) => incomes.get(key(uid, id)),
    addIncome: async (row) => {
      const k = key(row.user_id, row.id);
      if (incomes.has(k)) return false;
      incomes.set(k, row); return true;
    },
    updateIncome: async (uid, id, value, updated_at) => {
      const row = incomes.get(key(uid, id));
      if (!row) return false;
      Object.assign(row, value, { updated_at }); return true;
    },
    deleteIncome: async (uid, id) => incomes.delete(key(uid, id)),
    listCategories: async (uid) => owned(categories, uid),
    getCategory: async (uid, id) => categories.get(key(uid, id)),
    addCategory: async (row) => {
      if (owned(categories, row.user_id).some((x) => x.name.toLowerCase() === row.name.toLowerCase())) return false;
      categories.set(key(row.user_id, row.id), row); return true;
    },
    deleteCategory: async (uid, id) => categories.delete(key(uid, id)),
    listSettings: async (uid) => owned(settings, uid),
    putSetting: async (row) => { settings.set(key(row.user_id, row.setting_key), row); }
  };
}

const make = () => createApp(memoryStore());
const register = (app, email) => app.handle('POST', '/auth/register', { email, password: 'very-secret-password' });
const auth = (token) => ({ authorization: `Bearer ${token}` });

test('health, register, login, me, logout and old-token rejection', async () => {
  const app = make();
  assert.equal((await app.handle('GET', '/health')).status, 200);
  const registered = await register(app, 'A@example.com');
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, 'a@example.com');
  assert.equal((await register(app, 'a@example.com')).status, 409);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'a@example.com', password: 'wrong-password' })).status, 401);
  const login = await app.handle('POST', '/auth/login', { email: 'A@example.com', password: 'very-secret-password' });
  assert.equal(login.status, 200);
  assert.notEqual(login.body.token, registered.body.token);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(login.body.token))).body.user.email, 'a@example.com');
  assert.equal((await app.handle('POST', '/auth/logout', {}, auth(login.body.token))).status, 204);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(login.body.token))).status, 401);
});

test('income CRUD is bound to the verified session, never client user_id', async () => {
  const app = make();
  const alice = (await register(app, 'alice@example.com')).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const id = 'f1a32abb-dfc0-4348-a3a6-2a487524d9fd';
  const input = { id, user_id: bob.user.user_id, income_date: '2026-08-15', category: 'Зарплата', description: 'test', amount: 1_000_000_000 };
  assert.equal((await app.handle('POST', '/incomes', input)).status, 401);
  const created = await app.handle('POST', '/incomes', input, auth(alice.token));
  assert.equal(created.status, 201);
  assert.equal(created.body.data.user_id, alice.user.user_id);
  assert.equal((await app.handle('POST', '/incomes', input, auth(alice.token))).status, 409);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(bob.token))).body.data.length, 0);
  assert.equal((await app.handle('PUT', `/incomes/${id}`, input, auth(bob.token))).status, 404);
  assert.equal((await app.handle('DELETE', `/incomes/${id}`, {}, auth(bob.token))).status, 404);
  assert.equal((await app.handle('PUT', `/incomes/${id}`, { ...input, amount: 42 }, auth(alice.token))).body.data.amount, 42);
  assert.equal((await app.handle('DELETE', `/incomes/${id}`, {}, auth(alice.token))).status, 204);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data.length, 0);
});

test('categories and settings are per-user; protected category cannot be removed', async () => {
  const app = make();
  const alice = (await register(app, 'alice@example.com')).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const salary = await app.handle('POST', '/categories', { name: 'Зарплата', user_id: bob.user.user_id }, auth(alice.token));
  assert.equal(salary.status, 201);
  const id = salary.body.data.id;
  assert.equal((await app.handle('DELETE', `/categories/${id}`, {}, auth(alice.token))).status, 403);
  assert.equal((await app.handle('GET', '/categories', {}, auth(bob.token))).body.data.length, 0);
  const other = await app.handle('POST', '/categories', { name: 'Прочее' }, auth(alice.token));
  assert.equal((await app.handle('DELETE', `/categories/${other.body.data.id}`, {}, auth(bob.token))).status, 404);
  assert.equal((await app.handle('DELETE', `/categories/${other.body.data.id}`, {}, auth(alice.token))).status, 204);
  assert.equal((await app.handle('PUT', '/settings/theme', { user_id: bob.user.user_id, setting_value: 'dark' }, auth(alice.token))).status, 200);
  assert.equal((await app.handle('GET', '/settings', {}, auth(bob.token))).body.data.length, 0);
  assert.equal((await app.handle('GET', '/settings', {}, auth(alice.token))).body.data[0].setting_value, 'dark');
});

test('rejects malformed inputs and expired or forged tokens', async () => {
  const app = make();
  const account = (await register(app, 'alice@example.com')).body;
  assert.equal((await app.handle('POST', '/incomes', { income_date: '2026-02-30', category: 'A', description: '', amount: 1 }, auth(account.token))).status, 400);
  assert.equal((await app.handle('PUT', '/settings/a%20b', { setting_value: 'x' }, auth(account.token))).status, 400);
  const forged = account.token.slice(0, -1) + (account.token.endsWith('a') ? 'b' : 'a');
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(forged))).status, 401);
  const expired = createApp(memoryStore(), { now: () => new Date('2100-01-01') });
  assert.equal((await expired.handle('GET', '/auth/me', {}, auth(account.token))).status, 401);
});

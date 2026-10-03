'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { randomUUID } = require('node:crypto');

function memoryStore() {
  const users = new Map();
  const identities = new Map();
  const sessions = new Map();
  const incomes = new Map();
  const categories = new Map();
  const settings = new Map();
  const resetTokens = new Map();
  const rateLimits = new Map();
  const revisions = new Map();
  const bump = uid => revisions.set(uid, randomUUID());
  const owned = (map, uid) => [...map.values()].filter((row) => row.user_id === uid);
  const key = (uid, id) => `${uid}:${id}`;
  const identityKey = (provider, providerUserId) => `${provider}:${providerUserId}`;
  return {
    async loadBootstrap(id, validate, knownRevision) {
      const session = await this.getSession(id);
      const user = session ? await this.getUser(session.user_id) : null;
      validate({ session, user });
      if (!revisions.has(user.user_id)) bump(user.user_id);
      const revision = revisions.get(user.user_id);
      if (knownRevision === revision) return { user, revision, not_modified: true };
      return { user, revision, not_modified: false, incomes: await this.listIncomes(user.user_id),
        categories: await this.listCategories(user.user_id), settings: await this.listSettings(user.user_id) };
    },
    health: async () => {},
    consumeRateLimit: async (bucketKey, limit, windowMs, when) => {
      const nowMs = when.getTime();
      let state = rateLimits.get(bucketKey);
      if (!state || state.resetAt <= nowMs) state = { count: 0, resetAt: nowMs + windowMs };
      const allowed = state.count < limit;
      if (allowed) state.count += 1;
      rateLimits.set(bucketKey, state);
      return { allowed, retry_after_seconds: allowed ? 0 : Math.max(1, Math.ceil((state.resetAt - nowMs) / 1000)) };
    },
    register: async (user, hash, defaults) => {
      const emailKey = identityKey('email', user.email);
      if (identities.has(emailKey)) return false;
      users.set(user.user_id, user);
      identities.set(emailKey, { provider: 'email', provider_user_id: user.email, user_id: user.user_id, password_hash: hash });
      defaults.forEach((row) => categories.set(key(row.user_id, row.id), row));
      return true;
    },
    registerOAuth: async (user, provider, providerUserId, defaults) => {
      const providerKey = identityKey(provider, providerUserId);
      const emailKey = identityKey('email', user.email);
      if (identities.has(providerKey) || identities.has(emailKey)) return false;
      users.set(user.user_id, user);
      identities.set(emailKey, { provider: 'email', provider_user_id: user.email, user_id: user.user_id, password_hash: '' });
      identities.set(providerKey, { provider, provider_user_id: providerUserId, user_id: user.user_id, password_hash: '' });
      defaults.forEach((row) => categories.set(key(row.user_id, row.id), row));
      return true;
    },
    getIdentity: async (provider, providerUserId) => identities.get(identityKey(provider, providerUserId)),
    linkIdentity: async (provider, providerUserId, uid, createdAt) => {
      const k = identityKey(provider, providerUserId);
      const existing = identities.get(k);
      if (existing) return existing.user_id === uid;
      identities.set(k, { provider, provider_user_id: providerUserId, user_id: uid, password_hash: '', created_at: createdAt });
      return true;
    },
    getUser: async (id) => users.get(id),
    activateUser: async (uid, when, trialEndsAt) => {
      const user = users.get(uid);
      if (!user) return null;
      user.status = 'active';
      user.updated_at = when;
      user.trial_ends_at = trialEndsAt;
      settings.delete(key(uid, 'auth.email_verification'));
      return user;
    },
    addSession: async (row) => { sessions.set(row.session_id, row); },
    getSession: async (id) => sessions.get(id),
    revokeSession: async (id, when) => { sessions.get(id).revoked_at = when; },
    createPasswordResetToken: async (row) => {
      for (const [hash, token] of resetTokens) if (token.user_id === row.user_id) resetTokens.delete(hash);
      resetTokens.set(row.token_hash, { ...row, used_at: null });
    },
    deletePasswordResetToken: async (hash) => { resetTokens.delete(hash); },
    resetPassword: async (hash, passwordHash, when) => {
      const token = resetTokens.get(hash);
      if (!token || token.used_at || new Date(token.expires_at) <= when) return false;
      const identity = identities.get(identityKey('email', users.get(token.user_id)?.email || ''));
      if (!identity) return false;
      identity.password_hash = passwordHash;
      token.used_at = when;
      for (const [otherHash, other] of resetTokens) if (other.user_id === token.user_id && otherHash !== hash) resetTokens.delete(otherHash);
      for (const session of sessions.values()) if (session.user_id === token.user_id && !session.revoked_at) session.revoked_at = when;
      return true;
    },
    listIncomes: async (uid) => owned(incomes, uid),
    getIncome: async (uid, id) => incomes.get(key(uid, id)),
    addIncome: async (row) => {
      const k = key(row.user_id, row.id);
      if (incomes.has(k)) return false;
      incomes.set(k, row); bump(row.user_id); return true;
    },
    updateIncome: async (uid, id, value, updated_at) => {
      const row = incomes.get(key(uid, id));
      if (!row) return false;
      Object.assign(row, value, { updated_at }); bump(uid); return true;
    },
    deleteIncome: async (uid, id) => { const removed = incomes.delete(key(uid, id)); if (removed) bump(uid); return removed; },
    deleteAllIncomes: async (uid) => { for (const row of owned(incomes, uid)) incomes.delete(key(uid, row.id)); bump(uid); },
    replaceIncomes: async (uid, rows) => {
      const next = new Map(incomes);
      for (const row of owned(next, uid)) next.delete(key(uid, row.id));
      for (const row of rows) next.set(key(row.user_id, row.id), row);
      incomes.clear();
      for (const [id, row] of next) incomes.set(id, row);
      bump(uid);
      return rows;
    },
    listCategories: async (uid) => owned(categories, uid),
    getCategory: async (uid, id) => categories.get(key(uid, id)),
    addCategory: async (row) => {
      if (owned(categories, row.user_id).some((x) => x.name.toLowerCase() === row.name.toLowerCase())) return false;
      categories.set(key(row.user_id, row.id), row); bump(row.user_id); return true;
    },
    deleteCategory: async (uid, id) => { const removed = categories.delete(key(uid, id)); if (removed) bump(uid); return removed; },
    listSettings: async (uid) => owned(settings, uid),
    getSetting: async (uid, settingKey) => settings.get(key(uid, settingKey)),
    putSetting: async (row) => { settings.set(key(row.user_id, row.setting_key), row); if (!/^(auth|system|rate|billing)\./.test(row.setting_key)) bump(row.user_id); },
    deleteSetting: async (uid, settingKey) => { settings.delete(key(uid, settingKey)); },
    getEmailVerification: async (uid) => {
      const row = settings.get(key(uid, 'auth.email_verification'));
      if (!row) return null;
      try { return JSON.parse(row.setting_value); } catch (_) { return null; }
    },
    createEmailVerification: async (row) => {
      settings.set(key(row.user_id, 'auth.email_verification'), {
        user_id: row.user_id,
        setting_key: 'auth.email_verification',
        setting_value: JSON.stringify({
          token_hash: row.token_hash,
          created_at: row.created_at.toISOString(),
          expires_at: row.expires_at.toISOString()
        }),
        updated_at: row.created_at
      });
    },
    confirmEmailVerification: async (uid, tokenHash, when, trialEndsAt) => {
      const row = settings.get(key(uid, 'auth.email_verification'));
      const user = users.get(uid);
      if (!row || !user || user.status !== 'pending_email') return false;
      let verification;
      try { verification = JSON.parse(row.setting_value); } catch (_) { return false; }
      if (verification.token_hash !== tokenHash || new Date(verification.expires_at) <= when) return false;
      user.status = 'active';
      user.updated_at = when;
      user.trial_ends_at = trialEndsAt;
      settings.delete(key(uid, 'auth.email_verification'));
      return true;
    },
    deleteAccount: async (uid) => {
      for (const map of [incomes, categories, settings, sessions, resetTokens, identities]) {
        for (const [id, row] of map) if (row.user_id === uid) map.delete(id);
      }
      users.delete(uid);
      revisions.delete(uid);
    }
  };
}

const make = () => createApp(memoryStore(), { requireEmailVerification: false });
const register = (app, email) => app.handle('POST', '/auth/register', { email, password: 'very-secret-password' });
const auth = (token) => ({ authorization: `Bearer ${token}` });

test('revision cache detects every bootstrap mutation and isolates devices/users', async () => {
  const store = memoryStore();
  const app = createApp(store, { requireEmailVerification: false });
  const account = (await register(app, 'revision@example.com')).body;
  const other = (await register(app, 'revision-other@example.com')).body;
  const headers = auth(account.token);
  const bootstrap = revision => app.handle('GET', '/bootstrap' + (revision ? '?revision=' + revision : ''), {}, headers);
  let full = (await bootstrap()).body;
  assert.equal(full.not_modified, false);
  assert.ok(full.revision);
  const otherRevision = (await app.handle('GET', '/bootstrap', {}, auth(other.token))).body.revision;
  let dataReads = 0;
  for (const name of ['listIncomes', 'listCategories', 'listSettings']) {
    const original = store[name];
    store[name] = async (...args) => { dataReads++; return original(...args); };
  }
  assert.equal((await bootstrap(full.revision)).body.not_modified, true);
  assert.equal(dataReads, 0);
  assert.equal((await bootstrap('stale')).body.not_modified, false);
  assert.equal(dataReads, 3);
  const row = { income_date: '2026-09-15', category: 'Зарплата', description: 'Revision', amount: 123 };
  async function mutation(method, path, body, status) {
    const response = await app.handle(method, path, body, headers);
    assert.equal(response.status, status, path);
    const previous = full.revision;
    full = (await bootstrap(previous)).body;
    assert.equal(full.not_modified, false, path);
    assert.notEqual(full.revision, previous, path);
    assert.equal((await bootstrap(full.revision)).body.not_modified, true);
    assert.equal((await app.handle('GET', '/bootstrap?revision=' + otherRevision, {}, auth(other.token))).body.not_modified, true);
    return response.body;
  }
  const added = await mutation('POST', '/incomes', row, 201);
  await mutation('PUT', '/incomes/' + added.data.id, { ...row, amount: 456 }, 200);
  await mutation('DELETE', '/incomes/' + added.data.id, {}, 204);
  await mutation('POST', '/incomes', row, 201);
  await mutation('DELETE', '/incomes', {}, 204);
  await mutation('POST', '/incomes/replace', { incomes: [row] }, 200);
  const cat = await mutation('POST', '/categories', { name: 'Revision category' }, 201);
  await mutation('DELETE', '/categories/' + cat.data.id, {}, 204);
  await mutation('PUT', '/settings/theme', { setting_value: 'dark' }, 200);
  for (const key of ['auth.oauth_ticket', 'system.internal', 'rate.internal']) {
    await store.putSetting({ user_id: account.user.user_id, setting_key: key, setting_value: 'private' });
    assert.equal((await bootstrap(full.revision)).body.not_modified, true);
  }
  await store.consumeRateLimit('bucket', 10, 60000, new Date());
  assert.equal((await bootstrap(full.revision)).body.not_modified, true);
  assert.equal((await app.handle('PUT', '/settings/system.data_revision', { setting_value: full.revision }, headers)).status, 403);
  assert.ok((await bootstrap()).body.settings.every(row => !/^(auth|system|rate)\./.test(row.setting_key)));
  const second = (await app.handle('POST', '/auth/login', { email: account.user.email, password: 'very-secret-password' })).body;
  assert.equal((await app.handle('GET', '/bootstrap?revision=' + full.revision, {}, auth(second.token))).body.not_modified, true);
  await app.handle('POST', '/incomes', row, auth(second.token));
  assert.equal((await bootstrap(full.revision)).body.not_modified, false);
});

test('bootstrap authenticates once, isolates user data, and reduces startup reads', async () => {
  const store = memoryStore();
  const app = createApp(store, { requireEmailVerification: false });
  const alice = (await register(app, 'bootstrap-alice@example.com')).body;
  const bob = (await register(app, 'bootstrap-bob@example.com')).body;
  const row = { income_date: '2026-09-15', category: 'Зарплата', description: 'Проверка', amount: 123 };
  await app.handle('POST', '/incomes', row, auth(alice.token));
  await app.handle('POST', '/incomes', { ...row, amount: 456 }, auth(bob.token));
  await app.handle('PUT', '/settings/theme', { setting_value: 'dark' }, auth(alice.token));
  await store.putSetting({ user_id: alice.user.user_id, setting_key: 'auth.oauth_ticket', setting_value: 'private' });
  const calls = [];
  for (const name of ['getSession', 'getUser', 'listIncomes', 'listCategories', 'listSettings']) {
    const original = store[name];
    store[name] = async (...args) => { calls.push(name); return original(...args); };
  }
  assert.equal((await app.handle('GET', '/bootstrap')).status, 401);
  assert.equal(calls.length, 0);
  for (const route of ['/auth/me', '/incomes', '/categories']) {
    assert.equal((await app.handle('GET', route, {}, auth(alice.token))).status, 200);
  }
  assert.equal(calls.length, 8);
  calls.length = 0;
  const result = await app.handle('GET', '/bootstrap', {}, auth(alice.token));
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['getSession', 'getUser', 'listIncomes', 'listCategories', 'listSettings']);
  assert.equal(result.body.user.user_id, alice.user.user_id);
  assert.equal(result.body.incomes[0].amount, 123);
  assert.equal(result.body.categories.length, 3);
  assert.deepEqual(result.body.settings.map(x => x.setting_key), ['theme']);
  for (const rows of [result.body.incomes, result.body.categories, result.body.settings]) {
    assert.ok(rows.every(x => x.user_id === alice.user.user_id));
  }
  assert.equal(JSON.stringify(result.body).includes('secret_hash'), false);
  const other = await app.handle('GET', '/bootstrap', {}, auth(bob.token));
  assert.equal(other.body.incomes[0].amount, 456);
  assert.deepEqual(other.body.settings, []);
  const forged = alice.token.slice(0, -1) + (alice.token.endsWith('a') ? 'b' : 'a');
  calls.length = 0;
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(forged))).status, 401);
  assert.ok(!calls.includes('listIncomes'));
  await app.handle('POST', '/auth/logout', {}, auth(alice.token));
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(alice.token))).status, 401);
});

test('bootstrap rejects expired sessions, inactive users and deleted accounts', async () => {
  const store = memoryStore();
  const current = new Date('2026-10-01T12:00:00Z');
  const app = createApp(store, { requireEmailVerification: false, now: () => current });
  const account = (await register(app, 'bootstrap-expiry@example.com')).body;
  const session = await store.getSession(account.token.split('.')[0]);
  const user = await store.getUser(account.user.user_id);
  user.status = 'pending_email';
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(account.token))).status, 401);
  user.status = 'active';
  session.expires_at = new Date(current.getTime() - 1);
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(account.token))).status, 401);
  session.expires_at = new Date(current.getTime() + 10000);
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(account.token))).status, 200);
  await store.deleteAccount(user.user_id);
  assert.equal((await app.handle('GET', '/bootstrap', {}, auth(account.token))).status, 401);
});

test('health, register, login, me, logout and old-token rejection', async () => {
  const app = make();
  assert.equal((await app.handle('GET', '/health')).status, 200);
  const registered = await register(app, 'A@example.com');
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, 'a@example.com');
  assert.equal(new Date(registered.body.user.trial_ends_at) - new Date(registered.body.user.created_at), 14 * 86400000);
  assert.deepEqual((await app.handle('GET', '/categories', {}, auth(registered.body.token))).body.data.map((x) => x.name),
    ['Зарплата', 'Подработка', 'Прочее']);
  assert.equal((await register(app, 'a@example.com')).status, 409);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'a@example.com', password: 'wrong-password' })).status, 401);
  const login = await app.handle('POST', '/auth/login', { email: 'A@example.com', password: 'very-secret-password' });
  assert.equal(login.status, 200);
  assert.notEqual(login.body.token, registered.body.token);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(login.body.token))).body.user.email, 'a@example.com');
  assert.equal((await app.handle('POST', '/auth/logout', {}, auth(login.body.token))).status, 204);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(login.body.token))).status, 401);
});

test('Yandex OAuth login creates and exchanges a single-use qPokoy session ticket', async () => {
  const store = memoryStore();
  const oauth = {
    isConfigured: (provider) => provider === 'yandex',
    signingSecret: (provider) => 'test-secret-for-' + provider,
    authorizationUrl: (provider, state, redirectUri) => {
      const url = new URL('https://provider.test/authorize');
      url.searchParams.set('provider', provider);
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', redirectUri);
      return url.toString();
    },
    exchange: async (provider, code) => {
      assert.equal(code, 'good-code');
      return { provider, providerUserId: provider + '-user-123', email: 'oauth@example.com' };
    }
  };
  const app = createApp(store, {
    requireEmailVerification: false,
    oauth,
    appBaseUrl: 'https://qpokoy.ru/',
    oauthCallbackBaseUrl: 'https://api.example.test'
  });

  async function oauthLogin(provider) {
    const start = await app.handle('GET', `/auth/oauth/${provider}/start`);
    assert.equal(start.status, 200);
    const authUrl = new URL(start.body.url);
    assert.equal(authUrl.searchParams.get('provider'), provider);
    assert.equal(authUrl.searchParams.get('redirect_uri'), `https://api.example.test/auth/oauth/${provider}/callback`);
    const state = authUrl.searchParams.get('state');
    const callback = await app.handle('GET', `/auth/oauth/${provider}/callback?code=good-code&state=${encodeURIComponent(state)}`);
    assert.equal(callback.status, 302);
    const returnUrl = new URL(callback.headers.Location);
    assert.equal(returnUrl.origin, 'https://qpokoy.ru');
    const ticket = returnUrl.searchParams.get('oauth_ticket');
    assert.ok(ticket);
    const exchange = await app.handle('POST', '/auth/oauth/exchange', { ticket });
    assert.equal(exchange.status, 200);
    assert.ok(exchange.body.token);
    assert.equal(exchange.body.user.email, 'oauth@example.com');
    assert.equal((await app.handle('POST', '/auth/oauth/exchange', { ticket })).status, 400);
    return exchange.body;
  }

  const yandex = await oauthLogin('yandex');
  assert.deepEqual((await app.handle('GET', '/categories', {}, auth(yandex.token))).body.data.map((x) => x.name),
    ['Зарплата', 'Подработка', 'Прочее']);

  const badState = await app.handle('GET', '/auth/oauth/yandex/callback?code=good-code&state=bad');
  assert.equal(badState.status, 302);
  assert.equal(new URL(badState.headers.Location).searchParams.get('oauth_error'), 'oauth_invalid_state');
});

test('rate limits registration, password guessing, password reset and OAuth starts', async () => {
  const store = memoryStore();
  let current = new Date('2026-10-01T06:00:00.000Z');
  const oauth = {
    isConfigured: () => true,
    signingSecret: (provider) => 'rate-test-' + provider,
    authorizationUrl: (provider, state, redirectUri) => {
      const url = new URL('https://provider.test/authorize');
      url.searchParams.set('provider', provider);
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', redirectUri);
      return url.toString();
    },
    exchange: async () => { throw new Error('not used'); }
  };
  const short = { limit: 2, windowMs: 60 * 1000 };
  const app = createApp(store, {
    requireEmailVerification: false,
    now: () => current,
    oauth,
    oauthCallbackBaseUrl: 'https://api.example.test',
    rateLimits: {
      registerIp: short, registerEmail: short,
      loginIp: short, loginEmail: short,
      passwordResetIp: short, passwordResetEmail: short,
      oauthStartIp: short
    }
  });
  const ctx1 = { sourceIp: '203.0.113.10' };
  const ctx2 = { sourceIp: '203.0.113.11' };
  const ctx3 = { sourceIp: '203.0.113.12' };

  assert.equal((await app.handle('POST', '/auth/register', { email: 'rate@example.com', password: 'very-secret-password' }, {}, ctx1)).status, 201);
  assert.equal((await app.handle('POST', '/auth/register', { email: 'rate2@example.com', password: 'very-secret-password' }, {}, ctx1)).status, 201);
  const blockedRegister = await app.handle('POST', '/auth/register', { email: 'rate3@example.com', password: 'very-secret-password' }, {}, ctx1);
  assert.equal(blockedRegister.status, 429);
  assert.equal(blockedRegister.body.error.code, 'rate_limited');
  assert.equal(blockedRegister.headers['Retry-After'], '60');

  current = new Date(current.getTime() + 61 * 1000);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'rate@example.com', password: 'wrong-password' }, {}, ctx1)).status, 401);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'rate@example.com', password: 'wrong-password' }, {}, ctx2)).status, 401);
  const blockedLogin = await app.handle('POST', '/auth/login', { email: 'rate@example.com', password: 'wrong-password' }, {}, ctx3);
  assert.equal(blockedLogin.status, 429);
  assert.equal(blockedLogin.body.error.code, 'rate_limited');

  current = new Date(current.getTime() + 61 * 1000);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'rate@example.com', password: 'very-secret-password' }, {}, ctx3)).status, 200);

  assert.equal((await app.handle('POST', '/auth/password-reset/request', { email: 'rate@example.com' }, {}, ctx1)).status, 202);
  assert.equal((await app.handle('POST', '/auth/password-reset/request', { email: 'rate@example.com' }, {}, ctx2)).status, 202);
  assert.equal((await app.handle('POST', '/auth/password-reset/request', { email: 'rate@example.com' }, {}, ctx3)).status, 429);

  assert.equal((await app.handle('GET', '/auth/oauth/yandex/start', {}, {}, ctx1)).status, 200);
  assert.equal((await app.handle('GET', '/auth/oauth/yandex/start', {}, {}, ctx1)).status, 200);
  assert.equal((await app.handle('GET', '/auth/oauth/yandex/start', {}, {}, ctx1)).status, 429);
});

test('email verification gates registration, expires, is single-use and starts the trial on confirmation', async () => {
  const store = memoryStore();
  const sent = [];
  let current = new Date('2026-09-30T12:00:00.000Z');
  const app = createApp(store, {
    now: () => current,
    requireEmailVerification: true,
    emailVerificationBaseUrl: 'https://qpokoy.ru/',
    sendEmailVerificationEmail: async (message) => { sent.push(message); }
  });

  const registered = await register(app, 'verify@example.com');
  assert.equal(registered.status, 201);
  assert.equal(registered.body.verification_required, true);
  assert.equal(registered.body.token, undefined);
  assert.equal(sent.length, 1);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'verify@example.com', password: 'wrong-password' })).status, 401);
  const blocked = await app.handle('POST', '/auth/login', { email: 'verify@example.com', password: 'very-secret-password' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'email_not_verified');

  const firstUrl = new URL(sent[0].verificationUrl);
  const firstToken = firstUrl.searchParams.get('verify_token');
  assert.match(firstToken, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i);
  assert.equal((await app.handle('POST', '/auth/email-verification/confirm', { token: 'bad' })).status, 400);

  current = new Date(current.getTime() + 25 * 3600000);
  assert.equal((await app.handle('POST', '/auth/email-verification/confirm', { token: firstToken })).status, 400);

  const resent = await app.handle('POST', '/auth/email-verification/resend', { email: 'verify@example.com' });
  assert.equal(resent.status, 202);
  assert.equal(sent.length, 2);
  const secondToken = new URL(sent[1].verificationUrl).searchParams.get('verify_token');
  assert.equal((await app.handle('POST', '/auth/email-verification/confirm', { token: secondToken })).status, 204);
  assert.equal((await app.handle('POST', '/auth/email-verification/confirm', { token: secondToken })).status, 400);

  const login = await app.handle('POST', '/auth/login', { email: 'verify@example.com', password: 'very-secret-password' });
  assert.equal(login.status, 200);
  assert.equal(new Date(login.body.user.trial_ends_at) - current, 14 * 86400000);

  const unknown = await app.handle('POST', '/auth/email-verification/resend', { email: 'missing@example.com' });
  assert.equal(unknown.status, 202);
  assert.equal(sent.length, 2);
});

test('password reset is private, single-use, expires, changes password and revokes sessions', async () => {
  const store = memoryStore();
  const sent = [];
  let current = new Date('2026-09-30T12:00:00.000Z');
  const app = createApp(store, {
    requireEmailVerification: false,
    now: () => current,
    passwordResetBaseUrl: 'https://qpokoy.ru/',
    sendPasswordResetEmail: async (message) => { sent.push(message); }
  });
  const account = (await register(app, 'reset@example.com')).body;
  const second = (await app.handle('POST', '/auth/login', { email: 'reset@example.com', password: 'very-secret-password' })).body;

  const unknown = await app.handle('POST', '/auth/password-reset/request', { email: 'missing@example.com' });
  assert.equal(unknown.status, 202);
  assert.equal(sent.length, 0);

  const requested = await app.handle('POST', '/auth/password-reset/request', { email: 'RESET@example.com' });
  assert.equal(requested.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'reset@example.com');
  const url = new URL(sent[0].resetUrl);
  const token = url.searchParams.get('reset_token');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  assert.equal((await app.handle('POST', '/auth/password-reset/confirm', { token: 'bad', password: 'new-secret-password' })).status, 400);
  assert.equal((await app.handle('POST', '/auth/password-reset/confirm', { token, password: 'short' })).status, 400);
  assert.equal((await app.handle('POST', '/auth/password-reset/confirm', { token, password: 'new-secret-password' })).status, 204);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(account.token))).status, 401);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(second.token))).status, 401);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'reset@example.com', password: 'very-secret-password' })).status, 401);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'reset@example.com', password: 'new-secret-password' })).status, 200);
  assert.equal((await app.handle('POST', '/auth/password-reset/confirm', { token, password: 'another-password' })).status, 400);

  await app.handle('POST', '/auth/password-reset/request', { email: 'reset@example.com' });
  const expiredToken = new URL(sent.at(-1).resetUrl).searchParams.get('reset_token');
  current = new Date(current.getTime() + 31 * 60000);
  assert.equal((await app.handle('POST', '/auth/password-reset/confirm', { token: expiredToken, password: 'another-password' })).status, 400);
});

test('password reset request keeps generic success even if Postbox fails', async () => {
  const errors = [];
  const app = createApp(memoryStore(), {
    requireEmailVerification: false,
    sendPasswordResetEmail: async () => { throw new Error('mail unavailable'); },
    onError: (error) => errors.push(error)
  });
  await register(app, 'reset@example.com');
  const result = await app.handle('POST', '/auth/password-reset/request', { email: 'reset@example.com' });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(errors.length, 1);
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
  assert.equal((await app.handle('PUT', `/incomes/${id}`, { ...input, amount: 42.5 }, auth(alice.token))).status, 400);
  const fractionalId = '7dfabf32-bb83-4dc9-b67f-8a2975258de8';
  assert.equal((await app.handle('POST', '/incomes', { ...input, id: fractionalId, amount: 99.99 }, auth(alice.token))).status, 400);
  assert.equal((await app.handle('DELETE', `/incomes/${id}`, {}, auth(alice.token))).status, 204);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data.length, 0);
});

test('categories and settings are per-user; protected category cannot be removed', async () => {
  const app = make();
  const alice = (await register(app, 'alice@example.com')).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const defaults = (await app.handle('GET', '/categories', {}, auth(alice.token))).body.data;
  assert.deepEqual(defaults.map((x) => x.name), ['Зарплата', 'Подработка', 'Прочее']);
  assert.equal((await app.handle('DELETE', `/categories/${defaults[0].id}`, {}, auth(alice.token))).status, 403);
  for (const category of defaults.slice(1)) {
    assert.equal((await app.handle('DELETE', `/categories/${category.id}`, {}, auth(bob.token))).status, 404);
    assert.equal((await app.handle('DELETE', `/categories/${category.id}`, {}, auth(alice.token))).status, 204);
  }
  assert.deepEqual((await app.handle('GET', '/categories', {}, auth(alice.token))).body.data.map((x) => x.name), ['Зарплата']);
  assert.deepEqual((await app.handle('GET', '/categories', {}, auth(bob.token))).body.data.map((x) => x.name),
    ['Зарплата', 'Подработка', 'Прочее']);
  assert.equal((await app.handle('POST', '/categories', { name: 'Зарплата' }, auth(alice.token))).status, 409);
  const other = await app.handle('POST', '/categories', { name: 'Тестовая' }, auth(alice.token));
  assert.equal(other.status, 201);
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
  const expired = createApp(memoryStore(), { requireEmailVerification: false, now: () => new Date('2100-01-01') });
  assert.equal((await expired.handle('GET', '/auth/me', {}, auth(account.token))).status, 401);
});

test('atomic replace validates all rows, ignores client ownership, and accepts empty array', async () => {
  const app = make();
  const alice = (await register(app, 'alice@example.com')).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const payload = { income_date: '2026-09-15', category: 'Зарплата', description: 'old', amount: 10 };
  await app.handle('POST', '/incomes', payload, auth(alice.token));
  await app.handle('POST', '/incomes', payload, auth(bob.token));
  const existing = (await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data;
  const id = 'f1a32abb-dfc0-4348-a3a6-2a487524d9fd';
  const replacement = [
    { ...payload, id, user_id: bob.user.user_id, description: 'новый доход', amount: 100 },
    { ...payload, description: 'second', amount: 200 }
  ];
  assert.equal((await app.handle('POST', '/incomes/replace', { incomes: replacement })).status, 401);
  const invalid = await app.handle('POST', '/incomes/replace', { incomes: [replacement[0], { ...replacement[1], income_date: '2026-02-30' }] }, auth(alice.token));
  assert.equal(invalid.status, 400);
  for (const malformed of [
    { ...replacement[1], amount: 0 },
    { ...replacement[1], amount: 100.5 },
    { ...replacement[1], category: 'x'.repeat(81) },
    { ...replacement[1], description: 'x'.repeat(5001) },
    { ...replacement[1], id: 'not-a-uuid' }
  ]) {
    assert.equal((await app.handle('POST', '/incomes/replace', { incomes: [replacement[0], malformed] }, auth(alice.token))).status, 400);
  }
  assert.equal((await app.handle('POST', '/incomes/replace', { incomes: {} }, auth(alice.token))).status, 400);
  assert.deepEqual((await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data, existing);
  assert.equal((await app.handle('POST', '/incomes/replace', { incomes: [replacement[0], replacement[0]] }, auth(alice.token))).status, 400);
  assert.equal((await app.handle('POST', '/incomes/replace', { incomes: Array(501).fill(replacement[0]) }, auth(alice.token))).status, 413);
  const result = await app.handle('POST', '/incomes/replace', { incomes: replacement }, auth(alice.token));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 2);
  assert.equal(result.body.data[0].id, id);
  assert.equal(result.body.data[0].user_id, alice.user.user_id);
  assert.match(result.body.data[1].id, /^[0-9a-f-]{36}$/);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(bob.token))).body.data.length, 1);
  assert.equal((await app.handle('POST', '/incomes/replace', { incomes: [] }, auth(alice.token))).status, 200);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data.length, 0);
  assert.equal((await app.handle('GET', '/categories', {}, auth(alice.token))).body.data.length, 3);
});

test('DELETE /incomes clears only current user income', async () => {
  const app = make();
  const alice = (await register(app, 'alice@example.com')).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const row = { income_date: '2026-09-15', category: 'Зарплата', description: '', amount: 10 };
  await app.handle('POST', '/incomes', row, auth(alice.token));
  await app.handle('POST', '/incomes', row, auth(bob.token));
  assert.equal((await app.handle('DELETE', '/incomes')).status, 401);
  assert.equal((await app.handle('DELETE', '/incomes', { user_id: bob.user.user_id }, auth(alice.token))).status, 204);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(alice.token))).body.data.length, 0);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(bob.token))).body.data.length, 1);
  assert.equal((await app.handle('GET', '/categories', {}, auth(alice.token))).body.data.length, 3);
});

test('DELETE /auth/me removes all own data and sessions, not another account', async () => {
  const store = memoryStore();
  const app = createApp(store, { requireEmailVerification: false });
  const alice = (await register(app, 'alice@example.com')).body;
  const aliceSecond = (await app.handle('POST', '/auth/login', { email: 'alice@example.com', password: 'very-secret-password' })).body;
  const bob = (await register(app, 'bob@example.com')).body;
  const row = { income_date: '2026-09-15', category: 'Зарплата', description: '', amount: 10 };
  await app.handle('POST', '/incomes', row, auth(alice.token));
  await app.handle('POST', '/incomes', row, auth(bob.token));
  await app.handle('PUT', '/settings/theme', { setting_value: 'dark' }, auth(alice.token));
  assert.equal((await app.handle('DELETE', '/auth/me')).status, 401);
  assert.equal((await app.handle('DELETE', '/auth/me', { user_id: bob.user.user_id }, auth(alice.token))).status, 204);
  assert.equal(await store.getUser(alice.user.user_id), undefined);
  assert.equal(await store.getIdentity('email', 'alice@example.com'), undefined);
  assert.equal((await store.listCategories(alice.user.user_id)).length, 0);
  assert.equal((await store.listIncomes(alice.user.user_id)).length, 0);
  assert.equal((await store.listSettings(alice.user.user_id)).length, 0);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(alice.token))).status, 401);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(aliceSecond.token))).status, 401);
  assert.equal((await app.handle('POST', '/auth/login', { email: 'alice@example.com', password: 'very-secret-password' })).status, 401);
  assert.equal((await app.handle('GET', '/auth/me', {}, auth(bob.token))).status, 200);
  assert.equal((await app.handle('GET', '/incomes', {}, auth(bob.token))).body.data.length, 1);
});

test('billing access gives prelaunch accounts a 14-day launch trial and makes expired accounts read-only', async () => {
  const store = memoryStore();
  let clock = new Date('2026-09-30T12:00:00.000Z');
  const app = createApp(store, {
    requireEmailVerification: false,
    billingEnforcementStartedAt: '2026-10-01T00:00:00.000Z',
    now: () => new Date(clock)
  });
  const existing = (await register(app, 'existing-billing@example.com')).body;
  const existingHeaders = auth(existing.token);

  clock = new Date('2026-10-02T12:00:00.000Z');
  let status = await app.handle('GET', '/billing/status', {}, existingHeaders);
  assert.equal(status.status, 200);
  assert.equal(status.body.data.mode, 'trial');
  assert.equal(status.body.data.plan, 'trial');
  assert.equal(status.body.data.trial_ends_at, '2026-10-15T00:00:00.000Z');
  assert.equal(status.body.data.can_write, true);
  assert.equal((await app.handle('POST', '/incomes', {
    income_date: '2026-10-02', category: 'Зарплата', description: 'Trial', amount: 100
  }, existingHeaders)).status, 201);

  clock = new Date('2026-10-20T12:00:00.000Z');
  status = await app.handle('GET', '/billing/status', {}, existingHeaders);
  assert.equal(status.body.data.mode, 'expired');
  assert.equal(status.body.data.can_write, false);
  assert.equal((await app.handle('POST', '/incomes', {
    income_date: '2026-10-20', category: 'Зарплата', description: 'Blocked', amount: 100
  }, existingHeaders)).status, 402);

  clock = new Date('2026-10-02T12:00:00.000Z');
  const fresh = (await register(app, 'trial-billing@example.com')).body;
  const freshHeaders = auth(fresh.token);
  status = await app.handle('GET', '/billing/status', {}, freshHeaders);
  assert.equal(status.body.data.mode, 'trial');
  assert.equal(status.body.data.can_write, true);
  assert.equal((await app.handle('GET', '/bootstrap', {}, freshHeaders)).body.billing.mode, 'trial');

  clock = new Date('2026-10-17T12:00:00.000Z');
  status = await app.handle('GET', '/billing/status', {}, freshHeaders);
  assert.equal(status.body.data.mode, 'expired');
  assert.equal(status.body.data.can_write, false);
  assert.equal((await app.handle('POST', '/incomes', {
    income_date: '2026-10-17', category: 'Зарплата', description: 'Blocked', amount: 100
  }, freshHeaders)).status, 402);
  assert.equal((await app.handle('GET', '/incomes', {}, freshHeaders)).status, 200);
  assert.equal((await app.handle('DELETE', '/auth/me', {}, freshHeaders)).status, 204);
});

test('billing payment and grace state are server-managed and keep writes enabled only while entitled', async () => {
  const store = memoryStore();
  let clock = new Date('2026-10-02T12:00:00.000Z');
  const app = createApp(store, {
    requireEmailVerification: false,
    billingEnforcementStartedAt: '2026-10-01T00:00:00.000Z',
    now: () => new Date(clock)
  });
  const account = (await register(app, 'paid-billing@example.com')).body;
  const headers = auth(account.token);
  const uid = account.user.user_id;
  const initial = (await app.handle('GET', '/bootstrap', {}, headers)).body;
  await store.putSetting({
    user_id: uid,
    setting_key: 'billing.access',
    setting_value: JSON.stringify({
      plan: 'monthly',
      paid_until: '2026-10-25T00:00:00.000Z',
      grace_until: '2026-10-28T00:00:00.000Z',
      auto_renew: true
    }),
    updated_at: clock
  });
  const cached = (await app.handle('GET', '/bootstrap?revision=' + encodeURIComponent(initial.revision), {}, headers)).body;
  assert.equal(cached.not_modified, true);
  assert.equal(cached.billing.mode, 'paid');
  assert.equal(cached.billing.auto_renew, true);
  assert.equal(cached.settings, undefined);
  assert.equal((await app.handle('GET', '/settings', {}, headers)).body.data.some(row => row.setting_key === 'billing.access'), false);
  assert.equal((await app.handle('PUT', '/settings/billing.access', { setting_value: '{}' }, headers)).status, 403);

  clock = new Date('2026-10-26T12:00:00.000Z');
  assert.equal((await app.handle('GET', '/billing/status', {}, headers)).body.data.mode, 'grace');
  assert.equal((await app.handle('POST', '/categories', { name: 'Grace category' }, headers)).status, 201);

  clock = new Date('2026-10-29T12:00:00.000Z');
  assert.equal((await app.handle('GET', '/billing/status', {}, headers)).body.data.mode, 'expired');
  assert.equal((await app.handle('POST', '/categories', { name: 'Blocked category' }, headers)).status, 402);
});

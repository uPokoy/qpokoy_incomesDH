'use strict';

const { randomUUID } = require('node:crypto');
const { hashPassword, verifyPassword, newSession, parseToken, verifySecret } = require('./security');

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (message) => { throw new HttpError(400, 'bad_request', message); };
const requiredString = (value, field, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) bad(`Invalid ${field}`);
  return value.trim();
};
const emailValue = (value) => {
  const email = requiredString(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Invalid email');
  return email;
};
const passwordValue = (value) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 1024) bad('Password must be 8–1024 characters');
  return value;
};
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('Invalid income_date');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) bad('Invalid income_date');
  return value;
};
const uuidValue = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) bad('Invalid id');
  return value;
};
const incomeValue = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected JSON object');
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) bad('Invalid amount');
  if (typeof body.description !== 'string' || body.description.length > 5000) bad('Invalid description');
  return {
    income_date: validDate(body.income_date),
    category: requiredString(body.category, 'category', 80),
    description: body.description.trim(), amount
  };
};

function createApp(store, options = {}) {
  const now = options.now || (() => new Date());
  const sessionDays = 30;

  async function authenticate(headers) {
    const token = parseToken(headers.authorization || headers.Authorization);
    if (!token) throw new HttpError(401, 'unauthorized', 'Authentication required');
    const session = await store.getSession(token.sessionId);
    if (!session || session.revoked_at || new Date(session.expires_at) <= now() || !verifySecret(token.secret, session.secret_hash)) {
      throw new HttpError(401, 'unauthorized', 'Invalid session');
    }
    const user = await store.getUser(session.user_id);
    if (!user || user.status !== 'active') throw new HttpError(401, 'unauthorized', 'Invalid session');
    return { user, session };
  }

  async function createSession(user) {
    const session = newSession();
    const createdAt = now();
    await store.addSession({ session_id: session.sessionId, user_id: user.user_id,
      secret_hash: session.secretHash, created_at: createdAt,
      expires_at: new Date(createdAt.getTime() + sessionDays * 86400000) });
    return { token: session.token, expires_at: new Date(createdAt.getTime() + sessionDays * 86400000).toISOString(), user: publicUser(user) };
  }

  async function handle(method, path, body = {}, headers = {}) {
    try {
      const url = new URL(path, 'https://local.invalid');
      const pathname = url.pathname.replace(/\/$/, '') || '/';
      if (['POST', 'PUT', 'PATCH'].includes(method) && (!body || typeof body !== 'object' || Array.isArray(body))) bad('Expected JSON object');
      if (method === 'GET' && pathname === '/health') {
        await store.health();
        return response(200, { status: 'ok' });
      }
      if (method === 'POST' && pathname === '/auth/register') {
        const email = emailValue(body.email);
        const password = passwordValue(body.password);
        const user = { user_id: randomUUID(), email, status: 'active', created_at: now(), updated_at: now(), trial_ends_at: now() };
        const passwordHash = await hashPassword(password);
        const created = await store.register(user, passwordHash);
        if (!created) throw new HttpError(409, 'email_exists', 'Email already registered');
        return response(201, await createSession(user));
      }
      if (method === 'POST' && pathname === '/auth/login') {
        const email = emailValue(body.email);
        const password = passwordValue(body.password);
        const identity = await store.getIdentity('email', email);
        if (!identity || !identity.password_hash || !await verifyPassword(password, identity.password_hash)) {
          throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
        }
        const user = await store.getUser(identity.user_id);
        if (!user || user.status !== 'active') throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
        return response(200, await createSession(user));
      }
      const { user, session } = await authenticate(headers);
      const userId = user.user_id;
      if (method === 'GET' && pathname === '/auth/me') return response(200, { user: publicUser(user) });
      if (method === 'POST' && pathname === '/auth/logout') {
        await store.revokeSession(session.session_id, now());
        return response(204, null);
      }
      if (pathname === '/incomes' && method === 'GET') return response(200, { data: await store.listIncomes(userId) });
      if (pathname === '/incomes' && method === 'POST') {
        const value = incomeValue(body);
        const id = body.id === undefined ? randomUUID() : uuidValue(body.id);
        const created = await store.addIncome({ user_id: userId, id, ...value, created_at: now(), updated_at: now() });
        if (!created) throw new HttpError(409, 'income_exists', 'Income already exists');
        return response(201, { data: await store.getIncome(userId, id) });
      }
      const incomeMatch = /^\/incomes\/([^/]+)$/.exec(pathname);
      if (incomeMatch && (method === 'PUT' || method === 'PATCH')) {
        const id = uuidValue(incomeMatch[1]);
        const value = incomeValue(body);
        const updated = await store.updateIncome(userId, id, value, now());
        if (!updated) throw new HttpError(404, 'not_found', 'Income not found');
        return response(200, { data: await store.getIncome(userId, id) });
      }
      if (incomeMatch && method === 'DELETE') {
        const id = uuidValue(incomeMatch[1]);
        if (!await store.deleteIncome(userId, id)) throw new HttpError(404, 'not_found', 'Income not found');
        return response(204, null);
      }
      if (pathname === '/categories' && method === 'GET') return response(200, { data: await store.listCategories(userId) });
      if (pathname === '/categories' && method === 'POST') {
        const name = requiredString(body.name, 'name', 80).replace(/\s+/g, ' ');
        const id = randomUUID();
        const created = await store.addCategory({ user_id: userId, id, name, created_at: now() });
        if (!created) throw new HttpError(409, 'category_exists', 'Category already exists');
        return response(201, { data: await store.getCategory(userId, id) });
      }
      const categoryMatch = /^\/categories\/([^/]+)$/.exec(pathname);
      if (categoryMatch && method === 'DELETE') {
        const id = uuidValue(categoryMatch[1]);
        const category = await store.getCategory(userId, id);
        if (!category) throw new HttpError(404, 'not_found', 'Category not found');
        if (category.name.toLocaleLowerCase('ru-RU') === 'зарплата') throw new HttpError(403, 'protected_category', 'Salary category cannot be deleted');
        await store.deleteCategory(userId, id);
        return response(204, null);
      }
      if (pathname === '/settings' && method === 'GET') return response(200, { data: await store.listSettings(userId) });
      const settingMatch = /^\/settings\/([^/]+)$/.exec(pathname);
      if (settingMatch && method === 'PUT') {
        const key = requiredString(decodeURIComponent(settingMatch[1]), 'setting_key', 80);
        if (!/^[A-Za-z0-9_.-]+$/.test(key)) bad('Invalid setting_key');
        if (typeof body.setting_value !== 'string' || body.setting_value.length > 65536) bad('Invalid setting_value');
        const row = { user_id: userId, setting_key: key, setting_value: body.setting_value, updated_at: now() };
        await store.putSetting(row);
        return response(200, { data: row });
      }
      throw new HttpError(404, 'not_found', 'Route not found');
    } catch (error) {
      if (error instanceof HttpError) return response(error.status, { error: { code: error.code, message: error.message } });
      if (options.onError) options.onError(error);
      return response(500, { error: { code: 'internal_error', message: 'Internal server error' } });
    }
  }
  return { handle };
}

function publicUser(user) {
  return { user_id: user.user_id, email: user.email, status: user.status, created_at: user.created_at };
}
function response(status, body) { return { status, body }; }
module.exports = { createApp };

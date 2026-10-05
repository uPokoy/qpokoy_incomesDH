'use strict';

const { createApp } = require('./app');
const { createYdbStore } = require('./ydb');
const { sendPasswordResetEmail, sendEmailVerificationEmail } = require('./mail');
const { createOAuthService } = require('./oauth');
const { createYooKassaClient } = require('./yookassa');
const { createPaymentRouter } = require('./payment-router');
const { OVERRIDE_KEY, readGrant } = require('./admin-billing');
let app;
let store;
let paymentRouter;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BILLING_ACCESS_SETTING = 'billing.access';

function normalizeIso(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function buildAdminUsersData(snapshot = {}, billingEnforcementStartedAt = '', current = new Date()) {
  const currentMs = current.getTime();
  const enforcement = (() => {
    if (!billingEnforcementStartedAt) return null;
    const parsed = new Date(String(billingEnforcementStartedAt));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  })();
  const settings = new Map();
  for (const row of Array.isArray(snapshot.settings) ? snapshot.settings : []) {
    if (!row?.user_id || ![OVERRIDE_KEY, BILLING_ACCESS_SETTING].includes(row.setting_key)) continue;
    if (!settings.has(row.user_id)) settings.set(row.user_id, new Map());
    settings.get(row.user_id).set(row.setting_key, row.setting_value);
  }

  function accessFor(user, manual, normal) {
    let trialEndsAt = normalizeIso(user?.trial_ends_at);
    const createdAtMs = Date.parse(user?.created_at);
    if (enforcement && Number.isFinite(createdAtMs) && createdAtMs < enforcement.getTime()) {
      const launchTrialEndsAt = new Date(enforcement.getTime() + 14 * 86400000).toISOString();
      if (!trialEndsAt || Date.parse(trialEndsAt) < Date.parse(launchTrialEndsAt)) trialEndsAt = launchTrialEndsAt;
    }
    const base = {
      can_read: true,
      can_export_pdf: true,
      can_delete_account: true,
      can_write: true,
      auto_renew: false,
      paid_until: null,
      grace_until: null,
      trial_ends_at: trialEndsAt,
      plan: null,
      source: null
    };
    if (manual) {
      const paid = normalizeIso(manual.paid_until);
      const grace = normalizeIso(manual.grace_until);
      const common = {
        ...base,
        plan: manual.plan,
        source: 'admin',
        auto_renew: manual.auto_renew,
        paid_until: paid,
        grace_until: grace
      };
      if (manual.plan === 'lifetime') return { ...common, mode: 'lifetime', status: 'active' };
      if (paid && Date.parse(paid) > currentMs) return { ...common, mode: 'paid', status: 'active' };
      if (grace && Date.parse(grace) > currentMs) return { ...common, mode: 'grace', status: 'grace' };
      return { ...common, mode: 'expired', status: 'expired', can_write: false };
    }
    if (!enforcement || currentMs < enforcement.getTime()) {
      return { ...base, mode: 'prelaunch', status: 'active' };
    }
    if (normal) {
      const paid = normalizeIso(normal.paid_until);
      const grace = normalizeIso(normal.grace_until);
      const common = {
        ...base,
        plan: normal.plan,
        source: 'payment',
        auto_renew: normal.auto_renew,
        paid_until: paid,
        grace_until: grace
      };
      if (normal.plan === 'lifetime') return { ...common, mode: 'lifetime', status: 'active' };
      if (paid && Date.parse(paid) > currentMs) return { ...common, mode: 'paid', status: 'active' };
      if (grace && Date.parse(grace) > currentMs) return { ...common, mode: 'grace', status: 'grace' };
      if (trialEndsAt && Date.parse(trialEndsAt) > currentMs) {
        return { ...base, mode: 'trial', status: 'active', plan: 'trial' };
      }
      return { ...common, mode: 'expired', status: 'expired', can_write: false };
    }
    if (trialEndsAt && Date.parse(trialEndsAt) > currentMs) {
      return { ...base, mode: 'trial', status: 'active', plan: 'trial' };
    }
    return { ...base, mode: 'expired', status: 'expired', can_write: false };
  }

  const users = (Array.isArray(snapshot.users) ? snapshot.users : []).map((user) => {
    const own = settings.get(user.user_id) || new Map();
    const manual = readGrant({ setting_value: own.get(OVERRIDE_KEY) || '' });
    const normal = readGrant({ setting_value: own.get(BILLING_ACCESS_SETTING) || '' });
    const assignment = manual
      ? { ...manual, source: 'admin' }
      : normal
        ? { ...normal, source: 'payment' }
        : null;
    return {
      user_id: user.user_id,
      email: user.email,
      status: user.status,
      created_at: user.created_at,
      trial_ends_at: user.trial_ends_at,
      billing: accessFor(user, manual, normal),
      assignment
    };
  });

  const active = users.filter((item) => item.status === 'active' && ['active', 'grace'].includes(item.billing?.status)).length;
  const trial = users.filter((item) => item.status === 'active' && item.billing?.mode === 'trial').length;
  const expired = users.filter((item) => item.status === 'active' && item.billing?.status === 'expired').length;
  return {
    users,
    stats: { total: users.length, active, trial, expired },
    generated_at: current.toISOString()
  };
}

async function handler(event = {}) {
  try {
    const method = String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
    const pathOnly = event.path || event.rawPath || '/';
    const queryString = event.rawQueryString || new URLSearchParams(event.queryStringParameters || {}).toString();
    const path = queryString && !String(pathOnly).includes('?') ? String(pathOnly) + '?' + queryString : pathOnly;
    const headers = event.headers || {};
    const requestContext = { sourceIp: event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp || '' };
    const origin = headers.origin || headers.Origin;
    const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const cors = origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (method === 'OPTIONS') return { statusCode: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' }, body: '' };
    if (event.isBase64Encoded && String(event.body || '').length > 4 * Math.ceil(MAX_BODY_BYTES / 3)) {
      return json(413, { error: { code: 'payload_too_large', message: 'Request body too large' } }, cors);
    }
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json(413, { error: { code: 'payload_too_large', message: 'Request body too large' } }, cors);
    let body = {};
    try { if (raw) body = JSON.parse(raw); } catch { return json(400, { error: { code: 'bad_json', message: 'Invalid JSON' } }, cors); }

    store ||= createYdbStore();
    const appBaseUrl = process.env.APP_BASE_URL || 'https://qpokoy.ru/';
    paymentRouter ||= createPaymentRouter(store, {
      client: createYooKassaClient({
        shopId: process.env.YOOKASSA_SHOP_ID || '',
        secretKey: process.env.YOOKASSA_SECRET_KEY || ''
      }),
      appBaseUrl,
      returnUrl: process.env.YOOKASSA_RETURN_URL || '',
      onError: () => console.error('Payment API error: internal_error')
    });
    app ||= createApp(store, {
      onError: (error) => console.error('API error', error),
      passwordResetBaseUrl: appBaseUrl,
      emailVerificationBaseUrl: appBaseUrl,
      appBaseUrl,
      oauthCallbackBaseUrl: process.env.PUBLIC_API_BASE_URL || 'https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net',
      oauth: createOAuthService(process.env),
      requireEmailVerification: String(process.env.REQUIRE_EMAIL_VERIFICATION || '').toLowerCase() === 'true',
      adminUserIds: process.env.ADMIN_USER_IDS || '',
      billingEnforcementStartedAt: process.env.BILLING_ENFORCEMENT_STARTED_AT || '',
      sendPasswordResetEmail: ({ to, resetUrl }) => sendPasswordResetEmail({
        to,
        resetUrl,
        from: process.env.POSTBOX_FROM || 'qPokoy <noreply@qpokoy.ru>'
      }),
      sendEmailVerificationEmail: ({ to, verificationUrl }) => sendEmailVerificationEmail({
        to,
        verificationUrl,
        from: process.env.POSTBOX_FROM || 'qPokoy <noreply@qpokoy.ru>'
      })
    });

    const paymentResult = await paymentRouter.handle(method, path, body, headers, requestContext);
    let result = paymentResult;
    if (!result) {
      const requestUrl = new URL(path, 'https://qpokoy.local');
      const wantsAdminList = method === 'GET' && requestUrl.pathname === '/admin/users' && !requestUrl.searchParams.has('email');
      if (wantsAdminList) {
        const access = await app.handle('GET', '/admin/session', {}, headers, requestContext);
        if (access.status !== 200) result = access;
        else if (typeof store.listAdminUsers !== 'function') result = { status: 503, body: { error: { code: 'admin_list_unavailable', message: 'Список пользователей временно недоступен.' } } };
        else {
          const snapshot = await store.listAdminUsers();
          result = { status: 200, body: { data: buildAdminUsersData(snapshot, process.env.BILLING_ENFORCEMENT_STARTED_AT || '') } };
        }
      } else {
        result = await app.handle(method, path, body, headers, requestContext);
      }
    }
    if (result.status >= 300 && result.status < 400 && result.headers?.Location) {
      return {
        statusCode: result.status,
        headers: { 'Cache-Control': 'no-store', ...cors, ...result.headers },
        body: ''
      };
    }
    return json(result.status, result.body, { ...cors, ...(result.headers || {}) });
  } catch (error) {
    console.error('API bootstrap error', error);
    return json(500, { error: { code: 'internal_error', message: 'Internal server error' } });
  }
}

function json(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }, body: body === null ? '' : JSON.stringify(body) };
}
module.exports = { handler, MAX_BODY_BYTES, buildAdminUsersData };

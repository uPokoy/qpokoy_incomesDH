'use strict';

const { createApp } = require('./app');
const { createYdbStore } = require('./ydb');
const { sendPasswordResetEmail, sendEmailVerificationEmail } = require('./mail');
const { createOAuthService } = require('./oauth');
const { createYooKassaClient } = require('./yookassa');
const { createPaymentRouter } = require('./payment-router');
let app;
let store;
let paymentRouter;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
    const result = paymentResult || await app.handle(method, path, body, headers, requestContext);
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
module.exports = { handler, MAX_BODY_BYTES };

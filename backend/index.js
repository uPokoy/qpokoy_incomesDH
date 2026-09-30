'use strict';

const { createApp } = require('./app');
const { createYdbStore } = require('./ydb');
let app;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function handler(event = {}) {
  try {
    const method = String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
    const path = event.path || event.rawPath || '/';
    const headers = event.headers || {};
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
    app ||= createApp(createYdbStore(), { onError: (error) => console.error('API error', error) });
    const result = await app.handle(method, path, body, headers);
    return json(result.status, result.body, cors);
  } catch (error) {
    console.error('API bootstrap error', error);
    return json(500, { error: { code: 'internal_error', message: 'Internal server error' } });
  }
}

function json(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }, body: body === null ? '' : JSON.stringify(body) };
}
module.exports = { handler, MAX_BODY_BYTES };

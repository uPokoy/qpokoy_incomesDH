'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOAuthService } = require('../oauth');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('Google OAuth uses authorization code flow and verified userinfo email', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      return response(200, { access_token: 'google-access' });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return response(200, { sub: 'google-user', email: 'User@Example.com', email_verified: true });
    }
    throw new Error('Unexpected URL ' + url);
  };
  const oauth = createOAuthService({
    GOOGLE_OAUTH_CLIENT_ID: 'google-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret'
  }, fetchImpl);

  assert.equal(oauth.isConfigured('google'), true);
  const authorize = new URL(oauth.authorizationUrl('google', 'signed-state', 'https://api.example/callback'));
  assert.equal(authorize.origin, 'https://accounts.google.com');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('client_id'), 'google-client');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://api.example/callback');
  assert.equal(authorize.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorize.searchParams.get('state'), 'signed-state');

  const profile = await oauth.exchange('google', 'authorization-code', 'https://api.example/callback');
  assert.deepEqual(profile, { provider: 'google', providerUserId: 'google-user', email: 'user@example.com' });
  const tokenBody = new URLSearchParams(calls[0].init.body);
  assert.equal(tokenBody.get('grant_type'), 'authorization_code');
  assert.equal(tokenBody.get('code'), 'authorization-code');
  assert.equal(tokenBody.get('client_secret'), 'google-secret');
  assert.equal(tokenBody.get('redirect_uri'), 'https://api.example/callback');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer google-access');
});

test('Yandex OAuth uses Basic token exchange and OAuth userinfo header', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://oauth.yandex.ru/token') {
      return response(200, { access_token: 'yandex-access' });
    }
    if (url.startsWith('https://login.yandex.ru/info')) {
      return response(200, { id: 'yandex-user', default_email: 'YaUser@Example.com' });
    }
    throw new Error('Unexpected URL ' + url);
  };
  const oauth = createOAuthService({
    YANDEX_OAUTH_CLIENT_ID: 'yandex-client',
    YANDEX_OAUTH_CLIENT_SECRET: 'yandex-secret'
  }, fetchImpl);

  assert.equal(oauth.isConfigured('yandex'), true);
  const authorize = new URL(oauth.authorizationUrl('yandex', 'signed-state', 'https://api.example/yandex/callback'));
  assert.equal(authorize.origin, 'https://oauth.yandex.ru');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('client_id'), 'yandex-client');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://api.example/yandex/callback');

  const profile = await oauth.exchange('yandex', 'authorization-code', 'https://api.example/yandex/callback');
  assert.deepEqual(profile, { provider: 'yandex', providerUserId: 'yandex-user', email: 'yauser@example.com' });
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('yandex-client:yandex-secret').toString('base64'));
  assert.equal(new URLSearchParams(calls[0].init.body).get('code'), 'authorization-code');
  assert.equal(calls[1].init.headers.Authorization, 'OAuth yandex-access');
});

test('OAuth provider is disabled until both client id and secret are configured', () => {
  const oauth = createOAuthService({ GOOGLE_OAUTH_CLIENT_ID: 'only-id' }, async () => response(500, {}));
  assert.equal(oauth.isConfigured('google'), false);
  assert.equal(oauth.isConfigured('yandex'), false);
  assert.throws(() => oauth.authorizationUrl('google', 'state', 'https://api.example/callback'), /not configured/i);
});

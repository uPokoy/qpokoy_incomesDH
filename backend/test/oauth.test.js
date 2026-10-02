'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOAuthService } = require('../oauth');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

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
  assert.equal(authorize.searchParams.get('state'), 'signed-state');

  const profile = await oauth.exchange('yandex', 'authorization-code', 'https://api.example/yandex/callback');
  assert.deepEqual(profile, { provider: 'yandex', providerUserId: 'yandex-user', email: 'yauser@example.com' });
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('yandex-client:yandex-secret').toString('base64'));
  assert.equal(new URLSearchParams(calls[0].init.body).get('code'), 'authorization-code');
  assert.equal(calls[1].init.headers.Authorization, 'OAuth yandex-access');
});

test('OAuth provider is disabled until both client id and secret are configured', () => {
  const oauth = createOAuthService({ YANDEX_OAUTH_CLIENT_ID: 'only-id' }, async () => response(500, {}));
  assert.equal(oauth.isConfigured('yandex'), false);
  assert.equal(oauth.isConfigured('other'), false);
  assert.throws(() => oauth.authorizationUrl('yandex', 'state', 'https://api.example/callback'), /not configured/i);
  assert.throws(() => oauth.authorizationUrl('other', 'state', 'https://api.example/callback'), /not configured/i);
});

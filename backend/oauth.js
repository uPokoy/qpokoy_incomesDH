'use strict';

class OAuthProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'OAuthProviderError';
    this.code = code;
    this.status = status;
  }
}

const PROVIDERS = {
  yandex: {
    authorizationUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    userInfoUrl: 'https://login.yandex.ru/info?format=json'
  }
};

function createOAuthService(env = process.env, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is required for OAuth');

  function config(provider) {
    if (provider !== 'yandex') return null;
    return {
      provider,
      clientId: String(env.YANDEX_OAUTH_CLIENT_ID || '').trim(),
      clientSecret: String(env.YANDEX_OAUTH_CLIENT_SECRET || '').trim(),
      ...PROVIDERS.yandex
    };
  }

  function isConfigured(provider) {
    const cfg = config(provider);
    return !!(cfg && cfg.clientId && cfg.clientSecret);
  }

  function signingSecret(provider) {
    const cfg = config(provider);
    if (!cfg || !cfg.clientSecret) throw new OAuthProviderError('oauth_not_configured', 'OAuth provider is not configured', 503);
    return cfg.clientSecret;
  }

  function authorizationUrl(provider, state, redirectUri) {
    const cfg = config(provider);
    if (!cfg || !cfg.clientId || !cfg.clientSecret) throw new OAuthProviderError('oauth_not_configured', 'OAuth provider is not configured', 503);
    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async function exchange(provider, code, redirectUri) {
    const cfg = config(provider);
    if (!cfg || !cfg.clientId || !cfg.clientSecret) throw new OAuthProviderError('oauth_not_configured', 'OAuth provider is not configured', 503);
    if (!code) throw new OAuthProviderError('oauth_invalid_code', 'OAuth authorization code is missing', 400);

    const form = new URLSearchParams({ grant_type: 'authorization_code', code });
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(cfg.clientId + ':' + cfg.clientSecret).toString('base64')
    };

    const tokenResponse = await fetchImpl(cfg.tokenUrl, { method: 'POST', headers, body: form.toString() });
    const tokenPayload = await readJson(tokenResponse, 'oauth_token_error');
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new OAuthProviderError('oauth_token_error', 'OAuth provider rejected the authorization code', 502);
    }

    const userResponse = await fetchImpl(cfg.userInfoUrl, {
      headers: { Authorization: 'OAuth ' + tokenPayload.access_token, Accept: 'application/json' }
    });
    const profile = await readJson(userResponse, 'oauth_profile_error');
    if (!userResponse.ok) throw new OAuthProviderError('oauth_profile_error', 'Could not load OAuth user profile', 502);

    const providerUserId = String(profile.id || '').trim();
    const email = String(profile.default_email || '').trim().toLowerCase();
    if (!providerUserId || !email) {
      throw new OAuthProviderError('oauth_email_unavailable', 'Yandex account must provide an email address', 400);
    }
    return { provider, providerUserId, email };
  }

  return { isConfigured, signingSecret, authorizationUrl, exchange };
}

async function readJson(response, code) {
  let payload = null;
  try { payload = await response.json(); }
  catch (_) { throw new OAuthProviderError(code, 'OAuth provider returned invalid JSON', 502); }
  return payload || {};
}

module.exports = { createOAuthService, OAuthProviderError };

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
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo'
  },
  yandex: {
    authorizationUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    userInfoUrl: 'https://login.yandex.ru/info?format=json'
  }
};

function createOAuthService(env = process.env, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is required for OAuth');

  function config(provider) {
    if (!PROVIDERS[provider]) return null;
    if (provider === 'google') {
      return {
        provider,
        clientId: String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
        clientSecret: String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
        ...PROVIDERS.google
      };
    }
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
    if (provider === 'google') {
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('include_granted_scopes', 'true');
    }
    return url.toString();
  }

  async function exchange(provider, code, redirectUri) {
    const cfg = config(provider);
    if (!cfg || !cfg.clientId || !cfg.clientSecret) throw new OAuthProviderError('oauth_not_configured', 'OAuth provider is not configured', 503);
    if (!code) throw new OAuthProviderError('oauth_invalid_code', 'OAuth authorization code is missing', 400);

    const form = new URLSearchParams({ grant_type: 'authorization_code', code });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (provider === 'google') {
      form.set('client_id', cfg.clientId);
      form.set('client_secret', cfg.clientSecret);
      form.set('redirect_uri', redirectUri);
    } else {
      headers.Authorization = 'Basic ' + Buffer.from(cfg.clientId + ':' + cfg.clientSecret).toString('base64');
    }

    const tokenResponse = await fetchImpl(cfg.tokenUrl, { method: 'POST', headers, body: form.toString() });
    const tokenPayload = await readJson(tokenResponse, 'oauth_token_error');
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new OAuthProviderError('oauth_token_error', 'OAuth provider rejected the authorization code', 502);
    }

    const userHeaders = provider === 'google'
      ? { Authorization: 'Bearer ' + tokenPayload.access_token, Accept: 'application/json' }
      : { Authorization: 'OAuth ' + tokenPayload.access_token, Accept: 'application/json' };
    const userResponse = await fetchImpl(cfg.userInfoUrl, { headers: userHeaders });
    const profile = await readJson(userResponse, 'oauth_profile_error');
    if (!userResponse.ok) throw new OAuthProviderError('oauth_profile_error', 'Could not load OAuth user profile', 502);

    if (provider === 'google') {
      const providerUserId = String(profile.sub || '').trim();
      const email = String(profile.email || '').trim().toLowerCase();
      if (!providerUserId || !email || profile.email_verified !== true) {
        throw new OAuthProviderError('oauth_email_unavailable', 'Google account must provide a verified email address', 400);
      }
      return { provider, providerUserId, email };
    }

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

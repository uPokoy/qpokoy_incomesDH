'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { parseToken, verifySecret } = require('./security');
const { YooKassaError } = require('./yookassa');
const {
  BILLING_ACCESS_SETTING,
  BILLING_PAYMENT_METHOD_SETTING,
  BILLING_PLANS,
  parseJsonSetting,
  buildPaidGrant,
  paymentSettingKey,
  paymentMetadata,
  verifiedGrant
} = require('./billing-payments');

class PaymentHttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function createPaymentRouter(store, options = {}) {
  const client = options.client;
  const now = options.now || (() => new Date());
  const appBaseUrl = options.appBaseUrl || 'https://qpokoy.ru/';
  const returnUrl = options.returnUrl || (() => {
    const url = new URL(appBaseUrl);
    url.searchParams.set('payment', 'return');
    return url.toString();
  })();
  const rateLimits = {
    createUser: { limit: 10, windowMs: 60 * 60 * 1000 },
    createIp: { limit: 30, windowMs: 60 * 60 * 1000 },
    ...(options.rateLimits || {})
  };

  function response(status, body, headers = {}) { return { status, body, headers }; }
  function isPaymentPath(pathname) {
    return pathname === '/billing/payments' || pathname === '/billing/auto-renew' ||
      pathname === '/billing/yookassa/webhook' || /^\/billing\/payments\/[A-Za-z0-9-]{10,80}$/.test(pathname);
  }
  function sourceIp(headers, requestContext) {
    const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-IP'] || '';
    return String(requestContext?.sourceIp || String(forwarded).split(',')[0] || 'unknown').trim().slice(0, 128) || 'unknown';
  }
  function hashBucket(value) { return createHash('sha256').update(String(value)).digest('base64url'); }
  async function rateLimit(name, subject) {
    const rule = rateLimits[name];
    if (!rule || !store.consumeRateLimit) return;
    const result = await store.consumeRateLimit(hashBucket('payments:' + name + ':' + String(subject).toLowerCase()), rule.limit, rule.windowMs, now());
    if (result?.allowed) return;
    const retry = Math.max(1, Number(result?.retry_after_seconds) || Math.ceil(rule.windowMs / 1000));
    throw new PaymentHttpError(429, 'rate_limited', 'Слишком много запросов. Попробуйте позже.', { 'Retry-After': String(retry) });
  }
  async function authenticate(headers) {
    const token = parseToken(headers.authorization || headers.Authorization);
    if (!token) throw new PaymentHttpError(401, 'unauthorized', 'Authentication required');
    const session = await store.getSession(token.sessionId);
    if (!session || session.revoked_at || new Date(session.expires_at) <= now() || !verifySecret(token.secret, session.secret_hash)) {
      throw new PaymentHttpError(401, 'unauthorized', 'Invalid session');
    }
    const user = await store.getUser(session.user_id);
    if (!user || user.status !== 'active') throw new PaymentHttpError(401, 'unauthorized', 'Invalid session');
    return user;
  }
  function planDescription(plan) {
    return plan === 'monthly' ? 'qPokoy — подписка на месяц' :
      plan === 'yearly' ? 'qPokoy — подписка на год' : 'qPokoy — бессрочный доступ';
  }
  function paymentRecord(payment, plan, autoRenewRequested, extra = {}) {
    return {
      payment_id: payment.id,
      status: payment.status || 'pending',
      plan,
      amount_rub: BILLING_PLANS[plan].price_rub,
      auto_renew_requested: Boolean(autoRenewRequested),
      confirmation_url: payment.confirmation?.confirmation_url || null,
      created_at: payment.created_at || now().toISOString(),
      updated_at: now().toISOString(),
      ...extra
    };
  }
  async function putUserSetting(userId, key, value) {
    const timestamp = now();
    await store.putSetting({ user_id: userId, setting_key: key, setting_value: JSON.stringify(value), updated_at: timestamp });
  }

  async function createPayment(user, body, ip) {
    if (!client?.isConfigured?.()) throw new PaymentHttpError(503, 'payments_not_configured', 'Оплата пока не настроена.');
    const plan = String(body?.plan || '');
    if (!BILLING_PLANS[plan]) throw new PaymentHttpError(400, 'invalid_plan', 'Неизвестный тариф.');
    if (body?.auto_renew !== undefined && typeof body.auto_renew !== 'boolean') {
      throw new PaymentHttpError(400, 'bad_request', 'Некорректное значение автопродления.');
    }
    const autoRenew = plan !== 'lifetime' && body?.auto_renew === true;
    await rateLimit('createUser', user.user_id);
    await rateLimit('createIp', ip);

    const currentAccess = parseJsonSetting(await store.getSetting(user.user_id, BILLING_ACCESS_SETTING));
    const grant = buildPaidGrant(plan, now(), currentAccess);
    const metadata = paymentMetadata({ userId: user.user_id, plan, autoRenew, grant });
    const requestId = body?.request_id === undefined ? randomUUID() : String(body.request_id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new PaymentHttpError(400, 'invalid_request_id', 'Некорректный идентификатор запроса.');
    }
    const payment = await client.createPayment({
      amountRub: BILLING_PLANS[plan].price_rub,
      returnUrl,
      description: planDescription(plan),
      savePaymentMethod: autoRenew,
      metadata,
      idempotenceKey: requestId
    });
    if (!payment?.id || !/^[A-Za-z0-9-]{10,80}$/.test(String(payment.id))) {
      throw new PaymentHttpError(502, 'payment_provider_error', 'ЮKassa не вернула идентификатор платежа.');
    }
    const record = paymentRecord(payment, plan, autoRenew);
    await putUserSetting(user.user_id, paymentSettingKey(payment.id), record);
    return response(201, { data: {
      payment_id: payment.id,
      status: record.status,
      plan,
      amount_rub: record.amount_rub,
      confirmation_url: record.confirmation_url
    } });
  }

  async function paymentStatus(user, paymentId) {
    const row = await store.getSetting(user.user_id, paymentSettingKey(paymentId));
    const value = parseJsonSetting(row);
    if (!value) throw new PaymentHttpError(404, 'payment_not_found', 'Платёж не найден.');
    return response(200, { data: value });
  }

  async function setAutoRenew(user, body) {
    if (typeof body?.enabled !== 'boolean') throw new PaymentHttpError(400, 'bad_request', 'Некорректное значение автопродления.');
    const row = await store.getSetting(user.user_id, BILLING_ACCESS_SETTING);
    const access = parseJsonSetting(row);
    if (!access || !['monthly', 'yearly'].includes(access.plan)) {
      throw new PaymentHttpError(400, 'auto_renew_unavailable', 'Автопродление доступно только для подписки на месяц или год.');
    }
    if (body.enabled) {
      const method = parseJsonSetting(await store.getSetting(user.user_id, BILLING_PAYMENT_METHOD_SETTING));
      if (!method?.payment_method_id) throw new PaymentHttpError(400, 'payment_method_required', 'Нет сохранённого способа оплаты для автопродления.');
    }
    const updated = { ...access, auto_renew: body.enabled };
    await putUserSetting(user.user_id, BILLING_ACCESS_SETTING, updated);
    return response(200, { data: updated });
  }

  async function webhook(body) {
    if (!client?.isConfigured?.()) throw new PaymentHttpError(503, 'payments_not_configured', 'Оплата пока не настроена.');
    if (body?.type !== 'notification' || !['payment.succeeded', 'payment.canceled'].includes(body?.event)) {
      return response(200, { ok: true, ignored: true });
    }
    const paymentId = String(body?.object?.id || '');
    if (!/^[A-Za-z0-9-]{10,80}$/.test(paymentId)) return response(200, { ok: true, ignored: true });
    const payment = await client.getPayment(paymentId);
    const expectedStatus = body.event === 'payment.succeeded' ? 'succeeded' : 'canceled';
    if (!payment || payment.id !== paymentId || payment.status !== expectedStatus) {
      return response(200, { ok: true, ignored: true });
    }
    const grant = verifiedGrant(payment);
    if (!grant) return response(200, { ok: true, ignored: true });
    const user = await store.getUser(grant.userId);
    if (!user) return response(200, { ok: true, ignored: true });

    const previous = parseJsonSetting(await store.getSetting(grant.userId, paymentSettingKey(paymentId)));
    const record = paymentRecord(payment, grant.plan, grant.autoRenewRequested, {
      payment_method_saved: payment.payment_method?.saved === true,
      succeeded_at: payment.status === 'succeeded' ? (payment.captured_at || now().toISOString()) : null
    });

    if (payment.status === 'succeeded') {
      const savedMethodId = payment.payment_method?.saved === true ? String(payment.payment_method?.id || '') : '';
      const canAutoRenew = grant.autoRenewRequested && ['monthly', 'yearly'].includes(grant.plan) && /^[A-Za-z0-9-]{10,120}$/.test(savedMethodId);
      const access = {
        plan: grant.plan,
        paid_until: grant.paid_until,
        grace_until: grant.grace_until,
        auto_renew: canAutoRenew,
        last_payment_id: paymentId
      };
      await putUserSetting(grant.userId, BILLING_ACCESS_SETTING, access);
      if (canAutoRenew) {
        await putUserSetting(grant.userId, BILLING_PAYMENT_METHOD_SETTING, {
          payment_method_id: savedMethodId,
          saved_at: now().toISOString(),
          source_payment_id: paymentId
        });
      }
    }
    await putUserSetting(grant.userId, paymentSettingKey(paymentId), { ...previous, ...record });
    return response(200, { ok: true });
  }

  async function handle(method, path, body = {}, headers = {}, requestContext = {}) {
    const url = new URL(path, 'https://local.invalid');
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (!isPaymentPath(pathname)) return null;
    try {
      if (method === 'POST' && pathname === '/billing/yookassa/webhook') return await webhook(body);
      const user = await authenticate(headers);
      if (method === 'POST' && pathname === '/billing/payments') return await createPayment(user, body, sourceIp(headers, requestContext));
      const match = /^\/billing\/payments\/([A-Za-z0-9-]{10,80})$/.exec(pathname);
      if (method === 'GET' && match) return await paymentStatus(user, match[1]);
      if (method === 'POST' && pathname === '/billing/auto-renew') return await setAutoRenew(user, body);
      throw new PaymentHttpError(404, 'not_found', 'Payment route not found');
    } catch (error) {
      if (error instanceof PaymentHttpError) return response(error.status, { error: { code: error.code, message: error.message } }, error.headers);
      if (error instanceof YooKassaError) return response(error.status || 502, { error: { code: error.code || 'payment_provider_error', message: error.message } });
      if (options.onError) options.onError(error);
      return response(500, { error: { code: 'internal_error', message: 'Internal server error' } });
    }
  }

  return { handle };
}

module.exports = { createPaymentRouter, PaymentHttpError };

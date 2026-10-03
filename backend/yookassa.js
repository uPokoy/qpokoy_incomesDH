'use strict';

class YooKassaError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'YooKassaError';
    this.code = code;
    this.status = status;
  }
}

function createYooKassaClient(options = {}) {
  const shopId = String(options.shopId || '').trim();
  const secretKey = String(options.secretKey || '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiBaseUrl = String(options.apiBaseUrl || 'https://api.yookassa.ru/v3').replace(/\/$/, '');
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;

  function isConfigured() {
    return /^\d+$/.test(shopId) && secretKey.length >= 8 && typeof fetchImpl === 'function';
  }

  async function request(method, path, body, idempotenceKey) {
    if (!isConfigured()) throw new YooKassaError('yookassa_not_configured', 'ЮKassa не настроена.', 503);
    const headers = {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(shopId + ':' + secretKey, 'utf8').toString('base64')
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotenceKey) headers['Idempotence-Key'] = String(idempotenceKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(apiBaseUrl + path, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new YooKassaError('yookassa_timeout', 'ЮKassa не ответила вовремя.', 504);
      throw new YooKassaError('yookassa_unavailable', 'Не удалось связаться с ЮKassa.', 502);
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch (_) { throw new YooKassaError('yookassa_invalid_response', 'ЮKassa вернула некорректный ответ.', 502); }
    }
    if (!response.ok) {
      const providerCode = String(payload?.code || payload?.type || 'api_error').slice(0, 80);
      throw new YooKassaError('yookassa_' + providerCode, 'ЮKassa отклонила запрос.', 502);
    }
    return payload;
  }

  async function createPayment({ amountRub, returnUrl, description, savePaymentMethod = false, metadata = {}, idempotenceKey }) {
    const amount = Number(amountRub);
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError('Invalid amountRub');
    if (!/^https:\/\//i.test(String(returnUrl || ''))) throw new TypeError('Invalid returnUrl');
    if (!idempotenceKey) throw new TypeError('Idempotence key is required');
    const body = {
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: String(returnUrl) },
      description: String(description || '').slice(0, 128),
      metadata
    };
    if (savePaymentMethod) body.save_payment_method = true;
    return request('POST', '/payments', body, idempotenceKey);
  }

  async function getPayment(paymentId) {
    const id = String(paymentId || '').trim();
    if (!/^[A-Za-z0-9-]{10,80}$/.test(id)) throw new TypeError('Invalid payment id');
    return request('GET', '/payments/' + encodeURIComponent(id));
  }

  return { isConfigured, createPayment, getPayment };
}

module.exports = { YooKassaError, createYooKassaClient };

'use strict';

const BILLING_ACCESS_SETTING = 'billing.access';
const BILLING_PAYMENT_METHOD_SETTING = 'billing.payment_method';
const BILLING_PAYMENT_PREFIX = 'billing.payment.';
const BILLING_PLANS = Object.freeze({
  monthly: { code: 'monthly', price_rub: 149, period: 'month' },
  yearly: { code: 'yearly', price_rub: 1190, period: 'year' },
  lifetime: { code: 'lifetime', price_rub: 1790, period: 'lifetime' }
});
const GRACE_MS = 3 * 86400000;

function parseJsonSetting(row) {
  try {
    const value = JSON.parse(row?.setting_value || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) { return null; }
}

function addMonthsUtc(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}

function buildPaidGrant(plan, current, existing) {
  if (!BILLING_PLANS[plan]) throw new TypeError('Invalid billing plan');
  if (plan === 'lifetime') return { plan, paid_until: null, grace_until: null, auto_renew: false };
  const now = new Date(current);
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid current time');
  let base = now;
  const existingPaid = existing?.paid_until ? new Date(existing.paid_until) : null;
  if (existingPaid && Number.isFinite(existingPaid.getTime()) && existingPaid > base) base = existingPaid;
  const end = addMonthsUtc(base, plan === 'monthly' ? 1 : 12);
  return {
    plan,
    paid_until: end.toISOString(),
    grace_until: new Date(end.getTime() + GRACE_MS).toISOString(),
    auto_renew: false
  };
}

function paymentSettingKey(paymentId) {
  const id = String(paymentId || '').trim();
  if (!/^[A-Za-z0-9-]{10,80}$/.test(id)) throw new TypeError('Invalid payment id');
  return BILLING_PAYMENT_PREFIX + id;
}

function paymentMetadata({ userId, plan, autoRenew, grant }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId || ''))) {
    throw new TypeError('Invalid user id');
  }
  if (!BILLING_PLANS[plan]) throw new TypeError('Invalid billing plan');
  return {
    app: 'qpokoy-v1',
    user_id: String(userId),
    plan,
    auto_renew: autoRenew && plan !== 'lifetime' ? '1' : '0',
    paid_until: grant?.paid_until || '',
    grace_until: grant?.grace_until || ''
  };
}

function verifiedGrant(payment) {
  const metadata = payment?.metadata;
  if (!metadata || metadata.app !== 'qpokoy-v1') return null;
  const userId = String(metadata.user_id || '');
  const plan = String(metadata.plan || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return null;
  if (!BILLING_PLANS[plan]) return null;
  const expected = BILLING_PLANS[plan].price_rub;
  if (payment?.amount?.currency !== 'RUB' || Number(payment?.amount?.value) !== expected) return null;
  if (plan === 'lifetime') {
    return { userId, plan, paid_until: null, grace_until: null, autoRenewRequested: false };
  }
  const paid = new Date(String(metadata.paid_until || ''));
  const grace = new Date(String(metadata.grace_until || ''));
  if (!Number.isFinite(paid.getTime()) || !Number.isFinite(grace.getTime()) || grace.getTime() - paid.getTime() !== GRACE_MS) return null;
  return {
    userId,
    plan,
    paid_until: paid.toISOString(),
    grace_until: grace.toISOString(),
    autoRenewRequested: metadata.auto_renew === '1'
  };
}

module.exports = {
  BILLING_ACCESS_SETTING,
  BILLING_PAYMENT_METHOD_SETTING,
  BILLING_PAYMENT_PREFIX,
  BILLING_PLANS,
  GRACE_MS,
  parseJsonSetting,
  buildPaidGrant,
  paymentSettingKey,
  paymentMetadata,
  verifiedGrant
};

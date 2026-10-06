'use strict';

const RECEIPT_SETTING = 'billing.receipt.last';
const PLAN_RECEIPTS = Object.freeze({
  monthly: { amount_rub: 149, service_name: 'Доступ к сервису qPokoy на 1 месяц' },
  yearly: { amount_rub: 1190, service_name: 'Доступ к сервису qPokoy на 1 год' },
  lifetime: { amount_rub: 1790, service_name: 'Бессрочный доступ к сервису qPokoy' }
});

function paymentIdValue(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9-]{10,80}$/.test(id) ? id : null;
}

function normalizeReceiptUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1000) return null;
  let url;
  try { url = new URL(raw); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'lknpd.nalog.ru' || url.username || url.password || url.search || url.hash) return null;
  if (!/^\/api\/v1\/receipt\/\d{10,12}\/[A-Za-z0-9_-]{4,80}\/print\/?$/.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

function planReceipt(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_RECEIPTS, plan) ? PLAN_RECEIPTS[plan] : null;
}

function readReceiptRecord(row) {
  try {
    const value = JSON.parse(row?.setting_value || 'null');
    const paymentId = paymentIdValue(value?.payment_id);
    const receiptUrl = normalizeReceiptUrl(value?.receipt_url);
    const sentAtMs = Date.parse(value?.sent_at || '');
    const startedAtMs = Date.parse(value?.started_at || '');
    const status = value?.status === 'sent' ? 'sent' : value?.status === 'sending' ? 'sending' : null;
    if (!paymentId || !receiptUrl || !status) return null;
    return {
      payment_id: paymentId,
      receipt_url: receiptUrl,
      status,
      sent_at: Number.isFinite(sentAtMs) ? new Date(sentAtMs).toISOString() : null,
      started_at: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null
    };
  } catch (_) { return null; }
}

module.exports = { RECEIPT_SETTING, PLAN_RECEIPTS, paymentIdValue, normalizeReceiptUrl, planReceipt, readReceiptRecord };

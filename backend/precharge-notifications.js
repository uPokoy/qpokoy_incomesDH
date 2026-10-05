'use strict';

const { randomUUID } = require('node:crypto');
const { createYdbStore } = require('./ydb');
const { getIamToken, qPokoyEmailTemplate, POSTBOX_SEND_URL } = require('./mail');
const {
  BILLING_ACCESS_SETTING,
  BILLING_PAYMENT_METHOD_SETTING,
  BILLING_PLANS,
  parseJsonSetting
} = require('./billing-payments');

const CONSENT_KEY = 'billing.auto_renew_consent';
const ADMIN_OVERRIDE_KEY = 'billing.admin_override';
const PRECHARGE_NOTICE_PREFIX = 'billing.precharge_notice.';
const PRECHARGE_LEAD_MS = 3 * 86400000;
const PRECHARGE_WINDOW_MS = 4 * 86400000;
const NOTICE_LEASE_MS = 15 * 60 * 1000;

function prechargeNoticeKey(paidUntil) {
  const end = Date.parse(String(paidUntil || ''));
  if (!Number.isFinite(end)) throw new TypeError('Invalid paid_until');
  return PRECHARGE_NOTICE_PREFIX + String(end);
}

function formatChargeDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid charge date');
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow'
  }).format(date);
}

function planLabel(plan) {
  return plan === 'monthly' ? 'Доступ на месяц' : plan === 'yearly' ? 'Доступ на год' : String(plan || '');
}

async function sendPrechargeNotificationEmail({
  to,
  plan,
  amountRub,
  chargeAt,
  settingsUrl = 'https://qpokoy.ru/',
  from = 'qPokoy <noreply@qpokoy.ru>',
  fetchImpl = globalThis.fetch
}) {
  if (!to) throw new TypeError('Recipient is required');
  if (!['monthly', 'yearly'].includes(plan)) throw new TypeError('Invalid recurring plan');
  if (!Number.isFinite(Number(amountRub)) || Number(amountRub) <= 0) throw new TypeError('Invalid amount');
  const amount = new Intl.NumberFormat('ru-RU').format(Number(amountRub)) + ' ₽';
  const chargeDate = formatChargeDate(chargeAt);
  const label = planLabel(plan);
  const subject = 'Предстоящее автопродление';
  const previewText = `${amount} · списание ${chargeDate}`;
  const keepAutoRenewText = 'Хотите оставить автопродление? Ничего делать не нужно — списание произойдёт автоматически в указанную дату.';
  const optOutText = 'Чтобы отказаться от будущего списания, откройте qPokoy → Настройки → Данные и нажмите «Отключить автопродление» или «Отвязать карту».';
  const paidPeriodText = 'Отключение автопродления или отвязка карты не меняют уже оплаченный период.';
  const text = [
    subject,
    '',
    label,
    `Сумма списания: ${amount}`,
    `Дата списания: ${chargeDate}`,
    '',
    keepAutoRenewText,
    '',
    'Управление доступом: ' + settingsUrl,
    '',
    optOutText,
    '',
    paidPeriodText
  ].join('\n');
  const html = qPokoyEmailTemplate({
    pageTitle: subject,
    icon: '&#8635;',
    title: subject,
    actionLabel: 'Управление доступом',
    actionUrl: settingsUrl,
    previewText,
    details: { label, amount, chargeDate },
    afterActionText: keepAutoRenewText,
    noteLines: [optOutText, paidPeriodText]
  });

  const iamToken = await getIamToken(fetchImpl);
  const response = await fetchImpl(POSTBOX_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YaCloud-SubjectToken': iamToken
    },
    body: JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' }
          }
        }
      }
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Postbox send failed (${response.status})${details ? ': ' + details.slice(0, 500) : ''}`);
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : {};
}

function isValidSentNotice(notice, access) {
  const end = Date.parse(access?.paid_until || '');
  const sent = Date.parse(notice?.sent_at || '');
  return notice?.status === 'sent' &&
    notice.plan === access?.plan &&
    notice.paid_until === access?.paid_until &&
    Number(notice.amount_rub) === Number(BILLING_PLANS[access?.plan]?.price_rub) &&
    Number.isFinite(end) && Number.isFinite(sent) && sent <= end - PRECHARGE_LEAD_MS;
}

async function hasValidPrechargeNoticeForUser(store, userId) {
  if (!store?.getSetting) return false;
  const access = parseJsonSetting(await store.getSetting(userId, BILLING_ACCESS_SETTING));
  if (!access || !['monthly', 'yearly'].includes(access.plan) || !access.paid_until) return false;
  let key;
  try { key = prechargeNoticeKey(access.paid_until); } catch (_) { return false; }
  const notice = parseJsonSetting(await store.getSetting(userId, key));
  return isValidSentNotice(notice, access);
}

function createPrechargeNotificationWorker(store, options = {}) {
  const now = options.now || (() => new Date());
  const sendEmail = options.sendEmail || sendPrechargeNotificationEmail;
  const settingsUrl = options.settingsUrl || options.appBaseUrl || 'https://qpokoy.ru/';

  async function notifyUser(userId, start) {
    const user = await store.getUser(userId);
    if (!user || user.status !== 'active' || !user.email || Date.parse(user.created_at) < start) return { skipped: true };
    const timestamp = now();
    const reservation = await store.withPaymentTransaction(userId, async t => {
      const access = await t.get(BILLING_ACCESS_SETTING);
      const method = await t.get(BILLING_PAYMENT_METHOD_SETTING);
      const consent = await t.get(CONSENT_KEY);
      if (await t.get(ADMIN_OVERRIDE_KEY)) return null;
      if (!access?.auto_renew || !['monthly', 'yearly'].includes(access.plan)) return null;
      if (!consent?.enabled || consent.plan !== access.plan || !method?.saved) return null;
      const end = Date.parse(access.paid_until || '');
      const remaining = end - timestamp.getTime();
      if (!Number.isFinite(end) || remaining < PRECHARGE_LEAD_MS || remaining > PRECHARGE_WINDOW_MS) return null;
      const key = prechargeNoticeKey(access.paid_until);
      const current = await t.get(key);
      if (isValidSentNotice(current, access)) return null;
      const attempted = Date.parse(current?.attempted_at || '');
      if (current?.status === 'sending' && Number.isFinite(attempted) && attempted > timestamp.getTime() - NOTICE_LEASE_MS) return null;
      const attemptId = randomUUID();
      const amountRub = BILLING_PLANS[access.plan].price_rub;
      await t.put(key, {
        status: 'sending',
        attempt_id: attemptId,
        plan: access.plan,
        paid_until: access.paid_until,
        amount_rub: amountRub,
        attempted_at: timestamp.toISOString()
      }, timestamp);
      return { key, attemptId, plan: access.plan, paidUntil: access.paid_until, amountRub };
    });
    if (!reservation) return { skipped: true };

    try {
      const sent = await sendEmail({
        to: user.email,
        plan: reservation.plan,
        amountRub: reservation.amountRub,
        chargeAt: reservation.paidUntil,
        settingsUrl
      });
      const sentAt = now();
      await store.withPaymentTransaction(userId, async t => {
        const current = await t.get(reservation.key);
        if (current?.attempt_id !== reservation.attemptId) return null;
        await t.put(reservation.key, {
          ...current,
          status: 'sent',
          sent_at: sentAt.toISOString(),
          message_id: typeof sent?.MessageId === 'string' ? sent.MessageId.slice(0, 160) : null
        }, sentAt);
        return true;
      });
      return { sent: true };
    } catch (error) {
      const failedAt = now();
      await store.withPaymentTransaction(userId, async t => {
        const current = await t.get(reservation.key);
        if (current?.attempt_id !== reservation.attemptId) return null;
        await t.put(reservation.key, {
          ...current,
          status: 'failed',
          failed_at: failedAt.toISOString(),
          error_code: 'send_failed'
        }, failedAt);
        return true;
      });
      throw error;
    }
  }

  return async function run(event = {}) {
    const start = Date.parse(options.billingEnforcementStartedAt || '');
    if (options.enabled !== true || !Number.isFinite(start) || start > now().getTime()) return { disabled: true };
    if (event.httpMethod || event.requestContext?.http) throw new Error('Precharge notification worker must not be public HTTP');
    let after = typeof event.cursor === 'string' ? event.cursor : '';
    if (after && !/^[0-9a-f-]{36}$/i.test(after)) throw new Error('Invalid notification cursor');
    const result = { checked: 0, sent: 0, failed: 0, next_cursor: null };
    const elapsedNow = options.elapsedNow || Date.now;
    const deadline = elapsedNow() + (options.budgetMs || 180000);
    for (let page = 0; page < 5; page++) {
      const rows = await store.listPaymentRenewalUsers(after);
      for (const row of rows) {
        if (elapsedNow() >= deadline) { result.next_cursor = after; return result; }
        result.checked++;
        try {
          const notification = await notifyUser(row.user_id, start);
          if (notification.sent) result.sent++;
        } catch (_) { result.failed++; }
        after = row.user_id;
      }
      if (rows.length < 100) return result;
      after = rows.at(-1).user_id;
    }
    result.next_cursor = after;
    return result;
  };
}

let worker;
async function handler(event = {}) {
  const start = Date.parse(process.env.BILLING_ENFORCEMENT_STARTED_AT || '');
  if (process.env.PRECHARGE_NOTIFICATIONS_ENABLED !== 'true' || !Number.isFinite(start) || start > Date.now()) return { disabled: true };
  if (!worker) {
    const store = createYdbStore();
    worker = createPrechargeNotificationWorker(store, {
      enabled: true,
      billingEnforcementStartedAt: process.env.BILLING_ENFORCEMENT_STARTED_AT || '',
      appBaseUrl: process.env.APP_BASE_URL || 'https://qpokoy.ru/'
    });
  }
  try { return await worker(event); } catch (_) { return { failed: true, code: 'precharge_notification_worker_failed' }; }
}

module.exports = {
  handler,
  createPrechargeNotificationWorker,
  sendPrechargeNotificationEmail,
  hasValidPrechargeNoticeForUser,
  prechargeNoticeKey,
  isValidSentNotice,
  PRECHARGE_LEAD_MS,
  PRECHARGE_WINDOW_MS,
  NOTICE_LEASE_MS
};

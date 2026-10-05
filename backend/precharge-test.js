'use strict';

const { sendPrechargeNotificationEmail } = require('./precharge-notifications');
const { BILLING_PLANS } = require('./billing-payments');

function validEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function handler(event = {}) {
  if (event?.send_test_email !== true) return { ready: true, sent: false };
  if (process.env.PRECHARGE_TEST_EMAIL_ENABLED !== 'true') return { sent: false, code: 'test_email_disabled' };

  const to = validEmail(process.env.PRECHARGE_TEST_EMAIL_TO);
  if (!to) return { sent: false, code: 'test_email_recipient_missing' };

  const chargeAt = new Date(Date.now() + 4 * 86400000).toISOString();
  try {
    const result = await sendPrechargeNotificationEmail({
      to,
      plan: 'monthly',
      amountRub: BILLING_PLANS.monthly.price_rub,
      chargeAt,
      settingsUrl: process.env.APP_BASE_URL || 'https://qpokoy.ru/'
    });
    return {
      sent: true,
      message_id: typeof result?.MessageId === 'string' ? result.MessageId.slice(0, 160) : null
    };
  } catch (_) {
    return { sent: false, code: 'test_email_send_failed' };
  }
}

module.exports = { handler };

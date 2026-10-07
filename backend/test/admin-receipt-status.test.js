'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdminUsersData } = require('../index');

const UID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '2f17a9b0-1234-4abc-9def-1234567890ab';
const OLD_PAYMENT_ID = '3f17a9b0-1234-4abc-9def-1234567890ab';

function snapshot({ billing = true, receipt = null } = {}) {
  const settings = [];
  if (billing) settings.push({
    user_id: UID,
    setting_key: 'billing.access',
    setting_value: JSON.stringify({
      plan: 'monthly', paid_until: '2026-11-05T19:19:01.000Z', grace_until: '2026-11-08T19:19:01.000Z',
      auto_renew: true, last_payment_id: PAYMENT_ID, last_paid_at: '2026-10-06T17:19:01.000Z'
    })
  });
  if (receipt) settings.push({ user_id: UID, setting_key: 'billing.receipt.last', setting_value: JSON.stringify(receipt) });
  return {
    users: [{ user_id: UID, email: 'buyer@example.test', status: 'active', created_at: '2026-10-03T12:00:00.000Z', trial_ends_at: '2026-10-17T12:00:00.000Z' }],
    settings
  };
}

function status(input) {
  return buildAdminUsersData(input, '2026-10-01T00:00:00.000Z', new Date('2026-10-07T06:00:00.000Z')).users[0].receipt_status;
}

test('admin list marks a paid payment without a matching sent receipt as pending', () => {
  assert.equal(status(snapshot()), 'pending');
  assert.equal(status(snapshot({ receipt: { payment_id: OLD_PAYMENT_ID, receipt_url: 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/oldreceipt1/print', status: 'sent', started_at: '2026-10-06T19:00:00.000Z', sent_at: '2026-10-06T19:01:00.000Z' } })), 'pending');
});

test('admin list marks only the current payment receipt as sent', () => {
  assert.equal(status(snapshot({ receipt: { payment_id: PAYMENT_ID, receipt_url: 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print', status: 'sent', started_at: '2026-10-06T19:00:00.000Z', sent_at: '2026-10-06T19:01:00.000Z' } })), 'sent');
});

test('admin list treats in-flight receipt as needing attention and unpaid accounts as not required', () => {
  assert.equal(status(snapshot({ receipt: { payment_id: PAYMENT_ID, receipt_url: 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print', status: 'sending', started_at: '2026-10-07T05:59:00.000Z', sent_at: null } })), 'sending');
  assert.equal(status(snapshot({ billing: false })), 'not_required');
});

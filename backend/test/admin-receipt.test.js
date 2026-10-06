'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReceiptUrl, readReceiptRecord, planReceipt, RECEIPT_SETTING } = require('../admin-receipt');
const { sendReceiptEmail } = require('../receipt-mail');
const { METADATA_TOKEN_URL, POSTBOX_SEND_URL } = require('../mail');

test('receipt helper accepts only canonical My Tax receipt links', () => {
  const good = 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print';
  assert.equal(normalizeReceiptUrl(good), good);
  for (const bad of [
    'http://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print',
    'https://evil.example/api/v1/receipt/472501543470/2000oua7qn/print',
    'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print?x=1',
    'https://user:pass@lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print'
  ]) assert.equal(normalizeReceiptUrl(bad), null);
  assert.equal(RECEIPT_SETTING, 'billing.receipt.last');
  assert.equal(planReceipt('monthly').amount_rub, 149);
});

test('receipt records fail closed and normalize timestamps', () => {
  const row = { setting_value: JSON.stringify({
    payment_id: '2f17a9b0-1234-4abc-9def-1234567890ab',
    receipt_url: 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print',
    status: 'sent', sent_at: '2026-10-06T22:58:00+03:00', started_at: '2026-10-06T22:57:00+03:00'
  }) };
  const record = readReceiptRecord(row);
  assert.equal(record.status, 'sent');
  assert.equal(record.sent_at, '2026-10-06T19:58:00.000Z');
  assert.equal(readReceiptRecord({ setting_value: '{bad' }), null);
});

test('receipt email sends official link through Postbox', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === METADATA_TOKEN_URL) return { ok: true, json: async () => ({ access_token: 'iam-token' }) };
    if (url === POSTBOX_SEND_URL) return { ok: true, text: async () => '{}' };
    throw new Error('unexpected URL');
  };
  await sendReceiptEmail({
    to: 'buyer@example.test',
    receiptUrl: 'https://lknpd.nalog.ru/api/v1/receipt/472501543470/2000oua7qn/print',
    amountRub: 149,
    serviceName: 'Доступ к сервису qPokoy на 1 месяц',
    fetchImpl
  });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.Destination.ToAddresses, ['buyer@example.test']);
  assert.match(body.Content.Simple.Subject.Data, /Чек/);
  assert.match(body.Content.Simple.Body.Text.Data, /149/);
  assert.match(body.Content.Simple.Body.Text.Data, /lknpd\.nalog\.ru/);
});

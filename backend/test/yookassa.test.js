'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createYooKassaClient, YooKassaError } = require('../yookassa');

test('YooKassa client creates redirect payment with Basic auth and idempotence key', async () => {
  let call;
  const fetchImpl = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({
      id: '2d9f4f11-1111-2222-8333-abcdefabcdef',
      status: 'pending',
      confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/test' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createYooKassaClient({ shopId: '1482961', secretKey: 'top-secret-key', fetchImpl });
  const result = await client.createPayment({
    amountRub: 149,
    returnUrl: 'https://qpokoy.ru/?payment=return',
    description: 'qPokoy — подписка на месяц',
    savePaymentMethod: true,
    metadata: { app: 'qpokoy-v1', plan: 'monthly' },
    idempotenceKey: '7332a5a4-efba-4705-a914-3d6d3053bee2'
  });

  assert.equal(result.status, 'pending');
  assert.equal(call.url, 'https://api.yookassa.ru/v3/payments');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, 'Basic ' + Buffer.from('1482961:top-secret-key').toString('base64'));
  assert.equal(call.options.headers['Idempotence-Key'], '7332a5a4-efba-4705-a914-3d6d3053bee2');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body.amount, { value: '149.00', currency: 'RUB' });
  assert.equal(body.capture, true);
  assert.deepEqual(body.confirmation, { type: 'redirect', return_url: 'https://qpokoy.ru/?payment=return' });
  assert.equal(body.save_payment_method, true);
  assert.equal(body.metadata.app, 'qpokoy-v1');
});

test('YooKassa client reads payment and does not expose secret in provider errors', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(JSON.stringify({ id: 'pay-1234567890', status: 'succeeded' }), { status: 200 });
    return new Response(JSON.stringify({ type: 'error', code: 'invalid_request' }), { status: 400 });
  };
  const client = createYooKassaClient({ shopId: '1482961', secretKey: 'very-secret-value', fetchImpl });
  assert.equal((await client.getPayment('pay-1234567890')).status, 'succeeded');
  await assert.rejects(
    () => client.getPayment('pay-0987654321'),
    error => error instanceof YooKassaError && error.code === 'yookassa_invalid_request' && !error.message.includes('very-secret-value')
  );
});

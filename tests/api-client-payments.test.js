'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient } = require('../js/api-client.js');

function storageWithToken() {
  const values = new Map([['qPokoyYdbSessionTokenV1', '7332a5a4-efba-4705-a914-3d6d3053bee2.' + 'a'.repeat(43)]]);
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return payload === null ? '' : JSON.stringify(payload); }
  };
}

test('payment client methods call billing endpoints with bearer session', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/billing/payments') && options.method === 'POST') {
      return jsonResponse({ data: { payment_id: 'pay-1234567890', confirmation_url: 'https://pay.example/' } }, 201);
    }
    if (url.endsWith('/billing/payments/pay-1234567890')) {
      return jsonResponse({ data: { payment_id: 'pay-1234567890', status: 'succeeded' } });
    }
    if (url.endsWith('/billing/auto-renew')) return jsonResponse({ data: { auto_renew: false } });
    throw new Error('Unexpected request ' + url);
  };
  const api = createApiClient({ baseUrl: 'https://api.example', storage: storageWithToken(), fetchImpl });
  const requestId = 'b9119fc2-c825-44b7-ba49-7da50db62b4c';
  const payment = await api.createPayment('monthly', true, requestId);
  assert.equal(payment.payment_id, 'pay-1234567890');
  assert.deepEqual(JSON.parse(calls[0].options.body), { plan: 'monthly', auto_renew: true, request_id: requestId });
  assert.match(calls[0].options.headers.Authorization, /^Bearer /);

  assert.equal((await api.paymentStatus('pay-1234567890')).status, 'succeeded');
  assert.equal((await api.setBillingAutoRenew(false)).auto_renew, false);
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].options.body), { enabled: false });
});

test('retry preserves caller request identity and payment errors do not erase session', async () => {
  const calls=[],storage=storageWithToken();
  const api=createApiClient({baseUrl:'https://api.example',storage,fetchImpl:async(url,options)=>{
    calls.push(JSON.parse(options.body));return calls.length===1
      ?jsonResponse({error:{code:'yookassa_timeout',message:'Timeout'}},504)
      :jsonResponse({data:{payment_id:'pay-1234567890',status:'pending'}},201);
  }});
  const id='b9119fc2-c825-44b7-ba49-7da50db62b4c';
  await assert.rejects(api.createPayment('monthly',true,id),e=>e.status===504);
  assert.ok(storage.getItem('qPokoyYdbSessionTokenV1'));
  await api.createPayment('monthly',true,id);assert.deepEqual(calls[0],calls[1]);
});

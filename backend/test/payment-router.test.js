'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentRouter } = require('../payment-router');
const { newSession } = require('../security');
const { BILLING_ACCESS_SETTING, BILLING_PAYMENT_METHOD_SETTING, paymentSettingKey } = require('../billing-payments');

function fixture() {
  const current = new Date('2026-10-03T12:00:00.000Z');
  const user = {
    user_id: '7332a5a4-efba-4705-a914-3d6d3053bee2',
    email: 'user@example.com',
    status: 'active',
    created_at: current,
    trial_ends_at: new Date('2026-10-17T12:00:00.000Z')
  };
  const issued = newSession();
  const session = {
    session_id: issued.sessionId,
    user_id: user.user_id,
    secret_hash: issued.secretHash,
    expires_at: new Date('2026-11-03T12:00:00.000Z'),
    revoked_at: null
  };
  const settings = new Map();
  const key = (uid, settingKey) => uid + ':' + settingKey;
  const store = {
    async getSession(id) { return id === session.session_id ? session : null; },
    async getUser(id) { return id === user.user_id ? user : null; },
    async getSetting(uid, settingKey) { return settings.get(key(uid, settingKey)) || null; },
    async putSetting(row) { settings.set(key(row.user_id, row.setting_key), row); },
    async withPaymentTransaction(uid,operation) {
      const snapshot=new Map(settings);
      try { return await operation({get:async k=>parseSetting(settings.get(key(uid,k))),
        put:async(k,v,time)=>settings.set(key(uid,k),{user_id:uid,setting_key:k,setting_value:JSON.stringify(v),updated_at:time})}); }
      catch(e){settings.clear();for(const [k,v] of snapshot)settings.set(k,v);throw e;}
    },
    async consumeRateLimit() { return { allowed: true, retry_after_seconds: 0 }; }
  };
  let createdArgs = null;
  let verifiedPayment = null;
  const client = {
    isConfigured: () => true,
    async createPayment(args) {
      createdArgs = args;
      return {
        id: '2d9f4f11-1111-2222-8333-abcdefabcdef',
        status: 'pending',
        amount: { value: '149.00', currency: 'RUB' },
        metadata: args.metadata,
        created_at: current.toISOString(),
        confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/test' }
      };
    },
    async getPayment() { return verifiedPayment; }
  };
  const router = createPaymentRouter(store, {
    client,
    now: () => new Date(current),
    appBaseUrl: 'https://qpokoy.ru/'
  });
  return {
    router,
    token: issued.token,
    user,
    settings,
    key,
    getCreatedArgs: () => createdArgs,
    setVerifiedPayment: value => { verifiedPayment = value; }
  };
}

function parseSetting(row) { return row ? JSON.parse(row.setting_value) : null; }

test('authenticated user creates payment and successful verified webhook grants access', async () => {
  const f = fixture();
  const requestId = 'b9119fc2-c825-44b7-ba49-7da50db62b4c';
  const created = await f.router.handle(
    'POST',
    '/billing/payments',
    { plan: 'monthly', auto_renew: true, request_id: requestId },
    { Authorization: 'Bearer ' + f.token },
    { sourceIp: '127.0.0.1' }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.data.plan, 'monthly');
  assert.equal(created.body.data.amount_rub, 149);
  assert.equal(created.body.data.confirmation_url, 'https://yoomoney.ru/checkout/test');
  const args = f.getCreatedArgs();
  assert.equal(args.savePaymentMethod, true);
  assert.match(args.idempotenceKey,/^[0-9a-f]{64}$/);
  assert.equal(args.metadata.user_id, f.user.user_id);
  assert.equal(args.metadata.order_id,args.idempotenceKey);

  const paymentId = created.body.data.payment_id;
  assert.equal(parseSetting(f.settings.get(f.key(f.user.user_id, paymentSettingKey(paymentId)))).status, 'pending');

  f.setVerifiedPayment({
    id: paymentId,
    status: 'succeeded',
    paid: true,
    amount: { value: '149.00', currency: 'RUB' },
    metadata: args.metadata,
    created_at: '2026-10-03T12:00:00.000Z',
    captured_at: '2026-10-03T12:01:00.000Z',
    payment_method: { id: '2e000000-000f-5000-9000-1a2b3c4d5e6f', saved: true }
  });
  const webhook = await f.router.handle('POST', '/billing/yookassa/webhook', {
    type: 'notification',
    event: 'payment.succeeded',
    object: { id: paymentId }
  });
  assert.equal(webhook.status, 200);

  const access = parseSetting(f.settings.get(f.key(f.user.user_id, BILLING_ACCESS_SETTING)));
  assert.deepEqual(access, {
    plan: 'monthly',
    paid_until: '2026-11-03T12:01:00.000Z',
    grace_until: '2026-11-06T12:01:00.000Z',
    auto_renew: true,
    last_payment_id: paymentId,
    last_paid_at: '2026-10-03T12:01:00.000Z'
  });
  const method = parseSetting(f.settings.get(f.key(f.user.user_id, BILLING_PAYMENT_METHOD_SETTING)));
  assert.equal(method.payment_method_id, '2e000000-000f-5000-9000-1a2b3c4d5e6f');

  const second = await f.router.handle('POST', '/billing/yookassa/webhook', {
    type: 'notification', event: 'payment.succeeded', object: { id: paymentId }
  });
  assert.equal(second.status, 200);
  assert.equal(parseSetting(f.settings.get(f.key(f.user.user_id, BILLING_ACCESS_SETTING))).paid_until, '2026-11-03T12:01:00.000Z');
});

test('webhook is ignored when verified provider state does not match notification', async () => {
  const f = fixture();
  f.setVerifiedPayment({
    id: '2d9f4f11-1111-2222-8333-abcdefabcdef',
    status: 'pending',
    amount: { value: '149.00', currency: 'RUB' },
    metadata: { app: 'qpokoy-v1', user_id: f.user.user_id, plan: 'monthly', auto_renew: '0', paid_until: '2026-11-03T12:01:00.000Z', grace_until: '2026-11-06T12:01:00.000Z' }
  });
  const result = await f.router.handle('POST', '/billing/yookassa/webhook', {
    type: 'notification', event: 'payment.succeeded', object: { id: '2d9f4f11-1111-2222-8333-abcdefabcdef' }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, true);
  assert.equal(f.settings.has(f.key(f.user.user_id, BILLING_ACCESS_SETTING)), false);
});

test('auto-renew can be disabled after a paid subscription exists', async () => {
  const f = fixture();
  f.settings.set(f.key(f.user.user_id, BILLING_ACCESS_SETTING), {
    user_id: f.user.user_id,
    setting_key: BILLING_ACCESS_SETTING,
    setting_value: JSON.stringify({ plan: 'yearly', paid_until: '2027-10-03T12:00:00.000Z', grace_until: '2027-10-06T12:00:00.000Z', auto_renew: true })
  });
  const result = await f.router.handle('POST', '/billing/auto-renew', { enabled: false }, { Authorization: 'Bearer ' + f.token });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.auto_renew, false);
});

test('saved payment method can be unlinked without shortening paid access', async () => {
  const f = fixture();
  const paidUntil = '2026-11-03T12:00:00.000Z';
  f.settings.set(f.key(f.user.user_id, BILLING_ACCESS_SETTING), {
    user_id: f.user.user_id,
    setting_key: BILLING_ACCESS_SETTING,
    setting_value: JSON.stringify({ plan: 'monthly', paid_until: paidUntil, grace_until: '2026-11-06T12:00:00.000Z', auto_renew: true })
  });
  f.settings.set(f.key(f.user.user_id, BILLING_PAYMENT_METHOD_SETTING), {
    user_id: f.user.user_id,
    setting_key: BILLING_PAYMENT_METHOD_SETTING,
    setting_value: JSON.stringify({ payment_method_id: '2e000000-000f-5000-9000-1a2b3c4d5e6f', saved: true, source_payment_id: '2d9f4f11-1111-2222-8333-abcdefabcdef' })
  });

  const result = await f.router.handle('DELETE', '/billing/payment-method', {}, { Authorization: 'Bearer ' + f.token });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.unlinked, true);

  const access = parseSetting(f.settings.get(f.key(f.user.user_id, BILLING_ACCESS_SETTING)));
  assert.equal(access.auto_renew, false);
  assert.equal(access.paid_until, paidUntil);
  const method = parseSetting(f.settings.get(f.key(f.user.user_id, BILLING_PAYMENT_METHOD_SETTING)));
  assert.equal(method.saved, false);
  assert.equal(method.payment_method_id, null);
  assert.equal(method.source_payment_id, null);
});

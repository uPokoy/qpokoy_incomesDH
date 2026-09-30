'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getIamToken, sendPasswordResetEmail, sendEmailVerificationEmail, qPokoyEmailTemplate, METADATA_TOKEN_URL, POSTBOX_SEND_URL } = require('../mail');

function response(status, body, asJson = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => asJson ? body : JSON.parse(body || '{}'),
    text: async () => asJson ? JSON.stringify(body) : String(body || '')
  };
}

test('Postbox sender gets IAM token from metadata and sends UTF-8 reset email', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === METADATA_TOKEN_URL) return response(200, { access_token: 'iam-token' }, true);
    if (url === POSTBOX_SEND_URL) return response(200, '{"MessageId":"message-1"}');
    throw new Error('unexpected URL');
  };
  const resetUrl = 'https://qpokoy.ru/?reset_token=abc';
  const result = await sendPasswordResetEmail({ to: 'тест@example.com', resetUrl, fetchImpl: fakeFetch });
  assert.equal(result.MessageId, 'message-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Metadata-Flavor'], 'Google');
  assert.equal(calls[1].init.headers['X-YaCloud-SubjectToken'], 'iam-token');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.FromEmailAddress, 'noreply@qpokoy.ru');
  assert.deepEqual(body.Destination.ToAddresses, ['тест@example.com']);
  assert.equal(body.Content.Simple.Subject.Data, 'qPokoy — восстановление пароля');
  assert.match(body.Content.Simple.Body.Text.Data, /30 минут/);
  assert.match(body.Content.Simple.Body.Html.Data, /Восстановление пароля/);
  assert.match(body.Content.Simple.Body.Html.Data, /#050914/);
  assert.match(body.Content.Simple.Body.Html.Data, /#0b2344/);
  assert.match(body.Content.Simple.Body.Html.Data, /reset_token=abc/);
});

test('Postbox sender sends UTF-8 registration verification email', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === METADATA_TOKEN_URL) return response(200, { access_token: 'iam-token' }, true);
    if (url === POSTBOX_SEND_URL) return response(200, '{"MessageId":"message-verify"}');
    throw new Error('unexpected URL');
  };
  const verificationUrl = 'https://qpokoy.ru/?verify_token=user.secret';
  const result = await sendEmailVerificationEmail({ to: 'тест@example.com', verificationUrl, fetchImpl: fakeFetch });
  assert.equal(result.MessageId, 'message-verify');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.Content.Simple.Subject.Data, 'qPokoy — подтверждение электронной почты');
  assert.match(body.Content.Simple.Body.Text.Data, /24 часа/);
  assert.match(body.Content.Simple.Body.Html.Data, /Подтверждение электронной почты/);
  assert.match(body.Content.Simple.Body.Html.Data, /Подтвердить почту/);
  assert.match(body.Content.Simple.Body.Html.Data, /verify_token=user.secret/);
});

test('qPokoy email template escapes dynamic text and link attributes', () => {
  const html = qPokoyEmailTemplate({
    title: '<Подтверждение>',
    text: 'Текст & проверка',
    actionLabel: 'Открыть "ссылку"',
    actionUrl: 'https://qpokoy.ru/?x=1&y="2"',
    note: "Примечание <тест>"
  });
  assert.match(html, /&lt;Подтверждение&gt;/);
  assert.match(html, /Текст &amp; проверка/);
  assert.match(html, /Открыть &quot;ссылку&quot;/);
  assert.match(html, /x=1&amp;y=&quot;2&quot;/);
  assert.doesNotMatch(html, /<Подтверждение>/);
});

test('IAM and Postbox failures are surfaced to the caller', async () => {
  await assert.rejects(getIamToken(async () => response(500, 'nope')), /IAM token request failed/);
  let step = 0;
  const fakeFetch = async () => {
    step++;
    return step === 1 ? response(200, { access_token: 'iam-token' }, true) : response(403, 'denied');
  };
  await assert.rejects(sendPasswordResetEmail({ to: 'a@example.com', resetUrl: 'https://qpokoy.ru/', fetchImpl: fakeFetch }), /Postbox send failed/);
});

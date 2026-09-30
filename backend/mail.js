'use strict';

const METADATA_TOKEN_URL = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
const POSTBOX_SEND_URL = 'https://postbox.cloud.yandex.net/v2/email/outbound-emails';

async function getIamToken(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
  const response = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!response.ok) throw new Error(`IAM token request failed (${response.status})`);
  const payload = await response.json();
  if (!payload?.access_token) throw new Error('IAM token response is invalid');
  return payload.access_token;
}

async function sendPasswordResetEmail({ to, resetUrl, from = 'noreply@qpokoy.ru', fetchImpl = globalThis.fetch }) {
  const iamToken = await getIamToken(fetchImpl);
  const subject = 'Восстановление пароля qPokoy';
  const text = [
    'Вы запросили восстановление пароля qPokoy.',
    '',
    'Чтобы задать новый пароль, откройте ссылку:',
    resetUrl,
    '',
    'Ссылка действует 30 минут и может быть использована только один раз.',
    'Если вы не запрашивали восстановление, просто проигнорируйте это письмо.'
  ].join('\n');
  const html = `<!doctype html><html lang="ru"><body style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">
    <h2>Восстановление пароля qPokoy</h2>
    <p>Вы запросили восстановление пароля qPokoy.</p>
    <p><a href="${resetUrl}">Задать новый пароль</a></p>
    <p>Ссылка действует 30 минут и может быть использована только один раз.</p>
    <p>Если вы не запрашивали восстановление, просто проигнорируйте это письмо.</p>
  </body></html>`;
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

module.exports = { getIamToken, sendPasswordResetEmail, METADATA_TOKEN_URL, POSTBOX_SEND_URL };

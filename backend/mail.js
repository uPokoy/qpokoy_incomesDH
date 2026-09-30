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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function qPokoyEmailTemplate({ title, text, actionLabel, actionUrl, note }) {
  const safeTitle = escapeHtml(title);
  const safeText = escapeHtml(text);
  const safeLabel = escapeHtml(actionLabel);
  const safeUrl = escapeHtml(actionUrl);
  const safeNote = escapeHtml(note);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#050914;color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#050914;">
    <tr>
      <td align="center" style="padding:28px 12px 36px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="height:54px;overflow:hidden;border-radius:28px 28px 0 0;background:#081426;">
              <div style="height:54px;border-radius:0 0 70% 45%;background:#0b2344;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 14px;background:#081426;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#0b1220;border:1px solid #1d2b40;border-radius:20px;">
                <tr>
                  <td style="padding:34px 30px 30px;">
                    <div style="margin:0 0 24px;font-size:24px;line-height:1;font-weight:700;letter-spacing:-0.6px;color:#f8fafc;">qPokoy</div>
                    <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:#f8fafc;">${safeTitle}</h1>
                    <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#cbd5e1;">${safeText}</p>

                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="border-radius:12px;background:#e9edf2;">
                          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 20px;font-size:14px;line-height:18px;font-weight:700;color:#273142;text-decoration:none;border-radius:12px;">${safeLabel}</a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">${safeNote}</p>
                    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#64748b;">Если кнопка не открывается, скопируйте ссылку в браузер:<br>
                      <a href="${safeUrl}" style="color:#94a3b8;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:70px;overflow:hidden;border-radius:0 0 28px 28px;background:#081426;">
              <div style="height:70px;border-radius:65% 40% 0 0;background:#0b2344;"></div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 18px 0;font-size:11px;line-height:1.55;color:#526277;">
              qPokoy · учёт доходов
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendPostboxEmail({ to, from, subject, text, html, fetchImpl }) {
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

async function sendPasswordResetEmail({ to, resetUrl, from = 'noreply@qpokoy.ru', fetchImpl = globalThis.fetch }) {
  const subject = 'qPokoy — восстановление пароля';
  const text = [
    'Восстановление пароля qPokoy',
    '',
    'Вы запросили восстановление пароля.',
    'Чтобы задать новый пароль, откройте ссылку:',
    resetUrl,
    '',
    'Ссылка действует 30 минут и может быть использована только один раз.',
    'Если вы не запрашивали восстановление, просто проигнорируйте это письмо.'
  ].join('\n');
  const html = qPokoyEmailTemplate({
    title: 'Восстановление пароля',
    text: 'Вы запросили восстановление пароля. Нажмите кнопку ниже, чтобы задать новый пароль.',
    actionLabel: 'Задать новый пароль',
    actionUrl: resetUrl,
    note: 'Ссылка действует 30 минут и может быть использована только один раз. Если вы не запрашивали восстановление, просто проигнорируйте это письмо.'
  });
  return sendPostboxEmail({ to, from, subject, text, html, fetchImpl });
}

async function sendEmailVerificationEmail({ to, verificationUrl, from = 'noreply@qpokoy.ru', fetchImpl = globalThis.fetch }) {
  const subject = 'qPokoy — подтверждение электронной почты';
  const text = [
    'Подтверждение электронной почты qPokoy',
    '',
    'Чтобы завершить регистрацию, подтвердите адрес электронной почты:',
    verificationUrl,
    '',
    'Ссылка действует 24 часа и может быть использована только один раз.',
    'Если вы не регистрировались в qPokoy, просто проигнорируйте это письмо.'
  ].join('\n');
  const html = qPokoyEmailTemplate({
    title: 'Подтверждение электронной почты',
    text: 'Спасибо за регистрацию в qPokoy. Подтвердите адрес электронной почты, чтобы завершить создание аккаунта.',
    actionLabel: 'Подтвердить почту',
    actionUrl: verificationUrl,
    note: 'Ссылка действует 24 часа и может быть использована только один раз. Если вы не регистрировались в qPokoy, просто проигнорируйте это письмо.'
  });
  return sendPostboxEmail({ to, from, subject, text, html, fetchImpl });
}

module.exports = {
  getIamToken,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  qPokoyEmailTemplate,
  METADATA_TOKEN_URL,
  POSTBOX_SEND_URL
};

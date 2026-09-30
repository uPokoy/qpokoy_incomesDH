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

function qPokoyEmailTemplate({
  pageTitle,
  icon,
  title,
  firstLine,
  secondLine,
  actionLabel,
  actionUrl,
  ignoreText
}) {
  const safeUrl = escapeHtml(actionUrl);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    @media only screen and (max-width:620px) {
      .qp-outer { padding:16px 10px !important; }
      .qp-main { padding:26px 22px 28px !important; }
      .qp-header { padding:24px 22px !important; }
      .qp-h1 { font-size:25px !important; line-height:1.2 !important; }
      .qp-button { width:100% !important; }
      .qp-button a { display:block !important; width:100% !important; min-width:0 !important; }
      .qp-body-text { font-size:15px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#070b12;color:#eef3f8;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#070b12" style="width:100%;border-collapse:collapse;background-color:#070b12;background-image:radial-gradient(ellipse 77% 47% at -8% 72%,rgba(35,50,70,.84) 0%,rgba(30,43,61,.9) 45%,rgba(14,23,36,.89) 63%,transparent 64%),radial-gradient(ellipse 82% 53% at 108% 15%,rgba(40,55,77,.82) 0%,rgba(27,40,58,.9) 49%,rgba(12,20,32,.93) 68%,transparent 69%),linear-gradient(145deg,#05080e 0%,#09111c 42%,#070c14 72%,#04070c 100%);background-repeat:no-repeat;">
  <tr>
    <td align="center" class="qp-outer" style="padding:36px 16px 42px;">
      <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border-collapse:separate;border-spacing:0;background:#121a25;border:1px solid #344155;border-radius:20px;overflow:hidden;">
        <tr>
          <td class="qp-header" bgcolor="#192332" style="background:#192332;padding:29px 36px 25px;border-bottom:1px solid #344155;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" align="left">
                  <span style="font-size:31px;font-weight:800;letter-spacing:-1px;line-height:1;color:#ffffff;"><span style="color:#398df9;">q</span>Pokoy</span><br>
                  <span style="display:inline-block;margin-top:5px;color:#aab5c4;font-size:13px;letter-spacing:.3px;">Учёт доходов</span>
                </td>
                <td align="right" valign="bottom" width="85" style="width:85px;white-space:nowrap;">
                  <table role="presentation" cellpadding="0" cellspacing="3" border="0" align="right" style="height:48px;">
                    <tr valign="bottom">
                      <td valign="bottom"><div style="width:10px;height:17px;background:#388df3;border-radius:5px 5px 0 0;">&nbsp;</div></td>
                      <td valign="bottom"><div style="width:10px;height:28px;background:#388df3;border-radius:5px 5px 0 0;">&nbsp;</div></td>
                      <td valign="bottom"><div style="width:10px;height:39px;background:#388df3;border-radius:5px 5px 0 0;">&nbsp;</div></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="qp-main" bgcolor="#121a25" align="center" style="padding:36px 36px 34px;background-color:#121a25;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td align="center" style="padding:0 0 23px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td align="center" valign="middle" width="70" height="70" bgcolor="#1b2f49" style="width:70px;height:70px;border:1px solid #385d8e;border-radius:18px;background:#1b2f49;color:#71a7ff;font-family:Arial,Helvetica,sans-serif;font-size:43px;font-weight:700;line-height:70px;">${icon}</td></tr>
                </table>
              </td></tr>
              <tr><td align="center" style="padding:0 0 25px;">
                <h1 class="qp-h1" style="margin:0;color:#f7faff;font-size:29px;font-weight:750;line-height:1.2;">${escapeHtml(title)}</h1>
              </td></tr>
              <tr><td align="center" class="qp-body-text" style="color:#cdd7e5;font-size:16px;line-height:1.6;padding:0 0 12px;">${escapeHtml(firstLine)}</td></tr>
              <tr><td align="center" class="qp-body-text" style="color:#cdd7e5;font-size:16px;line-height:1.6;padding:0 0 29px;">${escapeHtml(secondLine)}</td></tr>
              <tr><td align="center" style="padding:0 0 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" class="qp-button" style="border-collapse:separate;">
                  <tr><td align="center" bgcolor="#2c6fe4" style="border-radius:13px;background:#2c6fe4;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;box-sizing:border-box;min-width:250px;padding:16px 24px;border:1px solid #4383ef;border-radius:13px;background:#2c6fe4;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1.35;text-align:center;mso-padding-alt:0;text-underline-color:#2c6fe4;">${escapeHtml(actionLabel)} &nbsp;&rarr;</a>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 0 25px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid #344155;border-radius:12px;background:#192332;">
                  <tr><td style="padding:14px 17px;color:#c3cfdf;font-size:13px;line-height:1.55;">
                    Если кнопка не работает, скопируйте ссылку из письма и откройте её в браузере.<br>
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:7px;color:#79aaff;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">${safeUrl}</a>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="height:1px;background:#344155;font-size:1px;line-height:1px;">&nbsp;</td></tr>
              <tr><td align="center" style="padding:20px 0 0;color:#aab5c4;font-size:13px;line-height:1.55;">${escapeHtml(ignoreText)}</td></tr>
            </table>
          </td>
        </tr>
        <tr><td bgcolor="#192332" align="center" style="border-top:1px solid #344155;background:#192332;padding:20px 20px 24px;color:#aab5c4;font-size:13px;line-height:1.7;">
          С уважением,<br><strong style="font-size:14px;color:#f5f9ff;">Команда qPokoy</strong>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
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

async function sendPasswordResetEmail({ to, resetUrl, from = 'qPokoy <noreply@qpokoy.ru>', fetchImpl = globalThis.fetch }) {
  const subject = 'qPokoy — восстановление пароля';
  const text = [
    'Сбросьте пароль — qPokoy',
    '',
    'Вы отправили запрос на восстановление пароля в qPokoy.',
    'Чтобы установить новый пароль, откройте ссылку:',
    resetUrl,
    '',
    'Ссылка действует 30 минут и может быть использована только один раз.',
    'Если вы не отправляли запрос на восстановление пароля, просто проигнорируйте это письмо.'
  ].join('\n');
  const html = qPokoyEmailTemplate({
    pageTitle: 'Сбросьте пароль — qPokoy',
    icon: '&#8635;',
    title: 'Сбросьте пароль',
    firstLine: 'Вы отправили запрос на восстановление пароля в qPokoy.',
    secondLine: 'Чтобы установить новый пароль, перейдите по ссылке ниже.',
    actionLabel: 'Сбросить пароль',
    actionUrl: resetUrl,
    ignoreText: 'Если вы не отправляли запрос на восстановление пароля, просто проигнорируйте это письмо.'
  });
  return sendPostboxEmail({ to, from, subject, text, html, fetchImpl });
}

async function sendEmailVerificationEmail({ to, verificationUrl, from = 'qPokoy <noreply@qpokoy.ru>', fetchImpl = globalThis.fetch }) {
  const subject = 'qPokoy — подтверждение электронной почты';
  const text = [
    'Подтвердите ваш email — qPokoy',
    '',
    'Вы создали аккаунт в qPokoy.',
    'Чтобы завершить регистрацию и начать пользоваться сервисом, подтвердите адрес электронной почты:',
    verificationUrl,
    '',
    'Ссылка действует 24 часа и может быть использована только один раз.',
    'Если вы не создавали аккаунт в qPokoy, просто проигнорируйте это письмо.'
  ].join('\n');
  const html = qPokoyEmailTemplate({
    pageTitle: 'Подтвердите ваш email — qPokoy',
    icon: '&#10003;',
    title: 'Подтвердите ваш email',
    firstLine: 'Вы создали аккаунт в qPokoy.',
    secondLine: 'Чтобы завершить регистрацию и начать пользоваться сервисом, подтвердите адрес электронной почты.',
    actionLabel: 'Подтвердить email',
    actionUrl: verificationUrl,
    ignoreText: 'Если вы не создавали аккаунт в qPokoy, просто проигнорируйте это письмо.'
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

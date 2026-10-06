'use strict';

const { getIamToken, qPokoyEmailTemplate, POSTBOX_SEND_URL } = require('./mail');

async function sendPostbox({ to, from, subject, text, html, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
  const iamToken = await getIamToken(fetchImpl);
  const response = await fetchImpl(POSTBOX_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-YaCloud-SubjectToken': iamToken },
    body: JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: { Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          Html: { Data: html, Charset: 'UTF-8' }
        }
      } }
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Postbox send failed (${response.status})${details ? ': ' + details.slice(0, 500) : ''}`);
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : {};
}

async function sendReceiptEmail({
  to,
  receiptUrl,
  amountRub,
  serviceName,
  from = 'qPokoy <noreply@qpokoy.ru>',
  fetchImpl = globalThis.fetch
}) {
  const subject = 'Чек об оплате qPokoy';
  const text = [
    'Чек об оплате qPokoy',
    '',
    `Спасибо за оплату. ${serviceName}.`,
    `Сумма: ${amountRub} ₽.`,
    '',
    'Официальный чек «Мой налог»:',
    receiptUrl,
    '',
    'Сохраните это письмо или ссылку на чек.'
  ].join('\n');
  const html = qPokoyEmailTemplate({
    pageTitle: 'Чек об оплате — qPokoy',
    icon: '&#10003;',
    title: 'Чек об оплате',
    firstLine: 'Спасибо за оплату qPokoy.',
    secondLine: `${serviceName}. Сумма: ${amountRub} ₽.`,
    actionLabel: 'Открыть чек',
    actionUrl: receiptUrl,
    ignoreText: 'Это официальный чек, сформированный в сервисе «Мой налог».',
    previewText: `Чек qPokoy на сумму ${amountRub} ₽`,
    noteLines: ['Это официальный чек, сформированный в сервисе «Мой налог».', 'Сохраните это письмо или ссылку на чек.']
  });
  return sendPostbox({ to, from, subject, text, html, fetchImpl });
}

module.exports = { sendReceiptEmail };

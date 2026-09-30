'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler, MAX_BODY_BYTES } = require('../index');

test('request size is capped at 2 MiB before database initialization', async () => {
  assert.equal(MAX_BODY_BYTES, 2 * 1024 * 1024);
  const response = await handler({ httpMethod: 'POST', path: '/incomes/replace', body: 'x'.repeat(MAX_BODY_BYTES + 1) });
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error.code, 'payload_too_large');
  const encoded = await handler({ httpMethod: 'POST', path: '/incomes/replace', isBase64Encoded: true,
    body: 'A'.repeat(4 * Math.ceil(MAX_BODY_BYTES / 3) + 4) });
  assert.equal(encoded.statusCode, 413);
});

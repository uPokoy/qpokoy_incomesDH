'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { newEmailVerificationToken, parseEmailVerificationToken } = require('../security');
const hash = value => createHash('sha256').update(value).digest('hex');

test('legacy verification token format and hash remain compatible, including uppercase UUIDs', () => {
  const uid = randomUUID().toUpperCase(), token = newEmailVerificationToken(uid);
  const secret = token.token.split('.')[1];
  assert.equal(token.tokenHash, hash(secret));
  assert.deepEqual(parseEmailVerificationToken(token.token), { userId: uid, tokenHash: token.tokenHash });
});

test('Android source is covered by the same stored hash and accepts only exact enum suffix', () => {
  const uid = randomUUID(), token = newEmailVerificationToken(uid, 'android');
  const proof = token.token.slice(uid.length + 1);
  assert.equal(token.tokenHash, hash(proof));
  assert.deepEqual(parseEmailVerificationToken(token.token), { userId: uid, tokenHash: token.tokenHash, client: 'android' });
  assert.notEqual(parseEmailVerificationToken(token.token.replace(/\.android$/, '')).tokenHash, token.tokenHash);
  const web = newEmailVerificationToken(uid);
  assert.notEqual(parseEmailVerificationToken(web.token + '.android').tokenHash, web.tokenHash);
  for (const value of ['bad', token.token + '.android', token.token + '?client=android',
    token.token.replace(/android$/, 'ANDROID'), token.token.replace(/android$/, 'web'), token.token + '#x']) {
    assert.equal(parseEmailVerificationToken(value), null);
  }
});

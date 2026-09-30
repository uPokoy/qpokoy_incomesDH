'use strict';

const { randomBytes, randomUUID, createHash, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}

function newSession() {
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  return { sessionId, secret, token: `${sessionId}.${secret}`, secretHash: hashSecret(secret) };
}

function hashSecret(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function parseToken(header) {
  const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(String(header || ''));
  return match ? { sessionId: match[1], secret: match[2] } : null;
}

function verifySecret(secret, storedHash) {
  if (!/^[a-f0-9]{64}$/i.test(String(storedHash || ''))) return false;
  return timingSafeEqual(Buffer.from(hashSecret(secret), 'hex'), Buffer.from(storedHash, 'hex'));
}

module.exports = { hashPassword, verifyPassword, newSession, parseToken, verifySecret };

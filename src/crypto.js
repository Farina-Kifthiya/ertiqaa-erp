const crypto = require('crypto');
const config = require('./config');

const KEY = crypto.createHash('sha256').update(String(config.encryptionKey)).digest();

function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64');
}

function decryptBuffer(b64) {
  const raw = Buffer.from(String(b64), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmac(payload, secret = config.jwtSecret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function signToken(data, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw Object.assign(new Error('Invalid or expired link'), { status: 400 });
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw Object.assign(new Error('Invalid or expired link'), { status: 400 });
  }
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!data.exp || Date.now() > data.exp) throw Object.assign(new Error('This link has expired. Request a fresh one.'), { status: 410 });
  return data;
}

function randomPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out;
  do {
    out = Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join('');
  } while (!/[A-Z]/.test(out) || !/[a-z]/.test(out) || !/[0-9]/.test(out) || !/[^A-Za-z0-9]/.test(out));
  return out;
}

module.exports = { encryptBuffer, decryptBuffer, sha256, hmac, signToken, verifyToken, randomPassword };

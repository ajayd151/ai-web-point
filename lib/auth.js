// Server-side session auth. The password lives ONLY in env (APP_PASSWORD) and
// is never sent to the client, so it can't be seen in View Source / DevTools.
// A signed, HttpOnly cookie proves a successful login; the HMAC key is the
// password itself, so no separate secret is needed.
const crypto = require('crypto');

const SEP = '|';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function hmac(payload) {
  const secret = process.env.APP_PASSWORD || '';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function sign(username, now) {
  const exp = now + TTL_MS;
  const payload = (username || 'user') + SEP + exp;
  return Buffer.from(payload + SEP + hmac(payload)).toString('base64');
}

function verify(token, now) {
  try {
    if (!process.env.APP_PASSWORD || !token) return false;
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(SEP);
    if (parts.length < 3) return false;
    const mac = parts.pop();
    const payload = parts.join(SEP);
    const expected = hmac(payload);
    if (mac.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
    const exp = Number(parts[1]);
    return !!exp && exp > now;
  } catch (e) {
    return false;
  }
}

function constantEquals(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookie(req, name) {
  const h = (req.headers && req.headers.cookie) || '';
  const m = h.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

module.exports = { sign, verify, constantEquals, parseCookie };

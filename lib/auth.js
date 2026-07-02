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

// `account` (optional) is the email of the WORKSPACE this login belongs to. For a normal
// user it equals their own email (omitted). For a team member it is their account owner's
// email, so the data layer scopes them to the shared workspace. Stored as an extra payload
// field; verify() still finds exp at parts[1], so old 2-field cookies keep working.
function sign(username, now, account) {
  const exp = now + TTL_MS;
  let payload = (username || 'user') + SEP + exp;
  if (account && String(account).toLowerCase() !== String(username || '').toLowerCase()) {
    payload += SEP + String(account).toLowerCase();
  }
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

// Returns the identity (username/email) baked into a VALID session cookie, else null.
function identity(token, now) {
  try {
    if (!verify(token, now)) return null;
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(SEP);
    return parts[0] || null;
  } catch (e) {
    return null;
  }
}

// The WORKSPACE email a valid cookie is scoped to: the optional account field if present,
// else the identity itself. Used by the tenant layer so team members share their owner's data.
function accountOf(token, now) {
  try {
    if (!verify(token, now)) return null;
    const parts = Buffer.from(token, 'base64').toString('utf8').split(SEP);
    // parts = [email, exp, (account?), hmac]; a 4-part token carries an account at [2]
    if (parts.length >= 4) return parts[2] || parts[0];
    return parts[0] || null;
  } catch (e) {
    return null;
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

module.exports = { sign, verify, identity, accountOf, constantEquals, parseCookie };

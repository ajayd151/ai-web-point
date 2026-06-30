// Multi-tenant scoping. Every per-customer blob path / DB row is namespaced by the
// signed-in user. The OWNER (operator) keeps the legacy root namespace so the existing
// app + data are completely unchanged; every other customer gets an isolated `u/<hash>/`
// blob prefix and a stable user_key. Until public sign-ups open (allow-list = owner only),
// this is a no-op for the live app, it just makes the data layer ready for real tenants.
const crypto = require('crypto');
const { identity, parseCookie } = require('./auth');

function ownerEmail() {
  return String(
    process.env.OWNER_EMAIL ||
    (process.env.ALLOWED_EMAILS || '').split(',')[0] ||
    'ajay@aimpro.co.uk'
  ).trim().toLowerCase();
}

// The signed-in email from the session cookie, lowercased ('' if not logged in).
function emailOf(req) {
  const e = identity(parseCookie(req, 'aiwp'), Date.now());
  return e ? String(e).toLowerCase() : '';
}

function hash(email, len) {
  return crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, len);
}

// Blob path prefix for this request's tenant. Owner => '' (root, unchanged).
// Other customers => 'u/<12-hex>/'. Anonymous/public requests => '' (owner namespace).
function tenantPrefix(req) {
  const e = emailOf(req);
  if (!e || e === ownerEmail()) return '';
  return 'u/' + hash(e, 12) + '/';
}

// Stable key for DB columns / slugs. Owner => 'owner', others => 16-hex of the email.
function tenantKey(req) {
  const e = emailOf(req);
  if (!e) return 'anon';
  if (e === ownerEmail()) return 'owner';
  return hash(e, 16);
}

module.exports = { tenantPrefix, tenantKey, ownerEmail, emailOf };

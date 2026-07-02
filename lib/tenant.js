// Multi-tenant scoping. Every per-customer blob path / DB row is namespaced by the
// signed-in user. The OWNER (operator) keeps the legacy root namespace so the existing
// app + data are completely unchanged; every other customer gets an isolated `u/<hash>/`
// blob prefix and a stable user_key. Until public sign-ups open (allow-list = owner only),
// this is a no-op for the live app, it just makes the data layer ready for real tenants.
const crypto = require('crypto');
const { identity, accountOf, parseCookie } = require('./auth');

function ownerEmail() {
  return String(
    process.env.OWNER_EMAIL ||
    (process.env.ALLOWED_EMAILS || '').split(',')[0] ||
    'ajay@aimpro.co.uk'
  ).trim().toLowerCase();
}

// The signed-in PERSON's email from the session cookie, lowercased ('' if not logged in).
// Use this for attribution (who did something), NOT for data scoping.
function emailOf(req) {
  const e = identity(parseCookie(req, 'aiwp'), Date.now());
  return e ? String(e).toLowerCase() : '';
}

// The WORKSPACE email this request is scoped to: the account owner for a team member,
// otherwise the person themselves. All blob/DB/slug scoping uses THIS, so a team member
// shares their owner's data. Falls back to the person's email for old cookies.
function accountEmailOf(req) {
  const a = accountOf(parseCookie(req, 'aiwp'), Date.now());
  return a ? String(a).toLowerCase() : '';
}

function hash(email, len) {
  return crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, len);
}

// Blob path prefix for this request's tenant. Owner => '' (root, unchanged).
// Other customers => 'u/<12-hex>/'. Anonymous/public requests => '' (owner namespace).
function tenantPrefix(req) {
  const e = accountEmailOf(req);
  if (!e || e === ownerEmail()) return '';
  return 'u/' + hash(e, 12) + '/';
}

// Stable key for DB columns / slugs. Owner => 'owner', others => 16-hex of the email.
function tenantKey(req) {
  const e = accountEmailOf(req);
  if (!e) return 'anon';
  if (e === ownerEmail()) return 'owner';
  return hash(e, 16);
}

// Mockup/site slugs are public (served by URL to prospects), so we make them globally
// unique by embedding the tenant key: a non-owner's slug becomes `<16hex>--<base>`.
// The owner keeps clean, unchanged slugs. Public read endpoints look up by the full
// (unique) slug, so they need no change; only the list/dashboard views filter by owner.
function isTenantSlug(slug) { return /^[0-9a-f]{16}--/.test(String(slug || '')); }

// Namespace a base slug for this request's tenant. Idempotent: if the slug is already
// this tenant's (passed back from the client), it is returned unchanged.
function tenantSlug(req, base) {
  const k = tenantKey(req);
  base = String(base || '');
  if (k === 'owner' || k === 'anon') return base;
  if (base.startsWith(k + '--')) return base;
  return k + '--' + base;
}

// Does this request's tenant own this slug? (for filtering list views)
function ownsSlug(req, slug) {
  const k = tenantKey(req);
  if (k === 'owner') return !isTenantSlug(slug); // owner = every legacy/clean slug
  return String(slug || '').startsWith(k + '--');
}

module.exports = { tenantPrefix, tenantKey, ownerEmail, emailOf, accountEmailOf, isTenantSlug, tenantSlug, ownsSlug };

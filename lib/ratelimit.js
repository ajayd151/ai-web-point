// Rolling usage cap (cost safety-net). Each recorded event writes one tiny blob whose path
// encodes the person + kind + timestamp; we count them via list() (fresh, not CDN-cached) and
// prune expired ones.
//
// The quota is PER PERSON, not per workspace. It used to be shared across a whole workspace,
// which meant one busy teammate could starve everyone else (including the owner) out of searches.
// Each person now gets their own bucket, so caps are meaningful and predictable.
//
// Limits resolve in this order: Admin > Limits (the rate_limits table) -> USER_LIMITS env
// (legacy) -> the env default (LIMIT_SEARCH / LIMIT_GENERATE / LIMIT_PROWL / LIMIT_POUNCE /
// LIMIT_GRAMMAR). Window length is RATE_WINDOW_HOURS.
//
// IMPORTANT: prefer check() up front + record() ONLY after the work succeeds, so a
// failed/retried call (e.g. a transient OpenAI image failure) does NOT burn quota.
// checkAndRecord() (records immediately) is kept for cheap calls that rarely fail.
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');
const { getRateLimits } = require('./db');

const WINDOW_HOURS = Number(process.env.RATE_WINDOW_HOURS) || 20;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
const RATE_KINDS = ['search', 'generate', 'prowl', 'pounce', 'grammar', 'sms'];

// Legacy env override, kept working for anything already configured. Admin > Limits wins over it.
// {"mate@x.com":{"search":10,"generate":5,"prowl":5,"pounce":2}}
let _userLimits = null;
function userLimits() {
  if (_userLimits) return _userLimits;
  try { _userLimits = JSON.parse(process.env.USER_LIMITS || '{}'); } catch (e) { _userLimits = {}; }
  return _userLimits;
}
function globalLimit(kind) {
  if (kind === 'search') return Number(process.env.LIMIT_SEARCH || 30);
  if (kind === 'generate') return Number(process.env.LIMIT_GENERATE || 50);
  if (kind === 'prowl') return Number(process.env.LIMIT_PROWL || 30);
  if (kind === 'pounce') return Number(process.env.LIMIT_POUNCE || 30);
  if (kind === 'grammar') return Number(process.env.LIMIT_GRAMMAR || 300); // cheap call, generous cap
  if (kind === 'sms') return Number(process.env.LIMIT_SMS || 100); // per DAY (campaign worker), not per window
  return 20;
}
const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// Admin > Limits first, then the legacy env override, then the global default.
async function limitFor(kind, email) {
  const e = String(email || '').toLowerCase();
  if (e) {
    try {
      const db = await getRateLimits(e);
      const v = db && num(db[kind]);
      if (v != null) return v;
    } catch (err) { /* fall through to env, never block the request */ }
    const per = userLimits()[e];
    const v2 = per && num(per[kind]);
    if (v2 != null) return v2;
  }
  return globalLimit(kind);
}

// Each person counts against their own bucket. Hashed so no email ends up in a blob path.
function personKey(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return 'shared';
  return crypto.createHash('sha256').update(e).digest('hex').slice(0, 12);
}

// One usage event -> {person, kind, t}. Handles both layouts:
//   new:    usage/<personKey>/<kind>-<ts>-<id>.txt
//   legacy: usage/<kind>-<ts>-<id>.txt      (workspace-wide, person unknown)
// Legacy events belong to nobody now, so they count against no one, but we still parse them so
// they get pruned when they expire rather than lingering forever.
function parseEvent(pathname, url) {
  const rest = String(pathname).split('usage/')[1];
  if (!rest) return null;
  const parts = rest.split('/');
  const file = parts.pop() || '';
  const m = file.match(/^([a-z]+)-(\d+)-/);
  if (!m) return null;
  return { person: parts.length ? parts[0] : '', kind: m[1], t: Number(m[2]), url: url };
}

// Read usage, prune expired, and report whether this PERSON is under their limit for `kind`.
// No write. `prefix` namespaces per tenant, `email` narrows to the individual.
async function check(kind, now, prefix, email) {
  prefix = prefix || '';
  const limit = await limitFor(kind, email);
  const me = personKey(email);
  let blobs;
  try {
    blobs = (await list({ prefix: prefix + 'usage/' })).blobs || [];
  } catch (e) {
    // storage hiccup, fail open so the app stays usable
    return { ok: true, limit, used: 0, degraded: true, windowHours: WINDOW_HOURS };
  }

  const events = blobs.map((b) => parseEvent(b.pathname, b.url)).filter(Boolean);

  const expired = events.filter((e) => now - e.t >= WINDOW_MS);
  if (expired.length) { try { await del(expired.map((e) => e.url)); } catch (e) {} }

  const mine = events.filter((e) => now - e.t < WINDOW_MS && e.kind === kind && e.person === me);
  const used = mine.length;
  if (used >= limit) {
    const oldest = mine.sort((a, b) => a.t - b.t)[0];
    const retryMs = oldest ? oldest.t + WINDOW_MS - now : WINDOW_MS;
    return { ok: false, limit, used, retryHours: Math.max(1, Math.ceil(retryMs / 3600000)), windowHours: WINDOW_HOURS };
  }
  return { ok: true, limit, used, windowHours: WINDOW_HOURS };
}

// Record one usage event against this person (call this AFTER the work succeeds).
async function record(kind, now, prefix, email) {
  prefix = prefix || '';
  try {
    await put(`${prefix}usage/${personKey(email)}/${kind}-${now}-${crypto.randomUUID().slice(0, 8)}.txt`, '1', {
      access: 'public', addRandomSuffix: false, contentType: 'text/plain',
    });
  } catch (e) { /* best effort */ }
}

// Check + record in one step (for cheap calls that rarely fail after the check).
async function checkAndRecord(kind, now, prefix, email) {
  const r = await check(kind, now, prefix, email);
  if (r.ok && !r.degraded) await record(kind, now, prefix, email);
  return r.ok ? Object.assign({}, r, { used: r.used + 1 }) : r;
}

// Current in-window usage for everyone under one tenant prefix: { personKey: { kind: count } }.
// Read only, for the Admin > Limits screen: no pruning and no writes, so looking at the screen
// can never disturb anyone's quota.
async function usageByPerson(prefix, now) {
  const out = {};
  let blobs;
  try { blobs = (await list({ prefix: (prefix || '') + 'usage/' })).blobs || []; } catch (e) { return out; }
  blobs
    .map((b) => parseEvent(b.pathname, b.url))
    .filter((e) => e && (now - e.t) < WINDOW_MS)
    .forEach((e) => {
      if (!out[e.person]) out[e.person] = {};
      out[e.person][e.kind] = (out[e.person][e.kind] || 0) + 1;
    });
  return out;
}

module.exports = { check, record, checkAndRecord, limitFor, globalLimit, usageByPerson, personKey, WINDOW_HOURS, RATE_KINDS };

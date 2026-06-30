// Rolling usage cap (cost safety-net for a single-user tool). Each recorded event
// writes one tiny blob whose filename encodes the kind + timestamp; we count them
// via list() (fresh, not CDN-cached) and prune expired ones. Limits + window are
// env-overridable (LIMIT_SEARCH / LIMIT_GENERATE / LIMIT_PROWL / LIMIT_POUNCE /
// RATE_WINDOW_HOURS).
//
// IMPORTANT: prefer check() up front + record() ONLY after the work succeeds, so a
// failed/retried call (e.g. a transient OpenAI image failure) does NOT burn quota.
// checkAndRecord() (records immediately) is kept for cheap calls that rarely fail.
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const WINDOW_HOURS = Number(process.env.RATE_WINDOW_HOURS) || 20;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

function limitFor(kind) {
  if (kind === 'search') return Number(process.env.LIMIT_SEARCH || 30);
  if (kind === 'generate') return Number(process.env.LIMIT_GENERATE || 50);
  if (kind === 'prowl') return Number(process.env.LIMIT_PROWL || 30);
  if (kind === 'pounce') return Number(process.env.LIMIT_POUNCE || 30);
  if (kind === 'grammar') return Number(process.env.LIMIT_GRAMMAR || 300); // cheap call, generous cap
  return 20;
}

// Read usage, prune expired, and report whether `kind` is under its limit. No write.
// `prefix` namespaces the quota per tenant (owner => '' => the legacy global counter).
async function check(kind, now, prefix) {
  prefix = prefix || '';
  const limit = limitFor(kind);
  let blobs;
  try {
    blobs = (await list({ prefix: prefix + 'usage/' })).blobs || [];
  } catch (e) {
    // storage hiccup, fail open so the app stays usable
    return { ok: true, limit, used: 0, degraded: true, windowHours: WINDOW_HOURS };
  }

  const events = blobs
    .map((b) => {
      const m = b.pathname.match(/usage\/([a-z]+)-(\d+)-/); // unanchored: works with or without a tenant prefix
      return m ? { kind: m[1], t: Number(m[2]), url: b.url } : null;
    })
    .filter(Boolean);

  const recent = events.filter((e) => now - e.t < WINDOW_MS);
  const expired = events.filter((e) => now - e.t >= WINDOW_MS);
  if (expired.length) { try { await del(expired.map((e) => e.url)); } catch (e) {} }

  const used = recent.filter((e) => e.kind === kind).length;
  if (used >= limit) {
    const oldest = recent.filter((e) => e.kind === kind).sort((a, b) => a.t - b.t)[0];
    const retryMs = oldest ? oldest.t + WINDOW_MS - now : WINDOW_MS;
    return { ok: false, limit, used, retryHours: Math.max(1, Math.ceil(retryMs / 3600000)), windowHours: WINDOW_HOURS };
  }
  return { ok: true, limit, used, windowHours: WINDOW_HOURS };
}

// Record one usage event (call this AFTER the work succeeds).
async function record(kind, now, prefix) {
  prefix = prefix || '';
  try {
    await put(`${prefix}usage/${kind}-${now}-${crypto.randomUUID().slice(0, 8)}.txt`, '1', {
      access: 'public', addRandomSuffix: false, contentType: 'text/plain',
    });
  } catch (e) { /* best effort */ }
}

// Check + record in one step (for cheap calls that rarely fail after the check).
async function checkAndRecord(kind, now, prefix) {
  const r = await check(kind, now, prefix);
  if (r.ok && !r.degraded) await record(kind, now, prefix);
  return r.ok ? Object.assign({}, r, { used: r.used + 1 }) : r;
}

module.exports = { check, record, checkAndRecord, WINDOW_HOURS };

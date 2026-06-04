// Simple per-12h usage cap. Each allowed event writes one tiny blob whose
// filename encodes the kind + timestamp; we count them via list() (fresh, not
// CDN-cached) and prune expired ones. Good enough as a spend safety-net for a
// single-user tool. Limits overridable via env (LIMIT_SEARCH / LIMIT_GENERATE).
const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const WINDOW_MS = 12 * 60 * 60 * 1000;

function limitFor(kind) {
  if (kind === 'search') return Number(process.env.LIMIT_SEARCH || 20);
  if (kind === 'generate') return Number(process.env.LIMIT_GENERATE || 20);
  return 20;
}

async function checkAndRecord(kind, now) {
  const limit = limitFor(kind);
  let blobs;
  try {
    blobs = (await list({ prefix: 'usage/' })).blobs || [];
  } catch (e) {
    // storage hiccup — fail open so the app stays usable
    return { ok: true, limit, used: 0, degraded: true };
  }

  const events = blobs
    .map((b) => {
      const m = b.pathname.match(/^usage\/([a-z]+)-(\d+)-/);
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
    return { ok: false, limit, used, retryHours: Math.max(1, Math.ceil(retryMs / 3600000)) };
  }

  try {
    await put(`usage/${kind}-${now}-${crypto.randomUUID().slice(0, 8)}.txt`, '1', {
      access: 'public', addRandomSuffix: false, contentType: 'text/plain',
    });
  } catch (e) { /* best effort */ }

  return { ok: true, limit, used: used + 1 };
}

module.exports = { checkAndRecord };

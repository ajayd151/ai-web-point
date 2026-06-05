// Tiny data layer for link-tracking events (Vercel Postgres / Neon).
// Phase 1: records when a prospect opens a preview ('view') or clicks the
// "Request a demo" CTA ('cta'). Fails soft everywhere so tracking never
// breaks the page or the dashboard if the DB is unavailable.
const { sql } = require('@vercel/postgres');

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS link_events (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL,
    event TEXT NOT NULL DEFAULT 'view',
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    ua TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS link_events_slug_idx ON link_events (slug)`;
  ensured = true;
}

// Is the database configured at all? (env injected by the Vercel Postgres store)
function dbConfigured() {
  return !!(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL);
}

async function recordEvent(slug, event, ua) {
  if (!dbConfigured()) return false;
  try {
    await ensureTable();
    await sql`INSERT INTO link_events (slug, event, ua) VALUES (${slug}, ${event}, ${ua || null})`;
    return true;
  } catch (e) {
    console.error('recordEvent failed:', e.message);
    return false;
  }
}

// Returns a map: { [slug]: { view: {n, last}, cta: {n, last} } }
async function statsBySlug() {
  if (!dbConfigured()) return {};
  try {
    await ensureTable();
    const { rows } = await sql`
      SELECT slug, event, COUNT(*)::int AS n, MAX(ts) AS last
      FROM link_events GROUP BY slug, event`;
    const map = {};
    for (const r of rows) {
      map[r.slug] = map[r.slug] || {};
      map[r.slug][r.event] = { n: r.n, last: r.last };
    }
    return map;
  } catch (e) {
    console.error('statsBySlug failed:', e.message);
    return {};
  }
}

module.exports = { recordEvent, statsBySlug, dbConfigured };

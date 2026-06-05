// Tiny data layer for link-tracking events (Vercel Postgres / Neon).
// Phase 1: records when a prospect opens a preview ('view') or clicks the
// "Request a demo" CTA ('cta'). Fails soft everywhere so tracking never
// breaks the page or the dashboard if the DB is unavailable.
const { createPool } = require('@vercel/postgres');

// Build the pool from whichever pooled connection string the Neon/Vercel
// integration injected (names vary with the env-var prefix).
function connString() {
  return process.env.POSTGRES_URL
    || process.env.POSTGRES_DATABASE_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_PRISMA_URL
    || '';
}
let _pool = null;
function pool() {
  if (!_pool) _pool = createPool({ connectionString: connString() });
  return _pool;
}
const sql = (strings, ...values) => pool().sql(strings, ...values);

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
  await sql`ALTER TABLE link_events ADD COLUMN IF NOT EXISTS platform TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS link_events_slug_idx ON link_events (slug)`;
  ensured = true;
}

// Is the database configured at all? (env injected by the Vercel Postgres store)
function dbConfigured() {
  return !!connString();
}

async function recordEvent(slug, event, ua, platform) {
  if (!dbConfigured()) return false;
  try {
    await ensureTable();
    await sql`INSERT INTO link_events (slug, event, ua, platform) VALUES (${slug}, ${event}, ${ua || null}, ${platform || null})`;
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
    // platform of the most recent OPEN per slug (how they engaged: w/s/e)
    const { rows: plat } = await sql`
      SELECT DISTINCT ON (slug) slug, platform
      FROM link_events WHERE event = 'view'
      ORDER BY slug, ts DESC`;
    for (const r of plat) {
      map[r.slug] = map[r.slug] || {};
      map[r.slug].platform = r.platform || '';
    }
    return map;
  } catch (e) {
    console.error('statsBySlug failed:', e.message);
    return {};
  }
}

module.exports = { recordEvent, statsBySlug, dbConfigured };

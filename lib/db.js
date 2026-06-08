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

// Best-effort capture of a founding-member application (backup to the email).
async function recordApplication(a) {
  if (!dbConfigured()) return false;
  try {
    await sql`CREATE TABLE IF NOT EXISTS applications (
      id BIGSERIAL PRIMARY KEY,
      created TIMESTAMPTZ NOT NULL DEFAULT now(),
      name TEXT, email TEXT, business TEXT, website TEXT,
      role TEXT, volume TEXT, channels TEXT, why TEXT
    )`;
    await sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS phone TEXT`;
    await sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS jobtitle TEXT`;
    await sql`INSERT INTO applications (name, email, phone, jobtitle, business, website, role, volume, channels, why)
      VALUES (${a.name}, ${a.email}, ${a.phone || null}, ${a.jobtitle || null}, ${a.business || null}, ${a.website || null},
              ${a.role || null}, ${a.volume || null}, ${a.channels || null}, ${a.why || null})`;
    return true;
  } catch (e) {
    console.error('recordApplication failed:', e.message);
    return false;
  }
}

// Aggregated analytics for the performance dashboard. `since` = ISO string or null (all-time).
async function dashboardData(since) {
  if (!dbConfigured()) return null;
  await ensureTable();
  const s = since || null;
  const counts = (await sql`SELECT event, COUNT(DISTINCT slug)::int AS slugs, COUNT(*)::int AS total FROM link_events WHERE (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY event`).rows;
  const channel = (await sql`SELECT event, platform, COUNT(DISTINCT slug)::int AS slugs FROM link_events WHERE event IN ('sent','view') AND platform IS NOT NULL AND platform <> '' AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY event, platform`).rows;
  const byHour = (await sql`SELECT EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/London')::int AS h, COUNT(*)::int AS n FROM link_events WHERE event='view' AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY h`).rows;
  const byDow = (await sql`SELECT EXTRACT(DOW FROM ts AT TIME ZONE 'Europe/London')::int AS d, COUNT(*)::int AS n FROM link_events WHERE event='view' AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY d`).rows;
  const ttoRows = (await sql`
    SELECT AVG(EXTRACT(EPOCH FROM (view_at - sent_at))) / 60.0 AS avg_min
    FROM (
      SELECT slug, MIN(ts) FILTER (WHERE event='sent') AS sent_at, MIN(ts) FILTER (WHERE event='view') AS view_at
      FROM link_events WHERE (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY slug
    ) t WHERE sent_at IS NOT NULL AND view_at IS NOT NULL AND view_at >= sent_at`).rows;
  const rows = (await sql`
    SELECT slug,
      MIN(ts) FILTER (WHERE event='sent') AS sent_at,
      string_agg(DISTINCT platform, ',') FILTER (WHERE event='sent' AND platform <> '') AS sent_via,
      MIN(ts) FILTER (WHERE event='view') AS opened_at,
      COUNT(*) FILTER (WHERE event='view')::int AS opens,
      COUNT(*) FILTER (WHERE event='cta')::int AS demo_clicks
    FROM link_events WHERE (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY slug ORDER BY MAX(ts) DESC LIMIT 100`).rows;
  return { counts, channel, byHour, byDow, avgTtoMin: ttoRows[0] && ttoRows[0].avg_min, rows };
}

module.exports = { recordEvent, statsBySlug, dbConfigured, recordApplication, dashboardData };

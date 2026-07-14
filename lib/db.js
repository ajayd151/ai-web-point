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
  await sql`ALTER TABLE link_events ADD COLUMN IF NOT EXISTS tpl TEXT`; // which first-message template (per-template stats)
  await sql`CREATE INDEX IF NOT EXISTS link_events_slug_idx ON link_events (slug)`;
  ensured = true;
}

// Is the database configured at all? (env injected by the Vercel Postgres store)
function dbConfigured() {
  return !!connString();
}

async function recordEvent(slug, event, ua, platform, tpl) {
  if (!dbConfigured()) return false;
  try {
    await ensureTable();
    await sql`INSERT INTO link_events (slug, event, ua, platform, tpl) VALUES (${slug}, ${event}, ${ua || null}, ${platform || null}, ${tpl || null})`;
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
// `neg`/`tpat` scope the stats to one tenant via the slug marker: owner => neg=true,
// tpat='%--%' (every slug WITHOUT a `<16hex>--` prefix); a tenant => neg=false, tpat='<key>--%'.
// Defaults to the owner scope, which excludes nothing for the owner's legacy slugs.
async function dashboardData(since, neg, tpat) {
  if (!dbConfigured()) return null;
  await ensureTable();
  const s = since || null;
  if (neg === undefined) neg = true;
  if (tpat === undefined) tpat = '%--%';
  // NOTE: the mockup funnel tables exclude direct-message sends (slug LIKE 'dm-%', no
  // mockup/link); those live only in byTemplate below as no-link sends.
  const counts = (await sql`SELECT event, COUNT(DISTINCT slug)::int AS slugs, COUNT(*)::int AS total FROM link_events WHERE slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY event`).rows;
  const channel = (await sql`SELECT event, platform, COUNT(DISTINCT slug)::int AS slugs FROM link_events WHERE event IN ('sent','view') AND platform IS NOT NULL AND platform <> '' AND slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY event, platform`).rows;
  const byHour = (await sql`SELECT EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/London')::int AS h, COUNT(*)::int AS n FROM link_events WHERE event='view' AND slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY h`).rows;
  const byDow = (await sql`SELECT EXTRACT(DOW FROM ts AT TIME ZONE 'Europe/London')::int AS d, COUNT(*)::int AS n FROM link_events WHERE event='view' AND slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY d`).rows;
  const ttoRows = (await sql`
    SELECT AVG(EXTRACT(EPOCH FROM (view_at - sent_at))) / 60.0 AS avg_min
    FROM (
      SELECT slug, MIN(ts) FILTER (WHERE event='sent') AS sent_at, MIN(ts) FILTER (WHERE event='view') AS view_at
      FROM link_events WHERE slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY slug
    ) t WHERE sent_at IS NOT NULL AND view_at IS NOT NULL AND view_at >= sent_at`).rows;
  const rows = (await sql`
    SELECT slug,
      MIN(ts) FILTER (WHERE event='sent') AS sent_at,
      string_agg(DISTINCT platform, ',') FILTER (WHERE event='sent' AND platform <> '') AS sent_via,
      MIN(ts) FILTER (WHERE event='view') AS opened_at,
      COUNT(*) FILTER (WHERE event='view')::int AS opens,
      COUNT(*) FILTER (WHERE event='cta')::int AS demo_clicks,
      MIN(ts) FILTER (WHERE event='cta') AS demo_at,
      COUNT(*) FILTER (WHERE event='signup')::int AS signups
    FROM link_events WHERE slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz) GROUP BY slug ORDER BY MAX(ts) DESC LIMIT 100`).rows;
  // per-day activity for the last 31 days (London time), distinct businesses per event
  const byDay = (await sql`
    SELECT to_char((ts AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS day,
           event, COUNT(DISTINCT slug)::int AS n, array_agg(DISTINCT slug) AS slugs
    FROM link_events
    WHERE ts >= (now() - interval '31 days') AND slug NOT LIKE 'dm-%' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat})
    GROUP BY day, event`).rows;
  // per first-message template: how each one performed (distinct businesses per stage)
  const byTemplate = (await sql`
    SELECT tpl,
      COUNT(DISTINCT slug) FILTER (WHERE event='sent')::int AS sent,
      COUNT(DISTINCT slug) FILTER (WHERE event='view')::int AS viewed,
      COUNT(DISTINCT slug) FILTER (WHERE event='cta')::int AS demos,
      COUNT(DISTINCT slug) FILTER (WHERE event='signup')::int AS signups
    FROM link_events
    WHERE tpl IS NOT NULL AND tpl <> '' AND (${neg} AND slug NOT LIKE ${tpat} OR NOT ${neg} AND slug LIKE ${tpat}) AND (${s}::timestamptz IS NULL OR ts >= ${s}::timestamptz)
    GROUP BY tpl ORDER BY sent DESC, viewed DESC`).rows;
  return { counts, channel, byHour, byDow, avgTtoMin: ttoRows[0] && ttoRows[0].avg_min, rows, byDay, byTemplate };
}

// Slugs whose preview had a demo-CTA click (your hottest leads).
async function hotLeadRows() {
  if (!dbConfigured()) return [];
  await ensureTable();
  return (await sql`
    SELECT slug,
      MIN(ts) FILTER (WHERE event='view') AS opened_at,
      MIN(ts) FILTER (WHERE event='cta') AS demo_at,
      MIN(ts) FILTER (WHERE event='signup') AS signup_at,
      COUNT(*) FILTER (WHERE event='signup')::int AS signups
    FROM link_events GROUP BY slug
    HAVING COUNT(*) FILTER (WHERE event='cta') > 0 OR COUNT(*) FILTER (WHERE event='signup') > 0
    ORDER BY MIN(ts) FILTER (WHERE event='signup') DESC NULLS LAST,
             MIN(ts) FILTER (WHERE event='cta') DESC NULLS LAST LIMIT 200`).rows;
}

// ---- users / subscriptions (Stripe) --------------------------------------
let usersEnsured = false;
async function ensureUsers() {
  if (usersEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    clerk_user_id TEXT,
    plan TEXT DEFAULT 'none',
    status TEXT DEFAULT 'inactive',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    founding BOOLEAN DEFAULT false,
    welcomed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS welcomed BOOLEAN DEFAULT false`;
  usersEnsured = true;
}
// Atomically flag a user as "welcomed". Returns true ONLY the first time (so the
// welcome/admin emails are sent exactly once, even if confirm + webhook both fire).
async function markWelcomed(email) {
  if (!dbConfigured() || !email) return false;
  try {
    await ensureUsers();
    const { rows } = await sql`UPDATE users SET welcomed = true WHERE email = ${String(email).toLowerCase()} AND welcomed IS NOT TRUE RETURNING email`;
    return rows.length > 0;
  } catch (e) { return false; }
}
async function getUserByEmail(email) {
  if (!dbConfigured() || !email) return null;
  try {
    await ensureUsers();
    const { rows } = await sql`SELECT email, plan, status, stripe_customer_id, stripe_subscription_id, founding FROM users WHERE email = ${String(email).toLowerCase()} LIMIT 1`;
    return rows[0] || null;
  } catch (e) { return null; }
}
// Upsert a user's billing fields by email. `fields` may include plan, status,
// stripe_customer_id, stripe_subscription_id, founding, clerk_user_id.
async function upsertUser(email, fields) {
  if (!dbConfigured() || !email) return null;
  const f = fields || {};
  const e = String(email).toLowerCase();
  try {
    await ensureUsers();
    const { rows } = await sql`
      INSERT INTO users (email, clerk_user_id, plan, status, stripe_customer_id, stripe_subscription_id, founding, updated_at)
      VALUES (${e}, ${f.clerk_user_id || null}, ${f.plan || 'none'}, ${f.status || 'inactive'}, ${f.stripe_customer_id || null}, ${f.stripe_subscription_id || null}, ${!!f.founding}, now())
      ON CONFLICT (email) DO UPDATE SET
        clerk_user_id = COALESCE(${f.clerk_user_id || null}, users.clerk_user_id),
        plan = COALESCE(${f.plan || null}, users.plan),
        status = COALESCE(${f.status || null}, users.status),
        stripe_customer_id = COALESCE(${f.stripe_customer_id || null}, users.stripe_customer_id),
        stripe_subscription_id = COALESCE(${f.stripe_subscription_id || null}, users.stripe_subscription_id),
        founding = COALESCE(${typeof f.founding === 'boolean' ? f.founding : null}, users.founding),
        updated_at = now()
      RETURNING email, plan, status, stripe_customer_id, stripe_subscription_id, founding`;
    return rows[0] || null;
  } catch (e2) { return null; }
}

// ---- feedback (in-app "Give feedback" button) ----------------------------
let feedbackEnsured = false;
async function ensureFeedback() {
  if (feedbackEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    created TIMESTAMPTZ NOT NULL DEFAULT now(),
    email TEXT,
    plan TEXT,
    status TEXT,
    type TEXT,
    importance TEXT,
    message TEXT NOT NULL,
    page TEXT,
    url TEXT,
    ua TEXT,
    handled BOOLEAN DEFAULT false
  )`;
  // NOTE: `status` already holds the submitter's ACCOUNT status (comped/active/canceled).
  // The done/ignored workflow gets its OWN column so the two never collide.
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_status TEXT DEFAULT 'new'`; // new | done | ignored
  feedbackEnsured = true;
}
// Store one feedback submission. Fails soft (returns false) so the UI never breaks.
async function recordFeedback(f) {
  if (!dbConfigured()) return false;
  const g = f || {};
  try {
    await ensureFeedback();
    await sql`INSERT INTO feedback (email, plan, status, type, importance, message, page, url, ua)
      VALUES (${g.email || null}, ${g.plan || null}, ${g.status || null}, ${g.type || null},
              ${g.importance || null}, ${g.message}, ${g.page || null}, ${g.url || null}, ${g.ua || null})`;
    return true;
  } catch (e) { console.error('recordFeedback failed:', e.message); return false; }
}
// Most-recent feedback for the Super Admin review (owner-only endpoint). `status` filters
// to 'new'/'done'/'ignored'; anything else (or null) returns all.
async function feedbackList(limit, status) {
  if (!dbConfigured()) return [];
  try {
    await ensureFeedback();
    const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const st = ['new', 'done', 'ignored'].includes(status) ? status : null;
    const { rows } = await sql`SELECT id, created, email, plan, status AS acct_status, type, importance, message, page, url, admin_status
      FROM feedback WHERE (${st}::text IS NULL OR admin_status = ${st})
      ORDER BY created DESC LIMIT ${n}`;
    return rows;
  } catch (e) { console.error('feedbackList failed:', e.message); return []; }
}
// Set one feedback item's status (owner action). Returns true on success.
async function setFeedbackStatus(id, status) {
  if (!dbConfigured() || !id) return false;
  const st = ['new', 'done', 'ignored'].includes(status) ? status : 'new';
  try {
    await ensureFeedback();
    const { rows } = await sql`UPDATE feedback SET admin_status = ${st}, handled = ${st !== 'new'} WHERE id = ${Number(id)} RETURNING id`;
    return rows.length > 0;
  } catch (e) { console.error('setFeedbackStatus failed:', e.message); return false; }
}
// Delete one feedback item (owner action).
async function deleteFeedback(id) {
  if (!dbConfigured() || !id) return false;
  try {
    await ensureFeedback();
    const { rows } = await sql`DELETE FROM feedback WHERE id = ${Number(id)} RETURNING id`;
    return rows.length > 0;
  } catch (e) { console.error('deleteFeedback failed:', e.message); return false; }
}

// ---- DeepDossier run log (private MVP, Phase 1) --------------------------
// One row per search: who ran it, the inputs, how long it took, estimated cost,
// how many records came back, and whether it was served from cache (no re-bill).
let ddRunsEnsured = false;
async function ensureDeepDossierRuns() {
  if (ddRunsEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS deepdossier_runs (
    id BIGSERIAL PRIMARY KEY,
    created TIMESTAMPTZ NOT NULL DEFAULT now(),
    email TEXT,
    inputs JSONB,
    records INT DEFAULT 0,
    cached BOOLEAN DEFAULT false,
    mock BOOLEAN DEFAULT false,
    cost_gbp NUMERIC(10,4) DEFAULT 0,
    ms_total INT,
    cache_key TEXT
  )`;
  ddRunsEnsured = true;
}
// Log one DeepDossier run. Fails soft so a logging hiccup never breaks the search.
async function recordDeepDossierRun(r) {
  if (!dbConfigured()) return false;
  const g = r || {};
  try {
    await ensureDeepDossierRuns();
    await sql`INSERT INTO deepdossier_runs (email, inputs, records, cached, mock, cost_gbp, ms_total, cache_key)
      VALUES (${g.email || null}, ${JSON.stringify(g.inputs || {})}, ${Number(g.records) || 0},
              ${!!g.cached}, ${!!g.mock}, ${Number(g.costGbp) || 0}, ${Number(g.msTotal) || null}, ${g.cacheKey || null})`;
    return true;
  } catch (e) { console.error('recordDeepDossierRun failed:', e.message); return false; }
}

// ---- activity / audit log (per-person report) ----
let activityEnsured = false;
async function ensureActivity() {
  if (activityEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL, account TEXT, action TEXT NOT NULL, detail TEXT, meta JSONB
  )`;
  await sql`CREATE INDEX IF NOT EXISTS activity_actor_idx ON activity_log (actor, ts DESC)`;
  activityEnsured = true;
}
// Record one action. actor = who did it (their email), account = the workspace owner.
// Fails soft so logging NEVER breaks the action it is recording.
async function logActivity(actor, account, action, detail, meta) {
  if (!dbConfigured() || !actor || !action) return false;
  try {
    await ensureActivity();
    await sql`INSERT INTO activity_log (actor, account, action, detail, meta)
      VALUES (${String(actor).toLowerCase()}, ${account ? String(account).toLowerCase() : null}, ${action},
              ${detail ? String(detail).slice(0, 300) : null}, ${meta ? JSON.stringify(meta) : null}::jsonb)`;
    return true;
  } catch (e) { return false; }
}
// Aggregated report for one person: counts by action + recent events. days = window (null=all).
async function activityReport(actor, days) {
  if (!dbConfigured() || !actor) return null;
  try {
    await ensureActivity();
    const a = String(actor).toLowerCase();
    const since = (days && Number(days) > 0) ? (Math.floor(Number(days)) + ' days') : null;
    const counts = (await sql`SELECT action, COUNT(*)::int AS n FROM activity_log
      WHERE actor = ${a} AND (${since}::text IS NULL OR ts >= now() - (${since})::interval) GROUP BY action`).rows;
    const recent = (await sql`SELECT ts, action, detail FROM activity_log
      WHERE actor = ${a} AND (${since}::text IS NULL OR ts >= now() - (${since})::interval) ORDER BY ts DESC LIMIT 100`).rows;
    return { counts: counts, recent: recent };
  } catch (e) { return null; }
}

// ---- centralised notes log (who wrote what, on which business) ----
let notesLogEnsured = false;
async function ensureNotesLog() {
  if (notesLogEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS notes_log (
    id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    account TEXT, author TEXT, slug TEXT, business TEXT, note TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS notes_log_account_idx ON notes_log (account, ts DESC)`;
  notesLogEnsured = true;
}
async function recordNote({ account, author, slug, business, note }) {
  if (!dbConfigured() || !note) return false;
  try {
    await ensureNotesLog();
    await sql`INSERT INTO notes_log (account, author, slug, business, note)
      VALUES (${account ? String(account).toLowerCase() : null}, ${author ? String(author).toLowerCase() : null},
              ${slug || null}, ${business ? String(business).slice(0, 160) : null}, ${String(note).slice(0, 2000)})`;
    return true;
  } catch (e) { return false; }
}
// All notes in a workspace (optionally filtered to one author), newest first.
async function notesLog(account, opts) {
  if (!dbConfigured()) return [];
  const o = opts || {};
  try {
    await ensureNotesLog();
    const acc = account ? String(account).toLowerCase() : null;
    const author = o.author ? String(o.author).toLowerCase() : null;
    const lim = Math.min(Math.max(Number(o.limit) || 300, 1), 500);
    const { rows } = await sql`SELECT ts, author, slug, business, note FROM notes_log
      WHERE (${acc}::text IS NULL OR account = ${acc}) AND (${author}::text IS NULL OR author = ${author})
      ORDER BY ts DESC LIMIT ${lim}`;
    return rows;
  } catch (e) { return []; }
}

// ---- per-member daily usage counters (e.g. CSV export records/day) ----
let usageEnsured = false;
async function ensureUsage() {
  if (usageEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS usage_daily (
    email TEXT NOT NULL, day DATE NOT NULL, kind TEXT NOT NULL, count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (email, day, kind)
  )`;
  usageEnsured = true;
}
async function getDailyUsage(email, kind, day) {
  if (!dbConfigured() || !email) return 0;
  try {
    await ensureUsage();
    const { rows } = await sql`SELECT count FROM usage_daily WHERE email = ${String(email).toLowerCase()} AND day = ${day} AND kind = ${kind}`;
    return (rows[0] && rows[0].count) || 0;
  } catch (e) { return 0; }
}
async function bumpDailyUsage(email, kind, n, day) {
  if (!dbConfigured() || !email) return false;
  try {
    await ensureUsage();
    await sql`INSERT INTO usage_daily (email, day, kind, count) VALUES (${String(email).toLowerCase()}, ${day}, ${kind}, ${Number(n) || 0})
      ON CONFLICT (email, day, kind) DO UPDATE SET count = usage_daily.count + ${Number(n) || 0}`;
    return true;
  } catch (e) { return false; }
}

// Counts for the Admin overview. Fail soft (return zeros).
async function feedbackCounts() {
  const zero = { total: 0, new: 0, done: 0, ignored: 0 };
  if (!dbConfigured()) return zero;
  try {
    await ensureFeedback();
    const { rows } = await sql`SELECT admin_status, COUNT(*)::int AS n FROM feedback GROUP BY admin_status`;
    const out = Object.assign({}, zero);
    rows.forEach((r) => { const k = r.admin_status || 'new'; if (out[k] != null) out[k] = r.n; out.total += r.n; });
    return out;
  } catch (e) { return zero; }
}
// All customer rows we have (created by Stripe checkout/webhook). Owner-only use.
async function listUsers() {
  if (!dbConfigured()) return [];
  try {
    await ensureUsers();
    const { rows } = await sql`SELECT email, plan, status, founding, stripe_customer_id, created_at FROM users ORDER BY created_at DESC`;
    return rows;
  } catch (e) { return []; }
}
async function countActiveCustomers() {
  if (!dbConfigured()) return 0;
  try {
    await ensureUsers();
    const { rows } = await sql`SELECT COUNT(*)::int AS n FROM users WHERE status IN ('active','trialing')`;
    return (rows[0] && rows[0].n) || 0;
  } catch (e) { return 0; }
}

// ---- team members (shared workspace) -------------------------------------
// A team member logs in with their own email but shares their owner's workspace
// (data scoped to owner_email) and rides the owner's plan (free/comped).
let teamEnsured = false;
async function ensureTeam() {
  if (teamEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS team_members (
    id BIGSERIAL PRIMARY KEY,
    owner_email TEXT NOT NULL,
    member_email TEXT UNIQUE NOT NULL,
    suspended BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS first_name TEXT`;
  await sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_name TEXT`;
  await sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS limits JSONB DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS must_change BOOLEAN DEFAULT false`;
  teamEnsured = true;
}
// Look up a member by their own email. Returns { owner_email, suspended, permissions, ... } or null.
async function getTeamMember(memberEmail) {
  if (!dbConfigured() || !memberEmail) return null;
  try {
    await ensureTeam();
    const { rows } = await sql`SELECT owner_email, member_email, first_name, last_name, suspended, permissions, limits, must_change FROM team_members WHERE member_email = ${String(memberEmail).toLowerCase()} LIMIT 1`;
    return rows[0] || null;
  } catch (e) { console.error('getTeamMember failed:', e.message); return null; }
}
async function listTeamMembers(ownerEmail) {
  if (!dbConfigured() || !ownerEmail) return [];
  try {
    await ensureTeam();
    const { rows } = await sql`SELECT member_email, first_name, last_name, suspended, permissions, limits, created_at FROM team_members WHERE owner_email = ${String(ownerEmail).toLowerCase()} ORDER BY created_at DESC`;
    return rows;
  } catch (e) { console.error('listTeamMembers failed:', e.message); return []; }
}
async function addTeamMember(ownerEmail, memberEmail, firstName, lastName, permissions, limits, mustChange) {
  if (!dbConfigured() || !ownerEmail || !memberEmail) return false;
  const perms = JSON.stringify(permissions || {});
  const lims = JSON.stringify(limits || {});
  const mc = !!mustChange;
  try {
    await ensureTeam();
    await sql`INSERT INTO team_members (owner_email, member_email, first_name, last_name, suspended, permissions, limits, must_change)
      VALUES (${String(ownerEmail).toLowerCase()}, ${String(memberEmail).toLowerCase()}, ${firstName || null}, ${lastName || null}, false, ${perms}::jsonb, ${lims}::jsonb, ${mc})
      ON CONFLICT (member_email) DO UPDATE SET owner_email = ${String(ownerEmail).toLowerCase()},
        first_name = ${firstName || null}, last_name = ${lastName || null}, suspended = false, permissions = ${perms}::jsonb, limits = ${lims}::jsonb, must_change = ${mc}`;
    return true;
  } catch (e) { console.error('addTeamMember failed:', e.message); return false; }
}
async function clearMustChange(memberEmail) {
  if (!dbConfigured() || !memberEmail) return false;
  try { await ensureTeam(); await sql`UPDATE team_members SET must_change = false WHERE member_email = ${String(memberEmail).toLowerCase()}`; return true; }
  catch (e) { return false; }
}
async function setTeamPermissions(ownerEmail, memberEmail, permissions, limits) {
  if (!dbConfigured() || !memberEmail) return false;
  const perms = JSON.stringify(permissions || {});
  const lims = JSON.stringify(limits || {});
  try {
    await ensureTeam();
    const { rows } = await sql`UPDATE team_members SET permissions = ${perms}::jsonb, limits = ${lims}::jsonb
      WHERE member_email = ${String(memberEmail).toLowerCase()} AND owner_email = ${String(ownerEmail).toLowerCase()} RETURNING id`;
    return rows.length > 0;
  } catch (e) { console.error('setTeamPermissions failed:', e.message); return false; }
}
async function setTeamSuspended(ownerEmail, memberEmail, suspended) {
  if (!dbConfigured() || !memberEmail) return false;
  try {
    await ensureTeam();
    const { rows } = await sql`UPDATE team_members SET suspended = ${!!suspended}
      WHERE member_email = ${String(memberEmail).toLowerCase()} AND owner_email = ${String(ownerEmail).toLowerCase()} RETURNING id`;
    return rows.length > 0;
  } catch (e) { console.error('setTeamSuspended failed:', e.message); return false; }
}
async function removeTeamMember(ownerEmail, memberEmail) {
  if (!dbConfigured() || !memberEmail) return false;
  try {
    await ensureTeam();
    const { rows } = await sql`DELETE FROM team_members
      WHERE member_email = ${String(memberEmail).toLowerCase()} AND owner_email = ${String(ownerEmail).toLowerCase()} RETURNING id`;
    return rows.length > 0;
  } catch (e) { console.error('removeTeamMember failed:', e.message); return false; }
}

// ---- DeepDossier saved leads ("Our Leads") -------------------------------
// Every record pulled by DeepDossier is kept here per owner, with its full data
// blob, so the operator can revisit, export (CSV/PDF) and build a lead bank.
let ddLeadsEnsured = false;
async function ensureDeepDossierLeads() {
  if (ddLeadsEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS deepdossier_leads (
    id BIGSERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    lead_key TEXT NOT NULL,
    name TEXT, title TEXT, company TEXT, email TEXT, mobile TEXT, band TEXT,
    data JSONB, criteria JSONB,
    created TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner, lead_key)
  )`;
  ddLeadsEnsured = true;
}
function ddLeadKey(r) {
  const e = String((r && r.email) || '').trim().toLowerCase();
  if (e) return e;
  return (String((r && r.name) || '').trim().toLowerCase() + '|' + String((r && r.company) || '').trim().toLowerCase());
}
async function saveDeepDossierLeads(owner, rows, criteria) {
  if (!dbConfigured() || !owner || !Array.isArray(rows) || !rows.length) return 0;
  let n = 0;
  try {
    await ensureDeepDossierLeads();
    const o = String(owner).toLowerCase();
    const crit = JSON.stringify(criteria || {});
    for (const r of rows) {
      const key = ddLeadKey(r);
      if (!key || key === '|') continue;
      const band = r.match && r.match.band ? r.match.band : null;
      try {
        await sql`INSERT INTO deepdossier_leads (owner, lead_key, name, title, company, email, mobile, band, data, criteria, updated)
          VALUES (${o}, ${key}, ${r.name || null}, ${r.title || null}, ${r.company || null}, ${r.email || null}, ${r.mobile || null}, ${band}, ${JSON.stringify(r)}, ${crit}, now())
          ON CONFLICT (owner, lead_key) DO UPDATE SET
            name = EXCLUDED.name, title = EXCLUDED.title, company = EXCLUDED.company,
            email = EXCLUDED.email, mobile = EXCLUDED.mobile, band = EXCLUDED.band,
            data = EXCLUDED.data, criteria = EXCLUDED.criteria, updated = now()`;
        n += 1;
      } catch (e) { /* skip one bad row */ }
    }
    return n;
  } catch (e) { console.error('saveDeepDossierLeads failed:', e.message); return n; }
}
async function listDeepDossierLeads(owner) {
  if (!dbConfigured() || !owner) return [];
  try {
    await ensureDeepDossierLeads();
    const { rows } = await sql`SELECT id, data, updated
      FROM deepdossier_leads WHERE owner = ${String(owner).toLowerCase()} ORDER BY updated DESC LIMIT 2000`;
    return rows.map((x) => Object.assign({}, x.data || {}, { _id: x.id, _updated: x.updated }));
  } catch (e) { console.error('listDeepDossierLeads failed:', e.message); return []; }
}

module.exports = { recordEvent, statsBySlug, dbConfigured, recordApplication, dashboardData, hotLeadRows, getUserByEmail, upsertUser, markWelcomed, recordFeedback, feedbackList, setFeedbackStatus, deleteFeedback, recordDeepDossierRun, getTeamMember, listTeamMembers, addTeamMember, setTeamSuspended, setTeamPermissions, removeTeamMember, clearMustChange, feedbackCounts, countActiveCustomers, listUsers, getDailyUsage, bumpDailyUsage, logActivity, activityReport, recordNote, notesLog, saveDeepDossierLeads, listDeepDossierLeads };

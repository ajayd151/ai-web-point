// Data layer for SMS campaigns: the campaign, its recipients (items), inbound replies and
// opt-outs. Postgres, not Blob, because the worker updates item states concurrently and the
// blob read-modify-write race would lose them. Fails soft like lib/db.js.
const { createPool } = require('@vercel/postgres');

function connString() {
  return process.env.POSTGRES_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_PRISMA_URL
    || '';
}
let _pool = null;
function pool() {
  if (!_pool) _pool = createPool({ connectionString: connString() });
  return _pool;
}
function ok() { return !!connString(); }
const sql = (...args) => pool().sql(...args);

let ensured = false;
async function ensure() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS sms_campaigns (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT, name TEXT, message TEXT NOT NULL,
    filters JSONB, schedule_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'scheduled', note TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sms_items (
    id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL,
    key TEXT, name TEXT, location TEXT, category TEXT, phone TEXT,
    state TEXT NOT NULL DEFAULT 'pending',  -- pending -> ready (mockup done) -> sent | failed | skipped
    slug TEXT, view_url TEXT, error TEXT, sid TEXT, sent_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sms_items_campaign_idx ON sms_items (campaign_id, state)`;
  await sql`CREATE TABLE IF NOT EXISTS sms_inbound (
    id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
    from_phone TEXT, body TEXT, matched_key TEXT, matched_name TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sms_optout (
    phone TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), source TEXT
  )`;
  ensured = true;
}

async function createCampaign({ createdBy, name, message, filters, scheduleAt, items }) {
  if (!ok()) return null;
  try {
    await ensure();
    const { rows } = await sql`INSERT INTO sms_campaigns (created_by, name, message, filters, schedule_at)
      VALUES (${createdBy}, ${name}, ${message}, ${JSON.stringify(filters || {})}::jsonb, ${scheduleAt}::timestamptz)
      RETURNING id`;
    const id = rows[0].id;
    for (const it of items) {
      await sql`INSERT INTO sms_items (campaign_id, key, name, location, category, phone)
        VALUES (${id}, ${it.key || ''}, ${it.name || ''}, ${it.location || ''}, ${it.category || ''}, ${it.phone || ''})`;
    }
    return id;
  } catch (e) { return null; }
}
async function listCampaigns() {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT c.*,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id) AS total,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.state = 'sent') AS sent,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.state = 'ready') AS ready,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.state IN ('failed','skipped')) AS failed
      FROM sms_campaigns c ORDER BY c.id DESC LIMIT 50`;
    return rows;
  } catch (e) { return []; }
}
async function campaignItems(id) {
  if (!ok()) return [];
  try { await ensure(); const { rows } = await sql`SELECT * FROM sms_items WHERE campaign_id = ${id} ORDER BY id`; return rows; } catch (e) { return []; }
}
async function setCampaignStatus(id, status, note) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_campaigns SET status = ${status}, note = ${note || null} WHERE id = ${id}`; return true; } catch (e) { return false; }
}
// Campaigns the worker should be driving right now.
async function dueCampaigns(nowIso) {
  if (!ok()) return [];
  try {
    await ensure();
    await sql`UPDATE sms_campaigns SET status = 'running' WHERE status = 'scheduled' AND schedule_at <= ${nowIso}::timestamptz`;
    const { rows } = await sql`SELECT * FROM sms_campaigns WHERE status = 'running' ORDER BY id`;
    return rows;
  } catch (e) { return []; }
}
async function itemsInState(campaignId, state, limit) {
  if (!ok()) return [];
  try { await ensure(); const { rows } = await sql`SELECT * FROM sms_items WHERE campaign_id = ${campaignId} AND state = ${state} ORDER BY id LIMIT ${limit}`; return rows; } catch (e) { return []; }
}
async function setItem(id, fields) {
  if (!ok()) return false;
  try {
    await ensure();
    await sql`UPDATE sms_items SET
      state = COALESCE(${fields.state || null}, state),
      slug = COALESCE(${fields.slug || null}, slug),
      view_url = COALESCE(${fields.viewUrl || null}, view_url),
      error = COALESCE(${fields.error || null}, error),
      sid = COALESCE(${fields.sid || null}, sid),
      sent_at = CASE WHEN ${fields.state || ''} = 'sent' THEN now() ELSE sent_at END
      WHERE id = ${id}`;
    return true;
  } catch (e) { return false; }
}
// Every key that has EVER been sent an SMS by any campaign (for the "not already messaged" filter).
async function sentKeys() {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT DISTINCT key FROM sms_items WHERE state = 'sent'`; return new Set(rows.map((r) => r.key)); } catch (e) { return new Set(); }
}
async function addOptout(phone, source) {
  if (!ok() || !phone) return false;
  try { await ensure(); await sql`INSERT INTO sms_optout (phone, source) VALUES (${phone}, ${source || ''}) ON CONFLICT (phone) DO NOTHING`; return true; } catch (e) { return false; }
}
async function optoutSet() {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT phone FROM sms_optout`; return new Set(rows.map((r) => r.phone)); } catch (e) { return new Set(); }
}
async function recordInbound({ from, body, matchedKey, matchedName }) {
  if (!ok()) return false;
  try { await ensure(); await sql`INSERT INTO sms_inbound (from_phone, body, matched_key, matched_name) VALUES (${from}, ${body}, ${matchedKey || null}, ${matchedName || null})`; return true; } catch (e) { return false; }
}
async function listInbound(limit) {
  if (!ok()) return [];
  try { await ensure(); const { rows } = await sql`SELECT * FROM sms_inbound ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 300)}`; return rows; } catch (e) { return []; }
}

module.exports = { createCampaign, listCampaigns, campaignItems, setCampaignStatus, dueCampaigns, itemsInState, setItem, sentKeys, addOptout, optoutSet, recordInbound, listInbound };

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
  // the two-step (ask first) workflow + delivery tracking
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'link'`; // 'link' | 'ask'
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS link_message TEXT`; // auto-sent on a YES
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS link_delay_min INT NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS delivery TEXT`; // queued/sent/delivered/undelivered/failed
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS reply TEXT`; // positive/negative/other (first reply)
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS reply_at TIMESTAMPTZ`;
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS link_due_at TIMESTAMPTZ`; // when the auto link goes
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS link_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS post_reply TEXT`; // reply AFTER seeing the mockup
  await sql`CREATE INDEX IF NOT EXISTS sms_items_phone_idx ON sms_items (phone, id DESC)`;
  await sql`ALTER TABLE sms_inbound ADD COLUMN IF NOT EXISTS verdict TEXT`; // positive/negative/other/stop
  ensured = true;
}

async function createCampaign({ createdBy, name, message, filters, scheduleAt, items, mode, linkMessage, linkDelayMin }) {
  if (!ok()) return null;
  try {
    await ensure();
    const { rows } = await sql`INSERT INTO sms_campaigns (created_by, name, message, filters, schedule_at, mode, link_message, link_delay_min)
      VALUES (${createdBy}, ${name}, ${message}, ${JSON.stringify(filters || {})}::jsonb, ${scheduleAt}::timestamptz,
              ${mode === 'ask' ? 'ask' : 'link'}, ${linkMessage || null}, ${Math.min(Math.max(Number(linkDelayMin) || 1, 0), 1440)})
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
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.state IN ('failed','skipped')) AS failed,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.delivery = 'delivered') AS delivered,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.reply = 'positive') AS positive,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.reply = 'negative') AS negative,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.link_sent_at IS NOT NULL) AS linked,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.post_reply = 'positive') AS hot
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
  try { await ensure(); const { rows } = await sql`SELECT DISTINCT key FROM sms_items WHERE state IN ('sent','linked')`; return new Set(rows.map((r) => r.key)); } catch (e) { return new Set(); }
}
async function addOptout(phone, source) {
  if (!ok() || !phone) return false;
  try { await ensure(); await sql`INSERT INTO sms_optout (phone, source) VALUES (${phone}, ${source || ''}) ON CONFLICT (phone) DO NOTHING`; return true; } catch (e) { return false; }
}
async function optoutSet() {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT phone FROM sms_optout`; return new Set(rows.map((r) => r.phone)); } catch (e) { return new Set(); }
}
async function recordInbound({ from, body, matchedKey, matchedName, verdict }) {
  if (!ok()) return false;
  try { await ensure(); await sql`INSERT INTO sms_inbound (from_phone, body, matched_key, matched_name, verdict) VALUES (${from}, ${body}, ${matchedKey || null}, ${matchedName || null}, ${verdict || null})`; return true; } catch (e) { return false; }
}
async function listInbound(limit) {
  if (!ok()) return [];
  try { await ensure(); const { rows } = await sql`SELECT * FROM sms_inbound ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 300)}`; return rows; } catch (e) { return []; }
}

// delivery status callback from Twilio, keyed by the message sid
async function setDeliveryBySid(sid, status) {
  if (!ok() || !sid) return false;
  try { await ensure(); await sql`UPDATE sms_items SET delivery = ${status} WHERE sid = ${sid}`; return true; } catch (e) { return false; }
}
// the most recent item we texted on this number, with its campaign's workflow settings
async function latestItemByPhone(phone) {
  if (!ok() || !phone) return null;
  try {
    await ensure();
    const { rows } = await sql`SELECT i.*, c.mode, c.link_delay_min, c.link_message FROM sms_items i
      JOIN sms_campaigns c ON c.id = i.campaign_id
      WHERE i.phone = ${phone} AND i.state IN ('sent','linked') ORDER BY i.id DESC LIMIT 1`;
    return rows[0] || null;
  } catch (e) { return null; }
}
async function setReply(id, verdict, linkDueAt) {
  if (!ok()) return false;
  try {
    await ensure();
    await sql`UPDATE sms_items SET reply = ${verdict}, reply_at = now(),
      link_due_at = COALESCE(${linkDueAt || null}::timestamptz, link_due_at) WHERE id = ${id}`;
    return true;
  } catch (e) { return false; }
}
async function setPostReply(id, verdict) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_items SET post_reply = ${verdict} WHERE id = ${id}`; return true; } catch (e) { return false; }
}
// positive repliers whose auto link is due, across every non-cancelled campaign (replies can
// arrive after a campaign finishes, the follow-up must still go)
async function dueLinkSends(nowIso, limit) {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT i.*, c.link_message, c.created_by FROM sms_items i
      JOIN sms_campaigns c ON c.id = i.campaign_id
      WHERE i.reply = 'positive' AND i.link_sent_at IS NULL AND i.link_due_at IS NOT NULL
        AND i.link_due_at <= ${nowIso}::timestamptz AND c.status <> 'cancelled'
      ORDER BY i.link_due_at LIMIT ${Math.min(Number(limit) || 10, 50)}`;
    return rows;
  } catch (e) { return []; }
}
async function markLinkSent(id, sid) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_items SET link_sent_at = now(), state = 'linked', sid = COALESCE(${sid || null}, sid) WHERE id = ${id}`; return true; } catch (e) { return false; }
}
// the "call these now" list: said YES to the mockup, or replied warmly after seeing it
async function readyToCall(limit) {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT i.key, i.name, i.location, i.phone, i.reply_at, i.post_reply, i.link_sent_at, i.view_url
      FROM sms_items i WHERE i.post_reply = 'positive' OR (i.reply = 'positive')
      ORDER BY (i.post_reply = 'positive') DESC, i.reply_at DESC NULLS LAST LIMIT ${Math.min(Number(limit) || 50, 100)}`;
    return rows;
  } catch (e) { return []; }
}

module.exports = { createCampaign, listCampaigns, campaignItems, setCampaignStatus, dueCampaigns, itemsInState, setItem, sentKeys, addOptout, optoutSet, recordInbound, listInbound, setDeliveryBySid, latestItemByPhone, setReply, setPostReply, dueLinkSends, markLinkSent, readyToCall };

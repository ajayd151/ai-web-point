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
  // one optional nudge for non-responders
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS nudge_message TEXT`;
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS nudge_hours INT NOT NULL DEFAULT 24`;
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS nudged_at TIMESTAMPTZ`;
  // evergreen: a campaign that keeps auto-sending to NEW records that match its criteria
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS evergreen BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS topped_up_at TIMESTAMPTZ`;
  ensured = true;
}

async function createCampaign({ createdBy, name, message, filters, scheduleAt, items, mode, linkMessage, linkDelayMin, nudgeMessage, nudgeHours, evergreen }) {
  if (!ok()) return null;
  try {
    await ensure();
    const { rows } = await sql`INSERT INTO sms_campaigns (created_by, name, message, filters, schedule_at, mode, link_message, link_delay_min, nudge_message, nudge_hours, evergreen)
      VALUES (${createdBy}, ${name}, ${message}, ${JSON.stringify(filters || {})}::jsonb, ${scheduleAt}::timestamptz,
              ${mode === 'ask' ? 'ask' : 'link'}, ${linkMessage || null}, ${Math.min(Math.max(Number(linkDelayMin) || 1, 0), 1440)},
              ${(nudgeMessage || '').trim() || null}, ${Math.min(Math.max(Number(nudgeHours) || 24, 1), 168)}, ${!!evergreen})
      RETURNING id`;
    const id = rows[0].id;
    // batch-insert recipients: thousands of one-row inserts would be slow and can time out
    const pg = pool();
    const CH = 400;
    for (let i = 0; i < items.length; i += CH) {
      const chunk = items.slice(i, i + CH);
      const vals = [];
      const tuples = chunk.map((it, j) => {
        const b = j * 6;
        vals.push(id, it.key || '', it.name || '', it.location || '', it.category || '', it.phone || '');
        return '($' + (b + 1) + ',$' + (b + 2) + ',$' + (b + 3) + ',$' + (b + 4) + ',$' + (b + 5) + ',$' + (b + 6) + ')';
      }).join(',');
      await pg.query('INSERT INTO sms_items (campaign_id, key, name, location, category, phone) VALUES ' + tuples, vals);
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
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.post_reply = 'positive') AS hot,
        (SELECT COUNT(*)::int FROM sms_items i WHERE i.campaign_id = c.id AND i.nudged_at IS NOT NULL) AS nudged
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
// Returns true only when this is a NEW opt-out. A repeat (already opted out) returns false, so
// callers can avoid logging the same person twice when a link is fetched more than once.
async function addOptout(phone, source) {
  if (!ok() || !phone) return false;
  try { await ensure(); const r = await sql`INSERT INTO sms_optout (phone, source) VALUES (${phone}, ${source || ''}) ON CONFLICT (phone) DO NOTHING`; return (r.rowCount || 0) > 0; } catch (e) { return false; }
}
// Look up one queued item by its id, so the tap-to-opt-out link can find the phone + call-list
// key from the signed token in the URL (the phone number itself never travels in the link).
async function getItemById(id) {
  if (!ok() || !id) return null;
  try { await ensure(); const { rows } = await sql`SELECT id, phone, key, name FROM sms_items WHERE id=${Number(id)}`; return rows[0] || null; } catch (e) { return null; }
}
async function optoutSet() {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT phone FROM sms_optout`; return new Set(rows.map((r) => r.phone)); } catch (e) { return new Set(); }
}
// Opt-outs split by how they left: 'reply' = a STOP text (this is the number carriers police),
// 'link' = a tap on the soft opt-out link (does NOT count against the carrier metric). Anything
// older with a blank source is treated as a STOP reply, the safe assumption.
async function optoutCounts() {
  if (!ok()) return { reply: 0, link: 0, total: 0 };
  try {
    await ensure();
    const { rows } = await sql`SELECT source, COUNT(*)::int n FROM sms_optout GROUP BY source`;
    let reply = 0, link = 0, total = 0;
    rows.forEach((r) => { const n = Number(r.n) || 0; total += n; if (r.source === 'link') link += n; else reply += n; });
    return { reply, link, total };
  } catch (e) { return { reply: 0, link: 0, total: 0 }; }
}
// STOP-reply rate over a recent rolling window, for the auto safety-brake. Both figures come from
// the SAME window so the rate self-heals: as old STOPs and old sends age past the window, a paused
// number recovers on its own.
async function stopWindow(hours) {
  if (!ok()) return { stops: 0, sent: 0 };
  const h = Math.max(1, Math.round(Number(hours) || 24));
  try {
    await ensure();
    const { rows: a } = await sql`SELECT COUNT(*)::int n FROM sms_optout WHERE source <> 'link' AND at > now() - make_interval(hours => ${h})`;
    const { rows: b } = await sql`SELECT COUNT(*)::int n FROM sms_items WHERE sent_at > now() - make_interval(hours => ${h})`;
    return { stops: Number(a[0].n) || 0, sent: Number(b[0].n) || 0 };
  } catch (e) { return { stops: 0, sent: 0 }; }
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
// non-responders due their one nudge: asked, silent for the campaign's nudge window, never
// nudged before. Only campaigns that actually wrote a nudge message qualify.
async function dueNudges(limit) {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT i.*, c.nudge_message, c.created_by FROM sms_items i
      JOIN sms_campaigns c ON c.id = i.campaign_id
      WHERE c.nudge_message IS NOT NULL AND c.status NOT IN ('cancelled','paused')
        AND i.state = 'sent' AND i.reply IS NULL AND i.nudged_at IS NULL
        AND i.sent_at IS NOT NULL AND i.sent_at <= now() - make_interval(hours => c.nudge_hours)
      ORDER BY i.sent_at LIMIT ${Math.min(Number(limit) || 10, 50)}`;
    return rows;
  } catch (e) { return []; }
}
async function markNudged(id) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_items SET nudged_at = now() WHERE id = ${id}`; return true; } catch (e) { return false; }
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

// every record key already queued in a campaign (so an evergreen top-up adds only NEW ones)
async function campaignKeys(id) {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT key FROM sms_items WHERE campaign_id = ${id}`; return new Set(rows.map((r) => r.key)); } catch (e) { return new Set(); }
}
// add fresh recipients to an existing (evergreen) campaign as pending items
// record that an evergreen top-up was attempted (so it only runs a couple of times a day)
async function stampToppedUp(id) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_campaigns SET topped_up_at = now() WHERE id = ${id}`; return true; } catch (e) { return false; }
}
async function addItemsToCampaign(id, items) {
  if (!ok() || !items || !items.length) return 0;
  try {
    await ensure();
    for (const it of items) {
      await sql`INSERT INTO sms_items (campaign_id, key, name, location, category, phone)
        VALUES (${id}, ${it.key || ''}, ${it.name || ''}, ${it.location || ''}, ${it.category || ''}, ${it.phone || ''})`;
    }
    await sql`UPDATE sms_campaigns SET topped_up_at = now() WHERE id = ${id}`;
    return items.length;
  } catch (e) { return 0; }
}

module.exports = { createCampaign, listCampaigns, campaignItems, setCampaignStatus, dueCampaigns, itemsInState, setItem, sentKeys, addOptout, optoutSet, optoutCounts, stopWindow, getItemById, recordInbound, listInbound, setDeliveryBySid, latestItemByPhone, setReply, setPostReply, dueLinkSends, markLinkSent, dueNudges, markNudged, readyToCall, campaignKeys, addItemsToCampaign, stampToppedUp };

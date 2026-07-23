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
  // message experiments: each opener version is a row; every item is stamped with the version it
  // was sent under, so we can compare versions on real data (sent / yes / stop / opt-out rates).
  await sql`CREATE TABLE IF NOT EXISTS sms_msg (
    id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL, text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT
  )`;
  // start_day = the UK date (YYYY-MM-DD) this version goes live from, so a new opener can be
  // scheduled to begin on a fresh day rather than mid-window.
  await sql`ALTER TABLE sms_msg ADD COLUMN IF NOT EXISTS start_day TEXT`;
  await sql`ALTER TABLE sms_items ADD COLUMN IF NOT EXISTS msg_id BIGINT`;
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
      msg_id = COALESCE(${fields.msgId || null}, msg_id),
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
// Every phone number we have ever SENT to. Used to make sure the same person is never texted twice,
// even if they sit on the call list under two different records (same number, different key).
async function sentPhones() {
  if (!ok()) return new Set();
  try { await ensure(); const { rows } = await sql`SELECT DISTINCT phone FROM sms_items WHERE sent_at IS NOT NULL AND phone IS NOT NULL AND phone <> ''`; return new Set(rows.map((r) => r.phone)); } catch (e) { return new Set(); }
}
// One-off cleanup: collapse duplicate inbound rows (same phone + body + verdict) down to the
// earliest one. Fixes the double "[opted out via link]" rows a link prefetch used to create.
async function dedupeInbound() {
  if (!ok()) return 0;
  try { await ensure(); const r = await sql`DELETE FROM sms_inbound a USING sms_inbound b WHERE a.id > b.id AND a.from_phone = b.from_phone AND coalesce(a.body,'') = coalesce(b.body,'') AND coalesce(a.verdict,'') = coalesce(b.verdict,'')`; return r.rowCount || 0; } catch (e) { return 0; }
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
// Activity by hour-of-day (0-23, UK time), over the last `days`. Powers the Analytics chart:
// which hours get the sends, the yeses/nos, the STOP texts and the link opt-outs. Sends come from
// sms_items.sent_at, yes/no from sms_inbound verdicts, and STOP vs link opt-out from sms_optout
// by source (deduped per phone).
async function hourlyBreakdown(days) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ h: h, sends: 0, positive: 0, negative: 0, stop: 0, optout: 0 }));
  if (!ok()) return buckets;
  const d = Math.max(1, Math.round(Number(days) || 30));
  try {
    await ensure();
    const s = await sql`SELECT EXTRACT(HOUR FROM (sent_at AT TIME ZONE 'Europe/London'))::int h, COUNT(*)::int n FROM sms_items WHERE sent_at IS NOT NULL AND sent_at > now() - make_interval(days => ${d}) GROUP BY 1`;
    s.rows.forEach((r) => { if (r.h >= 0 && r.h < 24) buckets[r.h].sends = r.n; });
    const rp = await sql`SELECT EXTRACT(HOUR FROM (at AT TIME ZONE 'Europe/London'))::int h, verdict, COUNT(*)::int n FROM sms_inbound WHERE at > now() - make_interval(days => ${d}) GROUP BY 1,2`;
    rp.rows.forEach((r) => { if (r.h < 0 || r.h >= 24) return; if (r.verdict === 'positive') buckets[r.h].positive += r.n; else if (r.verdict === 'negative') buckets[r.h].negative += r.n; });
    const oo = await sql`SELECT EXTRACT(HOUR FROM (at AT TIME ZONE 'Europe/London'))::int h, source, COUNT(*)::int n FROM sms_optout WHERE at > now() - make_interval(days => ${d}) GROUP BY 1,2`;
    oo.rows.forEach((r) => { if (r.h < 0 || r.h >= 24) return; if (r.source === 'link') buckets[r.h].optout += r.n; else buckets[r.h].stop += r.n; });
    return buckets;
  } catch (e) { return buckets; }
}
// Reply performance by industry/niche tag (the category stamped on each item at send time).
// Answers "which niches say yes", so targeting can lean into the winners. Yes/no come from the
// item's own reply / post_reply verdicts, so no join is needed.
// ----- Message experiments (opener versions) -----
// Give every campaign a v1 from its current message, and stamp its already-sent items with it,
// so history starts from real data rather than a blank. Cheap no-op once done. Runs in the worker.
async function ensureBaseVersions() {
  if (!ok()) return;
  try {
    await ensure();
    const { rows } = await sql`SELECT c.id, c.message, c.created_by, c.created_at
      FROM sms_campaigns c LEFT JOIN sms_msg m ON m.campaign_id = c.id
      WHERE m.id IS NULL GROUP BY c.id, c.message, c.created_by, c.created_at`;
    for (const c of rows) {
      // '2000-01-01' = live since forever, so the baseline version is always the active one
      const ins = await sql`INSERT INTO sms_msg (campaign_id, text, created_by, created_at, start_day) VALUES (${c.id}, ${c.message || ''}, ${c.created_by || null}, ${c.created_at}, '2000-01-01') RETURNING id`;
      const vid = ins.rows[0].id;
      await sql`UPDATE sms_items SET msg_id = ${vid} WHERE campaign_id = ${c.id} AND msg_id IS NULL`;
    }
  } catch (e) { /* next tick */ }
}
// The version LIVE right now for a campaign: the most recent one whose start_day has arrived.
async function currentMsg(campaignId, today) {
  if (!ok()) return null;
  try {
    await ensure();
    const { rows } = await sql`SELECT id, text FROM sms_msg
      WHERE campaign_id = ${campaignId} AND (start_day IS NULL OR start_day <= ${today || '9999-99-99'})
      ORDER BY COALESCE(start_day, '0000-00-00') DESC, id DESC LIMIT 1`;
    return rows[0] || null;
  } catch (e) { return null; }
}
async function addMsg(campaignId, text, by, startDay) {
  if (!ok()) return null;
  try { await ensure(); const { rows } = await sql`INSERT INTO sms_msg (campaign_id, text, created_by, start_day) VALUES (${campaignId}, ${text}, ${by || null}, ${startDay || null}) RETURNING id`; return rows[0] ? rows[0].id : null; } catch (e) { return null; }
}
async function setCampaignMessage(id, text) {
  if (!ok()) return false;
  try { await ensure(); await sql`UPDATE sms_campaigns SET message = ${text} WHERE id = ${id}`; return true; } catch (e) { return false; }
}
// Per-version performance across all campaigns: sent / delivered / yes / no / stop / opt-out, so
// the UI can compare messages. STOP and link opt-out are attributed to the version that was sent
// to that phone (one send per phone, thanks to the phone-level dedupe).
async function messageStats() {
  if (!ok()) return [];
  try {
    await ensure();
    const v = await sql`SELECT m.id, m.campaign_id, m.text, m.created_at, m.start_day, c.name AS campaign_name
      FROM sms_msg m LEFT JOIN sms_campaigns c ON c.id = m.campaign_id ORDER BY m.campaign_id, m.id`;
    const base = {};
    v.rows.forEach((r) => { base[r.id] = { id: r.id, campaignId: r.campaign_id, campaignName: r.campaign_name || ('Campaign ' + r.campaign_id), text: r.text, createdAt: r.created_at, startDay: r.start_day, sent: 0, delivered: 0, yes: 0, no: 0, stop: 0, optout: 0 }; });
    const s = await sql`SELECT msg_id,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int sent,
        COUNT(*) FILTER (WHERE delivery = 'delivered')::int delivered,
        COUNT(*) FILTER (WHERE reply = 'positive' OR post_reply = 'positive')::int yes,
        COUNT(*) FILTER (WHERE reply = 'negative' OR post_reply = 'negative')::int no
      FROM sms_items WHERE msg_id IS NOT NULL GROUP BY 1`;
    s.rows.forEach((r) => { const b = base[r.msg_id]; if (b) { b.sent = r.sent; b.delivered = r.delivered; b.yes = r.yes; b.no = r.no; } });
    const o = await sql`SELECT i.msg_id, o.source, COUNT(*)::int n
      FROM sms_optout o JOIN sms_items i ON i.phone = o.phone AND i.sent_at IS NOT NULL
      WHERE i.msg_id IS NOT NULL GROUP BY 1, 2`;
    o.rows.forEach((r) => { const b = base[r.msg_id]; if (b) { if (r.source === 'link') b.optout += r.n; else b.stop += r.n; } });
    return Object.values(base);
  } catch (e) { return []; }
}
// Per-person journey through the funnel, for everyone who has ENGAGED (replied at all, or been
// sent the mockup). Returns the milestone flags so the UI can tick off what each has/hasn't done.
async function journey(limit) {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT key, name, location, phone, slug, view_url, delivery, reply, reply_at, link_sent_at, post_reply, nudged_at, sent_at
      FROM sms_items
      WHERE reply IS NOT NULL OR link_sent_at IS NOT NULL OR post_reply IS NOT NULL
      ORDER BY COALESCE(reply_at, link_sent_at, sent_at) DESC NULLS LAST
      LIMIT ${Math.min(Number(limit) || 200, 500)}`;
    // attach the first + last time each mockup was actually OPENED (link_events, event='view').
    // Best-effort in its own try so a missing table never blanks the journey.
    try {
      const slugs = rows.map((r) => r.slug).filter(Boolean);
      if (slugs.length) {
        const { rows: vr } = await sql`SELECT slug, MIN(ts) AS first_view, MAX(ts) AS last_view, COUNT(*)::int AS views
          FROM link_events WHERE event = 'view' AND slug = ANY(${slugs}) GROUP BY slug`;
        const m = {}; vr.forEach((v) => { m[v.slug] = v; });
        rows.forEach((r) => { const v = r.slug && m[r.slug]; if (v) { r.first_view = v.first_view; r.last_view = v.last_view; r.views = v.views; } });
      }
    } catch (e) { /* views are optional */ }
    return rows;
  } catch (e) { return []; }
}
async function byIndustry() {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`
      SELECT COALESCE(NULLIF(category, ''), '(untagged)') AS tag,
             COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
             COUNT(*) FILTER (WHERE reply = 'positive' OR post_reply = 'positive')::int AS yes,
             COUNT(*) FILTER (WHERE reply = 'negative' OR post_reply = 'negative')::int AS no
      FROM sms_items
      GROUP BY 1
      HAVING COUNT(*) FILTER (WHERE sent_at IS NOT NULL) > 0
      ORDER BY sent DESC`;
    return rows;
  } catch (e) { return []; }
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
    const { rows } = await sql`SELECT i.key, i.name, i.location, i.category, i.phone, i.reply_at, i.post_reply, i.link_sent_at, i.slug, i.view_url
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

module.exports = { createCampaign, listCampaigns, campaignItems, setCampaignStatus, dueCampaigns, itemsInState, setItem, sentKeys, addOptout, optoutSet, optoutCounts, stopWindow, sentPhones, dedupeInbound, hourlyBreakdown, byIndustry, ensureBaseVersions, currentMsg, addMsg, setCampaignMessage, messageStats, journey, getItemById, recordInbound, listInbound, setDeliveryBySid, latestItemByPhone, setReply, setPostReply, dueLinkSends, markLinkSent, dueNudges, markNudged, readyToCall, campaignKeys, addItemsToCampaign, stampToppedUp };

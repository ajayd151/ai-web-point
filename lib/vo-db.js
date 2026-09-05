// Video Outreach data layer (spec v4 section 3, Appendix B). Postgres, same lazy ensure() pattern
// as lib/smsdb.js. Every table is prefixed vo_ so nothing collides with the local-business SMS
// module (which already owns the word "campaign"). Rows are scoped by `account` (the workspace
// owner's email). Enums and state machines are enforced here, not in the UI.
const fs = require('fs');
const path = require('path');
const { createPool } = require('@vercel/postgres');
const { score, loadConfig, DEFAULT_CONFIG_PATH } = require('./vo-score');
const M = require('./vo-messages');
const { logActivity } = require('./db');

function connString() { return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || ''; }
let _pool = null;
function pool() { if (!_pool) _pool = createPool({ connectionString: connString() }); return _pool; }
function ok() { return !!connString(); }
const sql = (...args) => pool().sql(...args);
const q = (text, values) => pool().query(text, values || []);

// ---- Appendix B enums (stored exactly as these strings) ----
const ENUM = {
  creative_style: ['Video-led', 'Mixed', 'Static'],
  video_sourcing: ['UGC creators', 'AI tools', 'In-house', 'Unknown'],
  dm_active_90d: ['Y', 'N', 'Not found'],
  tier: ['A', 'B', 'Park', 'Disqualified'],
  priority: ['Must target', 'Strong', 'Possible', 'Later', 'Unlikely', 'Skip'],
  linkedin_connection_state: [null, 'Applied', 'Pending', 'Connected'],
  outreach_stage: ['Not contacted', 'Request sent', 'Accepted', 'Msg 1', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Call booked', 'Pilot', 'Client', 'Dead'],
  variant_used: ['A video sent', 'B permission'],
  outcome: [null, 'Won', 'Lost', 'No reply', 'Not a fit', 'Later'],
  campaign_status: ['Draft', 'Active', 'Paused', 'Finished'],
  campaign_schedule: ['One-off', 'Daily', 'Weekly', 'Monthly'],
  run_status: ['Queued', 'Running', 'Done', 'Stopped (cap)', 'Failed'],
};
// Outreach stage machine: the forward chain, plus any -> Replied, any -> Dead, Replied -> Call booked -> Pilot -> Client
const STAGE_NEXT = {
  'Not contacted': ['Request sent'], 'Request sent': ['Accepted'], 'Accepted': ['Msg 1'], 'Msg 1': ['Follow-up 1'],
  'Follow-up 1': ['Follow-up 2'], 'Follow-up 2': [], 'Replied': ['Call booked'], 'Call booked': ['Pilot'], 'Pilot': ['Client'], 'Client': [], 'Dead': [],
};
function stageAllowed(from, to) {
  if (!ENUM.outreach_stage.includes(to)) return false;
  if (to === 'Dead') return from !== 'Dead';
  if (to === 'Replied') return from !== 'Replied';
  return (STAGE_NEXT[from] || []).includes(to);
}
// LinkedIn connection machine: null -> Applied -> Pending -> Connected; Applied/Pending -> null (dead); Connected never goes back
function connAllowed(from, to) {
  const f = from || null, t = to || null;
  if (f === null) return t === 'Applied';
  if (f === 'Applied') return t === 'Pending' || t === 'Connected' || t === null;
  if (f === 'Pending') return t === 'Connected' || t === null;
  return false; // Connected is final
}

let ensured = false;
async function ensure() {
  if (ensured) return;
  try {
    await sql`CREATE TABLE IF NOT EXISTS vo_campaigns (
      id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', owner_email TEXT, notes TEXT,
      industry TEXT, keywords JSONB NOT NULL DEFAULT '[]'::jsonb, countries JSONB NOT NULL DEFAULT '["US"]'::jsonb,
      language TEXT NOT NULL DEFAULT 'English', size_bands JSONB NOT NULL DEFAULT '["1-10","11-50"]'::jsonb,
      store_platform TEXT NOT NULL DEFAULT 'Shopify only', meta_only BOOLEAN NOT NULL DEFAULT true, min_meta_ads INT NOT NULL DEFAULT 10,
      video_only BOOLEAN NOT NULL DEFAULT false, min_video_share INT NOT NULL DEFAULT 20,
      exclusions JSONB NOT NULL DEFAULT '[]'::jsonb, exclude_in_any_campaign BOOLEAN NOT NULL DEFAULT true, exclude_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
      seed_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
      target_per_run INT NOT NULL DEFAULT 20, raw_cap INT NOT NULL DEFAULT 400, cost_cap NUMERIC NOT NULL DEFAULT 10, min_score INT NOT NULL DEFAULT 55,
      schedule TEXT NOT NULL DEFAULT 'One-off', run_time TEXT NOT NULL DEFAULT '06:00', end_condition JSONB, recheck_days INT NOT NULL DEFAULT 30,
      role_rule_employees INT NOT NULL DEFAULT 20, accepted_titles JSONB NOT NULL DEFAULT '[]'::jsonb, channels JSONB NOT NULL DEFAULT '["LinkedIn","Email"]'::jsonb,
      fetch_emails_for TEXT NOT NULL DEFAULT 'priority_number <= 3',
      service_profile JSONB, template_set JSONB, default_variant TEXT NOT NULL DEFAULT 'A video sent',
      automation JSONB
    )`;
    await sql`CREATE TABLE IF NOT EXISTS vo_runs (
      id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, campaign_id BIGINT NOT NULL, kind TEXT NOT NULL DEFAULT 'import',
      status TEXT NOT NULL DEFAULT 'Queued', started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
      inputs JSONB, counts JSONB, est_cost NUMERIC NOT NULL DEFAULT 0, actual_cost NUMERIC NOT NULL DEFAULT 0, errors JSONB
    )`;
    await sql`CREATE TABLE IF NOT EXISTS vo_prospects (
      id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, campaign_id BIGINT NOT NULL, run_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      brand TEXT NOT NULL, website TEXT, domain TEXT NOT NULL, country TEXT, category TEXT, source TEXT, date_researched DATE DEFAULT CURRENT_DATE,
      active_meta_ads INT, video_ads INT, new_ads_30d INT, other_paid_channels INT, creative_style TEXT, ad_samples JSONB,
      skus INT, employees INT, monthly_visits INT, amazon_reviews_hero INT, shopify_plus BOOLEAN, growth_signals INT, pays_for_creative BOOLEAN, video_sourcing TEXT,
      creative_gap INT, trigger_event BOOLEAN, trigger_note TEXT,
      dm_name TEXT, dm_title TEXT, dm_linkedin TEXT, dm_active_90d TEXT, dm_email TEXT, second_contact_name TEXT, second_contact_email TEXT, second_contact_has_email BOOLEAN, gatekeeper BOOLEAN,
      disqualified_reason TEXT, score_a INT, score_b INT, score_c INT, score_d INT, score_total INT, tier TEXT, priority TEXT, priority_number INT, score_breakdown JSONB, score_version TEXT,
      brand_instagram TEXT, linkedin_connection_state TEXT, linkedin_request_sent_at TIMESTAMPTZ, linkedin_connected_at TIMESTAMPTZ,
      suggested_product_url TEXT, suggested_product_name TEXT, product_photo_check TEXT, why_this_product TEXT, video_url TEXT,
      observation TEXT, connection_note TEXT, message_a TEXT, message_b TEXT, variant_used TEXT,
      outreach_stage TEXT NOT NULL DEFAULT 'Not contacted', outcome TEXT, notes TEXT,
      UNIQUE (account, domain)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS vo_prospects_campaign_idx ON vo_prospects (account, campaign_id, priority_number, score_total DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS vo_outreach_events (
      id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, prospect_id BIGINT NOT NULL, campaign_id BIGINT,
      at TIMESTAMPTZ NOT NULL DEFAULT now(), channel TEXT, step TEXT NOT NULL, template TEXT, sample_sent BOOLEAN,
      response TEXT, next_action TEXT, next_action_date DATE, actor TEXT, detail TEXT
    )`;
    await sql`CREATE INDEX IF NOT EXISTS vo_events_prospect_idx ON vo_outreach_events (prospect_id, at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS vo_industry_presets (
      id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL, keywords JSONB NOT NULL DEFAULT '[]'::jsonb, translations JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS vo_config (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    // seed the Appendix A weights and the default service profile once; edit in-app afterwards
    const cfg = loadConfig(DEFAULT_CONFIG_PATH);
    await sql`INSERT INTO vo_config (key, value) VALUES ('scoring', ${JSON.stringify(cfg)}::jsonb) ON CONFLICT (key) DO NOTHING`;
    await sql`INSERT INTO vo_config (key, value) VALUES ('service_profile', ${JSON.stringify(M.DEFAULT_PROFILE)}::jsonb) ON CONFLICT (key) DO NOTHING`;
  } catch (e) { /* IF NOT EXISTS migrations; a transient lock must not blank reads */ }
  ensured = true;
}

// ---- config ----
async function getConfig(key, fallback) {
  if (!ok()) return fallback;
  try { await ensure(); const { rows } = await sql`SELECT value FROM vo_config WHERE key = ${key}`; return rows[0] ? rows[0].value : fallback; } catch (e) { return fallback; }
}
async function setConfig(key, value) {
  if (!ok()) return false;
  try { await ensure(); await sql`INSERT INTO vo_config (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`; return true; } catch (e) { return false; }
}
async function scoringConfig() { return getConfig('scoring', loadConfig(DEFAULT_CONFIG_PATH)); }
async function serviceProfile(campaign) {
  const base = await getConfig('service_profile', M.DEFAULT_PROFILE);
  return Object.assign({}, M.DEFAULT_PROFILE, base || {}, (campaign && campaign.service_profile) || {});
}

// ---- campaigns ----
const CAMPAIGN_FIELDS = ['name', 'status', 'owner_email', 'notes', 'industry', 'keywords', 'countries', 'language', 'size_bands', 'store_platform', 'meta_only', 'min_meta_ads', 'video_only', 'min_video_share', 'exclusions', 'exclude_in_any_campaign', 'exclude_domains', 'seed_brands', 'target_per_run', 'raw_cap', 'cost_cap', 'min_score', 'schedule', 'run_time', 'end_condition', 'recheck_days', 'role_rule_employees', 'accepted_titles', 'channels', 'fetch_emails_for', 'service_profile', 'template_set', 'default_variant', 'automation'];
const JSON_FIELDS = new Set(['keywords', 'countries', 'size_bands', 'exclusions', 'exclude_domains', 'seed_brands', 'end_condition', 'accepted_titles', 'channels', 'service_profile', 'template_set', 'automation']);
const BOOL_FIELDS = new Set(['meta_only', 'video_only', 'exclude_in_any_campaign', 'shopify_plus', 'pays_for_creative', 'trigger_event', 'second_contact_has_email', 'gatekeeper', 'sample_sent']);
const INT_FIELDS = new Set(['min_meta_ads', 'min_video_share', 'target_per_run', 'raw_cap', 'min_score', 'recheck_days', 'role_rule_employees', 'active_meta_ads', 'video_ads', 'new_ads_30d', 'other_paid_channels', 'skus', 'employees', 'monthly_visits', 'amazon_reviews_hero', 'growth_signals', 'creative_gap']);

function coerce(field, v) {
  if (v === undefined) return undefined;
  if (JSON_FIELDS.has(field)) return v === null ? null : JSON.stringify(v);
  if (BOOL_FIELDS.has(field)) { if (v === null || v === '') return null; if (typeof v === 'boolean') return v; const s = String(v).toLowerCase(); return ['y', 'yes', 'true', '1'].includes(s) ? true : (['n', 'no', 'false', '0'].includes(s) ? false : null); }
  if (INT_FIELDS.has(field)) { if (v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
  if (field === 'cost_cap') { const n = Number(v); return Number.isFinite(n) ? n : 10; }
  return v === null ? null : String(v);
}

async function listCampaigns(account) {
  if (!ok()) return [];
  try {
    await ensure();
    const { rows } = await sql`SELECT c.*,
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND COALESCE(p.tier,'') <> 'Disqualified') AS prospects_found,
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND p.linkedin_connection_state = 'Connected') AS connected,
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND p.outreach_stage IN ('Replied','Call booked','Pilot','Client')) AS replied,
        (SELECT COALESCE(SUM(actual_cost),0)::float FROM vo_runs r WHERE r.campaign_id = c.id) AS cost_to_date,
        (SELECT MAX(started_at) FROM vo_runs r WHERE r.campaign_id = c.id) AS last_run_at
      FROM vo_campaigns c WHERE c.account = ${account} ORDER BY c.updated_at DESC`;
    return rows;
  } catch (e) { return []; }
}
async function getCampaign(account, id) {
  if (!ok()) return null;
  try { await ensure(); const { rows } = await sql`SELECT * FROM vo_campaigns WHERE account = ${account} AND id = ${Number(id)}`; return rows[0] || null; } catch (e) { return null; }
}
async function saveCampaign(account, actor, data) {
  if (!ok()) return null;
  await ensure();
  const d = data || {};
  if (d.status && !ENUM.campaign_status.includes(d.status)) throw new Error('Bad campaign status');
  if (d.schedule && !ENUM.campaign_schedule.includes(d.schedule)) throw new Error('Bad schedule');
  if (d.default_variant && !['A video sent', 'B permission', 'Split test 50:50'].includes(d.default_variant)) throw new Error('Bad default variant');
  const id = Number(d.id) || 0;
  const cols = [], vals = [];
  for (const f of CAMPAIGN_FIELDS) { if (d[f] !== undefined) { const v = coerce(f, d[f]); cols.push(f); vals.push(v); } }
  if (!id) {
    if (!d.name) throw new Error('Campaign needs a name');
    cols.push('account', 'created_by'); vals.push(account, actor);
    const ph = vals.map((_, i) => (JSON_FIELDS.has(cols[i]) ? '$' + (i + 1) + '::jsonb' : '$' + (i + 1)));
    const { rows } = await q('INSERT INTO vo_campaigns (' + cols.join(',') + ') VALUES (' + ph.join(',') + ') RETURNING *', vals);
    return rows[0];
  }
  if (!cols.length) return getCampaign(account, id);
  const sets = cols.map((c, i) => c + ' = $' + (i + 1) + (JSON_FIELDS.has(c) ? '::jsonb' : ''));
  vals.push(account, id);
  const { rows } = await q('UPDATE vo_campaigns SET ' + sets.join(', ') + ', updated_at = now() WHERE account = $' + (vals.length - 1) + ' AND id = $' + vals.length + ' RETURNING *', vals);
  return rows[0] || null;
}
async function duplicateCampaign(account, actor, id) {
  const c = await getCampaign(account, id); if (!c) return null;
  const copy = {}; for (const f of CAMPAIGN_FIELDS) copy[f] = c[f];
  copy.name = c.name + ' (copy)'; copy.status = 'Draft';
  return saveCampaign(account, actor, copy);
}

// ---- runs ----
async function createRun(account, campaignId, kind, inputs) {
  await ensure();
  const { rows } = await sql`INSERT INTO vo_runs (account, campaign_id, kind, status, inputs) VALUES (${account}, ${Number(campaignId)}, ${kind || 'import'}, 'Running', ${JSON.stringify(inputs || {})}::jsonb) RETURNING *`;
  return rows[0];
}
async function finishRun(id, status, counts, errors, actualCost) {
  await ensure();
  if (!ENUM.run_status.includes(status)) status = 'Done';
  await sql`UPDATE vo_runs SET status = ${status}, finished_at = now(), counts = ${JSON.stringify(counts || {})}::jsonb, errors = ${JSON.stringify(errors || [])}::jsonb, actual_cost = ${Number(actualCost) || 0} WHERE id = ${Number(id)}`;
}
async function listRuns(account, campaignId) {
  if (!ok()) return [];
  try { await ensure(); const { rows } = await sql`SELECT * FROM vo_runs WHERE account = ${account} AND campaign_id = ${Number(campaignId)} ORDER BY started_at DESC LIMIT 50`; return rows; } catch (e) { return []; }
}

// ---- prospects ----
const PROSPECT_INPUTS = ['brand', 'website', 'country', 'category', 'source', 'active_meta_ads', 'video_ads', 'new_ads_30d', 'other_paid_channels', 'creative_style', 'skus', 'employees', 'monthly_visits', 'amazon_reviews_hero', 'shopify_plus', 'growth_signals', 'pays_for_creative', 'video_sourcing', 'creative_gap', 'trigger_event', 'trigger_note', 'dm_name', 'dm_title', 'dm_linkedin', 'dm_active_90d', 'dm_email', 'second_contact_name', 'second_contact_email', 'second_contact_has_email', 'gatekeeper', 'disqualified_reason', 'brand_instagram', 'suggested_product_url', 'suggested_product_name', 'product_photo_check', 'why_this_product', 'observation', 'notes'];
const PROSPECT_TEXT_OVERRIDES = ['connection_note', 'message_a', 'message_b', 'variant_used', 'outcome'];
const SCORE_INPUTS = new Set(['active_meta_ads', 'video_ads', 'new_ads_30d', 'other_paid_channels', 'skus', 'employees', 'monthly_visits', 'amazon_reviews_hero', 'shopify_plus', 'growth_signals', 'pays_for_creative', 'video_sourcing', 'creative_gap', 'trigger_event', 'dm_active_90d', 'second_contact_has_email', 'gatekeeper', 'disqualified_reason']);
const MESSAGE_INPUTS = new Set(['dm_name', 'category', 'creative_style', 'suggested_product_name', 'observation', 'video_url']);

function validateEnums(d) {
  const check = (f) => { if (d[f] !== undefined && d[f] !== null && d[f] !== '' && !ENUM[f].includes(d[f])) throw new Error('Bad value for ' + f + ': ' + d[f]); };
  ['creative_style', 'video_sourcing', 'dm_active_90d', 'variant_used'].forEach(check);
  if (d.outcome !== undefined && d.outcome !== null && d.outcome !== '' && !ENUM.outcome.includes(d.outcome)) throw new Error('Bad outcome');
  if (d.creative_gap !== undefined && d.creative_gap !== null && d.creative_gap !== '' && ![0, 4, 8].includes(Number(d.creative_gap))) throw new Error('creative_gap must be 0, 4 or 8');
}

// score + messages for one prospect object (used by import and by updates)
async function computeDerived(p, campaign) {
  const cfg = await scoringConfig();
  const s = score(p, cfg);
  const profile = await serviceProfile(campaign);
  let msgs = null;
  try { msgs = M.generate(p, profile, p.video_url || null); } catch (e) { msgs = null; }
  return { s, msgs };
}

async function importRows(account, actor, campaign, runId, mapped) {
  await ensure();
  const counts = { total: mapped.length, imported: 0, skipped_duplicate: 0, disqualified: 0, failed: 0 };
  const errors = [];
  for (const { input } of mapped) {
    try {
      const p = Object.assign({}, input);
      const { s, msgs } = await computeDerived(p, campaign);
      const cols = ['account', 'campaign_id', 'run_id', 'source'].concat(PROSPECT_INPUTS.filter((f) => f !== 'source'));
      const vals = [account, Number(campaign.id), Number(runId), 'import'].concat(PROSPECT_INPUTS.filter((f) => f !== 'source').map((f) => coerce(f, p[f] === undefined ? null : p[f])));
      cols.push('domain'); vals.push(p.domain);
      const derived = { score_a: s.score_a, score_b: s.score_b, score_c: s.score_c, score_d: s.score_d, score_total: s.score_total, tier: s.tier, priority: s.priority, priority_number: s.priority_number, score_breakdown: JSON.stringify(s.breakdown), score_version: s.score_version,
        observation: msgs ? msgs.observation : null, connection_note: msgs ? msgs.connection_note : null, message_a: msgs ? msgs.message_a : null, message_b: msgs ? msgs.message_b : null };
      for (const [k, v] of Object.entries(derived)) { cols.push(k); vals.push(v); }
      const ph = vals.map((_, i) => (cols[i] === 'score_breakdown' ? '$' + (i + 1) + '::jsonb' : '$' + (i + 1)));
      const r = await q('INSERT INTO vo_prospects (' + cols.join(',') + ') VALUES (' + ph.join(',') + ') ON CONFLICT (account, domain) DO NOTHING RETURNING id', vals);
      if (r.rowCount) { counts.imported++; if (s.tier === 'Disqualified') counts.disqualified++; }
      else counts.skipped_duplicate++;
    } catch (e) { counts.failed++; errors.push((input && input.brand) + ': ' + (e.message || 'failed')); }
  }
  return { counts, errors };
}

async function listProspects(account, f) {
  if (!ok()) return [];
  await ensure();
  const o = f || {};
  const where = ['p.account = $1']; const vals = [account];
  // every '?' in the clause becomes the same numbered parameter, so a search term can be reused
  const add = (cond, v) => { vals.push(v); where.push(cond.split('?').join('$' + vals.length)); };
  if (o.campaignId) add('p.campaign_id = ?', Number(o.campaignId));
  if (o.runId) add('p.run_id = ?', Number(o.runId));
  if (o.priority) add('p.priority = ?', o.priority);
  if (o.connection) { if (o.connection === 'none') where.push('p.linkedin_connection_state IS NULL'); else add('p.linkedin_connection_state = ?', o.connection); }
  if (o.creativeStyle) add('p.creative_style = ?', o.creativeStyle);
  if (o.stage) add('p.outreach_stage = ?', o.stage);
  if (o.q) add('(p.brand ILIKE ? OR p.domain ILIKE ?)', '%' + o.q + '%');
  if (!o.includeDisqualified) where.push("COALESCE(p.tier,'') <> 'Disqualified'"); // hidden by default (owner decision)
  const sqlText = 'SELECT p.*, e.at AS last_event_at, e.step AS last_event FROM vo_prospects p ' +
    'LEFT JOIN LATERAL (SELECT at, step FROM vo_outreach_events ev WHERE ev.prospect_id = p.id ORDER BY at DESC LIMIT 1) e ON true ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY p.priority_number ASC NULLS LAST, p.score_total DESC NULLS LAST, p.brand ASC LIMIT 1000';
  const { rows } = await q(sqlText, vals);
  return rows;
}
async function getProspect(account, id) {
  if (!ok()) return null;
  await ensure();
  const { rows } = await sql`SELECT * FROM vo_prospects WHERE account = ${account} AND id = ${Number(id)}`;
  const p = rows[0] || null;
  if (!p) return null;
  const ev = await sql`SELECT * FROM vo_outreach_events WHERE prospect_id = ${p.id} ORDER BY at DESC LIMIT 100`;
  p.events = ev.rows;
  return p;
}

// Edit any input; scoring inputs recalculate the score, message inputs regenerate the messages,
// unless the user is editing the message text itself.
async function updateProspect(account, actor, id, fields) {
  await ensure();
  const cur = await getProspect(account, id); if (!cur) throw new Error('Prospect not found');
  const d = fields || {};
  validateEnums(d);
  const merged = Object.assign({}, cur);
  const cols = [], vals = [];
  let touchedScore = false, touchedMsg = false, editedMsgText = false;
  for (const f of PROSPECT_INPUTS.concat(PROSPECT_TEXT_OVERRIDES, ['video_url'])) {
    if (d[f] === undefined) continue;
    const v = coerce(f, d[f]);
    merged[f] = v; cols.push(f); vals.push(v);
    if (SCORE_INPUTS.has(f)) touchedScore = true;
    if (MESSAGE_INPUTS.has(f)) touchedMsg = true;
    if (['connection_note', 'message_a', 'message_b'].includes(f)) editedMsgText = true;
  }
  if (d.website !== undefined) { const { normaliseDomain } = require('./vo-import'); merged.domain = normaliseDomain(d.website); cols.push('domain'); vals.push(merged.domain); }
  if (d.suggested_product_url !== undefined && d.suggested_product_name === undefined) { const { productNameFromUrl } = require('./vo-import'); const n = productNameFromUrl(d.suggested_product_url); if (n) { merged.suggested_product_name = n; cols.push('suggested_product_name'); vals.push(n); touchedMsg = true; } }
  const campaign = await getCampaign(account, cur.campaign_id);
  if (touchedScore || touchedMsg) {
    const { s, msgs } = await computeDerived(merged, campaign);
    if (touchedScore) {
      const sc = { score_a: s.score_a, score_b: s.score_b, score_c: s.score_c, score_d: s.score_d, score_total: s.score_total, tier: s.tier, priority: s.priority, priority_number: s.priority_number, score_breakdown: JSON.stringify(s.breakdown), score_version: s.score_version };
      for (const [k, v] of Object.entries(sc)) { cols.push(k); vals.push(v); }
    }
    if (touchedMsg && !editedMsgText && msgs) {
      for (const k of ['observation', 'connection_note', 'message_a', 'message_b']) { if (d[k] === undefined || k !== 'observation') { cols.push(k); vals.push(msgs[k]); } }
    }
  }
  if (!cols.length) return cur;
  const sets = cols.map((c, i) => c + ' = $' + (i + 1) + (c === 'score_breakdown' ? '::jsonb' : ''));
  vals.push(account, Number(id));
  await q('UPDATE vo_prospects SET ' + sets.join(', ') + ', updated_at = now() WHERE account = $' + (vals.length - 1) + ' AND id = $' + vals.length, vals);
  try { await logActivity(actor, account, 'vo_prospect_edit', cur.brand + ' edited (' + cols.filter((c) => !c.startsWith('score_')).join(', ') + ')', cur.brand); } catch (e) {}
  return getProspect(account, id);
}

// Paste the video URL: validate https, regenerate Message A with the link in place of the placeholder.
async function setVideoUrl(account, actor, id, url) {
  const u = String(url || '').trim();
  if (u && !/^https:\/\/\S+$/i.test(u)) throw new Error('The video URL must start with https://');
  return updateProspect(account, actor, id, { video_url: u || null });
}

async function addEvent(account, actor, prospect, ev) {
  await ensure();
  const e = ev || {};
  await sql`INSERT INTO vo_outreach_events (account, prospect_id, campaign_id, channel, step, template, sample_sent, response, next_action, next_action_date, actor, detail)
    VALUES (${account}, ${Number(prospect.id)}, ${Number(prospect.campaign_id)}, ${e.channel || null}, ${e.step || 'note'}, ${e.template || null}, ${e.sample_sent == null ? null : !!e.sample_sent}, ${e.response || null}, ${e.next_action || null}, ${e.next_action_date || null}, ${actor || null}, ${e.detail || null})`;
  try { await logActivity(actor, account, 'vo_event', prospect.brand + ': ' + (e.step || 'note') + (e.detail ? ' (' + e.detail + ')' : ''), prospect.brand); } catch (x) {}
}

// Stage machine (Appendix B). Setting a stage always writes an OutreachEvent.
async function setStage(account, actor, id, stage, opts) {
  await ensure();
  const p = await getProspect(account, id); if (!p) throw new Error('Prospect not found');
  const from = p.outreach_stage || 'Not contacted';
  if (stage === from) return p;
  if (!stageAllowed(from, stage)) throw new Error('Cannot move from "' + from + '" to "' + stage + '". Allowed next: ' + (STAGE_NEXT[from] || []).concat(['Replied', 'Dead']).filter((x) => x !== from).join(', '));
  const o = opts || {};
  const variant = o.variant_used && ENUM.variant_used.includes(o.variant_used) ? o.variant_used : null;
  await sql`UPDATE vo_prospects SET outreach_stage = ${stage}, variant_used = COALESCE(${variant}, variant_used), updated_at = now() WHERE account = ${account} AND id = ${Number(id)}`;
  await addEvent(account, actor, p, { channel: o.channel || 'LinkedIn', step: stage, template: variant || o.template || null, sample_sent: stage === 'Msg 1' ? !!p.video_url : null, detail: o.note || ('Stage ' + from + ' -> ' + stage) });
  return getProspect(account, id);
}

// LinkedIn connection machine (Appendix B). Connected sets the stage to Accepted where allowed.
async function setConnectionState(account, actor, id, state, opts) {
  await ensure();
  const p = await getProspect(account, id); if (!p) throw new Error('Prospect not found');
  const to = state || null;
  if (to && !ENUM.linkedin_connection_state.includes(to)) throw new Error('Bad connection state');
  const from = p.linkedin_connection_state || null;
  if (to === from) return p;
  if (!connAllowed(from, to)) throw new Error('Cannot move LinkedIn state from "' + (from || 'none') + '" to "' + (to || 'none') + '"');
  if (to === 'Applied') await sql`UPDATE vo_prospects SET linkedin_connection_state = 'Applied', linkedin_request_sent_at = COALESCE(linkedin_request_sent_at, now()), updated_at = now() WHERE id = ${Number(id)}`;
  else if (to === 'Pending') await sql`UPDATE vo_prospects SET linkedin_connection_state = 'Pending', updated_at = now() WHERE id = ${Number(id)}`;
  else if (to === 'Connected') await sql`UPDATE vo_prospects SET linkedin_connection_state = 'Connected', linkedin_connected_at = now(), updated_at = now() WHERE id = ${Number(id)}`;
  else await sql`UPDATE vo_prospects SET linkedin_connection_state = NULL, updated_at = now() WHERE id = ${Number(id)}`;
  await addEvent(account, actor, p, { channel: 'LinkedIn', step: 'Connection ' + (to || 'withdrawn'), detail: (opts && opts.note) || ('LinkedIn ' + (from || 'none') + ' -> ' + (to || 'none')) });
  // spec 4.9: on acceptance move to Accepted; on withdrawal (null) the stage goes Dead
  let cur = await getProspect(account, id);
  if (to === 'Connected' && stageAllowed(cur.outreach_stage, 'Accepted')) cur = await setStage(account, actor, id, 'Accepted', { channel: 'LinkedIn', note: 'Connection accepted' });
  if (to === 'Applied' && stageAllowed(cur.outreach_stage, 'Request sent')) cur = await setStage(account, actor, id, 'Request sent', { channel: 'LinkedIn', note: 'Connection request sent' });
  if (to === null && from && stageAllowed(cur.outreach_stage, 'Dead')) cur = await setStage(account, actor, id, 'Dead', { channel: 'LinkedIn', note: 'Request withdrawn, no acceptance' });
  return cur;
}

async function setOutcome(account, actor, id, outcome, note) {
  await ensure();
  const p = await getProspect(account, id); if (!p) throw new Error('Prospect not found');
  const o = outcome || null;
  if (o && !ENUM.outcome.includes(o)) throw new Error('Bad outcome');
  await sql`UPDATE vo_prospects SET outcome = ${o}, updated_at = now() WHERE account = ${account} AND id = ${Number(id)}`;
  await addEvent(account, actor, p, { step: 'Outcome ' + (o || 'cleared'), detail: note || null });
  return getProspect(account, id);
}

module.exports = { ENUM, STAGE_NEXT, stageAllowed, connAllowed, ensure, getConfig, setConfig, scoringConfig, serviceProfile, listCampaigns, getCampaign, saveCampaign, duplicateCampaign, createRun, finishRun, listRuns, importRows, listProspects, getProspect, updateProspect, setVideoUrl, addEvent, setStage, setConnectionState, setOutcome, PROSPECT_INPUTS };

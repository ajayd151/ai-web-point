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
const { DEFAULT_EXCLUSIONS } = require('./vo-run');
const S = require('./vo-services');

function connString() { return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || ''; }
let _pool = null;
function pool() { if (!_pool) _pool = createPool({ connectionString: connString() }); return _pool; }
function ok() { return !!connString(); }
const sql = (...args) => pool().sql(...args);
const q = (text, values) => pool().query(text, values || []);
// Postgres jsonb refuses lone surrogates (an emoji cut in half) and null bytes; ad copy from the wild has both.
function jsonb(v) { return JSON.stringify(v == null ? null : v).replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '').replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1').replace(/\\u0000/g, ''); }

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
    // Phase 2 to 5 columns (ADD COLUMN IF NOT EXISTS is safe to run every cold start)
    await sql`ALTER TABLE vo_runs ADD COLUMN IF NOT EXISTS state JSONB, ADD COLUMN IF NOT EXISTS heartbeat TIMESTAMPTZ`;
    await sql`ALTER TABLE vo_prospects ADD COLUMN IF NOT EXISTS products JSONB, ADD COLUMN IF NOT EXISTS products_source TEXT, ADD COLUMN IF NOT EXISTS apollo_org_id TEXT, ADD COLUMN IF NOT EXISTS ad_analysis JSONB, ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS linkedin_provider_id TEXT, ADD COLUMN IF NOT EXISTS linkedin_invitation_id TEXT, ADD COLUMN IF NOT EXISTS linkedin_chat_id TEXT, ADD COLUMN IF NOT EXISTS last_reply_text TEXT, ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS meta_page_id TEXT, ADD COLUMN IF NOT EXISTS reply_sentiment TEXT, ADD COLUMN IF NOT EXISTS reply_summary TEXT, ADD COLUMN IF NOT EXISTS product_candidates JSONB`;
    await sql`ALTER TABLE vo_campaigns ADD COLUMN IF NOT EXISTS schedule_days JSONB, ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/London', ADD COLUMN IF NOT EXISTS keywords_translated JSONB, ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`;
    await sql`ALTER TABLE vo_outreach_events ADD COLUMN IF NOT EXISTS done BOOLEAN`;
    await sql`CREATE TABLE IF NOT EXISTS vo_questions (id BIGSERIAL PRIMARY KEY, account TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), asked_by TEXT, question TEXT NOT NULL, answer TEXT, faq_worthy BOOLEAN, faq_question TEXT, faq_answer TEXT, feature_request TEXT, added_to_faq BOOLEAN, helpful BOOLEAN)`;
    await sql`INSERT INTO vo_config (key, value) VALUES ('exclusions', ${jsonb(DEFAULT_EXCLUSIONS)}::jsonb) ON CONFLICT (key) DO NOTHING`;
    await sql`INSERT INTO vo_config (key, value) VALUES ('linkedin', ${jsonb({ daily_requests: 20, daily_messages: 40, weekly_requests: 100, max_priority: 3, paused: false, paused_reason: '' })}::jsonb) ON CONFLICT (key) DO NOTHING`;
    // seed the Appendix A weights and the default service profile once; edit in-app afterwards
    const cfg = loadConfig(DEFAULT_CONFIG_PATH);
    await sql`INSERT INTO vo_config (key, value) VALUES ('scoring', ${jsonb(cfg)}::jsonb) ON CONFLICT (key) DO NOTHING`;
    await sql`INSERT INTO vo_config (key, value) VALUES ('service_profile', ${jsonb(M.DEFAULT_PROFILE)}::jsonb) ON CONFLICT (key) DO NOTHING`;
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
  try { await ensure(); await sql`INSERT INTO vo_config (key, value, updated_at) VALUES (${key}, ${jsonb(value)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`; return true; } catch (e) { return false; }
}
async function scoringConfig() { return getConfig('scoring', loadConfig(DEFAULT_CONFIG_PATH)); }
async function serviceProfile(campaign) {
  const base = await getConfig('service_profile', M.DEFAULT_PROFILE);
  return Object.assign({}, M.DEFAULT_PROFILE, base || {}, (campaign && campaign.service_profile) || {});
}

// ---- campaigns ----
const CAMPAIGN_FIELDS = ['name', 'status', 'owner_email', 'notes', 'industry', 'keywords', 'countries', 'language', 'size_bands', 'store_platform', 'meta_only', 'min_meta_ads', 'video_only', 'min_video_share', 'exclusions', 'exclude_in_any_campaign', 'exclude_domains', 'seed_brands', 'target_per_run', 'raw_cap', 'cost_cap', 'min_score', 'schedule', 'run_time', 'end_condition', 'recheck_days', 'role_rule_employees', 'accepted_titles', 'channels', 'fetch_emails_for', 'service_profile', 'template_set', 'default_variant', 'automation', 'schedule_days', 'timezone', 'keywords_translated'];
const JSON_FIELDS = new Set(['keywords', 'countries', 'size_bands', 'exclusions', 'exclude_domains', 'seed_brands', 'end_condition', 'accepted_titles', 'channels', 'service_profile', 'template_set', 'automation', 'schedule_days', 'keywords_translated']);
const BOOL_FIELDS = new Set(['meta_only', 'video_only', 'exclude_in_any_campaign', 'shopify_plus', 'pays_for_creative', 'trigger_event', 'second_contact_has_email', 'gatekeeper', 'sample_sent']);
const INT_FIELDS = new Set(['min_meta_ads', 'min_video_share', 'target_per_run', 'raw_cap', 'min_score', 'recheck_days', 'role_rule_employees', 'active_meta_ads', 'video_ads', 'new_ads_30d', 'other_paid_channels', 'skus', 'employees', 'monthly_visits', 'amazon_reviews_hero', 'growth_signals', 'creative_gap']);

function coerce(field, v) {
  if (v === undefined) return undefined;
  if (JSON_FIELDS.has(field)) return v === null ? null : jsonb(v);
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
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND p.outreach_stage IN ('Replied','Call booked','Pilot','Client') AND p.reply_sentiment = 'Positive') AS positive_replies,
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND p.linkedin_connection_state IN ('Applied','Pending')) AS requested,
        (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND p.outreach_stage IN ('Msg 1','Follow-up 1','Follow-up 2','Replied','Call booked','Pilot','Client')) AS videos_sent,
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
  const { rows } = await sql`INSERT INTO vo_runs (account, campaign_id, kind, status, inputs) VALUES (${account}, ${Number(campaignId)}, ${kind || 'import'}, 'Running', ${jsonb(inputs || {})}::jsonb) RETURNING *`;
  return rows[0];
}
async function finishRun(id, status, counts, errors, actualCost) {
  await ensure();
  if (!ENUM.run_status.includes(status)) status = 'Done';
  await sql`UPDATE vo_runs SET status = ${status}, finished_at = now(), counts = ${jsonb(counts || {})}::jsonb, errors = ${jsonb(errors || [])}::jsonb, actual_cost = ${Number(actualCost) || 0} WHERE id = ${Number(id)}`;
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
  try { msgs = M.generate(p, profile, p.video_url || null, campaign && campaign.template_set); } catch (e) { msgs = null; }
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
      const derived = { score_a: s.score_a, score_b: s.score_b, score_c: s.score_c, score_d: s.score_d, score_total: s.score_total, tier: s.tier, priority: s.priority, priority_number: s.priority_number, score_breakdown: jsonb(s.breakdown), score_version: s.score_version,
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
      const sc = { score_a: s.score_a, score_b: s.score_b, score_c: s.score_c, score_d: s.score_d, score_total: s.score_total, tier: s.tier, priority: s.priority, priority_number: s.priority_number, score_breakdown: jsonb(s.breakdown), score_version: s.score_version };
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
  if (stage === 'Msg 1') await scheduleFollowups(account, actor, p, o.channel || 'LinkedIn'); // 4.8: follow-up drafts at 3 and 7 days, however Msg 1 went out
  if (['Replied', 'Call booked', 'Pilot', 'Client', 'Dead'].includes(stage)) await cancelFollowups(id);
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
  if (to === null && from && !(opts && opts.keepStage) && stageAllowed(cur.outreach_stage, 'Dead')) cur = await setStage(account, actor, id, 'Dead', { channel: 'LinkedIn', note: 'Request withdrawn, no acceptance' });
  return cur;
}

// Back to square one for a prospect used in a test: stage Not contacted, no connection, no video, follow-ups cancelled. Events stay.
async function resetOutreach(account, actor, id) {
  await ensure();
  const p = await getProspect(account, id); if (!p) throw new Error('Prospect not found');
  await sql`UPDATE vo_prospects SET outreach_stage = 'Not contacted', linkedin_connection_state = NULL, linkedin_request_sent_at = NULL, linkedin_connected_at = NULL, linkedin_invitation_id = NULL, linkedin_chat_id = NULL, variant_used = NULL, outcome = NULL, video_url = NULL, last_reply_text = NULL, last_reply_at = NULL, reply_sentiment = NULL, reply_summary = NULL, email_sent_at = NULL, email_opened_at = NULL, updated_at = now() WHERE account = ${account} AND id = ${Number(id)}`;
  await cancelFollowups(id);
  await addEvent(account, actor, p, { step: 'Reset', detail: 'Outreach reset to Not contacted (was ' + (p.outreach_stage || '') + ', connection ' + (p.linkedin_connection_state || 'none') + ')' });
  return updateProspect(account, actor, id, { observation: p.observation || '' }); // rebuild Message A without the video link
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


// =====================================================================================
// Phases 2 to 5: sourcing runs, presets, re-checks, email, LinkedIn automation, results
// =====================================================================================
async function globalExclusions() { return getConfig('exclusions', DEFAULT_EXCLUSIONS); }
async function linkedinSettings() { return Object.assign({ daily_requests: 20, daily_messages: 40, weekly_requests: 100, max_priority: 3, paused: false, paused_reason: '' }, await getConfig('linkedin', {})); }
async function existingDomains(account) { await ensure(); const { rows } = await sql`SELECT domain FROM vo_prospects WHERE account = ${account}`; return new Set(rows.map((r) => r.domain)); }

const EXTRA_COLS = ['ad_samples', 'products', 'products_source', 'apollo_org_id', 'ad_analysis', 'meta_page_id', 'product_candidates'];
// Insert one sourced prospect (score and messages already computed by the pipeline). Duplicate domain = not inserted.
async function insertProspect(account, campaign, runId, p, s, msgs) {
  await ensure();
  const cols = ['account', 'campaign_id', 'run_id', 'domain', 'last_checked_at']; const vals = [account, Number(campaign.id), runId ? Number(runId) : null, p.domain, new Date().toISOString()];
  for (const f of PROSPECT_INPUTS) { cols.push(f); vals.push(coerce(f, p[f] === undefined ? null : p[f])); }
  for (const f of EXTRA_COLS) { cols.push(f); vals.push(['ad_samples', 'products', 'ad_analysis', 'product_candidates'].includes(f) ? (p[f] == null ? null : jsonb(p[f])) : (p[f] == null ? null : String(p[f]))); }
  const derived = { score_a: s.score_a, score_b: s.score_b, score_c: s.score_c, score_d: s.score_d, score_total: s.score_total, tier: s.tier, priority: s.priority, priority_number: s.priority_number, score_breakdown: jsonb(s.breakdown), score_version: s.score_version,
    observation: msgs ? msgs.observation : (p.observation || null), connection_note: msgs ? msgs.connection_note : null, message_a: msgs ? msgs.message_a : null, message_b: msgs ? msgs.message_b : null };
  // 'observation' is both an input column and a derived one: overwrite in place, never list a column twice
  for (const [k, v] of Object.entries(derived)) { const i = cols.indexOf(k); if (i >= 0) vals[i] = v; else { cols.push(k); vals.push(v); } }
  const JSONB = new Set(['score_breakdown', 'ad_samples', 'products', 'ad_analysis', 'product_candidates']);
  const ph = vals.map((_, i) => (JSONB.has(cols[i]) ? '$' + (i + 1) + '::jsonb' : '$' + (i + 1)));
  const r = await q('INSERT INTO vo_prospects (' + cols.join(',') + ') VALUES (' + ph.join(',') + ') ON CONFLICT (account, domain) DO NOTHING RETURNING id', vals);
  return { inserted: !!r.rowCount, id: r.rows[0] ? r.rows[0].id : null };
}
async function getRun(account, id) { await ensure(); const { rows } = await sql`SELECT * FROM vo_runs WHERE account = ${account} AND id = ${Number(id)}`; return rows[0] || null; }
async function saveRunState(run, state, status) {
  await ensure();
  const st = ENUM.run_status.includes(status) ? status : 'Running';
  const finished = st === 'Running' || st === 'Queued' ? null : new Date().toISOString();
  const slim = Object.assign({}, state, { candidates: (state.candidates || []).map((c) => Object.assign({}, c, { ad_samples: (c.ad_samples || []).slice(0, 3) })) });
  await sql`UPDATE vo_runs SET state = ${jsonb(slim)}::jsonb, status = ${st}, counts = ${jsonb(state.counts || {})}::jsonb, errors = ${jsonb((state.errors || []).slice(0, 50))}::jsonb, actual_cost = ${Number(state.cost) || 0}, heartbeat = now(), finished_at = COALESCE(${finished}, finished_at) WHERE id = ${Number(run.id)}`;
  run.state = state; run.status = st;
}
// The store object lib/vo-run.js drives a run through.
function runStore(account, actor, campaign) {
  return {
    getRun: (id) => getRun(account, id),
    saveRun: (run, state, status) => saveRunState(run, state, status),
    existingDomains: () => existingDomains(account),
    globalExclusions: () => globalExclusions(),
    scoringConfig: () => scoringConfig(),
    profile: (c) => serviceProfile(c || campaign),
    insertProspect: (c, runId, p, s, msgs) => insertProspect(account, c, runId, p, s, msgs),
  };
}
async function runningRuns(account, opts) {
  await ensure();
  // idle = untouched for 2 minutes: the worker only picks those up, so it never processes the same brands as a live UI step
  const { rows } = (opts && opts.idleOnly)
    ? await sql`SELECT * FROM vo_runs WHERE account = ${account} AND status IN ('Running','Queued') AND (heartbeat IS NULL OR heartbeat < now() - interval '2 minutes') ORDER BY started_at ASC LIMIT 5`
    : await sql`SELECT * FROM vo_runs WHERE account = ${account} AND status IN ('Running','Queued') ORDER BY started_at ASC LIMIT 5`;
  return rows;
}
async function claimRun(id) { await ensure(); const r = await sql`UPDATE vo_runs SET heartbeat = now() WHERE id = ${Number(id)} AND status IN ('Running','Queued') AND (heartbeat IS NULL OR heartbeat < now() - interval '50 seconds') RETURNING id`; return !!r.rowCount; }
async function stopRun(account, id, why) { await ensure(); await sql`UPDATE vo_runs SET status = 'Stopped (cap)', finished_at = now(), errors = COALESCE(errors, '[]'::jsonb) || ${jsonb([why || 'stopped by user'])}::jsonb WHERE account = ${account} AND id = ${Number(id)} AND status IN ('Running','Queued')`; }
async function allAccounts() { if (!ok()) return []; await ensure(); const { rows } = await sql`SELECT DISTINCT account FROM vo_campaigns`; return rows.map((r) => r.account); }
async function touchCampaignRun(id) { await ensure(); await sql`UPDATE vo_campaigns SET last_run_at = now(), updated_at = now() WHERE id = ${Number(id)}`; }

// ---- scheduling (2.1 schedule, 2.2 behaviour) ----
function localParts(now, tz) {
  try { const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/London', hour: '2-digit', minute: '2-digit', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour12: false }).formatToParts(now); const g = (t) => (f.find((x) => x.type === t) || {}).value; return { hhmm: g('hour') + ':' + g('minute'), weekday: g('weekday'), date: g('year') + '-' + g('month') + '-' + g('day'), day: Number(g('day')) }; }
  catch (e) { const d = now; return { hhmm: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()], date: d.toISOString().slice(0, 10), day: d.getUTCDate() }; }
}
// Is this scheduled campaign due right now? Daily: once a day after run_time. Weekly: on the chosen days. Monthly: the 1st.
function scheduleDue(c, now) {
  if (c.status !== 'Active' || !c.schedule || c.schedule === 'One-off') return false;
  const lp = localParts(now || new Date(), c.timezone);
  if (lp.hhmm < String(c.run_time || '06:00').slice(0, 5)) return false;
  if (c.last_run_at && localParts(new Date(c.last_run_at), c.timezone).date === lp.date) return false; // already ran today
  if (c.schedule === 'Weekly') { const days = Array.isArray(c.schedule_days) && c.schedule_days.length ? c.schedule_days : ['Mon']; if (!days.map((d) => String(d).slice(0, 3)).includes(lp.weekday)) return false; }
  if (c.schedule === 'Monthly' && lp.day !== 1) return false;
  const end = c.end_condition || {};
  if (end.until_date && lp.date > String(end.until_date).slice(0, 10)) return false;
  return true;
}
async function scheduledCampaigns(account) { await ensure(); const { rows } = await sql`SELECT c.*, (SELECT COUNT(*)::int FROM vo_prospects p WHERE p.campaign_id = c.id AND COALESCE(p.tier,'') NOT IN ('Disqualified')) AS found FROM vo_campaigns c WHERE c.account = ${account} AND c.status = 'Active' AND c.schedule <> 'One-off'`; return rows; }
async function finishCampaign(id, why) { await ensure(); await sql`UPDATE vo_campaigns SET status = 'Finished', notes = COALESCE(notes,'') || ${'\n' + why}, updated_at = now() WHERE id = ${Number(id)}`; }

// ---- industry presets (2.1) ----
async function listPresets(account) { if (!ok()) return []; await ensure(); const { rows } = await sql`SELECT * FROM vo_industry_presets WHERE account = ${account} ORDER BY name`; return rows; }
async function savePreset(account, name, keywords, translations) {
  await ensure(); const n = String(name || '').trim(); if (!n) throw new Error('Preset needs a name');
  const kw = jsonb((keywords || []).map(String).filter(Boolean)); const tr = jsonb(translations || {});
  const { rows } = await sql`SELECT id FROM vo_industry_presets WHERE account = ${account} AND name = ${n}`;
  if (rows[0]) { await sql`UPDATE vo_industry_presets SET keywords = ${kw}::jsonb, translations = ${tr}::jsonb WHERE id = ${rows[0].id}`; return rows[0].id; }
  const r = await sql`INSERT INTO vo_industry_presets (account, name, keywords, translations) VALUES (${account}, ${n}, ${kw}::jsonb, ${tr}::jsonb) RETURNING id`; return r.rows[0].id;
}
async function deletePreset(account, id) { await ensure(); await sql`DELETE FROM vo_industry_presets WHERE account = ${account} AND id = ${Number(id)}`; }

// ---- re-check cadence (2.1): oldest-checked prospects whose campaign's recheck_days has passed ----
async function prospectsDueRecheck(account, limit, opts) {
  await ensure(); const o = opts || {};
  const { rows } = o.force
    ? await sql`SELECT p.id, p.brand, p.domain, p.country, p.campaign_id, p.meta_page_id, c.recheck_days FROM vo_prospects p JOIN vo_campaigns c ON c.id = p.campaign_id
        WHERE p.account = ${account} AND (${o.campaignId ? Number(o.campaignId) : null}::bigint IS NULL OR p.campaign_id = ${o.campaignId ? Number(o.campaignId) : null}::bigint) AND COALESCE(p.tier,'') <> 'Disqualified' AND p.source <> 'import'
          AND COALESCE(p.last_checked_at, p.created_at) < now() - interval '1 hour'
        ORDER BY p.priority_number ASC NULLS LAST, p.score_total DESC LIMIT ${Number(limit) || 3}`
    : await sql`SELECT p.id, p.brand, p.domain, p.country, p.campaign_id, p.meta_page_id, c.recheck_days FROM vo_prospects p JOIN vo_campaigns c ON c.id = p.campaign_id
        WHERE p.account = ${account} AND c.status IN ('Active','Paused') AND COALESCE(p.tier,'') <> 'Disqualified' AND p.source <> 'import'
          AND COALESCE(p.last_checked_at, p.created_at) < now() - (COALESCE(c.recheck_days, 30) || ' days')::interval
        ORDER BY COALESCE(p.last_checked_at, p.created_at) ASC LIMIT ${Number(limit) || 5}`;
  return rows;
}
async function countRecountable(account, campaignId) { await ensure(); const { rows } = await sql`SELECT COUNT(*)::int AS n FROM vo_prospects p WHERE p.account = ${account} AND p.campaign_id = ${Number(campaignId)} AND COALESCE(p.tier,'') <> 'Disqualified' AND p.source <> 'import' AND COALESCE(p.last_checked_at, p.created_at) < now() - interval '1 hour'`; return rows[0] ? rows[0].n : 0; }
async function deleteProspect(account, id) { await ensure(); await sql`DELETE FROM vo_outreach_events WHERE account = ${account} AND prospect_id = ${Number(id)}`; const r = await sql`DELETE FROM vo_prospects WHERE account = ${account} AND id = ${Number(id)}`; return r.rowCount || 0; }
// Clear everything a run produced (test runs, or a run with bad keywords) so the campaign can run again without dedupe blocking it.
async function deleteRunProspects(account, runId) {
  await ensure();
  const run = await getRun(account, runId); if (!run) return { deleted: 0, remaining: 0, how: 'no run' };
  const count = async () => { const { rows } = await sql`SELECT COUNT(*)::int AS n FROM vo_prospects WHERE account = ${account} AND campaign_id = ${Number(run.campaign_id)}`; return rows[0] ? rows[0].n : 0; };
  const before = await count();
  // by run link first; if nothing carries the link, fall back to the run's time window on that campaign
  let ids = (await sql`SELECT id FROM vo_prospects WHERE account = ${account} AND run_id = ${Number(runId)}`).rows.map((r) => Number(r.id));
  let how = 'run_id';
  if (!ids.length) {
    const from = new Date(run.started_at).toISOString(); const to = new Date(new Date(run.finished_at || Date.now()).getTime() + 120000).toISOString();
    ids = (await sql`SELECT id FROM vo_prospects WHERE account = ${account} AND campaign_id = ${Number(run.campaign_id)} AND created_at >= ${from} AND created_at <= ${to}`).rows.map((r) => Number(r.id));
    how = 'time window';
  }
  if (ids.length) {
    await q('DELETE FROM vo_outreach_events WHERE account = $1 AND prospect_id = ANY($2)', [account, ids]);
    await q('DELETE FROM vo_prospects WHERE account = $1 AND id = ANY($2)', [account, ids]);
  }
  const after = await count();
  return { deleted: before - after, remaining: after, how: how };
}
async function setProducts(id, products, source, candidates) { await ensure(); await sql`UPDATE vo_prospects SET products = ${jsonb(products || [])}::jsonb, products_source = ${source || 'shopify'}, product_candidates = ${jsonb(candidates || [])}::jsonb, updated_at = now() WHERE id = ${Number(id)}`; }
async function markChecked(id) { await ensure(); await sql`UPDATE vo_prospects SET last_checked_at = now() WHERE id = ${Number(id)}`; }

// ---- email (4.8) ----
async function markEmail(id, what) { await ensure(); if (what === 'opened') await sql`UPDATE vo_prospects SET email_opened_at = COALESCE(email_opened_at, now()) WHERE id = ${Number(id)}`; else await sql`UPDATE vo_prospects SET email_sent_at = now() WHERE id = ${Number(id)}`; }
async function prospectById(id) { await ensure(); const { rows } = await sql`SELECT id, account, campaign_id, brand, email_opened_at FROM vo_prospects WHERE id = ${Number(id)}`; return rows[0] || null; }
// Follow-up tasks are events with a next_action_date; they are drafts until someone (or the auto setting) sends them.
async function scheduleFollowups(account, actor, p, channel) {
  const open = await sql`SELECT 1 FROM vo_outreach_events WHERE prospect_id = ${Number(p.id)} AND next_action_date IS NOT NULL AND done IS NOT TRUE LIMIT 1`;
  if (open.rows.length) return false; // already scheduled
  const d1 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); const d2 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await addEvent(account, actor, p, { channel: channel, step: 'Follow-up 1 due', next_action: 'Follow-up 1', next_action_date: d1, detail: 'Draft ready, due ' + d1 });
  await addEvent(account, actor, p, { channel: channel, step: 'Follow-up 2 due', next_action: 'Follow-up 2', next_action_date: d2, detail: 'Draft ready, due ' + d2 });
}
async function dueFollowups(account) {
  await ensure();
  const { rows } = await sql`SELECT e.id AS event_id, e.next_action, e.next_action_date, e.channel, p.id, p.brand, p.dm_name, p.dm_email, p.outreach_stage, p.video_url, p.campaign_id, p.linkedin_provider_id, p.linkedin_chat_id
    FROM vo_outreach_events e JOIN vo_prospects p ON p.id = e.prospect_id
    WHERE e.account = ${account} AND e.next_action_date IS NOT NULL AND e.done IS NOT TRUE AND e.next_action_date <= CURRENT_DATE AND p.outreach_stage NOT IN ('Replied','Call booked','Pilot','Client','Dead')
    ORDER BY e.next_action_date ASC LIMIT 100`;
  return rows;
}
async function completeFollowup(eventId) { await ensure(); await sql`UPDATE vo_outreach_events SET done = true WHERE id = ${Number(eventId)}`; }
async function cancelFollowups(prospectId) { await ensure(); await sql`UPDATE vo_outreach_events SET done = true WHERE prospect_id = ${Number(prospectId)} AND next_action_date IS NOT NULL AND done IS NOT TRUE`; }

// ---- LinkedIn automation (4.9) ----
async function linkedinQueue(account, maxPriority, limit) {
  await ensure();
  const { rows } = await sql`SELECT p.* FROM vo_prospects p JOIN vo_campaigns c ON c.id = p.campaign_id
    WHERE p.account = ${account} AND c.status = 'Active' AND COALESCE((c.automation->>'auto_connect')::boolean, false) = true
      AND p.priority_number IS NOT NULL AND p.priority_number <= LEAST(${Number(maxPriority) || 3}, COALESCE((c.automation->>'max_priority')::int, 2))
      AND p.linkedin_connection_state IS NULL AND p.outreach_stage = 'Not contacted' AND COALESCE(p.dm_linkedin,'') <> '' AND COALESCE(p.tier,'') <> 'Disqualified' AND COALESCE(p.source,'') <> 'demo'
    ORDER BY p.priority_number ASC, p.score_total DESC LIMIT ${Number(limit) || 1}`;
  return rows;
}
async function countLinkedinSince(account, steps, sinceIso) {
  await ensure();
  const { rows } = await q('SELECT COUNT(*)::int AS n FROM vo_outreach_events WHERE account = $1 AND channel = $2 AND step = ANY($3) AND at >= $4', [account, 'LinkedIn', steps, sinceIso]);
  return rows[0] ? rows[0].n : 0;
}
async function setLinkedinIds(id, ids) {
  await ensure(); const o = ids || {};
  await sql`UPDATE vo_prospects SET linkedin_provider_id = COALESCE(${o.provider_id || null}, linkedin_provider_id), linkedin_invitation_id = COALESCE(${o.invitation_id || null}, linkedin_invitation_id), linkedin_chat_id = COALESCE(${o.chat_id || null}, linkedin_chat_id), updated_at = now() WHERE id = ${Number(id)}`;
}
async function appliedProspects(account) { await ensure(); const { rows } = await sql`SELECT * FROM vo_prospects WHERE account = ${account} AND linkedin_connection_state IN ('Applied','Pending') ORDER BY linkedin_request_sent_at ASC LIMIT 500`; return rows; }
async function prospectByProviderId(account, pid) { if (!pid) return null; await ensure(); const { rows } = await sql`SELECT * FROM vo_prospects WHERE account = ${account} AND linkedin_provider_id = ${String(pid)} LIMIT 1`; return rows[0] || null; }
async function usedOtherChannel(prospectId) { await ensure(); const { rows } = await sql`SELECT 1 FROM vo_outreach_events WHERE prospect_id = ${Number(prospectId)} AND channel IN ('Email','Instagram') LIMIT 1`; return !!rows.length; }
async function recordReply(account, actor, id, text, atIso, cls) {
  await ensure();
  const p = await getProspect(account, id); if (!p) return null;
  const c = cls || {};
  await sql`UPDATE vo_prospects SET last_reply_text = ${String(text || '').slice(0, 4000)}, last_reply_at = ${atIso || new Date().toISOString()}, reply_sentiment = ${c.sentiment || null}, reply_summary = ${c.summary || null}, updated_at = now() WHERE id = ${Number(id)}`;
  await cancelFollowups(id);
  const label = (c.sentiment ? c.sentiment + ' reply' : 'Reply') + (c.summary ? ': ' + c.summary : '') + ' | ' + String(text || '').slice(0, 300);
  if (stageAllowed(p.outreach_stage, 'Replied')) return setStage(account, actor, id, 'Replied', { channel: 'LinkedIn', note: label });
  await addEvent(account, actor, p, { channel: 'LinkedIn', step: (c.sentiment || '') + ' reply', response: String(text || '').slice(0, 1000) });
  return getProspect(account, id);
}
// "Ready to send" (4.9 step 4): connected, not yet messaged.
async function readyToSend(account) { await ensure(); const { rows } = await sql`SELECT p.*, c.name AS campaign_name FROM vo_prospects p JOIN vo_campaigns c ON c.id = p.campaign_id WHERE p.account = ${account} AND p.linkedin_connection_state = 'Connected' AND p.outreach_stage IN ('Accepted','Request sent','Not contacted') ORDER BY p.linkedin_connected_at DESC NULLS LAST, p.priority_number ASC LIMIT 200`; return rows; }

// ---- results (5.5) ----
async function results(account, campaignId) {
  await ensure();
  const where = campaignId ? sql`SELECT priority, COALESCE(variant_used,'(none)') AS variant, COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE outreach_stage <> 'Not contacted')::int AS contacted,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Replied','Call booked','Pilot','Client'))::int AS replied,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Call booked','Pilot','Client'))::int AS calls,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Pilot','Client'))::int AS pilots,
      COUNT(*) FILTER (WHERE outcome = 'Won')::int AS won
      FROM vo_prospects WHERE account = ${account} AND campaign_id = ${Number(campaignId)} AND COALESCE(tier,'') <> 'Disqualified' GROUP BY 1, 2`
    : sql`SELECT priority, COALESCE(variant_used,'(none)') AS variant, COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE outreach_stage <> 'Not contacted')::int AS contacted,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Replied','Call booked','Pilot','Client'))::int AS replied,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Call booked','Pilot','Client'))::int AS calls,
      COUNT(*) FILTER (WHERE outreach_stage IN ('Pilot','Client'))::int AS pilots,
      COUNT(*) FILTER (WHERE outcome = 'Won')::int AS won
      FROM vo_prospects WHERE account = ${account} AND COALESCE(tier,'') <> 'Disqualified' GROUP BY 1, 2`;
  const { rows } = await where;
  return rows;
}

// ---- Example record for Ready to send (source = 'demo', never sent, removable) ----
async function createDemoReady(account, actor) {
  await ensure();
  const camps = await listCampaigns(account); const c = camps.find((x) => /live test/i.test(x.name)) || camps[0]; if (!c) throw new Error('Create a campaign first');
  await sql`DELETE FROM vo_prospects WHERE account = ${account} AND source = 'demo'`;
  const p = { brand: 'Demo Brand (example)', website: 'demo-brand.example', domain: 'demo-brand.example', country: 'US', category: 'Creatine gummies', source: 'demo', active_meta_ads: 48, video_ads: 30, new_ads_30d: 9, other_paid_channels: 1, creative_style: 'Video-led', skus: 12, employees: 18, growth_signals: 2, pays_for_creative: true, video_sourcing: 'UGC creators', creative_gap: 4, trigger_event: true, trigger_note: 'Launched 9 new ads this month', dm_name: 'Jamie Example', dm_title: 'Founder', dm_linkedin: 'linkedin.com/in/jamie-example', dm_active_90d: 'Y', gatekeeper: false, second_contact_has_email: false, observation: 'your Berry Blast creatine gummies video ads on Meta', suggested_product_url: 'https://demo-brand.example/products/berry-blast-creatine-gummies', suggested_product_name: 'Berry Blast Creatine Gummies', product_photo_check: 'Pass (7)', why_this_product: 'named most in their current ads, 7 real photos', notes: 'Example record so you can see how Ready to send works. Nothing here is real.', brand_instagram: '', dm_email: '', disqualified_reason: '' };
  const cfg = await scoringConfig(); const sc = score(p, cfg); const profile = await serviceProfile(c);
  let msgs = null; try { msgs = M.generate(p, profile, null, c.template_set); } catch (e) { msgs = null; }
  p.product_candidates = [{ url: p.suggested_product_url, name: 'Berry Blast Creatine Gummies', photos: 7, why: 'named most in their current ads' }, { url: 'https://demo-brand.example/products/sour-apple-creatine-gummies', name: 'Sour Apple Creatine Gummies', photos: 5, why: 'featured on their homepage' }, { url: 'https://demo-brand.example/products/creatine-monohydrate-powder', name: 'Creatine Monohydrate Powder', photos: 4, why: 'matches what the campaign is about' }];
  const ins = await insertProspect(account, c, null, p, sc, msgs);
  if (!ins.inserted) throw new Error('Could not create the example');
  await sql`UPDATE vo_prospects SET linkedin_connection_state = 'Connected', linkedin_request_sent_at = now() - interval '2 days', linkedin_connected_at = now() - interval '20 minutes', outreach_stage = 'Accepted' WHERE id = ${ins.id}`;
  const full = await getProspect(account, ins.id);
  await addEvent(account, actor, full, { channel: 'LinkedIn', step: 'Request sent', detail: 'Example: connection request sent (2 days ago)' });
  await addEvent(account, actor, full, { channel: 'LinkedIn', step: 'Accepted', detail: 'Example: they accepted 20 minutes ago, this is when the text arrives' });
  return full;
}
async function removeDemo(account) { await ensure(); const ids = (await sql`SELECT id FROM vo_prospects WHERE account = ${account} AND source = 'demo'`).rows.map((r) => Number(r.id)); if (ids.length) { await q('DELETE FROM vo_outreach_events WHERE account = $1 AND prospect_id = ANY($2)', [account, ids]); await q('DELETE FROM vo_prospects WHERE account = $1 AND id = ANY($2)', [account, ids]); } return ids.length; }

// ---- Ask AI: questions, answers, FAQ suggestions and ideas ----
async function saveQuestion(account, actor, q) {
  await ensure();
  const { rows } = await sql`INSERT INTO vo_questions (account, asked_by, question, answer, faq_worthy, faq_question, faq_answer, feature_request) VALUES (${account}, ${actor}, ${String(q.question || '').slice(0, 2000)}, ${String(q.answer || '').slice(0, 6000)}, ${!!q.faq_worthy}, ${q.faq_question || null}, ${q.faq_answer || null}, ${q.feature_request || null}) RETURNING *`;
  return rows[0];
}
async function listQuestions(account, limit) { await ensure(); const { rows } = await sql`SELECT * FROM vo_questions WHERE account = ${account} ORDER BY at DESC LIMIT ${Number(limit) || 30}`; return rows; }
async function markQuestion(account, id, fields) { await ensure(); const f = fields || {}; await sql`UPDATE vo_questions SET added_to_faq = COALESCE(${f.added_to_faq == null ? null : !!f.added_to_faq}, added_to_faq), helpful = COALESCE(${f.helpful == null ? null : !!f.helpful}, helpful) WHERE account = ${account} AND id = ${Number(id)}`; }
async function faqExtra() { return (await getConfig('faq_extra', [])) || []; }
async function addFaq(account, id) {
  await ensure();
  const { rows } = await sql`SELECT * FROM vo_questions WHERE account = ${account} AND id = ${Number(id)}`; const q = rows[0]; if (!q) throw new Error('Question not found');
  const list = await faqExtra();
  if (!list.some((x) => x.q === (q.faq_question || q.question))) list.unshift({ q: q.faq_question || q.question, a: q.faq_answer || q.answer, at: new Date().toISOString() });
  await setConfig('faq_extra', list.slice(0, 200));
  await markQuestion(account, id, { added_to_faq: true });
  return list;
}
async function removeFaq(index) { const list = await faqExtra(); list.splice(Number(index), 1); await setConfig('faq_extra', list); return list; }

// ---- daily report data ----
async function reportData(account) {
  await ensure();
  const since = new Date(Date.now() - 86400000).toISOString();
  const cnt = async (q) => { const { rows } = await q; return rows[0] ? Number(rows[0].n) : 0; };
  const day = {
    found: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_prospects WHERE account = ${account} AND created_at >= ${since} AND COALESCE(tier,'') <> 'Disqualified'`),
    requests: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_outreach_events WHERE account = ${account} AND at >= ${since} AND step = 'Request sent'`),
    accepted: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_outreach_events WHERE account = ${account} AND at >= ${since} AND step = 'Connection Connected'`),
    videos: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_outreach_events WHERE account = ${account} AND at >= ${since} AND step IN ('Msg 1','LinkedIn message','Email sent')`),
    replies: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_prospects WHERE account = ${account} AND last_reply_at >= ${since}`),
    positive: await cnt(sql`SELECT COUNT(*)::int AS n FROM vo_prospects WHERE account = ${account} AND last_reply_at >= ${since} AND reply_sentiment = 'Positive'`),
  };
  const waiting = (await sql`SELECT id, brand, dm_name, linkedin_connected_at FROM vo_prospects WHERE account = ${account} AND linkedin_connection_state = 'Connected' AND outreach_stage IN ('Accepted','Request sent','Not contacted') ORDER BY linkedin_connected_at DESC NULLS LAST LIMIT 50`).rows;
  const replied_open = (await sql`SELECT id, brand, reply_sentiment FROM vo_prospects WHERE account = ${account} AND outreach_stage = 'Replied' ORDER BY last_reply_at DESC NULLS LAST LIMIT 50`).rows;
  const events = (await sql`SELECT e.at, e.step, e.channel, e.detail, p.brand FROM vo_outreach_events e JOIN vo_prospects p ON p.id = e.prospect_id WHERE e.account = ${account} AND e.at >= ${since} AND e.step NOT IN ('note') ORDER BY e.at DESC LIMIT 200`).rows;
  const followups = await dueFollowups(account);
  const li = await linkedinSettings();
  const sod = new Date(); sod.setUTCHours(0, 0, 0, 0); const sow = new Date(sod); sow.setUTCDate(sow.getUTCDate() - ((sow.getUTCDay() + 6) % 7));
  return { day, waiting, replied_open, events, followups_due: followups.length, campaigns: await listCampaigns(account), linkedin: li, today_requests: await countLinkedinSince(account, ['Request sent'], sod.toISOString()), week_requests: await countLinkedinSince(account, ['Request sent'], sow.toISOString()) };
}

// ---- weight tuning (Phase 4): validate the config shape, then report the impact on the fixtures ----
function validateScoring(cfg) {
  const base = loadConfig(DEFAULT_CONFIG_PATH);
  const need = (obj, keys, where) => { for (const k of keys) if (obj == null || obj[k] === undefined) throw new Error('Scoring config is missing ' + where + '.' + k); };
  need(cfg, Object.keys(base), 'root');
  need(cfg.A_need, Object.keys(base.A_need), 'A_need'); need(cfg.B_afford, Object.keys(base.B_afford), 'B_afford'); need(cfg.C_fit, Object.keys(base.C_fit), 'C_fit'); need(cfg.D_access, Object.keys(base.D_access), 'D_access');
  for (const k of Object.keys(base.A_need)) if (!Array.isArray(cfg.A_need[k]) || cfg.A_need[k].some((b) => !Array.isArray(b) || b.length !== 2 || !Number.isFinite(Number(b[0])) || !Number.isFinite(Number(b[1])))) throw new Error('A_need.' + k + ' must be a list of [threshold, points] pairs');
  if (!Array.isArray(cfg.B_afford.employees)) throw new Error('B_afford.employees must be a list of [threshold, points] pairs');
  return true;
}
function scoringImpact(cfg) {
  const rows = S.fixtures(); let changed = 0; const moves = [];
  for (const r of rows) { const a = score(r.input, cfg); if (a.priority !== r.expected.priority) { changed++; if (moves.length < 15) moves.push(r.input.brand + ': ' + r.expected.priority + ' -> ' + a.priority); } }
  return { rows: rows.length, changed: changed, moves: moves };
}
async function saveScoring(cfg, actor) {
  validateScoring(cfg);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const out = Object.assign({}, cfg, { version: String(cfg.version || 'v1').replace(/-tuned.*$/, '') + '-tuned-' + stamp + '-' + Math.random().toString(36).slice(2, 5) });
  const okSave = await setConfig('scoring', out);
  return { ok: okSave, config: out, impact: scoringImpact(out) };
}
async function resetScoring() { const cfg = loadConfig(DEFAULT_CONFIG_PATH); await setConfig('scoring', cfg); return cfg; }
// Re-score every prospect of the account with the current config (after a weight change).
async function rescoreAll(account) {
  await ensure(); const cfg = await scoringConfig();
  const { rows } = await sql`SELECT * FROM vo_prospects WHERE account = ${account}`;
  let n = 0;
  for (const p of rows) {
    const s = score(p, cfg);
    await sql`UPDATE vo_prospects SET score_a = ${s.score_a}, score_b = ${s.score_b}, score_c = ${s.score_c}, score_d = ${s.score_d}, score_total = ${s.score_total}, tier = ${s.tier}, priority = ${s.priority}, priority_number = ${s.priority_number}, score_breakdown = ${jsonb(s.breakdown)}::jsonb, score_version = ${s.score_version}, updated_at = now() WHERE id = ${p.id}`;
    n++;
  }
  return n;
}

module.exports = { ENUM, STAGE_NEXT, stageAllowed, connAllowed, ensure, getConfig, setConfig, scoringConfig, serviceProfile, listCampaigns, getCampaign, saveCampaign, duplicateCampaign, createRun, finishRun, listRuns, importRows, listProspects, getProspect, updateProspect, setVideoUrl, addEvent, setStage, setConnectionState, setOutcome, resetOutreach, PROSPECT_INPUTS,
  globalExclusions, linkedinSettings, existingDomains, insertProspect, getRun, saveRunState, runStore, runningRuns, claimRun, stopRun, allAccounts, touchCampaignRun, scheduleDue, scheduledCampaigns, finishCampaign, listPresets, savePreset, deletePreset, prospectsDueRecheck, countRecountable, deleteProspect, deleteRunProspects, setProducts, markChecked, markEmail, prospectById, scheduleFollowups, dueFollowups, completeFollowup, cancelFollowups, linkedinQueue, countLinkedinSince, setLinkedinIds, appliedProspects, prospectByProviderId, usedOtherChannel, recordReply, readyToSend, reportData, saveQuestion, listQuestions, markQuestion, faqExtra, addFaq, removeFaq, createDemoReady, removeDemo, results, validateScoring, scoringImpact, saveScoring, resetScoring, rescoreAll };

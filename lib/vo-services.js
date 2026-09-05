// Video Outreach integrations (spec v4 sections 4.1 to 4.6 and 6). Apollo, Apify (Meta Ad Library),
// Shopify products.json, OpenAI (the house AI, gpt-4o-mini, JSON mode) and Hunter. Every provider
// has a DRY-RUN mode: when its key is absent it answers from the v12 fixtures, so the whole pipeline
// runs end to end (and is tested) without spending a penny. Keys live in Vercel env vars only.
//
// Verified 5 Sep 2026: Apollo company search is POST /api/v1/mixed_companies/search with
// q_organization_keyword_tags, organization_locations, organization_num_employees_ranges and
// currently_using_any_of_technology_uids (docs.apollo.io). Apify actor curious_coder/facebook-ads-library-scraper
// takes { urls: [{ url }], count, scrapeAdDetails } and costs about $0.75 per 1,000 ads (apify.com).
// The actor's OUTPUT field names are mapped tolerantly in normaliseAdRow; check one live run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchRetry } = require('./backoff');
const { parseFixtures, normaliseDomain, productNameFromUrl } = require('./vo-import');

const KEY = {
  apollo: () => process.env.APOLLO_API_KEY || '',
  hunter: () => process.env.HUNTER_API_KEY || '',
  apify: () => process.env.APIFY_TOKEN || '',
  openai: () => process.env.OPENAI_API_KEY || '',
  sendgrid: () => process.env.SENDGRID_API_KEY || '',
};
// Costs in pounds, overridable per env. Apify lists $0.75 per 1,000 ads; Apollo is 1 credit per
// company page, 1 per person match; the AI step is a fraction of a penny per brand on gpt-4o-mini.
const COST = {
  apifyPer1k: Number(process.env.VO_COST_APIFY_1K || 0.6),
  apolloCredit: Number(process.env.VO_COST_APOLLO_CREDIT || process.env.DD_COST_APOLLO || 0.03),
  aiPerBrand: Number(process.env.VO_COST_AI_BRAND || 0.01),
};
const DEFAULT_ACTOR = 'curious_coder/facebook-ads-library-scraper';
const AI_MODEL = 'gpt-4o-mini';

function providerStatus() {
  return {
    apollo: !!KEY.apollo(), hunter: !!KEY.hunter(), apify: !!KEY.apify(), openai: !!KEY.openai(), sendgrid: !!KEY.sendgrid(),
    ai_model: AI_MODEL, apify_actor: process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR,
  };
}
function dryRun(name) { return !KEY[name](); }

// ---- fixtures (dry-run data source) ----
let _fx = null;
function fixtures() {
  if (_fx) return _fx;
  const candidates = ['docs/video-outreach/video_outreach_fixtures_v12.csv'].map((p) => [path.join(process.cwd(), p), path.join(__dirname, '..', p)]).flat();
  for (const p of candidates) { try { _fx = parseFixtures(fs.readFileSync(p, 'utf8')); return _fx; } catch (e) { /* next */ } }
  _fx = []; return _fx;
}
function words(s) { return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2); }
function keywordMatch(text, keywords) {
  const t = words(text);
  return (keywords || []).some((k) => { const kw = words(k); return kw.length && kw.every((w) => t.includes(w)); });
}
// Fixture brands that match the campaign keywords (category or brand words); all of them when nothing matches.
function fixtureBrands(keywords, limit) {
  const all = fixtures().map((r) => r.input);
  const hit = all.filter((p) => keywordMatch(p.category + ' ' + p.brand, keywords));
  return (hit.length ? hit : all).slice(0, limit || 400);
}
function fixtureByDomain(domain) { const d = normaliseDomain(domain); return (fixtures().map((r) => r.input).find((p) => p.domain === d)) || null; }

// ---- Apify: Meta Ad Library (4.1a, 4.3) ----
function adLibraryUrl(keyword, country, videoOnly) {
  const u = new URL('https://www.facebook.com/ads/library/');
  u.searchParams.set('active_status', 'active'); u.searchParams.set('ad_type', 'all'); u.searchParams.set('country', country || 'US');
  u.searchParams.set('q', keyword); u.searchParams.set('search_type', 'keyword_unordered');
  if (videoOnly) u.searchParams.set('media_type', 'video');
  return u.toString();
}
// One ad row in our shape, whatever the actor called the fields.
function normaliseAdRow(r) {
  const s = r.snapshot || {};
  const videos = s.videos || r.videos || [];
  const images = s.images || r.images || [];
  const mediaType = String(r.mediaType || r.media_type || r.display_format || s.display_format || '');
  const start = r.startDate || r.start_date || r.startDateFormatted || r.ad_delivery_start_time || null;
  return {
    ad_id: String(r.adArchiveID || r.ad_archive_id || r.id || r.adId || ''),
    page_id: String(r.pageId || r.page_id || s.page_id || r.pageID || ''),
    page_name: String(r.pageName || r.page_name || s.page_name || ''),
    start_date: start ? (typeof start === 'number' ? new Date(start * (start < 1e12 ? 1000 : 1)).toISOString().slice(0, 10) : String(start).slice(0, 10)) : null,
    is_video: !!(videos.length || r.isVideo || r.is_video || /video/i.test(mediaType)),
    duration: Number(r.videoDuration || r.duration || (videos[0] && videos[0].duration) || 0) || null,
    copy: String((s.body && s.body.text) || r.adText || r.ad_text || r.body || r.text || r.caption || '').slice(0, 400),
    link_url: String(s.link_url || r.linkUrl || r.link_url || r.url || (s.cards && s.cards[0] && s.cards[0].link_url) || ''),
    thumbnail: String((videos[0] && (videos[0].video_preview_image_url || videos[0].preview)) || (images[0] && (images[0].original_image_url || images[0].url || images[0].src)) || r.thumbnail || r.imageUrl || ''),
    page_total_ads: r.page_total_ads || null, page_video_ads: r.page_video_ads || null, // dry-run hints only
    page_total_new_30d: r.page_total_new_30d || null,
  };
}
function daysAgo(n) { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); }
// Dry run: synthesise up to 10 ad rows per fixture brand that matches the keywords, carrying the real counts as hints.
function fixtureAdRows(keywords, country, videoOnly, limit) {
  const out = [];
  for (const p of fixtureBrands(keywords, 400)) {
    if (country && p.country && String(p.country).toUpperCase() !== String(country).toUpperCase()) continue;
    const n = Number(p.active_meta_ads) || 0; if (!n) continue;
    const v = Number(p.video_ads) || 0; const samples = Math.min(10, n); const vids = Math.round(samples * (v / n));
    if (videoOnly && !v) continue;
    for (let i = 0; i < samples; i++) {
      out.push({ adArchiveID: p.domain + '-' + i, pageId: 'fx-' + p.domain, pageName: p.brand, startDate: daysAgo(i < (Number(p.new_ads_30d) || 0) ? 3 + i : 45 + i * 9), isVideo: i < vids,
        adText: (i % 3 === 0 ? 'New: ' : '') + (p.suggested_product_name || p.category) + ' from ' + p.brand + '. ' + (p.pays_for_creative && i === 1 ? '#ad ' : '') + 'Shop now.',
        linkUrl: 'https://' + p.domain + '/products/' + (String(p.suggested_product_url || '').split('/products/')[1] || ''), thumbnail: '',
        page_total_ads: n, page_video_ads: v, page_total_new_30d: Number(p.new_ads_30d) || 0 });
      if (out.length >= (limit || 400)) return out;
    }
  }
  return out;
}
async function apifyMetaAds(opts) {
  const o = opts || {}; const limit = Math.max(10, Math.min(5000, Number(o.limit) || 400));
  if (dryRun('apify')) return { rows: fixtureAdRows(o.keywords, o.country, o.videoOnly, limit).map(normaliseAdRow), cost: 0, dry: true };
  const actor = (process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR).replace('/', '~');
  const urls = (o.keywords || []).map((k) => ({ url: adLibraryUrl(k, o.country, o.videoOnly) }));
  if (!urls.length) return { rows: [], cost: 0 };
  const timeoutSec = Math.max(30, Math.min(280, Number(o.timeoutSec) || 45));
  const r = await fetchRetry('https://api.apify.com/v2/acts/' + actor + '/run-sync-get-dataset-items?token=' + encodeURIComponent(KEY.apify()) + '&timeout=' + timeoutSec + '&format=json&clean=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: urls, count: limit, limitPerSource: Math.ceil(limit / urls.length), scrapeAdDetails: false, 'scrapePageAds.activeStatus': 'active', 'scrapePageAds.countryCode': o.country || 'US' }),
  }, { retries: 1, timeoutMs: (timeoutSec + 10) * 1000 });
  if (!r.ok) throw new Error('Apify returned HTTP ' + r.status + ' (check APIFY_TOKEN and the actor id in Settings)');
  const data = await r.json().catch(() => []);
  const rows = (Array.isArray(data) ? data : (data.items || [])).map(normaliseAdRow);
  return { rows: rows, cost: rows.length / 1000 * COST.apifyPer1k };
}
// Async Apify run for sourcing: start the actor, poll its status on later steps, then read the dataset.
// A pull of a few hundred ads can take minutes, longer than one Vercel function, so the run state
// carries the Apify run id and stepRun() keeps polling until the dataset is ready.
const debug = {}; // last raw samples from each provider, copied into the run state for verification
function apifyActor() { return (process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR).replace('/', '~'); }
async function apifyStartRun(opts) {
  const o = opts || {}; const limit = Math.max(10, Math.min(5000, Number(o.limit) || 400));
  const urls = (o.keywords || []).map((k) => ({ url: adLibraryUrl(k, o.country, o.videoOnly) }));
  if (!urls.length) throw new Error('No keywords to search');
  const r = await fetchRetry('https://api.apify.com/v2/acts/' + apifyActor() + '/runs?token=' + encodeURIComponent(KEY.apify()) + '&timeout=900', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: urls, count: limit, limitPerSource: Math.ceil(limit / urls.length), scrapeAdDetails: false, 'scrapePageAds.activeStatus': 'active', 'scrapePageAds.countryCode': o.country || 'US' }),
  }, { retries: 1, timeoutMs: 20000 });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.data || !d.data.id) throw new Error('Apify could not start the actor: HTTP ' + r.status + ' ' + String((d.error && d.error.message) || '').slice(0, 200));
  return { run_id: d.data.id, dataset_id: d.data.defaultDatasetId, status: d.data.status, started_at: new Date().toISOString() };
}
function pageAdsUrl(pageId, country) { const u = new URL('https://www.facebook.com/ads/library/'); u.searchParams.set('active_status', 'active'); u.searchParams.set('ad_type', 'all'); u.searchParams.set('country', country || 'ALL'); u.searchParams.set('view_all_page_id', String(pageId)); u.searchParams.set('search_type', 'page'); return u.toString(); }
// Second pass: the keyword search only returns a few ads per brand, so counts from it are too low.
// Pull each candidate PAGE's newest 30 active ads: 30 is enough to place every band (0, 1 to 9, 10 to 29, 30 plus).
async function apifyStartPageCount(pageIds, country, perPage) {
  const ids = (pageIds || []).filter(Boolean); if (!ids.length) return null;
  const per = Math.max(10, Math.min(60, Number(perPage) || 30));
  const r = await fetchRetry('https://api.apify.com/v2/acts/' + apifyActor() + '/runs?token=' + encodeURIComponent(KEY.apify()) + '&timeout=900', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: ids.map((id) => ({ url: pageAdsUrl(id, country) })), count: ids.length * per, limitPerSource: per, scrapeAdDetails: false, 'scrapePageAds.activeStatus': 'active', 'scrapePageAds.sortBy': 'date', 'scrapePageAds.countryCode': country || 'ALL' }),
  }, { retries: 1, timeoutMs: 20000 });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.data || !d.data.id) throw new Error('Apify could not start the page count: HTTP ' + r.status);
  return { run_id: d.data.id, dataset_id: d.data.defaultDatasetId, status: d.data.status, started_at: new Date().toISOString(), pages: ids.length, per: per };
}
// Merge the page-count rows back into the candidates: real active count (capped at the pull size), video share and new ads from the newest rows.
function applyPageCounts(candidates, rows, per) {
  const groups = groupAds(rows);
  const byPage = new Map(groups.map((g) => [String(g.page_id), g]));
  let updated = 0;
  for (const c of candidates) {
    const g = byPage.get(String(c.page_id)); if (!g) continue;
    c.active_meta_ads = g.active_meta_ads; c.video_ads = g.video_ads; c.new_ads_30d = g.new_ads_30d; c.creative_style = g.creative_style; c.pays_for_creative = c.pays_for_creative || g.pays_for_creative;
    c.ads_capped = g.active_meta_ads >= (per || 30); // true count is at least this
    const seen = new Set((c.ad_samples || []).map((a) => a.ad_id)); c.ad_samples = (c.ad_samples || []).concat(g.ad_samples.filter((a) => !seen.has(a.ad_id))).slice(0, 10);
    updated++;
  }
  return updated;
}
async function apifyRunStatus(runId) {
  const r = await fetchRetry('https://api.apify.com/v2/actor-runs/' + encodeURIComponent(runId) + '?token=' + encodeURIComponent(KEY.apify()), {}, { retries: 1, timeoutMs: 15000 });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.data) throw new Error('Apify run status HTTP ' + r.status);
  return { status: d.data.status, dataset_id: d.data.defaultDatasetId, finished_at: d.data.finishedAt || null };
}
async function apifyDatasetItems(datasetId, limit) {
  const r = await fetchRetry('https://api.apify.com/v2/datasets/' + encodeURIComponent(datasetId) + '/items?token=' + encodeURIComponent(KEY.apify()) + '&clean=true&format=json&limit=' + (Number(limit) || 5000), {}, { retries: 1, timeoutMs: 40000 });
  const data = await r.json().catch(() => []);
  const raw = Array.isArray(data) ? data : (data.items || []);
  if (raw.length) debug.apify_sample = JSON.stringify(raw[0]).slice(0, 3000);
  return { rows: raw.map(normaliseAdRow), cost: raw.length / 1000 * COST.apifyPer1k, raw_count: raw.length };
}
// 4.3 deterministic part: group ad rows by page. Returns one candidate per page with counts, style, samples.
function groupAds(rows, opts) {
  const o = opts || {}; const today = o.today ? new Date(o.today) : new Date();
  const byPage = new Map();
  for (const ad of rows || []) {
    const key = ad.page_id || ad.page_name; if (!key) continue;
    if (!byPage.has(key)) byPage.set(key, { page_id: ad.page_id, page_name: ad.page_name, rows: [] });
    byPage.get(key).rows.push(ad);
  }
  const out = [];
  for (const g of byPage.values()) {
    const hint = g.rows.find((r) => r.page_total_ads);
    const active = hint ? Number(hint.page_total_ads) : g.rows.length;
    const video = hint ? Number(hint.page_video_ads || 0) : g.rows.filter((r) => r.is_video).length;
    const new30 = hint && hint.page_total_new_30d != null ? Number(hint.page_total_new_30d) : g.rows.filter((r) => r.start_date && (today - new Date(r.start_date)) <= 30 * 86400000).length;
    const share = active ? video / active : 0;
    const creative_style = share > 0.6 ? 'Video-led' : (share >= 0.2 ? 'Mixed' : 'Static');
    const pays = g.rows.some((r) => /\bwith\b/i.test(r.page_name || '') || /#ad\b|#partner|\bpartner\b|\bugc\b/i.test(r.copy || ''));
    let domain = '';
    for (const r of g.rows) { const d = domainOf(r.link_url); if (d && !/facebook\.com|instagram\.com|fb\.me|amazon\./.test(d)) { domain = d; break; } }
    out.push({ page_id: g.page_id, page_name: g.page_name, brand: g.page_name, domain: domain, website: domain,
      active_meta_ads: active, video_ads: video, new_ads_30d: new30, creative_style: creative_style, pays_for_creative: pays,
      ad_samples: g.rows.slice(0, 10).map((r) => ({ ad_id: r.ad_id, start_date: r.start_date, is_video: r.is_video, duration: r.duration, page_name: r.page_name, copy: r.copy.slice(0, 200), thumbnail: r.thumbnail, link_url: r.link_url })) });
  }
  return out;
}
function domainOf(url) { try { if (!url) return ''; const u = new URL(/^https?:/i.test(url) ? url : 'https://' + url); return normaliseDomain(u.hostname); } catch (e) { return ''; } }

// ---- Apollo (4.1b, 4.4) ----
const COUNTRY_NAME = { US: 'United States', UK: 'United Kingdom', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', IE: 'Ireland' };
function apolloHeaders() { return { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': KEY.apollo() }; }
function bandRange(b) { const m = String(b).match(/(\d+)\s*-\s*(\d+)/); return m ? m[1] + ',' + m[2] : null; }
async function apolloCompanySearch(opts) {
  const o = opts || {}; const perPage = Math.min(100, Math.max(10, Number(o.perPage) || 100));
  if (dryRun('apollo')) {
    const list = fixtureBrands(o.keywords, perPage).filter((p) => !o.country || !p.country || String(p.country).toUpperCase() === String(o.country).toUpperCase());
    return { companies: list.map((p) => ({ brand: p.brand, domain: p.domain, website: p.website, employees: p.employees, country: p.country, apollo_org_id: null, linkedin_url: '' })), cost: 0, dry: true };
  }
  const body = {
    q_organization_keyword_tags: o.keywords || [],
    organization_locations: [COUNTRY_NAME[String(o.country || 'US').toUpperCase()] || o.country],
    organization_num_employees_ranges: (o.sizeBands || []).map(bandRange).filter(Boolean),
    currently_using_any_of_technology_uids: o.shopifyOnly ? ['shopify'] : undefined,
    page: o.page || 1, per_page: perPage,
  };
  const r = await fetchRetry('https://api.apollo.io/api/v1/mixed_companies/search', { method: 'POST', headers: apolloHeaders(), body: JSON.stringify(body) }, { retries: 2, timeoutMs: 15000 });
  if (!r.ok) throw new Error('Apollo company search HTTP ' + r.status);
  const d = await r.json().catch(() => ({}));
  const orgs = d.organizations || d.accounts || [];
  if (orgs[0]) debug.apollo_company_sample = JSON.stringify(orgs[0]).slice(0, 1500); else debug.apollo_company_sample = 'no organizations in response: keys ' + Object.keys(d).join(',');
  return { companies: orgs.map((x) => ({ brand: x.name || '', domain: normaliseDomain(x.primary_domain || x.website_url || ''), website: x.website_url || x.primary_domain || '', employees: x.estimated_num_employees || null, country: x.country || o.country, apollo_org_id: x.id || x.organization_id || null, linkedin_url: x.linkedin_url || '' })).filter((x) => x.domain), cost: COST.apolloCredit, pages: d.pagination ? d.pagination.total_pages : 1 };
}
// Organisation enrichment (headcount, LinkedIn, technologies). Endpoint per Apollo docs: GET /api/v1/organizations/enrich?domain=
async function apolloOrgEnrich(domain) {
  if (dryRun('apollo')) { const p = fixtureByDomain(domain); return p ? { employees: p.employees, shopify_plus: p.shopify_plus, linkedin_url: '', technologies: [], apollo_org_id: null, cost: 0, dry: true } : null; }
  const r = await fetchRetry('https://api.apollo.io/api/v1/organizations/enrich?domain=' + encodeURIComponent(domain), { headers: apolloHeaders() }, { retries: 2, timeoutMs: 12000 });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({})); const org = d.organization || {};
  if (!debug.apollo_enrich_sample) debug.apollo_enrich_sample = JSON.stringify({ status: r.status, keys: Object.keys(org).slice(0, 40), employees: org.estimated_num_employees }).slice(0, 800);
  const tech = (org.technology_names || org.current_technologies || []).map((t) => String(t && t.name ? t.name : t).toLowerCase());
  return { name: org.name || '', employees: org.estimated_num_employees || null, shopify_plus: tech.some((t) => /shopify plus/.test(t)) ? true : null, linkedin_url: org.linkedin_url || '', technologies: tech, apollo_org_id: org.id || null, industry: org.industry || '', cost: COST.apolloCredit };
}
const FOUNDER_TITLES = ['Founder', 'Co-Founder', 'CEO', 'Owner', 'Chief Executive Officer'];
const GROWTH_TITLES = ['Head of Growth', 'VP Growth', 'Growth Lead', 'Growth Marketing', 'Performance Marketing', 'Paid Social', 'Head of Marketing', 'VP Marketing', 'CMO', 'Marketing Director', 'Director of Marketing'];
// People at a domain with the given titles. Returns up to 5 in Apollo's relevance order.
async function apolloPeople(domain, titles) {
  if (dryRun('apollo')) {
    const p = fixtureByDomain(domain); if (!p || !p.dm_name) return { people: [], cost: 0, dry: true };
    return { people: [{ name: p.dm_name, title: p.dm_title || '', linkedin: p.dm_linkedin || '', email: '', email_status: '' }], cost: 0, dry: true };
  }
  const r = await fetchRetry('https://api.apollo.io/api/v1/mixed_people/search', { method: 'POST', headers: apolloHeaders(), body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: titles, include_similar_titles: true, page: 1, per_page: 5 }) }, { retries: 2, timeoutMs: 15000 });
  if (!r.ok) { let body = ''; try { body = (await r.text()).slice(0, 300); } catch (e) {} if (!debug.apollo_people_sample) debug.apollo_people_sample = JSON.stringify({ status: r.status, body: body }); return { people: [], cost: COST.apolloCredit, error: 'HTTP ' + r.status }; }
  const d = await r.json().catch(() => ({}));
  if (!debug.apollo_people_sample) debug.apollo_people_sample = JSON.stringify({ status: r.status, count: (d.people || d.contacts || []).length, first: (d.people || d.contacts || [])[0] }).slice(0, 1500);
  const people = (d.people || d.contacts || []).map((x) => ({ name: [x.first_name, x.last_name && !/\*/.test(x.last_name) ? x.last_name : ''].filter(Boolean).join(' ') || x.name || '', first_name: x.first_name || '', title: x.title || '', linkedin: x.linkedin_url || '', email: x.email && !/email_not_unlocked/.test(x.email) ? x.email : '', email_status: x.email_status || '', has_email: !!(x.has_email || x.email), apollo_id: x.id || null }));
  return { people: people, cost: COST.apolloCredit };
}
// Reveal one person's email (1 credit). Only called for prospects that pass the campaign's fetch_emails_for rule.
async function apolloEmail(person) {
  if (dryRun('apollo')) return { email: '', cost: 0, dry: true };
  const body = person.apollo_id ? { id: person.apollo_id } : { linkedin_url: person.linkedin, name: person.name };
  const r = await fetchRetry('https://api.apollo.io/api/v1/people/match', { method: 'POST', headers: apolloHeaders(), body: JSON.stringify(Object.assign({ reveal_personal_emails: false }, body)) }, { retries: 1, timeoutMs: 12000 });
  if (!r.ok) return { email: '', cost: COST.apolloCredit };
  const d = await r.json().catch(() => ({})); const p = d.person || {};
  if (!debug.apollo_match_sample) debug.apollo_match_sample = JSON.stringify({ status: r.status, name: p.name, has_linkedin: !!p.linkedin_url, email_status: p.email_status, keys: Object.keys(p).slice(0, 30) }).slice(0, 600);
  return { email: p.email && !/email_not_unlocked/.test(p.email) ? p.email : '', status: p.email_status || '', name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '), first_name: p.first_name || '', linkedin: p.linkedin_url || '', title: p.title || '', cost: COST.apolloCredit };
}
async function apolloJobPostings(orgId) {
  if (!orgId || dryRun('apollo')) return { marketing_roles: 0, cost: 0 };
  const r = await fetchRetry('https://api.apollo.io/api/v1/organizations/' + encodeURIComponent(orgId) + '/job_postings', { headers: apolloHeaders() }, { retries: 1, timeoutMs: 10000 });
  if (!r.ok) return { marketing_roles: 0, cost: 0 };
  const d = await r.json().catch(() => ({}));
  const jobs = d.organization_job_postings || d.job_postings || [];
  return { marketing_roles: jobs.filter((j) => /marketing|growth|paid|social|creative|brand/i.test(String(j.title || ''))).length, cost: 0 };
}
async function hunterVerify(email) {
  const unknown = { verified: false, status: 'unverified', score: null };
  if (!email || dryRun('hunter')) return unknown;
  try {
    const r = await fetchRetry('https://api.hunter.io/v2/email-verifier?email=' + encodeURIComponent(email) + '&api_key=' + encodeURIComponent(KEY.hunter()), {}, { retries: 2, timeoutMs: 10000 });
    if (!r.ok) return unknown;
    const d = await r.json().catch(() => ({})); const v = d.data || {};
    return { verified: ['valid', 'deliverable'].includes(String(v.status || v.result || '')), status: v.status || v.result || 'unverified', score: v.score == null ? null : Number(v.score) };
  } catch (e) { return unknown; }
}
// Decision-maker rule (4.4): founder if employees below the campaign threshold, else growth lead first with founder second.
function pickContacts(people, employees, roleRuleEmployees, acceptedTitles) {
  const founderRe = /founder|ceo|owner|chief executive/i;
  const growthList = (acceptedTitles && acceptedTitles.length ? acceptedTitles : GROWTH_TITLES);
  const growthRe = new RegExp(growthList.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const founders = people.filter((p) => founderRe.test(p.title || ''));
  const growth = people.filter((p) => growthRe.test(p.title || '') && !founderRe.test(p.title || ''));
  const small = employees == null || Number(employees) < Number(roleRuleEmployees || 20);
  const first = small ? (founders[0] || growth[0] || people[0] || null) : (growth[0] || founders[0] || people[0] || null);
  const second = (small ? growth[0] : founders[0]) || people.find((p) => p !== first) || null;
  return { dm: first, second: second === first ? null : second };
}

// ---- Shopify products (4.4, 4.6) ----
const INFOGRAPHIC = /facts|ingredient|benefit|certif|testimonial|review|chart|compar|badge|label|slide|how-?to|sfp|nfp|infograph|supplement-facts|nutrition/i;
function fixtureProducts(domain) {
  const p = fixtureByDomain(domain); if (!p || !p.suggested_product_url) return null;
  const m = String(p.product_photo_check || '').match(/(pass|weak pass|fail)\s*\((\d+)\)/i);
  const real = m ? Number(m[2]) : 4; const failed = m && /fail/i.test(m[1]);
  const handle = String(p.suggested_product_url).split('/products/')[1] || 'hero';
  const imgs = []; for (let i = 0; i < real; i++) imgs.push({ src: 'https://' + p.domain + '/cdn/' + handle + '-' + (i + 1) + '.jpg', alt: p.suggested_product_name + ' photo ' + (i + 1) });
  if (failed) for (let i = 0; i < 3; i++) imgs.push({ src: 'https://' + p.domain + '/cdn/' + handle + '-facts-' + i + '.jpg', alt: 'Supplement facts panel' });
  const products = [{ handle: handle, title: p.suggested_product_name || productNameFromUrl(p.suggested_product_url), price: null, tags: [], created_at: null, images: imgs, url: 'https://' + p.domain + '/products/' + handle }];
  const n = Number(p.skus) || 1;
  for (let i = 1; i < Math.min(n, 12); i++) products.push({ handle: handle + '-alt-' + i, title: (p.category || 'Product') + ' ' + (i + 1), price: null, tags: [], created_at: null, images: [{ src: 'https://' + p.domain + '/cdn/alt' + i + '.jpg', alt: 'Ingredients chart' }], url: 'https://' + p.domain + '/products/' + handle + '-alt-' + i });
  return { is_shopify: true, products: products, skus: n, dry: true };
}
async function shopifyProducts(domain, opts) {
  const o = opts || {};
  // dry run never touches the network: a tracker brand without a product URL simply has no feed
  if (o.dry || (dryRun('apify') && dryRun('apollo') && fixtureByDomain(domain))) { const f = fixtureProducts(domain); if (f) return f; const fx = fixtureByDomain(domain); return { is_shopify: false, products: [], skus: fx ? fx.skus : null, dry: true }; }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), o.timeoutMs || 5000);
  try {
    const r = await fetch('https://' + domain + '/products.json?limit=50', { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitePounce/1.0)', Accept: 'application/json' }, redirect: 'follow' });
    clearTimeout(t);
    if (!r.ok) return { is_shopify: false, products: [], skus: null, status: r.status };
    const d = await r.json().catch(() => null);
    if (!d || !Array.isArray(d.products)) return { is_shopify: false, products: [], skus: null };
    const products = d.products.map((p) => ({ handle: p.handle, title: p.title, price: p.variants && p.variants[0] ? Number(p.variants[0].price) : null, tags: Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',').map((x) => x.trim()).filter(Boolean), created_at: p.created_at || null, images: (p.images || []).map((i) => ({ src: i.src, alt: i.alt || '' })), url: 'https://' + domain + '/products/' + p.handle }));
    return { is_shopify: true, products: products, skus: products.length };
  } catch (e) { clearTimeout(t); return { is_shopify: false, products: [], skus: null, error: e.message }; }
}
// Is there a DTC store at all (4.2 hard filter)? products.json or a /cart page.
async function hasStore(domain, shop) {
  if (shop && shop.is_shopify) return true;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try { const r = await fetch('https://' + domain + '/cart', { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitePounce/1.0)' } }); clearTimeout(t); return r.status < 400; } catch (e) { clearTimeout(t); return false; }
}
function realPhotoCount(product) {
  return (product.images || []).filter((i) => { const name = String(i.src || '').split('/').pop().split('?')[0]; return !INFOGRAPHIC.test(String(i.alt || '')) && !INFOGRAPHIC.test(name); }).length;
}
function cleanScore(handle) { return (String(handle || '').match(/[^a-z0-9-]/g) || []).length; }
// 4.6 product selection. Returns { url, name, check, why, candidates_tried }.
const MERCH = /\b(tee|t-shirt|shirt|hoodie|hat|cap|sock|tote|mug|sticker|gift card|e-gift|apparel|shorts|leggings|set|jersey|sweat)\b/i;
function pickProduct(products, heroName, featuredHandles, opts) {
  const o = opts || {};
  const list = (products || []).filter((p) => p && p.handle);
  if (!list.length) return { url: null, name: null, check: 'Unverified', why: 'No product list yet', candidates_tried: 0 };
  const heroWords = words(heroName || '');
  const hintWords = Array.from(new Set((o.keywords || []).map(words).flat().filter((w) => !['for', 'the', 'and', 'with', 'best', 'buy'].includes(w))));
  const isHero = (p) => heroWords.length >= 1 && heroWords.every((w) => words(p.title).includes(w));
  const heroPartial = (p) => heroWords.length >= 1 && heroWords.some((w) => w.length > 3 && words(p.title).includes(w));
  const hintHits = (p) => hintWords.filter((w) => words(p.title + ' ' + (p.tags || []).join(' ')).includes(w)).length;
  const featIdx = (p) => { const i = (featuredHandles || []).indexOf(p.handle); return i < 0 ? 99 : i; };
  const isNew = (p) => /\bnew\b|launch|seasonal|limited|holiday|summer|winter/i.test(p.title + ' ' + (p.tags || []).join(' '));
  const merch = (p) => MERCH.test(p.title) ? 1 : 0;
  // rank: real products first, then the hero named in the ads, then anything matching the campaign keywords, then homepage featured, then new, reviews, clean URL
  const ranked = list.slice().sort((a, b) => (merch(a) - merch(b)) || (isHero(b) - isHero(a)) || (heroPartial(b) - heroPartial(a)) || (hintHits(b) - hintHits(a)) || (featIdx(a) - featIdx(b)) || (isNew(b) - isNew(a)) || ((b.reviews_count || 0) - (a.reviews_count || 0)) || (cleanScore(a.handle) - cleanScore(b.handle)));
  let weak = null; let tried = 0;
  for (const p of ranked) {
    tried++;
    const n = realPhotoCount(p);
    const reason = isHero(p) ? 'named most in the ads' : (heroPartial(p) ? 'closest to the product named in the ads' : (hintHits(p) ? 'matches the campaign keywords' : (featIdx(p) < 99 ? 'featured on the homepage' : (isNew(p) ? 'tagged as new or seasonal' : 'best remaining product'))));
    if (n >= 3) return { url: p.url, name: p.title, check: 'Pass (' + n + ')', why: reason + ', ' + n + ' real photos', candidates_tried: tried };
    if (n === 2 && !weak) weak = { url: p.url, name: p.title, check: 'Weak pass (2)', why: reason + ', only 2 clean photos', candidates_tried: tried };
    if (tried >= (opts && opts.maxTries || 8)) break;
  }
  if (weak) return weak;
  const top = ranked[0]; const n = realPhotoCount(top);
  return { url: top.url, name: top.title, check: 'FAIL (' + n + ')', why: 'no product has 3 real photos, best was ' + n, candidates_tried: tried };
}

// ---- OpenAI, JSON mode, temperature 0, cached per key (Appendix C) ----
const aiCache = new Map();
async function aiJson(prompt, cacheKey) {
  if (dryRun('openai')) return null;
  const k = cacheKey || crypto.createHash('sha1').update(prompt).digest('hex');
  if (aiCache.has(k)) return aiCache.get(k);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY.openai() }, signal: ctrl.signal,
        body: JSON.stringify({ model: AI_MODEL, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You output only valid JSON. Never use em dashes. British English.' }, { role: 'user', content: prompt }] }) });
      clearTimeout(t);
      const d = await r.json().catch(() => ({}));
      const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      const p = JSON.parse(txt || '{}');
      aiCache.set(k, p); return p;
    } catch (e) { clearTimeout(t); }
  }
  return null;
}
// C1 keyword suggester
async function suggestKeywords(industry, countries, language) {
  const ind = String(industry || '').trim(); if (!ind) return { keywords: [], translated: {} };
  const langs = (countries || []).map((c) => ({ DE: 'German', FR: 'French', ES: 'Spanish', IT: 'Italian', NL: 'Dutch' }[String(c).toUpperCase()])).filter(Boolean);
  const p = await aiJson('Industry: "' + ind + '". Countries: ' + (countries || ['US']).join(', ') + '. Outreach language: ' + (language || 'English') + '.\nReturn {"keywords": [10 to 20 lower-case product search terms a shopper would type for this industry, no brand names, each 1 to 4 words], "translated": {' + langs.map((l) => '"' + l + '": [the same terms in ' + l + ']').join(', ') + '}}', 'kw:' + ind + ':' + langs.join(','));
  if (p && Array.isArray(p.keywords) && p.keywords.length) return { keywords: p.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 20), translated: p.translated && typeof p.translated === 'object' ? p.translated : {} };
  // no key: a small deterministic list so the form still works
  const base = ind.toLowerCase();
  return { keywords: [base, base + ' online', 'best ' + base, base + ' for women', base + ' for men', base + ' bundle', 'buy ' + base, base + ' subscription', 'natural ' + base, base + ' gummies'].slice(0, 10), translated: {}, dry: true };
}
// C2 ad analysis. Falls back to a deterministic reading of the counts when the AI is off.
function heuristicAdAnalysis(cand) {
  const style = cand.creative_style || 'Static';
  const hero = cand.hero_product || (cand.ad_samples || []).map((a) => a.copy).join(' ').match(/New:\s*([^.]+)/i);
  const heroName = typeof hero === 'string' ? hero : (hero && hero[1] ? hero[1].trim() : '');
  return { creative_gap: style === 'Static' ? 8 : (style === 'Mixed' ? 4 : 0), video_sourcing: cand.pays_for_creative ? 'UGC creators' : 'Unknown', hero_product: heroName, observation: '', style_reason: 'from the video share: ' + style };
}
async function analyseAds(cand) {
  const samples = (cand.ad_samples || []).slice(0, 10);
  if (!samples.length) return heuristicAdAnalysis(cand);
  const p = await aiJson('Brand: ' + cand.brand + '. Creative style from the counts: ' + cand.creative_style + '.\nAd samples (JSON): ' + JSON.stringify(samples.map((a) => ({ copy: a.copy, is_video: a.is_video, start_date: a.start_date, page_name: a.page_name }))) +
    '\nReturn {"creative_gap": 0|4|8 (8 = stale, repetitive or mostly static while spending; 4 = some gap; 0 = polished in-house output), "video_sourcing": "UGC creators"|"AI tools"|"In-house"|"Unknown", "hero_product": the product named most in the ads, "observation": one line for a message, max 25 words, must name a real product or line from the ads, must not contain the words "Meta library", no em dashes, written as "your ... ads on Meta" so it reads after "Came across", "style_reason": short}', 'ads:' + cand.domain + ':' + samples.length);
  const h = heuristicAdAnalysis(cand);
  if (!p) return h;
  const out = { creative_gap: [0, 4, 8].includes(Number(p.creative_gap)) ? Number(p.creative_gap) : h.creative_gap,
    video_sourcing: ['UGC creators', 'AI tools', 'In-house', 'Unknown'].includes(p.video_sourcing) ? p.video_sourcing : h.video_sourcing,
    hero_product: String(p.hero_product || h.hero_product || '').slice(0, 120), observation: require('./vo-messages').cleanObservation(p.observation), style_reason: String(p.style_reason || '').slice(0, 200) };
  if (out.observation.split(/\s+/).length > 25 || /meta (ad )?library/i.test(out.observation) || /\u2014/.test(out.observation)) out.observation = '';
  return out;
}
// C3 homepage featured products
async function featuredProducts(domain, products) {
  if (dryRun('openai') || !products || !products.length) return [];
  let text = '';
  try { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000); const r = await fetch('https://' + domain + '/', { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitePounce/1.0)' } }); clearTimeout(t); text = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000); } catch (e) { return []; }
  const p = await aiJson('Homepage text: """' + text + '"""\nProduct handles and titles: ' + JSON.stringify(products.slice(0, 50).map((x) => ({ handle: x.handle, title: x.title }))) + '\nReturn {"featured": [handles of products shown in the homepage hero or first product row, in the order shown, max 6]}', 'feat:' + domain);
  return p && Array.isArray(p.featured) ? p.featured.map(String) : [];
}

// ---- cost estimate (2.2) ----
function estimateRun(campaign) {
  const c = campaign || {}; const status = providerStatus();
  const raw = Number(c.raw_cap) || 400; const target = Number(c.target_per_run) || 20;
  const kws = Array.isArray(c.keywords) ? c.keywords.length : 0; const countries = Array.isArray(c.countries) && c.countries.length ? c.countries.length : 1;
  const brands = Math.min(raw, Math.max(target * 4, 40));
  const apify = status.apify ? Math.min(5000, raw * 10) / 1000 * COST.apifyPer1k : 0; // ten ad rows per candidate brand
  const apolloCredits = status.apollo ? (kws * countries + brands * 2 + Math.round(brands * 0.4)) : 0; // search pages + org + people + emails for the top 40%
  const apollo = apolloCredits * COST.apolloCredit;
  const ai = status.openai ? brands * COST.aiPerBrand : 0;
  const total = Math.round((apify + apollo + ai) * 100) / 100;
  return { apify: Math.round(apify * 100) / 100, apollo: Math.round(apollo * 100) / 100, apollo_credits: apolloCredits, ai: Math.round(ai * 100) / 100, total: total, brands: brands, raw: raw,
    dry: { apify: !status.apify, apollo: !status.apollo, openai: !status.openai }, over_cap: total > (Number(c.cost_cap) || 10) };
}

module.exports = { debug, apifyStartRun, apifyStartPageCount, applyPageCounts, pageAdsUrl, apifyRunStatus, apifyDatasetItems, providerStatus, dryRun, COST, AI_MODEL, DEFAULT_ACTOR, fixtures, fixtureBrands, fixtureByDomain, keywordMatch, adLibraryUrl, normaliseAdRow, apifyMetaAds, groupAds, domainOf,
  apolloCompanySearch, apolloOrgEnrich, apolloPeople, apolloEmail, apolloJobPostings, hunterVerify, pickContacts, FOUNDER_TITLES, GROWTH_TITLES,
  shopifyProducts, hasStore, realPhotoCount, pickProduct, INFOGRAPHIC, aiJson, suggestKeywords, analyseAds, heuristicAdAnalysis, featuredProducts, estimateRun };

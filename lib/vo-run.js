// Video Outreach run orchestrator (spec v4 sections 4.1 to 4.7, Appendix B stop rules). One run =
// source candidates, then process them one brand at a time: hard filter, ad analysis, store products,
// enrichment, score, emails for the ones worth it, product pick, messages, insert. Vercel functions
// have a time limit, so a run is RESUMABLE: stepRun() works until its time budget is spent, saves the
// cursor in vo_runs.state, and the UI (or the cron worker) calls it again until it reports done.
// Everything touching the database goes through a `store` object so the whole pipeline is unit-tested
// with an in-memory store and the dry-run providers (no keys, no cost).
const S = require('./vo-services');
const { score } = require('./vo-score');
const M = require('./vo-messages');
const { normaliseDomain, productNameFromUrl } = require('./vo-import');

// Spec 4.2 seed list. Admin-editable in Settings (vo_config 'exclusions'); this is only the default.
const DEFAULT_EXCLUSIONS = ['Unilever', 'Nestle', 'Nestlé', 'P&G', 'Procter & Gamble', 'Church & Dwight', 'Bayer', "Nature's Bounty", 'Nature\'s Bounty', 'Nestle Health Science', 'Garden of Life', 'Solgar', 'Puritan\'s Pride', 'Osteo Bi-Flex', 'Sundown', 'Ester-C'];

function lc(s) { return String(s || '').trim().toLowerCase(); }
function onExclusionList(cand, lists) {
  const name = lc(cand.brand); const dom = lc(cand.domain);
  for (const x of lists.names || []) { const n = lc(x); if (n && (name === n || name.includes(n) || dom.includes(n.replace(/[^a-z0-9]/g, '')))) return x; }
  for (const d of lists.domains || []) { const n = normaliseDomain(d); if (n && dom === n) return d; }
  return null;
}
function countryOk(cand, countries) {
  if (!cand.country || !countries || !countries.length) return true;
  return countries.map((c) => lc(c)).includes(lc(cand.country)) || (lc(cand.country) === 'united states' && countries.map(lc).includes('us'));
}

// ---- 4.1 source ----
async function sourceCandidates(campaign, opts) {
  const o = opts || {}; const c = campaign;
  const keywords = (Array.isArray(c.keywords) ? c.keywords : []).map(String).filter(Boolean);
  const translated = c.keywords_translated && typeof c.keywords_translated === 'object' ? Object.values(c.keywords_translated).flat().map(String) : [];
  const seeds = (Array.isArray(c.seed_brands) ? c.seed_brands : []).map((d) => normaliseDomain(d)).filter(Boolean);
  const allKw = keywords.concat(translated, seeds.map((d) => d.split('.')[0]));
  const countries = Array.isArray(c.countries) && c.countries.length ? c.countries : ['US'];
  const rawCap = Math.max(10, Number(c.raw_cap) || 400);
  const byDomain = new Map(); let cost = 0; const errors = []; const dry = { apify: S.dryRun('apify'), apollo: S.dryRun('apollo') };
  if (!allKw.length) return { candidates: [], cost: 0, errors: ['No search keywords on the campaign'], dry: dry };
  for (const country of countries) {
    // a) Meta Ad Library via Apify, keyword search is the default (lesson from the manual runs)
    try {
      // the raw cap counts BRANDS; an ad-library pull returns ADS (about 10 per page in keyword search), so ask for ten times as many rows
      const ads = await S.apifyMetaAds({ keywords: allKw, country: country, videoOnly: !!c.video_only, limit: Math.min(5000, rawCap * 10), timeoutSec: o.apifyTimeoutSec });
      cost += ads.cost || 0;
      for (const g of S.groupAds(ads.rows, { today: o.today })) {
        const key = g.domain || ('page:' + lc(g.page_name));
        const prev = byDomain.get(key) || {};
        byDomain.set(key, Object.assign(prev, g, { country: country, source: 'meta_ads' + (prev.source && prev.source !== 'meta_ads' ? '+apollo' : '') }));
      }
    } catch (e) { errors.push('Apify (' + country + '): ' + e.message); }
    // b) Apollo company search, merged on domain. Kept without Meta ads only when Meta-only is off.
    try {
      const r = await S.apolloCompanySearch({ keywords: keywords.length ? keywords : allKw, country: country, sizeBands: c.size_bands, shopifyOnly: c.store_platform !== 'Any', perPage: Math.min(100, rawCap) });
      cost += r.cost || 0;
      for (const co of r.companies) {
        if (!co.domain) continue;
        const prev = byDomain.get(co.domain);
        if (prev) { Object.assign(prev, { employees: prev.employees || co.employees, apollo_org_id: co.apollo_org_id, brand: prev.brand || co.brand, source: 'meta_ads+apollo' }); continue; }
        // an Apollo brand might be advertising under a page name we could not link to a domain
        const pageKey = 'page:' + lc(co.brand);
        if (byDomain.has(pageKey)) { const g = byDomain.get(pageKey); byDomain.delete(pageKey); byDomain.set(co.domain, Object.assign(g, { domain: co.domain, website: co.website || co.domain, employees: co.employees, apollo_org_id: co.apollo_org_id, source: 'meta_ads+apollo' })); continue; }
        if (c.meta_only) continue;
        byDomain.set(co.domain, Object.assign({}, co, { active_meta_ads: null, video_ads: null, new_ads_30d: null, creative_style: null, ad_samples: [], source: 'apollo' }));
      }
    } catch (e) { errors.push('Apollo (' + country + '): ' + e.message); }
  }
  // exclusions and dedupe (4.2 list part, 2.1 exclusions, 2.2 "a brand belongs to one campaign")
  const lists = { names: DEFAULT_EXCLUSIONS.concat(o.globalExclusions || [], Array.isArray(c.exclusions) ? c.exclusions : []), domains: Array.isArray(c.exclude_domains) ? c.exclude_domains : [] };
  const existing = o.existingDomains || new Set();
  const out = []; let duplicates = 0;
  for (const cand of byDomain.values()) {
    if (!cand.domain) { cand.domain = ''; }
    if (cand.domain && existing.has(cand.domain) && c.exclude_in_any_campaign !== false) { duplicates++; continue; }
    cand.excluded_by = onExclusionList(cand, lists);
    out.push(cand);
    if (out.length >= rawCap) break;
  }
  return { candidates: out, cost: cost, errors: errors, dry: dry, duplicates: duplicates };
}

// ---- 4.2 to 4.7 per brand ----
function growthFromSignals(cand, jobs) {
  let g = 0;
  if (jobs && jobs.marketing_roles > 0) g++;
  if ((Number(cand.new_ads_30d) || 0) >= 6) g++;
  if ((Number(cand.active_meta_ads) || 0) >= 30) g++;
  return Math.min(3, g);
}
async function processCandidate(cand, campaign, ctx) {
  const c = campaign; const cfg = ctx.scoringConfig; const profile = ctx.profile;
  const p = { brand: cand.brand || cand.page_name || cand.domain, website: cand.website || cand.domain, domain: cand.domain, country: cand.country || (c.countries && c.countries[0]) || 'US',
    category: c.industry || (Array.isArray(c.keywords) && c.keywords[0]) || '', source: cand.source || 'sourcing',
    active_meta_ads: cand.active_meta_ads, video_ads: cand.video_ads, new_ads_30d: cand.new_ads_30d, creative_style: cand.creative_style || null, pays_for_creative: !!cand.pays_for_creative, ad_samples: cand.ad_samples || [],
    other_paid_channels: 0, skus: null, employees: cand.employees || null, monthly_visits: null, amazon_reviews_hero: null, shopify_plus: null, growth_signals: 0, video_sourcing: 'Unknown', creative_gap: 0, trigger_event: false, trigger_note: '',
    dm_name: '', dm_title: '', dm_linkedin: '', dm_active_90d: 'Not found', dm_email: '', second_contact_name: '', second_contact_email: '', second_contact_has_email: false, gatekeeper: false,
    disqualified_reason: '', brand_instagram: '', apollo_org_id: cand.apollo_org_id || null, products: null, products_source: null, observation: '', ad_analysis: null };
  let cost = 0;
  const disqualify = (why) => { p.disqualified_reason = why; };
  // hard filters that need no calls
  if (!countryOk(cand, c.countries)) disqualify('Not in target country (' + cand.country + ')');
  else if (cand.excluded_by) disqualify('On exclusion list (' + cand.excluded_by + ')');
  else if (p.employees != null && Number(p.employees) > 200) disqualify('Too large (' + p.employees + ' employees)');
  else if (c.meta_only !== false && !(Number(p.active_meta_ads) > 0)) disqualify('No active Meta ads');
  if (!p.domain) { if (!p.disqualified_reason) disqualify('No DTC store detected (no domain in the ads)'); }
  const dry = S.dryRun('apify') && S.dryRun('apollo');
  // dry run: the fields a human researched in the tracker (activity, gatekeeper, trigger) come from the fixtures
  const fx = dry && p.domain ? S.fixtureByDomain(p.domain) : null;
  if (!p.disqualified_reason) {
    // 4.3 ad analysis
    if ((p.ad_samples || []).length) {
      const a = await S.analyseAds(Object.assign({ domain: p.domain }, cand)); cost += S.dryRun('openai') ? 0 : S.COST.aiPerBrand;
      p.creative_gap = a.creative_gap; p.video_sourcing = a.video_sourcing; p.observation = a.observation || ''; p.ad_analysis = { hero_product: a.hero_product, style_reason: a.style_reason }; p.hero_product = a.hero_product;
    }
    // 4.4 store products + DTC check
    const shop = await S.shopifyProducts(p.domain, { dry: !!fx });
    if (shop.is_shopify) { p.products = shop.products; p.products_source = 'shopify'; p.skus = shop.skus; }
    else { p.products_source = 'unknown'; p.skus = shop.skus; }
    if (c.store_platform !== 'Any' && !shop.is_shopify && !fx) disqualify('No DTC store detected (not a Shopify products feed)');
    else if (!shop.is_shopify && !fx && !(await S.hasStore(p.domain, shop))) disqualify('No DTC store detected');
  }
  if (!p.disqualified_reason) {
    // 4.4 enrichment
    const org = await S.apolloOrgEnrich(p.domain); if (org) { cost += org.cost || 0; p.employees = p.employees || org.employees || null; if (org.shopify_plus != null) p.shopify_plus = org.shopify_plus; p.apollo_org_id = p.apollo_org_id || org.apollo_org_id || null; }
    if (p.employees != null && Number(p.employees) > 200) disqualify('Too large (' + p.employees + ' employees)');
  }
  if (!p.disqualified_reason) {
    const jobs = await S.apolloJobPostings(p.apollo_org_id); p.growth_signals = growthFromSignals(p, jobs);
    const titles = S.FOUNDER_TITLES.concat(Array.isArray(c.accepted_titles) && c.accepted_titles.length ? c.accepted_titles : S.GROWTH_TITLES);
    const pe = await S.apolloPeople(p.domain, titles); cost += pe.cost || 0;
    const picked = S.pickContacts(pe.people || [], p.employees, c.role_rule_employees, c.accepted_titles);
    if (picked.dm) { p.dm_name = picked.dm.name; p.dm_title = picked.dm.title; p.dm_linkedin = picked.dm.linkedin; p.dm_email = picked.dm.email || ''; p._dm = picked.dm; }
    if (picked.second) { p.second_contact_name = picked.second.name; p.second_contact_email = picked.second.email || ''; p.second_contact_has_email = !!picked.second.email; p._second = picked.second; }
    // Spec 4.2 would disqualify here, but the tracker (the source of truth) keeps brands with no named
    // contact as Later / Unlikely and scores dm_active_90d 'Not found' as 0. Keep the brand, flag it.
    if (!picked.dm) { p.dm_active_90d = 'Not found'; p.notes = 'No decision maker found by enrichment, find one by hand'; }
  }
  if (fx) { // researched fields from the tracker, so the dry run reproduces the tracker's scores (spec section 8)
    for (const k of ['other_paid_channels', 'growth_signals', 'creative_gap', 'video_sourcing', 'trigger_event', 'dm_active_90d', 'second_contact_has_email', 'gatekeeper', 'monthly_visits', 'amazon_reviews_hero', 'shopify_plus', 'pays_for_creative', 'skus', 'employees']) if (fx[k] !== undefined && fx[k] !== null && fx[k] !== '') p[k] = fx[k];
    if (!p.disqualified_reason && fx.disqualified_reason) p.disqualified_reason = fx.disqualified_reason;
    if (fx.category) p.category = fx.category;
  }
  // 4.5 score
  const s = score(p, cfg);
  const qualified = !p.disqualified_reason && s.score_total != null && s.score_total >= (Number(c.min_score) || 55);
  // 4.4 emails only for the ones worth the credits
  const wantEmail = !p.disqualified_reason && (c.fetch_emails_for === 'All' || (s.priority_number != null && s.priority_number <= 3));
  if (wantEmail && p._dm && !p.dm_email) { const e = await S.apolloEmail(p._dm); cost += e.cost || 0; if (e.email) { const v = await S.hunterVerify(e.email); p.dm_email = v.status === 'invalid' || v.status === 'undeliverable' ? '' : e.email; } }
  if (wantEmail && p._second && !p.second_contact_email) { const e = await S.apolloEmail(p._second); cost += e.cost || 0; if (e.email) { p.second_contact_email = e.email; p.second_contact_has_email = true; } }
  delete p._dm; delete p._second;
  // 4.6 product pick
  if (p.products && p.products.length) {
    const featured = await S.featuredProducts(p.domain, p.products);
    const pick = S.pickProduct(p.products, p.hero_product || '', featured);
    p.suggested_product_url = pick.url; p.suggested_product_name = pick.name; p.product_photo_check = pick.check; p.why_this_product = pick.why;
  } else { p.suggested_product_url = null; p.suggested_product_name = null; p.product_photo_check = 'Unverified'; p.why_this_product = p.products_source === 'unknown' ? 'No Shopify products feed' : null; }
  delete p.hero_product;
  // 4.7 messages
  let msgs = null; try { msgs = M.generate(p, profile, null, c.template_set); } catch (e) { msgs = null; }
  const s2 = (fx || wantEmail) ? score(p, cfg) : s; // re-score if enrichment changed inputs (second email etc.)
  return { prospect: p, score: s2, messages: msgs, qualified: qualified, cost: cost };
}

// ---- run driver ----
function newState() { return { sourced: false, candidates: [], cursor: 0, counts: { raw: 0, processed: 0, qualified: 0, parked: 0, disqualified: 0, duplicates: 0, failed: 0, excluded: 0 }, cost: 0, errors: [], stop: null }; }
function stopReason(state, campaign) {
  const c = campaign; const k = state.counts;
  if (k.qualified >= (Number(c.target_per_run) || 20)) return { status: 'Done', why: 'target reached (' + k.qualified + ' new qualified prospects)' };
  if (k.processed >= (Number(c.raw_cap) || 400)) return { status: 'Stopped (cap)', why: 'raw candidate cap reached (' + k.processed + ')' };
  if (state.cost >= (Number(c.cost_cap) || 10)) return { status: 'Stopped (cap)', why: 'cost cap reached (£' + state.cost.toFixed(2) + ')' };
  if (state.cursor >= state.candidates.length) return { status: 'Done', why: 'all ' + state.candidates.length + ' candidates processed' };
  return null;
}
// store: { getRun, saveRun(run, state, status), existingDomains(), globalExclusions(), scoringConfig(), profile(campaign), insertProspect(campaign, runId, prospect, score, messages) -> {inserted, id} }
async function stepRun(store, campaign, run, opts) {
  const o = opts || {}; const budgetMs = Number(o.budgetMs) || 40000; const started = Date.now();
  const state = run.state && run.state.candidates ? run.state : newState();
  if (!state.sourced) {
    const src = await sourceCandidates(campaign, { existingDomains: await store.existingDomains(), globalExclusions: await store.globalExclusions(), today: o.today, apifyTimeoutSec: o.apifyTimeoutSec });
    state.candidates = src.candidates; state.sourced = true; state.cost += src.cost; state.errors = state.errors.concat(src.errors); state.counts.raw = src.candidates.length; state.counts.duplicates = src.duplicates || 0; state.dry = src.dry;
    await store.saveRun(run, state, 'Running');
    if (!state.candidates.length) { const why = src.errors.length ? src.errors[0] : 'no candidates found for these keywords'; state.stop = why; await store.saveRun(run, state, src.errors.length && !src.candidates.length ? 'Failed' : 'Done'); return { done: true, status: src.errors.length ? 'Failed' : 'Done', state: state }; }
  }
  const ctx = { scoringConfig: await store.scoringConfig(), profile: await store.profile(campaign) };
  let stop = stopReason(state, campaign);
  while (!stop) {
    if (Date.now() - started > budgetMs) { await store.saveRun(run, state, 'Running'); return { done: false, status: 'Running', state: state }; }
    const cand = state.candidates[state.cursor];
    try {
      const r = await processCandidate(cand, campaign, ctx);
      state.cost += r.cost;
      const ins = await store.insertProspect(campaign, run.id, r.prospect, r.score, r.messages);
      if (!ins.inserted) state.counts.duplicates++;
      else if (r.prospect.disqualified_reason) state.counts.disqualified++;
      else if (r.qualified) state.counts.qualified++;
      else state.counts.parked++;
    } catch (e) { state.counts.failed++; state.errors.push((cand.brand || cand.domain) + ': ' + (e.message || 'failed')); }
    state.counts.processed++; state.cursor++;
    if (state.cursor % 5 === 0) await store.saveRun(run, state, 'Running');
    stop = stopReason(state, campaign);
  }
  state.stop = stop.why;
  await store.saveRun(run, state, stop.status);
  return { done: true, status: stop.status, state: state };
}

module.exports = { DEFAULT_EXCLUSIONS, sourceCandidates, processCandidate, stepRun, stopReason, newState, onExclusionList, growthFromSignals };

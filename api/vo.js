// Video Outreach API (spec v4). One endpoint, action switch, same style as api/sms-campaign.js.
// Admin-only: the owner, the VIDEO_OUTREACH_EMAILS allow-list and (Phase 4) subscribers on the plans
// in VIDEO_OUTREACH_PLANS; everyone else gets 404 so the module's existence is not revealed.
// Rows are scoped to the account. Sourcing runs are resumable: runNow starts one and works for up
// to 40 seconds, then the UI calls runStep until it reports done (the cron worker also picks them up).
const fs = require('fs');
const path = require('path');
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach, videoOutreachPlans } = require('../lib/access');
const { accountEmailOf, emailOf } = require('../lib/tenant');
const db = require('../lib/vo-db');
const S = require('../lib/vo-services');
const L = require('../lib/vo-linkedin');
const J = require('../lib/vo-jobs');
const { parseFixtures } = require('../lib/vo-import');
const M = require('../lib/vo-messages');

const FIXTURES = ['docs/video-outreach/video_outreach_fixtures_v12.csv'].map((p) => [path.join(process.cwd(), p), path.join(__dirname, '..', p)]).flat();
function readFixtures() { for (const p of FIXTURES) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { /* try next */ } } return ''; }
function providers() { const s = S.providerStatus(); const P = L.provider(); return Object.assign(s, { linkedin: L.providerName() || 'off', linkedin_configured: !!(P && P.configured()), plan_gate: videoOutreachPlans() }); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!canVideoOutreach(acct.email, acct)) { res.status(404).json({ error: 'Not found.' }); return; }
  const owner = accountEmailOf(req) || acct.email;
  const actor = emailOf(req) || acct.email;
  const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || (req.query && req.query.action) || 'campaigns');
  const id = Number(body.id || (req.query && req.query.id) || 0);

  try {
    // ---- campaigns ----
    if (action === 'campaigns') { res.status(200).json({ campaigns: await db.listCampaigns(owner), enums: db.ENUM, profile: await db.serviceProfile(null), placeholder: M.URL_PLACEHOLDER, providers: providers(), linkedin: await db.linkedinSettings() }); return; }
    if (action === 'campaign') {
      const c = await db.getCampaign(owner, id); if (!c) { res.status(404).json({ error: 'Campaign not found.' }); return; }
      res.status(200).json({ campaign: c, runs: await db.listRuns(owner, id), profile: await db.serviceProfile(c), estimate: S.estimateRun(c), providers: providers(), presets: await db.listPresets(owner), templates: M.DEFAULT_TEMPLATES, running: (await db.runningRuns(owner)).filter((r) => r.campaign_id === c.id) }); return;
    }
    if (action === 'saveCampaign') {
      const data = body.campaign || {};
      const c = await db.saveCampaign(owner, actor, data);
      // 2.2: saving a One-off campaign as Active starts a run straight away
      let run = null;
      if (c && body.startRun && c.schedule === 'One-off' && c.status === 'Active') { run = await J.startRun(owner, actor, c, 'sourcing'); }
      res.status(200).json({ ok: true, campaign: c, run: run, estimate: c ? S.estimateRun(c) : null }); return;
    }
    if (action === 'duplicateCampaign') { const c = await db.duplicateCampaign(owner, actor, id); res.status(200).json({ ok: !!c, campaign: c }); return; }
    if (action === 'setCampaignStatus') { const c = await db.saveCampaign(owner, actor, { id: id, status: String(body.status || '') }); res.status(200).json({ ok: !!c, campaign: c }); return; }
    if (action === 'estimate') { res.status(200).json({ estimate: S.estimateRun(body.campaign || (await db.getCampaign(owner, id)) || {}), providers: providers() }); return; }
    if (action === 'suggestKeywords') { const r = await S.suggestKeywords(body.industry, body.countries || ['US'], body.language || 'English'); res.status(200).json(r); return; }
    if (action === 'presets') { res.status(200).json({ presets: await db.listPresets(owner) }); return; }
    if (action === 'savePreset') { const pid = await db.savePreset(owner, body.name, body.keywords || [], body.translations || {}); res.status(200).json({ ok: true, id: pid, presets: await db.listPresets(owner) }); return; }
    if (action === 'deletePreset') { await db.deletePreset(owner, id); res.status(200).json({ ok: true, presets: await db.listPresets(owner) }); return; }

    // ---- runs (Phase 2/3 sourcing, resumable) ----
    if (action === 'runNow') {
      const c = await db.getCampaign(owner, id); if (!c) { res.status(404).json({ error: 'Campaign not found.' }); return; }
      if (!(Array.isArray(c.keywords) && c.keywords.length)) { res.status(400).json({ error: 'Add at least one search keyword first (the keywords drive the sourcing, not the industry label).' }); return; }
      const already = (await db.runningRuns(owner)).find((r) => r.campaign_id === c.id);
      if (already) { res.status(200).json({ ok: true, run: already, resumed: true }); return; }
      const est = S.estimateRun(c);
      if (est.over_cap && !body.force) { res.status(400).json({ error: 'The estimate (£' + est.total + ') is over this campaign\'s cost cap (£' + c.cost_cap + '). Raise the cap or lower the raw candidate cap.', estimate: est }); return; }
      if (c.status !== 'Active') await db.saveCampaign(owner, actor, { id: c.id, status: 'Active' });
      const run = await J.startRun(owner, actor, c, body.kind || 'sourcing');
      const r = await J.stepRun(owner, actor, run, 35000);
      res.status(200).json({ ok: true, run: await db.getRun(owner, run.id), done: r.done, status: r.status, waiting: r.waiting || null }); return;
    }
    if (action === 'runStep') {
      const run = await db.getRun(owner, id); if (!run) { res.status(404).json({ error: 'Run not found.' }); return; }
      if (!['Running', 'Queued'].includes(run.status)) { res.status(200).json({ ok: true, run: run, done: true, status: run.status }); return; }
      const r = await J.stepRun(owner, actor, run, 35000);
      res.status(200).json({ ok: true, run: await db.getRun(owner, run.id), done: r.done, status: r.status, waiting: r.waiting || null }); return;
    }
    if (action === 'runStatus') { const run = await db.getRun(owner, id); res.status(200).json({ run: run, done: !run || !['Running', 'Queued'].includes(run.status) }); return; }
    if (action === 'stopRun') { await db.stopRun(owner, id, 'Stopped by ' + actor); res.status(200).json({ ok: true, run: await db.getRun(owner, id) }); return; }
    if (action === 'workerTick') { res.status(200).json({ ok: true, tick: await J.tick(owner, actor, { base: base, runBudgetMs: 30000 }) }); return; }
    if (action === 'recheckNow') { res.status(200).json({ ok: true, rechecked: await J.recheck(owner, actor, Number(body.limit) || 5) }); return; }

    if (action === 'importCsv') {
      let campaign = id ? await db.getCampaign(owner, id) : null;
      if (!campaign) {
        campaign = await db.saveCampaign(owner, actor, { name: String(body.campaignName || 'US Supplements (v12 tracker)'), status: 'Active', industry: 'Vitamins and supplements', keywords: ['creatine gummies', 'colostrum', 'beef organ supplements', 'greens powder', 'collagen', 'probiotics'], countries: ['US'], schedule: 'One-off', notes: 'Seeded from the v12 tracker' });
      }
      const text = body.csvText ? String(body.csvText) : readFixtures();
      if (!text.trim()) { res.status(400).json({ error: 'No CSV to import.' }); return; }
      const mapped = parseFixtures(text);
      if (!mapped.length) { res.status(400).json({ error: 'The CSV had no rows.' }); return; }
      const run = await db.createRun(owner, campaign.id, 'import', { source: body.csvText ? 'upload' : 'fixtures_v12', rows: mapped.length });
      const { counts, errors } = await db.importRows(owner, actor, campaign, run.id, mapped);
      await db.finishRun(run.id, errors.length && !counts.imported ? 'Failed' : 'Done', counts, errors, 0);
      res.status(200).json({ ok: true, campaign: campaign, run: run, counts: counts, errors: errors });
      return;
    }

    // ---- prospects ----
    if (action === 'prospects') {
      const f = body.filters || {};
      const rows = await db.listProspects(owner, { campaignId: body.campaignId || f.campaignId, runId: f.run, priority: f.priority, connection: f.connection, creativeStyle: f.creativeStyle, stage: f.stage, q: f.q, includeDisqualified: !!f.includeDisqualified });
      res.status(200).json({ prospects: rows, enums: db.ENUM });
      return;
    }
    if (action === 'prospect') {
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      const campaign = await db.getCampaign(owner, p.campaign_id);
      const profile = await db.serviceProfile(campaign);
      let followups = null; try { const g = M.generate(p, profile, p.video_url || null, campaign && campaign.template_set); followups = { followup_1: g.followup_1, followup_2: g.followup_2 }; } catch (e) {}
      res.status(200).json({ prospect: p, campaign: campaign, followups: followups, enums: db.ENUM, stageNext: db.STAGE_NEXT, placeholder: M.URL_PLACEHOLDER, providers: providers(), profile: profile });
      return;
    }
    if (action === 'updateProspect') { const p = await db.updateProspect(owner, actor, id, body.fields || {}); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'setVideoUrl') { const p = await db.setVideoUrl(owner, actor, id, body.url); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'setStage') { const p = await db.setStage(owner, actor, id, String(body.stage || ''), { note: body.note, variant_used: body.variant_used, channel: body.channel }); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'setConnectionState') { const p = await db.setConnectionState(owner, actor, id, body.state || null, { note: body.note }); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'setOutcome') { const p = await db.setOutcome(owner, actor, id, body.outcome || null, body.note); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'addNote') {
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      await db.addEvent(owner, actor, p, { step: 'note', detail: String(body.note || '').slice(0, 2000), channel: body.channel || null });
      res.status(200).json({ ok: true, prospect: await db.getProspect(owner, id) }); return;
    }
    if (action === 'refreshProducts') { // re-fetch the Shopify feed and re-run the product rule for one prospect
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      const shop = await S.shopifyProducts(p.domain, {});
      if (!shop.is_shopify) { res.status(400).json({ error: 'No Shopify products feed at ' + p.domain + (shop.status ? ' (HTTP ' + shop.status + ')' : '') }); return; }
      const featured = await S.featuredProducts(p.domain, shop.products);
      const pick = S.pickProduct(shop.products, (p.ad_analysis && p.ad_analysis.hero_product) || '', featured);
      await db.updateProspect(owner, actor, id, { skus: shop.skus, suggested_product_url: pick.url, suggested_product_name: pick.name, product_photo_check: pick.check, why_this_product: pick.why });
      await db.setProducts(id, shop.products, 'shopify');
      res.status(200).json({ ok: true, prospect: await db.getProspect(owner, id) }); return;
    }
    if (action === 'runs') { res.status(200).json({ runs: await db.listRuns(owner, id) }); return; }
    if (action === 'deleteProspect') { const n = await db.deleteProspect(owner, id); res.status(200).json({ ok: true, deleted: n }); return; }
    if (action === 'deleteRunProspects') { const run = await db.getRun(owner, id); if (!run) { res.status(404).json({ error: 'Run not found.' }); return; } const r = await db.deleteRunProspects(owner, id); res.status(200).json(Object.assign({ ok: true }, r)); return; }

    // ---- email (Phase 2) ----
    if (action === 'sendEmail') { const r = await J.sendEmail(owner, actor, id, body.kind, base); res.status(200).json(Object.assign(r, { prospect: await db.getProspect(owner, id) })); return; }
    if (action === 'dueFollowups') { res.status(200).json({ tasks: await db.dueFollowups(owner) }); return; }
    if (action === 'sendFollowup') {
      const tasks = await db.dueFollowups(owner); const t = tasks.find((x) => Number(x.event_id) === Number(body.eventId));
      if (!t) { res.status(404).json({ error: 'That follow-up is no longer due.' }); return; }
      res.status(200).json(await J.sendFollowup(owner, actor, t, base)); return;
    }
    if (action === 'skipFollowup') { await db.completeFollowup(Number(body.eventId)); res.status(200).json({ ok: true }); return; }

    // ---- LinkedIn automation (Phase 5) ----
    if (action === 'readyToSend') { res.status(200).json({ prospects: await db.readyToSend(owner), providers: providers(), linkedin: await db.linkedinSettings() }); return; }
    if (action === 'linkedinSend') { res.status(200).json(await J.linkedinSend(owner, actor, id, body.url, body.text)); return; }
    if (action === 'linkedinTick') { res.status(200).json({ ok: true, tick: await J.linkedinTick(owner, actor) }); return; }
    if (action === 'linkedinTest') { const P = L.provider(); res.status(200).json(P ? await P.test() : { ok: false, detail: 'No provider set (VO_LINKEDIN_PROVIDER)' }); return; }
    if (action === 'linkedinResume') { const s = await db.linkedinSettings(); await db.setConfig('linkedin', Object.assign({}, s, { paused: false, paused_reason: '' })); res.status(200).json({ ok: true, linkedin: await db.linkedinSettings() }); return; }
    if (action === 'simulate') { // dry-run provider only: lets the owner walk the Phase 5 flow without a LinkedIn account
      if (L.providerName() !== 'dryrun') { res.status(400).json({ error: 'Simulation only works with VO_LINKEDIN_PROVIDER=dryrun' }); return; }
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      let pid = p.linkedin_provider_id; if (!pid) { pid = (await L.dry.lookup(p.dm_linkedin || p.brand)).provider_id; await db.setLinkedinIds(id, { provider_id: pid }); }
      if (body.what === 'accept') L.dry._simulateAccept(pid);
      else if (body.what === 'reply') L.dry._simulateReply(pid, body.text || 'Sure, send it over');
      else if (body.what === 'restrict') L.dry._simulateRestriction(true);
      else if (body.what === 'unrestrict') L.dry._simulateRestriction(false);
      res.status(200).json({ ok: true, tick: await J.linkedinTick(owner, actor), prospect: await db.getProspect(owner, id) }); return;
    }

    // ---- settings (5.4) and results (5.5), Phase 4 weight tuning ----
    if (action === 'config' || action === 'settings') {
      res.status(200).json({ scoring: await db.scoringConfig(), defaultScoring: require('../lib/vo-score').loadConfig(require('../lib/vo-score').DEFAULT_CONFIG_PATH), profile: await db.serviceProfile(null), exclusions: await db.globalExclusions(), linkedin: await db.linkedinSettings(), presets: await db.listPresets(owner), providers: providers(), templates: M.DEFAULT_TEMPLATES, limits: { hard_daily_requests: L.HARD_DAILY_REQUESTS } }); return;
    }
    if (action === 'saveProfile') { const ok = await db.setConfig('service_profile', Object.assign({}, M.DEFAULT_PROFILE, body.profile || {})); res.status(200).json({ ok: ok, profile: await db.serviceProfile(null) }); return; }
    if (action === 'saveExclusions') { const list = (body.exclusions || []).map((x) => String(x).trim()).filter(Boolean); await db.setConfig('exclusions', list); res.status(200).json({ ok: true, exclusions: list }); return; }
    if (action === 'saveLinkedinSettings') { const s = await db.linkedinSettings(); const n = body.linkedin || {}; const lim = L.limits(n); await db.setConfig('linkedin', Object.assign({}, s, lim, { timezone: n.timezone || s.timezone || 'America/New_York' })); res.status(200).json({ ok: true, linkedin: await db.linkedinSettings() }); return; }
    if (action === 'scoringImpact') { db.validateScoring(body.scoring || {}); res.status(200).json({ impact: db.scoringImpact(body.scoring) }); return; }
    if (action === 'saveScoring') { const r = await db.saveScoring(body.scoring || {}, actor); const n = body.rescore ? await db.rescoreAll(owner) : 0; res.status(200).json(Object.assign(r, { rescored: n })); return; }
    if (action === 'resetScoring') { const cfg = await db.resetScoring(); const n = await db.rescoreAll(owner); res.status(200).json({ ok: true, config: cfg, rescored: n }); return; }
    if (action === 'results') { res.status(200).json({ rows: await db.results(owner, body.campaignId || null), campaigns: await db.listCampaigns(owner) }); return; }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || 'Something went wrong.' });
  }
};

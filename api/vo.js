// Video Outreach API (spec v4). One endpoint, action switch, same style as api/sms-campaign.js.
// Admin-only: the owner, the VIDEO_OUTREACH_EMAILS allow-list and (Phase 4) subscribers on the plans
// in VIDEO_OUTREACH_PLANS; everyone else gets 404 so the module's existence is not revealed.
// Rows are scoped to the account. Sourcing runs are resumable: runNow starts one and works for up
// to 40 seconds, then the UI calls runStep until it reports done (the cron worker also picks them up).
const fs = require('fs');
const path = require('path');
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach, voLevel, videoOutreachPlans } = require('../lib/access');
const { accountEmailOf, emailOf } = require('../lib/tenant');
const db = require('../lib/vo-db');
const S = require('../lib/vo-services');
const L = require('../lib/vo-linkedin');
const J = require('../lib/vo-jobs');
const { parseFixtures } = require('../lib/vo-import');
const M = require('../lib/vo-messages');

const FIXTURES = ['docs/video-outreach/video_outreach_fixtures_v12.csv'].map((p) => [path.join(process.cwd(), p), path.join(__dirname, '..', p)]).flat();
function readFixtures() { for (const p of FIXTURES) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { /* try next */ } } return ''; }
function providers() { const s = S.providerStatus(); const P = L.provider(); return Object.assign(s, { linkedin: L.providerName() || 'off', linkedin_configured: !!(P && P.configured()), unipile: { dsn: !!process.env.UNIPILE_DSN, api_key: !!process.env.UNIPILE_API_KEY, account_id: !!process.env.UNIPILE_ACCOUNT_ID }, email_from: !!(process.env.VO_EMAIL_FROM), plan_gate: videoOutreachPlans() }); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!canVideoOutreach(acct.email, acct)) { res.status(404).json({ error: 'Not found.' }); return; }
  const owner = accountEmailOf(req) || acct.email;
  const actor = emailOf(req) || acct.email;
  // Team members reach only what the owner ticked: Ready to send actions, the whole module, or Settings.
  const lvl = voLevel(acct);
  const SETTINGS_ACTIONS = ['reclassifyReplies', 'senders', 'senderLink', 'senderAdd', 'senderSave', 'activityCheck', 'saveProfile', 'saveExclusions', 'saveLinkedinSettings', 'saveAlerts', 'testAlerts', 'saveScoring', 'resetScoring', 'scoringImpact', 'linkedinResume', 'linkedinTest', 'simulate', 'regenerateMessages', 'faqAdd', 'faqRemove', 'workerTick'];
  const READY_ACTIONS = ['funnel', 'readyToSend', 'readyCount', 'dueFollowups', 'upcomingFollowups', 'notRelevant', 'notRelevantStats', 'sendFollowup', 'skipFollowup', 'linkedinSend', 'setVideoUrl', 'checkVideo', 'sentMessages', 'prospect', 'updateProspect', 'refreshProducts', 'linkedinTick', 'campaigns', 'demoReady', 'removeDemo', 'ask', 'askHistory', 'markQuestion', 'faqExtra', 'recordReply', 'setStage', 'addNote', 'config', 'getContact'];
  const actionName = String((req.body && req.body.action) || (typeof req.body === 'string' ? (JSON.parse(req.body || '{}').action || '') : ''));
  if (SETTINGS_ACTIONS.includes(actionName) && !lvl.settings) { res.status(403).json({ error: 'Not allowed: Video Outreach settings are for the owner, or a member with the Settings permission.' }); return; }
  if (!lvl.all && !SETTINGS_ACTIONS.includes(actionName) && !READY_ACTIONS.includes(actionName)) { res.status(403).json({ error: 'Not allowed: your permission covers Ready to send only.' }); return; }
  const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || (req.query && req.query.action) || 'campaigns');
  const id = Number(body.id || (req.query && req.query.id) || 0);

  try {
    // ---- campaigns ----
    if (action === 'campaigns') { const ready = await db.readyToSend(owner); const due = await db.dueFollowups(owner); res.status(200).json({ campaigns: await db.listCampaigns(owner), enums: db.ENUM, profile: await db.serviceProfile(null), placeholder: M.URL_PLACEHOLDER, providers: providers(), linkedin: await db.linkedinSettings(), ready_count: ready.length, followups_due: due.length }); return; }
    if (action === 'readyCount') { const ready = await db.readyToSend(owner); const due = await db.dueFollowups(owner); res.status(200).json({ ready_count: ready.length, followups_due: due.length }); return; }
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
      if (!(await db.claimRun(run.id))) { res.status(200).json({ ok: true, run: run, done: false, status: run.status, waiting: 'busy' }); return; } // another step is working on it, poll again
      const r = await J.stepRun(owner, actor, run, 35000);
      res.status(200).json({ ok: true, run: await db.getRun(owner, run.id), done: r.done, status: r.status, waiting: r.waiting || null }); return;
    }
    if (action === 'runStatus') { const run = await db.getRun(owner, id); res.status(200).json({ run: run, done: !run || !['Running', 'Queued'].includes(run.status) }); return; }
    if (action === 'stopRun') { await db.stopRun(owner, id, 'Stopped by ' + actor); res.status(200).json({ ok: true, run: await db.getRun(owner, id) }); return; }
    if (action === 'workerTick') { res.status(200).json({ ok: true, tick: await J.tick(owner, actor, { base: base, runBudgetMs: 30000 }) }); return; }
    if (action === 'recheckNow') { res.status(200).json({ ok: true, rechecked: await J.recheck(owner, actor, Number(body.limit) || 5) }); return; }
    if (action === 'recountCampaign') { // "Refresh ad counts": re-pull each brand's own ads, a few per call, the UI loops until remaining is 0
      const done = await J.recheck(owner, actor, Number(body.limit) || 2, { force: true, campaignId: id });
      res.status(200).json({ ok: true, rechecked: done, remaining: await db.countRecountable(owner, id), blocked: done.some((d) => /hard limit|403/.test(d.error || '')) }); return;
    }

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
      const rows = await db.listProspects(owner, { campaignId: body.campaignId || f.campaignId, runId: f.run, priority: f.priority, connection: f.connection, creativeStyle: f.creativeStyle, stage: f.stage, q: f.q, includeDisqualified: !!f.includeDisqualified, ids: Array.isArray(f.ids) ? f.ids : undefined });
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
    if (action === 'setConnectionState') {
      const before = await db.getProspect(owner, id);
      const p = await db.setConnectionState(owner, actor, id, body.state || null, { note: body.note });
      let sms = 0; if (body.state === 'Connected' && before && before.linkedin_connection_state !== 'Connected') { try { sms = (await J.newLeadAlerts(owner, p, base)).sms; } catch (e) {} } // marked by hand: same new-lead text
      res.status(200).json({ ok: true, prospect: p, sms: sms }); return;
    }
    if (action === 'testAlerts') { res.status(200).json(Object.assign({ ok: true }, await J.testAlerts(owner, base))); return; }
    if (action === 'resetOutreach') { const p = await db.resetOutreach(owner, actor, id); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'setOutcome') { const p = await db.setOutcome(owner, actor, id, body.outcome || null, body.note); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'recordReply') { // a reply you saw yourself (email or LinkedIn by hand): stored, classified, stage Replied
      const p0 = await db.getProspect(owner, id); if (!p0) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      const cls = await S.classifyReply(body.text, { brand: p0.brand });
      const p = await db.recordReply(owner, actor, id, String(body.text || ''), null, cls);
      let alerts = { sms: 0 }; try { alerts = await J.replyAlerts(owner, p0, cls, body.channel || 'LinkedIn', base); } catch (e) {}
      res.status(200).json({ ok: true, prospect: p, sentiment: cls.sentiment, summary: cls.summary, sms: alerts.sms }); return;
    }
    if (action === 'addNote') {
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      await db.addEvent(owner, actor, p, { step: 'note', detail: String(body.note || '').slice(0, 2000), channel: body.channel || null });
      res.status(200).json({ ok: true, prospect: await db.getProspect(owner, id) }); return;
    }
    if (action === 'refreshProducts') { // re-fetch the Shopify feed and re-run the product rule for one prospect
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found.' }); return; }
      const r = await J.refreshProducts(owner, actor, p);
      if (!r.ok) { res.status(400).json({ error: r.error }); return; }
      res.status(200).json({ ok: true, prospect: await db.getProspect(owner, id) }); return;
    }
    if (action === 'runs') { res.status(200).json({ runs: await db.listRuns(owner, id) }); return; }
    if (action === 'deleteProspect') { const n = await db.deleteProspect(owner, id); res.status(200).json({ ok: true, deleted: n }); return; }
    if (action === 'deleteRunProspects') { const run = await db.getRun(owner, id); if (!run) { res.status(404).json({ error: 'Run not found.' }); return; } const r = await db.deleteRunProspects(owner, id); res.status(200).json(Object.assign({ ok: true }, r)); return; }

    // ---- email (Phase 2) ----
    if (action === 'sendEmail') { const r = await J.sendEmail(owner, actor, id, body.kind, base); res.status(200).json(Object.assign(r, { prospect: await db.getProspect(owner, id) })); return; }
    if (action === 'sentMessages') { res.status(200).json({ rows: await db.sentMessages(owner, 50) }); return; }
    if (action === 'upcomingFollowups') {
      let planned = []; try { planned = await J.planFollowups(owner, actor); } catch (e) {}
      const rows = await db.upcomingFollowups(owner); const cache = {};
      for (const t of rows) {
        try {
          const p = await db.getProspect(owner, t.id); const c = cache[p.campaign_id] || (cache[p.campaign_id] = await db.getCampaign(owner, p.campaign_id));
          const which = /3/.test(t.next_action) ? 'followup_3' : (/2/.test(t.next_action) ? 'followup_2' : 'followup_1');
          t.preview = M.generate(p, await db.serviceProfile(c), p.video_url || null, c && c.template_set)[which];
        } catch (e) { t.preview = ''; }
      }
      res.status(200).json({ tasks: rows, planned: planned }); return;
    }
    if (action === 'dueFollowups') { res.status(200).json({ tasks: await db.dueFollowups(owner) }); return; }
    if (action === 'sendFollowup') {
      const tasks = await db.dueFollowups(owner); const t = tasks.find((x) => Number(x.event_id) === Number(body.eventId));
      if (!t) { res.status(404).json({ error: 'That follow-up is no longer due.' }); return; }
      res.status(200).json(await J.sendFollowup(owner, actor, t, base)); return;
    }
    if (action === 'skipFollowup') { await db.completeFollowup(Number(body.eventId)); res.status(200).json({ ok: true }); return; }

    // ---- LinkedIn automation (Phase 5) ----
    if (action === 'demoReady') { const p = await db.createDemoReady(owner, actor); res.status(200).json({ ok: true, prospect: p }); return; }
    if (action === 'removeDemo') { res.status(200).json({ ok: true, removed: await db.removeDemo(owner) }); return; }
    // Proof of concept for a client brief (7 Oct 2026): how recently is each of these LinkedIn profiles active?
    // Owner only (Settings level), max 15 links a call, one profile view and up to two list calls each.
    if (action === 'activityCheck') {
      const P = L.provider(); if (!P || !P.configured()) { res.status(400).json({ error: 'LinkedIn provider not configured' }); return; }
      const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u) => L.personProfile(u)).slice(0, 15);
      const out = [];
      for (const u of urls) {
        try {
          const who = await P.lookup(u); const act = await P.activity(who.provider_id);
          const days = act.last_at ? Math.floor((Date.now() - new Date(act.last_at)) / 86400000) : null;
          out.push({ url: u, name: who.name, headline: who.headline, connections: who.connections, followers: who.followers, last_at: act.last_at, kind: act.kind, days_since: days, active_90d: L.activeSince(act.last_at) });
        } catch (e) { out.push({ url: u, error: String(e.message || e).slice(0, 160) }); }
      }
      res.status(200).json({ ok: true, people: out }); return;
    }
    if (action === 'notRelevant') { res.status(200).json(await db.markNotRelevant(owner, actor, id, String(body.reason || ''), body.note)); return; }
    if (action === 'notRelevantStats') { res.status(200).json({ reasons: db.NOT_RELEVANT_REASONS, rows: await db.notRelevantStats(owner) }); return; }
    if (action === 'dailyLedger') {
      const iso = (d) => d.toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || '')) ? body.to : iso(new Date());
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : iso(new Date(new Date(to + 'T12:00:00Z').getTime() - 30 * 86400000));
      const led = await db.dailyLedger(owner, from, to);
      // daily targets for the colours: requests = every active sender's cap; acceptances at the 20% the offer note earns; a day of brands per day of sending
      const snds = (await J.senders()).filter((x) => x.active !== false); const capacity = snds.reduce((a, x) => a + (Number(x.daily_requests) || 20), 0);
      led.targets = { requests: capacity, accepted: Math.max(1, Math.round(capacity * 0.2)), found: capacity, rate: 20, senders: snds.length };
      // how far through today's US send window we are (8am to 6pm in its time zone), so today is not red before sending has started
      try {
        const tz = (await db.linkedinSettings()).timezone || 'America/New_York';
        const hm = (zone) => { const pt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()); return Number(pt.find((x) => x.type === 'hour').value) % 24 + Number(pt.find((x) => x.type === 'minute').value) / 60; };
        const here = hm(tz); const uk = hm('Europe/London'); const diff = Math.round(uk - here + (uk - here < -12 ? 24 : 0));
        const h12 = (h) => { const x = ((h % 24) + 24) % 24; return (x % 12 || 12) + (x < 12 ? 'am' : 'pm'); };
        // measured on the UK clock, because the rows are UK days
        led.targets.window = Math.max(0, Math.min(1, (uk - (8 + diff)) / 10)); led.targets.window_uk = h12(8 + diff) + ' to ' + h12(18 + diff) + ' UK';
      } catch (e) {}
      const wt = (await db.readyToSend(owner)).filter((p) => p.source !== 'demo'); led.waiting = wt.length; led.overdue = wt.filter((p) => p.linkedin_connected_at && Date.now() - new Date(p.linkedin_connected_at) > 48 * 3600000).length;
      res.status(200).json(led); return;
    }
    // ---- LinkedIn senders (7 Oct 2026) ----
    if (action === 'senders') {
      const list = await J.senders(); const out = [];
      const sod = new Date(); sod.setUTCHours(0, 0, 0, 0); const sow = new Date(sod); sow.setUTCDate(sow.getUTCDate() - ((sow.getUTCDay() + 6) % 7));
      for (const x of list) {
        let info = null; try { info = await L.accountInfo(x.account_id); } catch (e) { info = { status: 'error: ' + String(e.message || e).slice(0, 80) }; }
        out.push({ account_id: x.account_id, name: x.name, first: x.first, primary: !!x.primary, active: x.active !== false, daily_requests: x.daily_requests, weekly_requests: x.weekly_requests,
          today: await db.countSenderSince(owner, x.account_id, x.primary, ['Request sent'], sod.toISOString()), week: await db.countSenderSince(owner, x.account_id, x.primary, ['Request sent'], sow.toISOString()),
          linkedin_name: info && info.name, status: info && info.status, next: x.next_request_at || null });
      }
      const s = await db.linkedinSettings();
      res.status(200).json({ senders: out, pending: (s.senders_pending || []).filter((p) => new Date(p.expires) > new Date()).map((p) => ({ name: p.name, first: p.first, url: p.url, expires: p.expires })) }); return;
    }
    if (action === 'senderLink') {
      const name = String(body.name || '').trim().slice(0, 60), first = String(body.first || '').trim().slice(0, 30);
      if (!name || !first) { res.status(400).json({ error: 'Type their full name and the first name their messages are signed with.' }); return; }
      const key = 'sp' + require('crypto').randomBytes(8).toString('hex');
      const tok = require('crypto').createHmac('sha256', String(process.env.APP_PASSWORD || 'sitepounce')).update('sender:' + key).digest('hex').slice(0, 32);
      const base = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host || 'www.sitepounce.com').split(',')[0].trim();
      const link = await L.hostedLink(key, base + '/api/vo-sender-hook?k=' + key + '&t=' + tok, base + '/#vo-settings');
      const s = await db.linkedinSettings();
      const pending = (s.senders_pending || []).filter((p) => new Date(p.expires) > new Date()).concat([{ key: key, name: name, first: first, url: link.url, expires: link.expiresOn, by: actor }]);
      await db.setConfig('linkedin', Object.assign({}, s, { senders_pending: pending }));
      res.status(200).json({ ok: true, url: link.url, expires: link.expiresOn }); return;
    }
    if (action === 'senderAdd') {
      const acct = String(body.account_id || '').trim(); const name = String(body.name || '').trim().slice(0, 60); const first = String(body.first || '').trim().slice(0, 30);
      if (!acct || !first) { res.status(400).json({ error: 'Paste the Unipile account ID and the sign-off first name.' }); return; }
      let info; try { info = await L.accountInfo(acct); } catch (e) { res.status(400).json({ error: 'Unipile does not know that account ID: ' + e.message }); return; }
      const s = await db.linkedinSettings(); const list = (s.senders || []).filter((x) => x.account_id !== acct);
      list.push({ account_id: acct, name: name || info.name || first, first: first, active: true, added_at: new Date().toISOString(), added_by: actor });
      await db.setConfig('linkedin', Object.assign({}, s, { senders: list }));
      res.status(200).json({ ok: true, linkedin_name: info.name }); return;
    }
    if (action === 'senderSave') {
      const acct = String(body.account_id || ''); const s = await db.linkedinSettings(); const lim = (n, d) => Math.max(0, Math.min(Number(n) || d, 25));
      if (body.primary) {
        await db.setConfig('linkedin', Object.assign({}, s, { primary_name: String(body.name || s.primary_name || '').slice(0, 60) || undefined }));
        res.status(200).json({ ok: true }); return;
      }
      const list = (s.senders || []).map((x) => x.account_id !== acct ? x : Object.assign({}, x, {
        name: String(body.name || x.name).slice(0, 60), first: String(body.first || x.first).slice(0, 30), active: body.active !== false,
        daily_requests: lim(body.daily_requests, 20), weekly_requests: Math.max(0, Math.min(Number(body.weekly_requests) || 100, 150)) }));
      await db.setConfig('linkedin', Object.assign({}, s, { senders: list }));
      res.status(200).json({ ok: true }); return;
    }
    // re-read every stored reply with the current rules (7 Oct 2026: a "thanks" and a PR agency pitch had been counted Positive)
    if (action === 'reclassifyReplies') {
      const rows = (await db.listProspects(owner, { includeDisqualified: true })).filter((p) => p.last_reply_text);
      const changed = [];
      for (const p of rows) {
        const cls = await S.classifyReply(p.last_reply_text, { brand: p.brand });
        if (cls.sentiment && cls.sentiment !== p.reply_sentiment) { await db.updateReplyReading(p.id, cls.sentiment, cls.summary); changed.push({ brand: p.brand, from: p.reply_sentiment, to: cls.sentiment, summary: cls.summary }); }
      }
      res.status(200).json({ ok: true, checked: rows.length, changed: changed }); return;
    }
    if (action === 'readyToSend') { const rows = (await db.readyToSend(owner)).map((p) => Object.assign(p, { product_label: p.suggested_product_name ? M.shortProduct(p.suggested_product_name) : '' })); res.status(200).json({ prospects: rows, providers: providers(), linkedin: await db.linkedinSettings() }); return; }
    if (action === 'linkedinSend') { res.status(200).json(await J.linkedinSend(owner, actor, id, body.url, body.text, { mode: body.mode })); return; }
    if (action === 'checkVideo') { res.status(200).json(await require('../lib/vo-video').resolveVideo(body.url)); return; }
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
      res.status(200).json({ scoring: await db.scoringConfig(), defaultScoring: require('../lib/vo-score').loadConfig(require('../lib/vo-score').DEFAULT_CONFIG_PATH), profile: await db.serviceProfile(null), exclusions: await db.globalExclusions(), linkedin: await db.linkedinSettings(), alerts: await db.getConfig('alerts', { mobiles: [], all_replies: false }), presets: await db.listPresets(owner), providers: providers(), templates: M.DEFAULT_TEMPLATES, limits: { hard_daily_requests: L.HARD_DAILY_REQUESTS } }); return;
    }
    if (action === 'saveProfile') { const ok = await db.setConfig('service_profile', Object.assign({}, M.DEFAULT_PROFILE, body.profile || {})); res.status(200).json({ ok: ok, profile: await db.serviceProfile(null) }); return; }
    if (action === 'saveAlerts') { const mobiles = (body.mobiles || []).map((m) => String(m).trim()).filter((m) => /\d{9,}/.test(m.replace(/\s+/g, ''))); await db.setConfig('alerts', { mobiles: mobiles, all_replies: !!body.all_replies }); res.status(200).json({ ok: true, alerts: await db.getConfig('alerts', {}) }); return; }
    if (action === 'regenerateMessages') { res.status(200).json({ ok: true, rebuilt: await db.regenerateMessages(owner, actor) }); return; }
    if (action === 'saveExclusions') { const list = (body.exclusions || []).map((x) => String(x).trim()).filter(Boolean); await db.setConfig('exclusions', list); res.status(200).json({ ok: true, exclusions: list }); return; }
    if (action === 'saveLinkedinSettings') { const s = await db.linkedinSettings(); const n = body.linkedin || {}; const lim = L.limits(n); await db.setConfig('linkedin', Object.assign({}, s, lim, { timezone: n.timezone || s.timezone || 'America/New_York', bridge_message: n.bridge_message === undefined ? s.bridge_message !== false : (n.bridge_message === 'on' || n.bridge_message === true), note_test: n.note_test === undefined ? s.note_test !== false : (n.note_test === 'on' || n.note_test === true), video_delivery: n.video_delivery === 'link' ? 'link' : (n.video_delivery === 'attachment' ? 'attachment' : (s.video_delivery || 'attachment')), warmup_test: n.warmup_test === undefined ? s.warmup_test !== false : (n.warmup_test === 'on' || n.warmup_test === true) })); res.status(200).json({ ok: true, linkedin: await db.linkedinSettings() }); return; }
    if (action === 'scoringImpact') { db.validateScoring(body.scoring || {}); res.status(200).json({ impact: db.scoringImpact(body.scoring) }); return; }
    if (action === 'saveScoring') { const r = await db.saveScoring(body.scoring || {}, actor); const n = body.rescore ? await db.rescoreAll(owner) : 0; res.status(200).json(Object.assign(r, { rescored: n })); return; }
    if (action === 'resetScoring') { const cfg = await db.resetScoring(); const n = await db.rescoreAll(owner); res.status(200).json({ ok: true, config: cfg, rescored: n }); return; }
    if (action === 'ask') { // Ask AI on the Help screen
      const q = String(body.question || '').trim(); if (!q) { res.status(400).json({ error: 'Type a question first.' }); return; }
      let guide = ''; try { guide = fs.readFileSync(path.join(process.cwd(), 'public', 'help-video-outreach.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); } catch (e) { guide = ''; }
      const camps = await db.listCampaigns(owner); const li = await db.linkedinSettings(); const rep = await db.reportData(owner);
      const snapshot = { stamp: new Date().toISOString().slice(0, 13), version: require('../lib/version').APP_VERSION, providers: providers(), campaigns: camps.map((c) => ({ name: c.name, status: c.status, schedule: c.schedule, prospects: c.prospects_found, requested: c.requested, connected: c.connected, videos_sent: c.videos_sent, positive_replies: c.positive_replies, cost: c.cost_to_date, auto_connect: !!(c.automation && c.automation.auto_connect), max_priority: c.automation && c.automation.max_priority })), linkedin: { paused: li.paused, daily_requests: li.daily_requests, weekly_requests: li.weekly_requests, max_priority: li.max_priority, next_request_at: li.next_request_at }, waiting_for_video: rep.waiting.map((p) => p.brand), replies_open: rep.replied_open.map((p) => p.brand), followups_due: rep.followups_due, last_24h: rep.day, extra_faq: await db.faqExtra() };
      const history = await db.listQuestions(owner, 8);
      const a = await S.askAssistant(q, guide, snapshot, history);
      const row = await db.saveQuestion(owner, actor, Object.assign({ question: q }, a));
      res.status(200).json({ ok: true, item: row }); return;
    }
    if (action === 'askHistory') { res.status(200).json({ items: await db.listQuestions(owner, 30), faq: await db.faqExtra() }); return; }
    if (action === 'faqAdd') { res.status(200).json({ ok: true, faq: await db.addFaq(owner, id) }); return; }
    if (action === 'faqRemove') { res.status(200).json({ ok: true, faq: await db.removeFaq(Number(body.index)) }); return; }
    if (action === 'faqExtra') { res.status(200).json({ faq: await db.faqExtra() }); return; }
    if (action === 'markQuestion') { await db.markQuestion(owner, id, { helpful: body.helpful }); res.status(200).json({ ok: true }); return; }
    if (action === 'findPerson') { const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found' }); return; } res.status(200).json(await J.findPersonOnLinkedIn(owner, actor, p)); return; }
    if (action === 'getContact') {
      // On demand (one button press): reveal the decision maker's verified email + phone from Apollo for one
      // brand. Only runs when pressed, so credits are spent on purpose. Saves what it finds onto the prospect.
      const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found' }); return; }
      const domain = S.domainOf(p.website || p.domain || '');
      if (!domain) { res.status(200).json({ ok: false, error: 'No website for this brand, so there is nothing to look up.' }); return; }
      const c = await S.apolloBestContact(domain);
      const fields = {};
      if (c.name) fields.dm_name = c.name;
      if (c.title) fields.dm_title = c.title;
      if (c.linkedin) fields.dm_linkedin = c.linkedin;
      if (c.email) fields.dm_email = c.email;
      if (c.phone) fields.dm_phone = c.phone;
      const prospect = Object.keys(fields).length ? await db.updateProspect(owner, actor, id, fields) : p;
      res.status(200).json({ ok: true, contact: c, prospect });
      return;
    }
    if (action === 'funnel') { res.status(200).json({ funnel: await db.funnelData(owner, body.from || null, body.to || null) }); return; }
    if (action === 'report') { res.status(200).json({ report: await db.reportData(owner) }); return; }
    if (action === 'sendReportNow') { res.status(200).json(await J.dailyReport(owner, actor, base, true)); return; }
    if (action === 'results') { res.status(200).json({ rows: await db.results(owner, body.campaignId || null), campaigns: await db.listCampaigns(owner) }); return; }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || 'Something went wrong.' });
  }
};

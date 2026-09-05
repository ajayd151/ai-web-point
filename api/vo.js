// Video Outreach API (spec v4). One endpoint, action switch, same style as api/sms-campaign.js.
// Admin-only: the owner plus the VIDEO_OUTREACH_EMAILS allow-list; everyone else gets 404 so the
// module's existence is not revealed (the DeepDossier pattern). Rows are scoped to the account.
const fs = require('fs');
const path = require('path');
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach } = require('../lib/access');
const { accountEmailOf, emailOf } = require('../lib/tenant');
const db = require('../lib/vo-db');
const { parseFixtures } = require('../lib/vo-import');
const M = require('../lib/vo-messages');

const FIXTURES = ['docs/video-outreach/video_outreach_fixtures_v12.csv'].map((p) => [path.join(process.cwd(), p), path.join(__dirname, '..', p)]).flat();
function readFixtures() { for (const p of FIXTURES) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { /* try next */ } } return ''; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!canVideoOutreach(acct.email)) { res.status(404).json({ error: 'Not found.' }); return; }
  const owner = accountEmailOf(req) || acct.email;
  const actor = emailOf(req) || acct.email;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || (req.query && req.query.action) || 'campaigns');
  const id = Number(body.id || (req.query && req.query.id) || 0);

  try {
    if (action === 'campaigns') { res.status(200).json({ campaigns: await db.listCampaigns(owner), enums: db.ENUM, profile: await db.serviceProfile(null), placeholder: M.URL_PLACEHOLDER }); return; }
    if (action === 'campaign') { const c = await db.getCampaign(owner, id); if (!c) { res.status(404).json({ error: 'Campaign not found.' }); return; } res.status(200).json({ campaign: c, runs: await db.listRuns(owner, id), profile: await db.serviceProfile(c) }); return; }
    if (action === 'saveCampaign') {
      const c = await db.saveCampaign(owner, actor, body.campaign || {});
      res.status(200).json({ ok: true, campaign: c }); return;
    }
    if (action === 'duplicateCampaign') { const c = await db.duplicateCampaign(owner, actor, id); res.status(200).json({ ok: !!c, campaign: c }); return; }
    if (action === 'setCampaignStatus') { const c = await db.saveCampaign(owner, actor, { id: id, status: String(body.status || '') }); res.status(200).json({ ok: !!c, campaign: c }); return; }

    if (action === 'importCsv') {
      // Phase 1 sourcing = the v12 tracker (bundled fixtures) or a CSV pasted/uploaded from the app.
      let campaign = id ? await db.getCampaign(owner, id) : null;
      if (!campaign) {
        campaign = await db.saveCampaign(owner, actor, { name: String(body.campaignName || 'US Supplements (v12 tracker)'), status: 'Active', industry: 'Vitamins and supplements', countries: ['US'], schedule: 'One-off', notes: 'Seeded from the v12 tracker' });
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
      let followups = null; try { const g = M.generate(p, profile, p.video_url || null); followups = { followup_1: g.followup_1, followup_2: g.followup_2 }; } catch (e) {}
      res.status(200).json({ prospect: p, campaign: campaign, followups: followups, enums: db.ENUM, stageNext: db.STAGE_NEXT, placeholder: M.URL_PLACEHOLDER });
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
    if (action === 'runs') { res.status(200).json({ runs: await db.listRuns(owner, id) }); return; }
    if (action === 'config') { res.status(200).json({ scoring: await db.scoringConfig(), profile: await db.serviceProfile(null) }); return; }
    if (action === 'saveProfile') { const ok = await db.setConfig('service_profile', Object.assign({}, M.DEFAULT_PROFILE, body.profile || {})); res.status(200).json({ ok: ok, profile: await db.serviceProfile(null) }); return; }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || 'Something went wrong.' });
  }
};

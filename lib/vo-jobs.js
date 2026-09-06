// Video Outreach background jobs (spec 2.2 scheduler, 2.1 re-check cadence, 4.8 email, 4.9 LinkedIn).
// Run by api/vo-worker.js every 10 minutes and triggered by hand from api/vo.js. Each job is small,
// idempotent and logs what it did, so a tick that dies half way leaves nothing inconsistent.
const db = require('./vo-db');
const R = require('./vo-run');
const S = require('./vo-services');
const L = require('./vo-linkedin');
const M = require('./vo-messages');
const E = require('./vo-email');
const { logActivity } = require('./db');
const { sendSms } = require('./sms');

// SMS alerts to the mobiles in Settings (vo_config 'alerts'). Each entry can carry a first name: "Aryan +447570944123".
function alertTargets(a) {
  return ((a && a.mobiles) || []).map((line) => { const m = String(line).match(/(\+?\d[\d\s]{8,}\d)/); if (!m) return null; const name = String(line).replace(m[1], '').replace(/[^A-Za-z' -]/g, '').trim(); return { mobile: m[1].replace(/\s+/g, ''), name: name.split(/\s+/)[0] || '' }; }).filter(Boolean);
}
async function smsAll(targets, buildText, base) {
  const out = { sms: 0 };
  for (const t of targets) { try { const r = await sendSms(t.mobile, String(buildText(t)).slice(0, 320), base); if (r && r.ok !== false) out.sms++; } catch (e) { /* SMS is best effort */ } }
  return out;
}
// A reply came in. Default: Positive and Question replies only.
async function replyAlerts(account, p, cls, channel, base) {
  const a = await db.getConfig('alerts', {}) || {}; const targets = alertTargets(a);
  const want = a.all_replies ? true : ['Positive', 'Question'].includes(cls.sentiment);
  if (!targets.length || !want) return { sms: 0 };
  return smsAll(targets, (t) => (t.name ? t.name + ', ' : '') + (cls.sentiment || 'new') + ' reply for ShekiPro from ' + (p.dm_name || 'the contact') + ' at ' + p.brand + ' via ' + (channel || 'LinkedIn') + (cls.summary ? ': ' + cls.summary : '') + '. Next: open SitePounce > Video Outreach > ' + p.brand + ' and answer them.', base);
}
// A connection was accepted: a new lead is waiting for its video.
async function newLeadAlerts(account, p, base) {
  const a = await db.getConfig('alerts', {}) || {}; const targets = alertTargets(a);
  if (!targets.length) return { sms: 0 };
  return smsAll(targets, (t) => (t.name ? t.name + ', ' : '') + 'new ShekiPro connection: ' + (p.dm_name || 'the contact') + ' at ' + p.brand + ' accepted on LinkedIn. Create an AI video for ' + (p.suggested_product_name || 'their hero product') + ', then send it via SitePounce > Video Outreach > Ready to send.', base);
}
// A test text so the numbers are proven before a real lead arrives.
async function testAlerts(account, base) {
  const a = await db.getConfig('alerts', {}) || {}; const targets = alertTargets(a);
  if (!targets.length) return { sms: 0, error: 'No mobiles saved in Settings' };
  return smsAll(targets, (t) => (t.name ? t.name + ', ' : '') + 'this is a test from SitePounce Video Outreach. Real texts will read: "new ShekiPro connection: Dan McCormick at Create accepted on LinkedIn. Create an AI video for Creatine Gummies, then send it via SitePounce > Video Outreach > Ready to send."', base);
}

function snapshot(c) { const o = {}; for (const k of ['name', 'industry', 'keywords', 'countries', 'size_bands', 'store_platform', 'meta_only', 'min_meta_ads', 'video_only', 'min_video_share', 'target_per_run', 'raw_cap', 'cost_cap', 'min_score', 'schedule']) o[k] = c[k]; return o; }

// ---- runs ----
async function startRun(account, actor, campaign, kind) {
  const est = S.estimateRun(campaign);
  const run = await db.createRun(account, campaign.id, kind || 'sourcing', { snapshot: snapshot(campaign), estimate: est, providers: S.providerStatus() });
  await db.touchCampaignRun(campaign.id);
  try { await logActivity(actor, account, 'vo_run_start', campaign.name + ': ' + (kind || 'sourcing') + ' run started (estimate £' + est.total + ')', campaign.name); } catch (e) {}
  return run;
}
async function stepRun(account, actor, run, budgetMs) {
  const campaign = await db.getCampaign(account, run.campaign_id); if (!campaign) { await db.saveRunState(run, R.newState(), 'Failed'); return { done: true, status: 'Failed' }; }
  const store = db.runStore(account, actor, campaign);
  const res = await R.stepRun(store, campaign, run, { budgetMs: budgetMs || 40000, apifyTimeoutSec: Math.max(30, Math.min(240, Math.floor((budgetMs || 40000) / 1000) - 10)) });
  if (res.done) {
    try { await logActivity(actor, account, 'vo_run_done', campaign.name + ': run ' + res.status + ', ' + (res.state.counts.qualified || 0) + ' qualified, ' + (res.state.counts.disqualified || 0) + ' disqualified, £' + Number(res.state.cost || 0).toFixed(2) + (res.state.stop ? ' (' + res.state.stop + ')' : ''), campaign.name); } catch (e) {}
    const auto = campaign.automation || {};
    if (auto.notify_run_finished) E.notifyOwner('Video Outreach run finished: ' + campaign.name, 'Run ' + run.id + ' ' + res.status + '.\n\nQualified: ' + (res.state.counts.qualified || 0) + '\nParked: ' + (res.state.counts.parked || 0) + '\nDisqualified: ' + (res.state.counts.disqualified || 0) + '\nCost: £' + Number(res.state.cost || 0).toFixed(2) + '\n' + (res.state.stop || '') + '\n\nOpen SitePounce > Video Outreach to see them.');
  }
  return res;
}
async function continueRuns(account, actor, budgetMs) {
  const started = Date.now(); const out = [];
  for (const run of await db.runningRuns(account, { idleOnly: true })) {
    const left = (budgetMs || 200000) - (Date.now() - started); if (left < 8000) break;
    if (!(await db.claimRun(run.id))) continue; // someone else (the UI) is stepping it right now
    const res = await stepRun(account, actor, run, Math.min(left - 3000, 240000));
    out.push({ run: run.id, status: res.status, processed: res.state && res.state.counts ? res.state.counts.processed : 0 });
  }
  return out;
}
// Scheduled campaigns (Daily / Weekly / Monthly) start a run when due; end conditions finish them.
async function startScheduled(account, actor, now) {
  const started = [];
  for (const c of await db.scheduledCampaigns(account)) {
    const end = c.end_condition || {};
    if (end.until_total && Number(c.found) >= Number(end.until_total)) { await db.finishCampaign(c.id, 'Finished: reached ' + end.until_total + ' prospects'); continue; }
    if (end.until_date && new Date(end.until_date) < new Date(now || Date.now())) { await db.finishCampaign(c.id, 'Finished: end date ' + String(end.until_date).slice(0, 10) + ' passed'); continue; }
    if (!db.scheduleDue(c, now || new Date())) continue;
    const run = await startRun(account, actor, c, 'scheduled'); started.push({ campaign: c.id, run: run.id });
  }
  return started;
}
// Re-check cadence: pull fresh ad counts for the oldest-checked prospects and re-score them.
async function recheck(account, actor, limit, opts) {
  const o = opts || {}; const out = [];
  for (const p of await db.prospectsDueRecheck(account, limit || 3, o)) {
    try {
      // by page id when we have it (exact, newest 30 ads), else a search on the brand name matched back on domain
      const ads = p.meta_page_id
        ? await S.apifyPageAds(p.meta_page_id, p.country || 'ALL', 30)
        : await S.apifyMetaAds({ keywords: [p.brand], country: p.country || 'US', limit: 100, timeoutSec: 40 });
      const groups = S.groupAds(ads.rows);
      const g = p.meta_page_id ? groups[0] : groups.find((x) => (x.domain && x.domain === p.domain) || (x.page_name && x.page_name.toLowerCase() === String(p.brand).toLowerCase()));
      if (g) await db.updateProspect(account, actor, p.id, { active_meta_ads: g.active_meta_ads, video_ads: g.video_ads, new_ads_30d: g.new_ads_30d, creative_style: g.creative_style });
      await db.markChecked(p.id); out.push({ id: p.id, brand: p.brand, updated: !!g, ads: g ? g.active_meta_ads : null });
    } catch (e) { await db.markChecked(p.id); out.push({ id: p.id, brand: p.brand, error: e.message }); if (/hard limit|403/.test(e.message)) break; }
  }
  return out;
}

// ---- email (4.8) ----
async function sendEmail(account, actor, id, kind, base) {
  const p = await db.getProspect(account, id); if (!p) throw new Error('Prospect not found');
  const campaign = await db.getCampaign(account, p.campaign_id); const profile = await db.serviceProfile(campaign);
  const k = kind === 'message_b' ? 'message_b' : 'message_a';
  const text = k === 'message_a' ? p.message_a : p.message_b;
  if (!text) throw new Error('No message text on this prospect yet');
  if (k === 'message_a' && !p.video_url) throw new Error('Paste the video URL first, Message A goes out with the link in it');
  const r = await E.sendProspectEmail({ to: p.dm_email, toName: p.dm_name, kind: k, text: text, prospect: p, profile: profile, base: base });
  if (!r.ok) throw new Error(r.error);
  await db.markEmail(p.id, 'sent');
  const variant = k === 'message_a' ? 'A video sent' : 'B permission';
  if (db.stageAllowed(p.outreach_stage, 'Msg 1')) await db.setStage(account, actor, id, 'Msg 1', { channel: 'Email', variant_used: variant, note: 'Email sent to ' + p.dm_email + ': ' + r.subject });
  else await db.addEvent(account, actor, p, { channel: 'Email', step: 'Email sent', template: variant, sample_sent: k === 'message_a', detail: r.subject });
  await db.scheduleFollowups(account, actor, p, 'Email');
  return { ok: true, subject: r.subject, from: r.from };
}
async function sendFollowup(account, actor, task, base) {
  const p = await db.getProspect(account, task.id); if (!p) throw new Error('Prospect not found');
  const campaign = await db.getCampaign(account, p.campaign_id); const profile = await db.serviceProfile(campaign);
  const g = M.generate(p, profile, p.video_url || null, campaign && campaign.template_set);
  const which = /2/.test(task.next_action || '') ? 'followup_2' : 'followup_1';
  const text = g[which]; const stage = which === 'followup_1' ? 'Follow-up 1' : 'Follow-up 2';
  if (task.channel === 'Email') { const r = await E.sendProspectEmail({ to: p.dm_email, toName: p.dm_name, kind: which, text: text, prospect: p, profile: profile, base: base }); if (!r.ok) throw new Error(r.error); }
  else {
    const P = L.provider(); if (!P) throw new Error('LinkedIn automation is off (VO_LINKEDIN_PROVIDER)');
    const r = await P.sendMessage(p.linkedin_provider_id, text, p.linkedin_chat_id); if (!r.ok) throw new Error(r.error || 'provider refused');
    await db.setLinkedinIds(p.id, { chat_id: r.chat_id });
  }
  if (db.stageAllowed(p.outreach_stage, stage)) await db.setStage(account, actor, p.id, stage, { channel: task.channel || 'LinkedIn', note: stage + ' sent' });
  else await db.addEvent(account, actor, p, { channel: task.channel || 'LinkedIn', step: stage + ' sent', detail: text.slice(0, 200) });
  await db.completeFollowup(task.event_id);
  return { ok: true, stage: stage };
}
async function autoFollowups(account, actor, base) {
  const out = [];
  for (const t of await db.dueFollowups(account)) {
    const c = await db.getCampaign(account, t.campaign_id); const auto = (c && c.automation) || {};
    if (!auto.auto_followups) continue;
    if (t.channel === 'Email' && !t.dm_email) continue;
    if (t.channel !== 'Email' && !L.enabled()) continue;
    try { out.push(Object.assign({ brand: t.brand }, await sendFollowup(account, actor, t, base))); } catch (e) { out.push({ brand: t.brand, error: e.message }); }
  }
  return out;
}

// ---- LinkedIn (4.9) ----
async function logCall(account, actor, what, detail) { try { await logActivity(actor, account, 'vo_linkedin_call', what + (detail ? ': ' + detail : '')); } catch (e) {} }
async function pauseLinkedin(account, actor, why) {
  const s = await db.linkedinSettings(); await db.setConfig('linkedin', Object.assign({}, s, { paused: true, paused_reason: why, paused_at: new Date().toISOString() }));
  await logCall(account, actor, 'PAUSED', why);
  E.notifyOwner('Video Outreach: LinkedIn automation paused', 'The LinkedIn provider reported: ' + why + '\n\nAll automatic requests and messages are paused. Open SitePounce > Video Outreach > Settings to review and resume.');
}
function startOfDay() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); }
function startOfWeek() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString(); }
async function linkedinTick(account, actor, now, opts) {
  const o = opts || {};
  const P = L.provider(); if (!P || !P.configured()) return { enabled: false };
  const s = await db.linkedinSettings(); const lim = L.limits(s);
  const out = { enabled: true, paused: !!s.paused, accepted: 0, pending: 0, withdrawn: 0, replies: 0, requests: 0, skipped: '' };
  if (s.paused) return out;
  const t = now || new Date();
  // 2. acceptance detection, Pending after 7 days, withdraw after 21 days
  try {
    const accepted = new Set((await P.listAccepted()).map((x) => String(x.provider_id)));
    await logCall(account, actor, 'listAccepted', accepted.size + ' relations');
    for (const p of await db.appliedProspects(account)) {
      const age = (t - new Date(p.linkedin_request_sent_at || p.updated_at)) / 86400000;
      if (p.linkedin_provider_id && accepted.has(String(p.linkedin_provider_id))) {
        await db.setConnectionState(account, actor, p.id, 'Connected', { note: 'Acceptance detected by the provider' });
        await db.updateProspect(account, actor, p.id, { observation: p.observation || '' }); // 3. regenerate the draft with the latest observation
        try { await newLeadAlerts(account, p, o.base); } catch (e) {}
        E.notifyOwner('New ShekiPro connection: ' + p.brand + ' accepted on LinkedIn', (p.dm_name || 'The contact') + ' at ' + p.brand + ' accepted the connection request.\n\nCreate the AI video for ' + (p.suggested_product_name || 'their hero product') + ', then open SitePounce > Video Outreach > Ready to send, paste the link and click Send.');
        out.accepted++;
      } else if (age > 21 && p.linkedin_connection_state !== null) {
        if (p.linkedin_invitation_id) { await P.withdraw(p.linkedin_invitation_id); await logCall(account, actor, 'withdraw', p.brand); }
        const keep = await db.usedOtherChannel(p.id);
        await db.setConnectionState(account, actor, p.id, null, { note: 'No acceptance after 21 days, request withdrawn', keepStage: keep });
        out.withdrawn++;
      } else if (age > 7 && p.linkedin_connection_state === 'Applied') { await db.setConnectionState(account, actor, p.id, 'Pending', { note: 'No answer after 7 days' }); out.pending++; }
    }
  } catch (e) { out.error_accept = e.message; }
  // 5. replies (polling; a webhook can call the same recordReply later)
  try {
    const since = s.last_poll || new Date(t - 2 * 86400000).toISOString();
    const msgs = await P.fetchNewMessages(since); await logCall(account, actor, 'fetchNewMessages', msgs.length + ' new');
    for (const m of msgs) {
      const p = await db.prospectByProviderId(account, m.provider_id); if (!p) continue;
      const cls = await S.classifyReply(m.text, { brand: p.brand });
      await db.recordReply(account, actor, p.id, m.text, m.at, cls); if (m.chat_id) await db.setLinkedinIds(p.id, { chat_id: m.chat_id });
      out.replies++;
      try { await replyAlerts(account, p, cls, 'LinkedIn', o.base); } catch (e) {}
      E.notifyOwner((cls.sentiment || 'New') + ' reply from ' + p.brand + (p.dm_name ? ' (' + p.dm_name + ')' : ''), (p.dm_name || 'Someone') + ' at ' + p.brand + ' replied on LinkedIn.\n\nReading: ' + (cls.sentiment || 'Neutral') + (cls.summary ? ', ' + cls.summary : '') + '\n\nTheir message:\n' + String(m.text || '').slice(0, 1500) + '\n\nNothing has been sent back. Open SitePounce > Video Outreach > the prospect to answer.');
    }
    await db.setConfig('linkedin', Object.assign({}, await db.linkedinSettings(), { last_poll: t.toISOString() }));
  } catch (e) { out.error_replies = e.message; }
  // 1. connection queue: one request per tick (the cron runs every 10 minutes, which spaces sends naturally), weekdays 8am to 6pm US Eastern, under the caps
  if (!L.inSendWindow(t, s.timezone)) { out.skipped = 'outside the send window'; return out; }
  const today = await db.countLinkedinSince(account, ['Request sent'], startOfDay()); const week = await db.countLinkedinSince(account, ['Request sent'], startOfWeek());
  if (today >= lim.daily_requests) { out.skipped = 'daily request cap reached (' + today + ')'; return out; }
  if (week >= lim.weekly_requests) { out.skipped = 'weekly request cap reached (' + week + ')'; return out; }
  for (const p of await db.linkedinQueue(account, lim.max_priority, 1)) {
    try {
      let pid = p.linkedin_provider_id;
      if (!pid) { const who = await P.lookup(p.dm_linkedin); pid = who.provider_id; await db.setLinkedinIds(p.id, { provider_id: pid }); await logCall(account, actor, 'lookup', p.dm_linkedin); }
      const r = await P.sendInvitation(pid, p.connection_note || ''); await logCall(account, actor, 'sendInvitation', p.brand + ' ' + (r.ok ? 'ok' : r.error));
      if (!r.ok) { if (r.restricted) { await pauseLinkedin(account, actor, r.error || 'account restricted'); } out.error_send = r.error; break; }
      await db.setLinkedinIds(p.id, { invitation_id: r.invitation_id });
      await db.setConnectionState(account, actor, p.id, 'Applied', { note: 'Connection request sent automatically' });
      out.requests++;
    } catch (e) { out.error_send = e.message; }
  }
  return out;
}
// 4. Ready to send: human in the loop, always. Needs a pasted https URL and a click.
async function linkedinSend(account, actor, id, url, text) {
  const P = L.provider(); if (!P || !P.configured()) throw new Error('LinkedIn automation is off (set VO_LINKEDIN_PROVIDER and the provider keys in Vercel)');
  const p = await db.getProspect(account, id); if (!p) throw new Error('Prospect not found');
  if (p.linkedin_connection_state !== 'Connected') throw new Error('Not connected yet, the message can only go to an accepted connection');
  const u = String(url || p.video_url || '').trim(); if (!/^https:\/\/\S+$/i.test(u)) throw new Error('Paste an https:// video URL first');
  try { const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 5000); const r = await fetch(u, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' }); clearTimeout(tm); if (r.status >= 400) throw new Error('The video URL answered HTTP ' + r.status); } catch (e) { if (/HTTP \d/.test(e.message)) throw e; /* HEAD blocked by some hosts, allow */ }
  let p2 = await db.setVideoUrl(account, actor, id, u);
  const body = String(text || p2.message_a || '').trim(); if (!body) throw new Error('Nothing to send');
  const chk = M.postCheck(body, { kind: 'message_a', video_url: u, profile: await db.serviceProfile(await db.getCampaign(account, p.campaign_id)) }); if (!chk.ok) throw new Error('Message check failed: ' + chk.errors.join('; '));
  let pid = p2.linkedin_provider_id; if (!pid) { const who = await P.lookup(p2.dm_linkedin); pid = who.provider_id; await db.setLinkedinIds(id, { provider_id: pid }); }
  const s = await db.linkedinSettings(); const lim = L.limits(s);
  const today = await db.countLinkedinSince(account, ['Msg 1', 'Follow-up 1', 'Follow-up 2', 'LinkedIn message'], startOfDay());
  if (today >= lim.daily_messages) throw new Error('Daily LinkedIn message cap reached (' + today + ')');
  const r = await P.sendMessage(pid, body, p2.linkedin_chat_id); await logCall(account, actor, 'sendMessage', p2.brand + ' ' + (r.ok ? 'ok' : r.error));
  if (!r.ok) { if (r.restricted) await pauseLinkedin(account, actor, r.error || 'account restricted'); throw new Error(r.error || 'The provider refused the message'); }
  await db.setLinkedinIds(id, { chat_id: r.chat_id });
  if (body !== p2.message_a) p2 = await db.updateProspect(account, actor, id, { message_a: body });
  if (db.stageAllowed(p2.outreach_stage, 'Msg 1')) await db.setStage(account, actor, id, 'Msg 1', { channel: 'LinkedIn', variant_used: 'A video sent', note: 'Message A sent through ' + P.name });
  else await db.addEvent(account, actor, p2, { channel: 'LinkedIn', step: 'LinkedIn message', template: 'A video sent', sample_sent: true, detail: body.slice(0, 200) });
  await db.scheduleFollowups(account, actor, p2, 'LinkedIn');
  return { ok: true, chat_id: r.chat_id };
}

async function tick(account, actor, opts) {
  const o = opts || {}; const base = o.base; const summary = { account: account };
  try { summary.scheduled = await startScheduled(account, actor, o.now); } catch (e) { summary.scheduled_error = e.message; }
  try { summary.runs = await continueRuns(account, actor, o.runBudgetMs || 200000); } catch (e) { summary.runs_error = e.message; }
  try { summary.recheck = await recheck(account, actor, 3); } catch (e) { summary.recheck_error = e.message; }
  try { summary.linkedin = await linkedinTick(account, actor, o.now, { base: base }); } catch (e) { summary.linkedin_error = e.message; }
  try { summary.followups = await autoFollowups(account, actor, base); } catch (e) { summary.followups_error = e.message; }
  return summary;
}

module.exports = { replyAlerts, newLeadAlerts, testAlerts, startRun, stepRun, continueRuns, startScheduled, recheck, sendEmail, sendFollowup, autoFollowups, linkedinTick, linkedinSend, pauseLinkedin, tick };

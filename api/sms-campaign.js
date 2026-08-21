// SMS campaigns (owner-only). Audience comes from SEARCH CRITERIA over the call list, not
// hand-ticking: industry / location / status / prowled / not-already-messaged, capped at a max.
// POST action=preview -> who matches, with counts and a cost estimate. Nothing is saved.
// POST action=create  -> snapshot the audience into a campaign for the worker to run.
// POST action=pause|resume|cancel, GET -> campaigns + replies, GET ?id= -> one campaign's items.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ukMobile, smsConfigured, sendSms, listMessagesTo } = require('../lib/sms');
const { buildAudience } = require('../lib/smsaudience');
const { limitFor } = require('../lib/ratelimit');
const { todayKey, londonHour } = require('../lib/digest');
const { getDailyUsage, bumpDailyUsage, logActivity } = require('../lib/db');
const { createCampaign, listCampaigns, campaignItems, setCampaignStatus, sentKeys, optoutSet, optoutCounts, dedupeInbound, hourlyBreakdown, byIndustry, stopTrend, rangeStats, metricRecords, messageStats, addMsg, setCampaignMessage, journey, listInbound, readyToCall, leadTimeline, lastSendNumber, markFunnelSiteByLead, backfillFunnel, funnelSitesNeedingDelivery, setFunnelDeliveryById } = require('../lib/smsdb');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

// Actions a regular SMS team member may NOT do directly: raising send volume. They are blocked and
// offered "do the safe thing, or submit for approval". Owners and designated approvers bypass this.
const GUARDED = { boostToday: 'Raise today\'s send cap (+50)', resumeCold: 'Override the STOP-rate auto-pause' };

// Approvers are kept in their OWN store (not the team-permission system, whose keys default to
// ALLOW). The owner is always an approver; others are added by email here.
async function readApprovers() { const j = await readJson('sms/_approvers.json'); return (j && Array.isArray(j.emails)) ? j.emails.map((e) => String(e).toLowerCase()) : []; }
async function isApproverEmail(email) { if (isComped(email)) return true; const list = await readApprovers(); return list.includes(String(email || '').toLowerCase()); }
async function readNumbers() { const j = await readJson('sms/_numbers.json'); return (j && Array.isArray(j.numbers)) ? j.numbers : []; }
async function readApprovals() { const j = await readJson('sms/_approvals.json'); return (j && Array.isArray(j.requests)) ? j.requests : []; }
async function writeApprovals(reqs) { try { await put('sms/_approvals.json', JSON.stringify({ requests: reqs }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* best effort */ } }

// The two guarded actions, as reusable helpers so the direct path (approver) and the approval path
// run identical logic.
async function doBoostToday(step, by) {
  const day = todayKey(new Date());
  const cur = (await readJson('sms/_capboost.json')) || {};
  const base = (cur.day === day && Number(cur.extra) > 0) ? Number(cur.extra) : 0;
  const extra = Math.min(base + Math.min(Math.max(Number(step) || 50, 1), 100), 400);
  await put('sms/_capboost.json', JSON.stringify({ day: day, extra: extra, by: by || '', at: new Date().toISOString() }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  return { extra: extra };
}
async function doResumeCold(by) {
  await put('sms/_breaker.json', JSON.stringify({ clearedAt: new Date().toISOString(), clearedBy: by || '' }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  // SMS is usable by the owner and by team members who have the 'sms' permission (default on,
  // the owner can switch it off per person in Team).
  const canSms = isComped(acct.email) || (acct.member && acct.perms && acct.perms.sms !== false);
  if (!canSms) { res.status(403).json({ error: 'You do not have SMS access. Ask your admin to switch it on.' }); return; }
  const approver = await isApproverEmail(acct.email);

  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.id) { res.status(200).json({ items: await campaignItems(Number(q.id)) }); return; }
    // Ready-to-call = positive repliers you have NOT yet dealt with (still Interested-ish). Once
    // you book/dismiss them their status moves on and they drop off, so the green badge self-clears.
    // We KEEP dealt-with leads in the list (tagged with their status) so the call-list tabs
    // (Not interested / Callback / Booked ...) have something to show. The green "to call" badge
    // counts only leads with NO status yet (brand new positive repliers), so it still self-clears
    // the moment you disposition someone.
    const idx = (await readJson('notes/_index.json')) || {};
    const callAll = (await readyToCall(200)).map((r) => Object.assign({}, r, { status: (idx[r.key] && idx[r.key].status) || '' }));
    const readyCount = callAll.filter((r) => !r.status).length; // untouched "to call" only
    if (q.count) { res.status(200).json({ readyCount: readyCount }); return; }
    // Cheap poll for the global "hot lead" flasher: how many leads replied AFTER their auto-built site.
    if (q.hot) {
      const hot = Object.keys(idx).filter((k) => (idx[k] && idx[k].status) === 'site-reply');
      res.status(200).json({ hot: hot.length });
      return;
    }
    if (q.hourly) {
      const hto = q.hto ? String(q.hto) : new Date(Date.now() + 86400000).toISOString();
      const hfrom = q.hfrom ? String(q.hfrom) : new Date(Date.now() - 30 * 86400000).toISOString();
      res.status(200).json({ hourly: await hourlyBreakdown(hfrom, hto), industry: await byIndustry(hfrom, hto), stopTrend: await stopTrend(14), messages: await messageStats(), today: todayKey(new Date()) });
      return;
    }
    if (q.statsFrom && q.statsTo) { res.status(200).json({ totals: await rangeStats(String(q.statsFrom), String(q.statsTo)) }); return; }
    if (q.metric) { res.status(200).json({ records: await metricRecords(String(q.metric), String(q.mfrom || '1970-01-01'), String(q.mto || '9999-01-01'), 400) }); return; }
    const oc = await optoutCounts();
    const brake = (await readJson('sms/_breaker.json')) || {};
    const brakeActive = brake.until && new Date(brake.until).getTime() > Date.now();
    const day = todayKey(new Date());
    const boost = (await readJson('sms/_capboost.json')) || {};
    const capExtra = (boost.day === day && Number(boost.extra) > 0) ? Number(boost.extra) : 0;
    const dailyCap = await limitFor('sms', acct.email);
    const sentToday = await getDailyUsage(acct.email, 'sms', day);
    const funnelCfg = (await readJson('sms/_funnel.json')) || {};
    res.status(200).json({
      campaigns: await listCampaigns(),
      replies: await listInbound(100),
      journey: q.light ? undefined : await journey(200), // heavy join, skipped on the frequent poll
      callNow: callAll.slice(0, 200),
      readyCount: readyCount,
      stopCount: oc.reply,            // STOP texts, the number carriers police
      linkOptouts: oc.link,           // soft opt-outs (a tap on the link) - proof it works
      brake: brakeActive ? { paused: true, until: brake.until, rate: brake.rate, stops: brake.stops, sent: brake.sent } : { paused: false },
      dailyCap: dailyCap,
      capExtra: capExtra,
      sentToday: sentToday,
      isOwner: isComped(acct.email),
      isApprover: approver,
      primaryNumber: process.env.TWILIO_FROM || '',
      sender: process.env.SMS_SENDER || 'Sophie',
      funnelEnabled: funnelCfg.enabled === true,
      funnelAlertMobile: funnelCfg.alertMobile || '',
      numbers: await readNumbers(),
      approvals: approver ? (await readApprovals()).filter((r) => r.status === 'pending') : [],
      approvers: isComped(acct.email) ? await readApprovers() : undefined,
      twilioReady: smsConfigured(),
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || '');

  // GUARDRAIL: a non-approver hitting a volume action is blocked and told to use the safe option or
  // request approval. It does NOT execute here.
  if (GUARDED[action] && !approver) {
    res.status(200).json({ needsApproval: true, action: action, label: GUARDED[action] });
    return;
  }

  // A team member asks an approver to sign off a guarded action.
  if (action === 'submitApproval') {
    const reqAction = String(body.reqAction || '');
    if (!GUARDED[reqAction]) { res.status(400).json({ error: 'Unknown request.' }); return; }
    const reqs = await readApprovals();
    reqs.unshift({ id: 'ap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), by: acct.email, action: reqAction, label: GUARDED[reqAction], payload: (body.payload && typeof body.payload === 'object') ? body.payload : {}, reason: String(body.reason || '').slice(0, 300), status: 'pending', at: new Date().toISOString() });
    await writeApprovals(reqs.slice(0, 200));
    res.status(200).json({ ok: true });
    return;
  }
  // An approver approves or denies a pending request; approval runs the action.
  if (action === 'decideApproval') {
    if (!approver) { res.status(403).json({ error: 'Approvers only.' }); return; }
    const reqs = await readApprovals();
    const r = reqs.find((x) => x.id === body.id);
    if (!r || r.status !== 'pending') { res.status(400).json({ error: 'Already handled or not found.' }); return; }
    if (body.decision === 'approve') {
      try {
        if (r.action === 'boostToday') await doBoostToday((r.payload && r.payload.step) || 50, acct.email);
        else if (r.action === 'resumeCold') await doResumeCold(acct.email);
      } catch (e) { res.status(500).json({ error: 'Could not run the approved action.' }); return; }
      r.status = 'approved';
    } else { r.status = 'denied'; }
    r.decidedBy = acct.email; r.decidedAt = new Date().toISOString();
    await writeApprovals(reqs);
    res.status(200).json({ ok: true, status: r.status });
    return;
  }
  // Owner manages the SENDING NUMBER pool (add/remove, set each number's own daily cap for warm-up).
  if (action === 'manageNumbers') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    let nums = await readNumbers();
    const phone = String(body.phone || '').replace(/[^0-9+]/g, '').trim();
    if (body.op === 'add' && phone) {
      if (!nums.find((n) => n.phone === phone)) nums.push({ phone: phone, label: String(body.label || '').slice(0, 40), cap: Math.min(Math.max(Number(body.cap) || 20, 1), 1000), addedAt: new Date().toISOString() });
    } else if (body.op === 'remove' && phone) {
      nums = nums.filter((n) => n.phone !== phone);
    } else if (body.op === 'setcap' && phone) {
      const n = nums.find((x) => x.phone === phone); if (n) n.cap = Math.min(Math.max(Number(body.cap) || 1, 1), 1000);
    }
    try { await put('sms/_numbers.json', JSON.stringify({ numbers: nums }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not save numbers.' }); return; }
    res.status(200).json({ ok: true, numbers: nums });
    return;
  }

  // Owner manages the approver list (add/remove by email).
  if (action === 'manageApprovers') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    let list = await readApprovers();
    const email = String(body.email || '').toLowerCase().trim();
    if (body.op === 'add' && email) list = Array.from(new Set(list.concat(email)));
    if (body.op === 'remove' && email) list = list.filter((e) => e !== email);
    try { await put('sms/_approvers.json', JSON.stringify({ emails: list }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not save approvers.' }); return; }
    res.status(200).json({ ok: true, approvers: list });
    return;
  }

  if (action === 'preview') {
    const a = await buildAudience(body.filters);
    res.status(200).json({
      count: a.items.length,
      matched: a.matched,
      capped: a.matched > a.items.length,
      scanned: a.scanned,
      skipped: a.skipped,
      sample: a.items.slice(0, 12),
      // rough money: every recipient gets a freshly generated mockup + one SMS segment
      estMockups: a.items.length,
      twilioReady: smsConfigured(),
    });
    return;
  }

  if (action === 'create') {
    const mode = body.mode === 'ask' ? 'ask' : 'link';
    const message = String(body.message || '').trim().slice(0, 480);
    const linkMessage = String(body.linkMessage || '').trim().slice(0, 480);
    if (!message) { res.status(400).json({ error: 'Write the message first.' }); return; }
    if (mode === 'link' && message.indexOf('{link}') < 0) { res.status(400).json({ error: 'The message must contain {link}, that is where the mockup goes.' }); return; }
    if (mode === 'ask') {
      if (message.indexOf('{link}') >= 0) { res.status(400).json({ error: 'Ask-first mode: the FIRST message must not contain {link}, the link goes in the follow-up.' }); return; }
      if (!linkMessage || linkMessage.indexOf('{link}') < 0) { res.status(400).json({ error: 'Write the auto-send follow-up, and it must contain {link}.' }); return; }
    }
    const evergreen = !!body.evergreen;
    // nudges: an ordered list. Back-compat: a single nudgeMessage/nudgeHours becomes the first one.
    let nudges = Array.isArray(body.nudges) ? body.nudges : [];
    if (!nudges.length && String(body.nudgeMessage || '').trim()) nudges = [{ message: body.nudgeMessage, hours: body.nudgeHours }];
    for (const n of nudges) {
      if (n && n.message && mode === 'ask' && String(n.message).indexOf('{link}') >= 0) {
        res.status(400).json({ error: 'A nudge goes to people who have not said yes, so it cannot contain {link} in ask-first mode.' }); return;
      }
    }
    // sending number is now MANDATORY: must be the default number or one in the pool
    const fromNumber = String(body.fromNumber || '').replace(/[^0-9+]/g, '').trim();
    if (!fromNumber) { res.status(400).json({ error: 'Choose which number to send from first.' }); return; }
    if (fromNumber !== (process.env.TWILIO_FROM || '') && !(await readNumbers()).find((n) => n.phone === fromNumber)) {
      res.status(400).json({ error: 'That sending number is not in your pool.' }); return;
    }
    const a = await buildAudience(body.filters);
    if (!a.items.length) { res.status(400).json({ error: 'Nobody matches those criteria.' }); return; }
    const when = body.scheduleAt ? new Date(body.scheduleAt) : new Date();
    if (isNaN(when.getTime())) { res.status(400).json({ error: 'That schedule date does not parse.' }); return; }
    const id = await createCampaign({
      createdBy: acct.email,
      name: String(body.name || '').trim().slice(0, 120) || ('Campaign ' + new Date().toISOString().slice(0, 10)),
      message: message,
      filters: body.filters || {},
      scheduleAt: when.toISOString(),
      items: a.items,
      mode: mode,
      linkMessage: linkMessage,
      linkDelayMin: body.linkDelayMin,
      nudges: nudges,
      evergreen: evergreen,
      fromNumber: fromNumber,
    });
    if (!id) { res.status(500).json({ error: 'Could not save the campaign.' }); return; }
    if (body.hold) { await setCampaignStatus(id, 'paused'); } // built but held: no sends until resumed
    res.status(200).json({ ok: true, id: id, count: a.items.length, skipped: a.skipped, held: !!body.hold });
    return;
  }

  if (action === 'test') {
    if (!smsConfigured()) { res.status(400).json({ error: 'Twilio keys are not set yet.' }); return; }
    const mob = ukMobile(body.phone);
    if (!mob) { res.status(400).json({ error: 'That is not a valid UK mobile (07... or +447...).' }); return; }
    const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';
    const r = await sendSms(mob, 'Site Pounce test: your SMS is working. Reply anything and it will show in Admin > SMS. Reply STOP to opt out.', base);
    if (r.ok) res.status(200).json({ ok: true });
    else res.status(200).json({ error: 'Twilio refused it: ' + (r.error || 'unknown') });
    return;
  }

  if (action === 'sendSite') {
    // One-off manual SMS to a lead who has already replied (e.g. "here's the website we built").
    // Not a campaign, so it does not touch the daily cap, but it still respects opt-outs.
    if (!smsConfigured()) { res.status(400).json({ error: 'Twilio keys are not set yet.' }); return; }
    const mob = ukMobile(body.phone);
    if (!mob) { res.status(400).json({ error: 'That is not a valid UK mobile number.' }); return; }
    const message = String(body.message || '').trim().slice(0, 640);
    if (!message) { res.status(400).json({ error: 'Write a message first.' }); return; }
    try { const outs = await optoutSet(); if (outs.has(mob)) { res.status(400).json({ error: 'That number has opted out, we cannot text them.' }); return; } } catch (e) { /* fail open on the opt-out check */ }
    const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';
    // Reuse the number this lead was originally messaged from, so the follow-up stays in the same
    // thread on their phone. Fall back to an explicit choice, then the primary number.
    const nums = await readNumbers();
    const original = await lastSendNumber(mob, String(body.key || ''));
    const fromNum = original || ((body.fromNumber && nums.some((n) => n.phone === body.fromNumber)) ? body.fromNumber : (process.env.TWILIO_FROM || ''));
    const r = await sendSms(mob, message, base, fromNum);
    if (!r.ok) { res.status(200).json({ error: 'Twilio refused it: ' + (r.error || 'unknown') }); return; }
    try { await bumpDailyUsage(acct.email, 'cost:sms', 1, todayKey(new Date())); } catch (e) {}
    try { await logActivity(acct.email, acct.email, 'message_sent', (body.name || mob) + ' (website link)', body.name || mob); } catch (e) {}
    try { await markFunnelSiteByLead(mob, String(body.key || ''), ''); } catch (e) {} // stop the auto-funnel double-sending
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'manageFunnel') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    const cur = (await readJson('sms/_funnel.json')) || {};
    let changed = false;
    if (body.enabled !== undefined) { cur.enabled = !!body.enabled; changed = true; }
    if (body.alertMobile !== undefined) { cur.alertMobile = String(body.alertMobile || '').trim().slice(0, 24); changed = true; }
    if (changed) {
      cur.at = new Date().toISOString(); cur.by = acct.email;
      try { await put('sms/_funnel.json', JSON.stringify(cur), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
      catch (e) { res.status(500).json({ error: 'Could not save.' }); return; }
    }
    res.status(200).json({ ok: true, enabled: !!cur.enabled, alertMobile: cur.alertMobile || '' });
    return;
  }

  if (action === 'funnelDeliveryBackfill') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    // One-off: look up each older auto-send in Twilio (by number) and record its real delivery status.
    const items = await funnelSitesNeedingDelivery(40);
    let updated = 0;
    for (const it of items) {
      const msgs = await listMessagesTo(it.phone, 50);
      if (!msgs.length) continue;
      const target = it.funnel_site_at ? new Date(it.funnel_site_at).getTime() : 0;
      const slug = String(it.slug || '');
      let best = null, bestScore = Infinity;
      for (const m of msgs) {
        if (String(m.direction || '').indexOf('outbound') < 0 || !m.status) continue;
        const t = m.dateSent ? new Date(m.dateSent).getTime() : 0;
        const dt = Math.abs(t - target);
        const hasSlug = slug && m.body && m.body.indexOf(slug) >= 0;
        const hasSite = m.body && m.body.indexOf('/s/') >= 0;
        const score = (hasSlug ? 0 : (hasSite ? 300000 : 3600000)) + dt; // prefer exact site link, then any site link, then closest time
        if (score < bestScore) { bestScore = score; best = m; }
      }
      if (best && bestScore < 2 * 3600000) { await setFunnelDeliveryById(it.id, best.status, best.sid); updated++; }
    }
    res.status(200).json({ ok: true, checked: items.length, updated: updated });
    return;
  }

  if (action === 'funnelBackfill') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    // Catch up: build + send to everyone who already replied positive but never went through the
    // funnel. Skip anyone already dispositioned to a terminal / not-interested status.
    const idx = (await readJson('notes/_index.json')) || {};
    const TERMINAL = { 'not-interested': 1, declined: 1, lost: 1, dnd: 1, 'invalid-phone': 1, won: 1, 'meeting-booked': 1, 'appointment-link-sent': 1 };
    const excludeKeys = Object.keys(idx).filter((k) => TERMINAL[(idx[k] && idx[k].status) || '']);
    if (body.run) {
      const queued = await backfillFunnel(excludeKeys, true);
      res.status(200).json({ ok: true, queued: queued });
    } else {
      const count = await backfillFunnel(excludeKeys, false);
      res.status(200).json({ ok: true, count: count });
    }
    return;
  }

  if (action === 'timeline') {
    // Full audit trail for one lead: sends + replies + opens (DB), merged with notes + built site (blobs).
    const phone = String(body.phone || '').trim();
    const rawKey = String(body.key || '').trim();
    const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
    const keyClean = rawKey.replace(/[^a-z0-9-]/gi, '').slice(0, 120); // notes/<key>.json is stored slug-safe
    const t = await leadTimeline(phone, rawKey, slug);
    const notes = keyClean ? await readJson('notes/' + keyClean + '.json') : null;
    const siteRaw = slug ? await readJson('sites/' + slug + '.json') : null;
    let site = null;
    if (siteRaw) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
      const url = (siteRaw.mode === 'published' && siteRaw.subdomain) ? `https://${siteRaw.subdomain}.aiwebpoint.com` : `${linkBase}/s/${slug}`;
      site = { createdAt: siteRaw.createdAt || '', mode: siteRaw.mode || 'preview', url: url };
    }
    res.status(200).json({ timeline: t, notes: notes, site: site });
    return;
  }

  if (action === 'implementMsg') {
    // start a new opener EXPERIMENT: log a new message version and point the campaign at it, so
    // future sends use it and are tracked separately. Keeps the full history intact.
    const cid = Number(body.campaignId);
    const text = String(body.text || '').trim().slice(0, 480);
    if (!cid) { res.status(400).json({ error: 'Which campaign?' }); return; }
    if (!text) { res.status(400).json({ error: 'Write the new message first.' }); return; }
    // schedule the new version to start on a FRESH day (next 8am), so each experiment runs over
    // whole days and stays comparable. If it is implemented before the window even opens (UK hour
    // < 8), it can start today.
    const nowD = new Date();
    const today = todayKey(nowD);
    const tomorrow = todayKey(new Date(nowD.getTime() + 24 * 3600 * 1000));
    const startDay = londonHour(nowD) < 8 ? today : tomorrow;
    const vid = await addMsg(cid, text, acct.email, startDay);
    if (!vid) { res.status(500).json({ error: 'Could not save the new version.' }); return; }
    res.status(200).json({ ok: true, id: vid, startDay: startDay, startsToday: startDay === today });
    return;
  }

  if (action === 'dedupeReplies') {
    const n = await dedupeInbound();
    res.status(200).json({ ok: true, removed: n });
    return;
  }

  if (action === 'boostToday') {
    // one-day-only bump to today's send cap (approver/owner path; members are gated above).
    try { const r = await doBoostToday(body.step || 50, acct.email); res.status(200).json({ ok: true, extra: r.extra }); }
    catch (e) { res.status(500).json({ error: 'Could not raise today\'s cap.' }); }
    return;
  }

  if (action === 'resetBoost') {
    // undo today's cap boost: stamp today with extra 0 so the worker ignores it from the next tick.
    const day = todayKey(new Date());
    try { await put('sms/_capboost.json', JSON.stringify({ day: day, extra: 0, by: acct.email, at: new Date().toISOString() }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not undo the boost.' }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'resumeCold') {
    // manual override of the STOP-rate auto-pause (approver/owner path; members are gated above).
    try { await doResumeCold(acct.email); res.status(200).json({ ok: true }); }
    catch (e) { res.status(500).json({ error: 'Could not lift the pause.' }); }
    return;
  }

  if (action === 'pause' || action === 'resume' || action === 'cancel') {
    const id = Number(body.id);
    if (!id) { res.status(400).json({ error: 'Which campaign?' }); return; }
    const status = action === 'pause' ? 'paused' : (action === 'resume' ? 'running' : 'cancelled');
    await setCampaignStatus(id, status);
    res.status(200).json({ ok: true, status: status });
    return;
  }

  res.status(400).json({ error: 'Unknown action.' });
};

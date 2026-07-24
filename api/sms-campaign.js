// SMS campaigns (owner-only). Audience comes from SEARCH CRITERIA over the call list, not
// hand-ticking: industry / location / status / prowled / not-already-messaged, capped at a max.
// POST action=preview -> who matches, with counts and a cost estimate. Nothing is saved.
// POST action=create  -> snapshot the audience into a campaign for the worker to run.
// POST action=pause|resume|cancel, GET -> campaigns + replies, GET ?id= -> one campaign's items.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ukMobile, smsConfigured, sendSms } = require('../lib/sms');
const { buildAudience } = require('../lib/smsaudience');
const { limitFor } = require('../lib/ratelimit');
const { todayKey, londonHour } = require('../lib/digest');
const { getDailyUsage } = require('../lib/db');
const { createCampaign, listCampaigns, campaignItems, setCampaignStatus, sentKeys, optoutSet, optoutCounts, dedupeInbound, hourlyBreakdown, byIndustry, rangeStats, metricRecords, messageStats, addMsg, setCampaignMessage, journey, listInbound, readyToCall } = require('../lib/smsdb');

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
    const TERMINAL = { 'meeting-booked': 1, 'appointment-link-sent': 1, won: 1, lost: 1, 'not-interested': 1, declined: 1, 'invalid-phone': 1, dnd: 1 };
    const idx = (await readJson('notes/_index.json')) || {};
    const callNow = (await readyToCall(200)).filter((r) => !TERMINAL[(idx[r.key] && idx[r.key].status) || '']);
    if (q.count) { res.status(200).json({ readyCount: callNow.length }); return; }
    if (q.hourly) { res.status(200).json({ hourly: await hourlyBreakdown(30), industry: await byIndustry(), messages: await messageStats(), today: todayKey(new Date()) }); return; }
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
    res.status(200).json({
      campaigns: await listCampaigns(),
      replies: await listInbound(100),
      journey: await journey(200),
      callNow: callNow.slice(0, 50),
      readyCount: callNow.length,
      stopCount: oc.reply,            // STOP texts, the number carriers police
      linkOptouts: oc.link,           // soft opt-outs (a tap on the link) - proof it works
      brake: brakeActive ? { paused: true, until: brake.until, rate: brake.rate, stops: brake.stops, sent: brake.sent } : { paused: false },
      dailyCap: dailyCap,
      capExtra: capExtra,
      sentToday: sentToday,
      isOwner: isComped(acct.email),
      isApprover: approver,
      primaryNumber: process.env.TWILIO_FROM || '',
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

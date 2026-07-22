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
const { todayKey } = require('../lib/digest');
const { createCampaign, listCampaigns, campaignItems, setCampaignStatus, sentKeys, optoutSet, optoutCounts, dedupeInbound, hourlyBreakdown, listInbound, readyToCall } = require('../lib/smsdb');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.id) { res.status(200).json({ items: await campaignItems(Number(q.id)) }); return; }
    // Ready-to-call = positive repliers you have NOT yet dealt with (still Interested-ish). Once
    // you book/dismiss them their status moves on and they drop off, so the green badge self-clears.
    const TERMINAL = { 'meeting-booked': 1, 'appointment-link-sent': 1, won: 1, lost: 1, 'not-interested': 1, declined: 1, 'invalid-phone': 1, dnd: 1 };
    const idx = (await readJson('notes/_index.json')) || {};
    const callNow = (await readyToCall(200)).filter((r) => !TERMINAL[(idx[r.key] && idx[r.key].status) || '']);
    if (q.count) { res.status(200).json({ readyCount: callNow.length }); return; }
    if (q.hourly) { res.status(200).json({ hourly: await hourlyBreakdown(30) }); return; }
    const oc = await optoutCounts();
    const brake = (await readJson('sms/_breaker.json')) || {};
    const brakeActive = brake.until && new Date(brake.until).getTime() > Date.now();
    const day = todayKey(new Date());
    const boost = (await readJson('sms/_capboost.json')) || {};
    const capExtra = (boost.day === day && Number(boost.extra) > 0) ? Number(boost.extra) : 0;
    const dailyCap = await limitFor('sms', acct.email);
    res.status(200).json({
      campaigns: await listCampaigns(),
      replies: await listInbound(100),
      callNow: callNow.slice(0, 50),
      readyCount: callNow.length,
      stopCount: oc.reply,            // STOP texts, the number carriers police
      linkOptouts: oc.link,           // soft opt-outs (a tap on the link) - proof it works
      brake: brakeActive ? { paused: true, until: brake.until, rate: brake.rate, stops: brake.stops, sent: brake.sent } : { paused: false },
      dailyCap: dailyCap,
      capExtra: capExtra,
      twilioReady: smsConfigured(),
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || '');

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
    const nudgeMessage = String(body.nudgeMessage || '').trim().slice(0, 480);
    if (nudgeMessage && mode === 'ask' && nudgeMessage.indexOf('{link}') >= 0) {
      res.status(400).json({ error: 'The nudge goes to people who have not said yes, so it cannot contain {link} in ask-first mode.' }); return;
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
      nudgeMessage: nudgeMessage,
      nudgeHours: body.nudgeHours,
      evergreen: evergreen,
    });
    if (!id) { res.status(500).json({ error: 'Could not save the campaign.' }); return; }
    res.status(200).json({ ok: true, id: id, count: a.items.length, skipped: a.skipped });
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

  if (action === 'dedupeReplies') {
    const n = await dedupeInbound();
    res.status(200).json({ ok: true, removed: n });
    return;
  }

  if (action === 'boostToday') {
    // one-day-only bump to today's send cap. Cumulative (tap twice for +100), capped so a stuck
    // finger cannot blast, and stamped with today's date so it evaporates tomorrow by itself.
    const day = todayKey(new Date());
    const cur = (await readJson('sms/_capboost.json')) || {};
    const base = (cur.day === day && Number(cur.extra) > 0) ? Number(cur.extra) : 0;
    const step = Math.min(Math.max(Number(body.step) || 50, 1), 100);
    const extra = Math.min(base + step, 400);
    try { await put('sms/_capboost.json', JSON.stringify({ day: day, extra: extra, by: acct.email, at: new Date().toISOString() }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not raise today\'s cap.' }); return; }
    res.status(200).json({ ok: true, extra: extra });
    return;
  }

  if (action === 'resumeCold') {
    // manual override of the STOP-rate auto-pause: clear the brake so the next worker tick resumes
    // cold sends (it re-evaluates the rate against the current threshold straight away).
    try { await put('sms/_breaker.json', JSON.stringify({ clearedAt: new Date().toISOString(), clearedBy: acct.email }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not lift the pause.' }); return; }
    res.status(200).json({ ok: true });
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

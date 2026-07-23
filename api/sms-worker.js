// The campaign engine, run by cron every 5 minutes. Each tick, for every running campaign:
//   1. generate mockups for a couple of pending recipients (each takes up to a minute or two)
//   2. send a small batch of ready ones, so the number drips politely instead of blasting
// Sends only happen inside working hours (Mon-Fri, 09:00-17:59 UK) and inside the daily 'sms'
// cap from Admin > Limits. Without Twilio keys, mockups still build but sends wait, so a campaign
// can be prepared before the account exists.
const { dueCampaigns, itemsInState, setItem, setCampaignStatus, dueLinkSends, markLinkSent, dueNudges, markNudged, campaignKeys, addItemsToCampaign, stampToppedUp, stopWindow, ensureBaseVersions, currentMsg } = require('../lib/smsdb');
const { buildAudience } = require('../lib/smsaudience');
const { sendSms, smsConfigured, lookupPhone, optOutUrl } = require('../lib/sms');
const { list, put } = require('@vercel/blob');
const { sign } = require('../lib/auth');
const { ownerEmail } = require('../lib/tenant');
const { getDailyUsage, bumpDailyUsage, logActivity } = require('../lib/db');
const { limitFor } = require('../lib/ratelimit');
const { londonHour, todayKey } = require('../lib/digest');
const { humaniseBusinessName } = require('../lib/names');

const MOCKUPS_PER_TICK = 2;  // each is a slow AI image, and the function has 300s
const LOOKUPS_PER_TICK = 20; // phone validation, ~0.8p each, each number only ever checked once
const TOPUP_PER_TICK = 200;         // evergreen: new matching records pulled in per top-up
const TOPUP_EVERY_HOURS = 11;       // ...and a top-up only runs about twice a day per campaign
const SENDS_PER_TICK = 10;   // ~120/hour ceiling, gentle on carrier filtering

// Auto safety-brake. If too many people are texting STOP (the metric carriers police), cold sends
// pause for a cooldown so the 24h volume drops and the number cools off. Measured over a rolling
// window so it recovers by itself. All three are env-overridable.
const STOP_WINDOW_HOURS = Math.max(1, Number(process.env.SMS_STOP_WINDOW_HOURS) || 24); // look-back for the rate
const STOP_TRIP_PCT = Math.max(0.5, Number(process.env.SMS_STOP_TRIP_PCT) || 7);        // trip at this STOP-rate % (temporarily 7 per user 2026-07-22; 3-4 is the healthier long-term line)
const STOP_MIN_SENT = Math.max(1, Number(process.env.SMS_STOP_MIN_SENT) || 40);         // ...but only once enough have been sent
const STOP_COOLDOWN_HOURS = Math.max(1, Number(process.env.SMS_STOP_COOLDOWN_HOURS) || 24); // how long cold sends stay paused
// Read/trip/clear the brake. Returns { paused, until, rate, stops, sent, reason }. State lives in
// its own blob so it survives between ticks and the dashboard can show a banner.
async function evalStopBrake(now) {
  let st = (await readJson('sms/_breaker.json')) || {};
  const w = await stopWindow(STOP_WINDOW_HOURS);
  const rate = w.sent ? (w.stops / w.sent * 100) : 0;
  const tNow = new Date(now).getTime();
  const activeUntil = st.until ? new Date(st.until).getTime() : 0;
  // still inside a cooldown that was set earlier
  if (activeUntil > tNow) return { paused: true, until: st.until, rate: rate, stops: w.stops, sent: w.sent, reason: 'cooldown' };
  // enough volume to judge, and the rate is over the line -> trip a fresh cooldown
  if (w.sent >= STOP_MIN_SENT && rate >= STOP_TRIP_PCT) {
    const until = new Date(tNow + STOP_COOLDOWN_HOURS * 3600000).toISOString();
    const next = { until: until, trippedAt: new Date(tNow).toISOString(), rate: Math.round(rate * 10) / 10, stops: w.stops, sent: w.sent };
    try { await put('sms/_breaker.json', JSON.stringify(next), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* still pause this tick */ }
    return { paused: true, until: until, rate: rate, stops: w.stops, sent: w.sent, reason: 'tripped' };
  }
  // healthy: clear any spent cooldown so the banner disappears
  if (st.until) { try { await put('sms/_breaker.json', JSON.stringify({ clearedAt: new Date(tNow).toISOString() }), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* nothing */ } }
  return { paused: false, until: null, rate: rate, stops: w.stops, sent: w.sent, reason: 'ok' };
}

function isCron(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.includes('vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && String((req.headers && req.headers.authorization) || '') === 'Bearer ' + secret;
}
// Send window: Mon to Fri, 08:00 to 20:00 UK by default (catch the morning commute, catch the
// evening read). Override with SMS_SEND_FROM_HOUR / SMS_SEND_TO_HOUR.
const SEND_FROM = Math.max(0, Math.min(23, Number(process.env.SMS_SEND_FROM_HOUR) || 8));
const SEND_TO = Math.max(SEND_FROM + 1, Math.min(24, Number(process.env.SMS_SEND_TO_HOUR) || 20));
function londonHM(now) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const h = Number((f.find((p) => p.type === 'hour') || {}).value || 0);
  const m = Number((f.find((p) => p.type === 'minute') || {}).value || 0);
  return { h: h, m: m };
}
function inSendWindow(now) {
  const day = new Date(now).getUTCDay(); // weekend check (Sat=6, Sun=0)
  if (day === 0 || day === 6) return false;
  const h = londonHour(new Date(now));
  return h >= SEND_FROM && h < SEND_TO;
}
// How much of the day's allowance should be USED UP by now, so the sends drip evenly across the
// window rather than firing the whole cap in the first 20 minutes. Also lets us later learn which
// send-times get the best replies, because sends are spread across the hours instead of bunched.
function paceRoom(cap, used, now) {
  if (!inSendWindow(now)) return 0;
  const t = londonHM(now);
  const frac = Math.min(1, Math.max(0, ((t.h - SEND_FROM) + t.m / 60) / (SEND_TO - SEND_FROM)));
  const allowedByNow = Math.min(cap, Math.ceil(cap * frac) + 1); // +1 so a tiny cap still starts
  return Math.max(0, allowedByNow - used);
}

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}
// A one-day-only bump to the daily send cap (the "send more today" button). It carries the day it
// was set for, so it applies only to today's 8am-8pm window and is ignored from 8am tomorrow, when
// sends resume at the normal cap. It can never quietly become the standing cap.
async function todayCapExtra(day) {
  const b = (await readJson('sms/_capboost.json')) || {};
  return (b.day === day && Number(b.extra) > 0) ? Number(b.extra) : 0;
}
// Rolling phone validation: every call-list number gets ONE Twilio Lookup, results cached in
// their own blob (calls/_phonecheck.json) so this never contends with the list itself (blob
// writes race). Dead numbers get the CRM status 'invalid-phone' when they had no status yet, so
// they drop straight into the existing Invalid-phone bucket nobody wastes dialling time on.
async function validatePhones(base) {
  const calls = (await readJson('calls/_list.json')) || {};
  const chk = (await readJson('calls/_phonecheck.json')) || {};
  const todo = Object.values(calls).filter((c) => c && c.phone && !chk[c.key]).slice(0, LOOKUPS_PER_TICK);
  if (!todo.length) return 0;
  let idx = null; // notes index, loaded only if something is actually invalid
  for (const c of todo) {
    // to E.164: works for landlines too, the whole list gets checked, not just mobiles
    const digits = String(c.phone).replace(/[^0-9+]/g, '');
    const e164 = digits.startsWith('+') ? digits
      : (digits.startsWith('00') ? ('+' + digits.slice(2))
      : (digits.startsWith('0') ? ('+44' + digits.slice(1)) : ('+44' + digits)));
    const r = await lookupPhone(e164);
    if (!r.checked) { chk[c.key] = { at: new Date().toISOString(), error: 1 }; continue; }
    chk[c.key] = { valid: !!r.valid, type: r.type || '', at: new Date().toISOString() };
    if (!r.valid) {
      try {
        if (!idx) idx = (await readJson('notes/_index.json')) || {};
        if (!idx[c.key] || !idx[c.key].status) {
          const now = new Date().toISOString();
          const notePath = 'notes/' + c.key + '.json';
          const nd = (await readJson(notePath)) || { slug: c.key, status: '', statusAt: '', comments: [] };
          nd.status = 'invalid-phone'; nd.statusAt = now;
          (nd.comments = nd.comments || []).push({ text: '📵 Twilio says this number is not in service.', at: now, by: 'sms' });
          await put(notePath, JSON.stringify(nd), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
          idx[c.key] = { status: 'invalid-phone', at: now };
        }
      } catch (e) { /* the check itself is recorded regardless */ }
    }
  }
  try {
    if (idx) await put('notes/_index.json', JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    await put('calls/_phonecheck.json', JSON.stringify(chk), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { /* next tick retries the same batch */ }
  return todo.length;
}

const ENRICH_PER_TICK = 150; // Google Place Details lookups per tick (free tier); ~150 x 5min finishes a few thousand in a couple of hours
// Backfill real Google data (website presence, rating, review count) for OLD call-list records so
// the SMS filters work on them too. Stored in its OWN blob (calls/_enrichdata.json), never
// touching the call list, so it cannot race a user add. Only runs when armed via Admin (a click),
// because Google Places is not free. Bumps the running spend in calls/_enrich.json.
async function enrichCallList() {
  const ctrl = (await readJson('calls/_enrich.json')) || {};
  if (!ctrl.active) return 0;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return 0;
  const calls = (await readJson('calls/_list.json')) || {};
  const data = (await readJson('calls/_enrichdata.json')) || {};
  const todo = Object.values(calls).filter((c) => c && c.placeId && c.web === undefined && !data[c.key]).slice(0, ENRICH_PER_TICK);
  if (!todo.length) { ctrl.active = false; ctrl.finishedAt = new Date().toISOString(); await put('calls/_enrich.json', JSON.stringify(ctrl), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); return 0; }
  let spentAdd = 0;
  for (const c of todo) {
    try {
      // websiteUri only = Place Details Pro SKU ($17/1000, 5000 free/month), far cheaper than
      // pulling rating/reviews (Enterprise+Atmosphere $25/1000). New records still get reviews free.
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(c.placeId), {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'websiteUri' },
      });
      const d = await r.json().catch(() => null);
      spentAdd += 0.0135;
      if (d && !d.error) {
        data[c.key] = { web: d.websiteUri ? 'has' : 'none', at: new Date().toISOString() };
      } else {
        data[c.key] = { web: 'unknown', at: new Date().toISOString() }; // do not re-charge for a bad id
      }
    } catch (e) { data[c.key] = { web: 'unknown', at: new Date().toISOString() }; }
  }
  try {
    await put('calls/_enrichdata.json', JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    ctrl.spent = (ctrl.spent || 0) + spentAdd;
    await put('calls/_enrich.json', JSON.stringify(ctrl), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { /* next tick retries */ }
  return todo.length;
}

// Generate one mockup by calling our own /api/generate with a server-minted owner cookie.
// Reuses the whole existing pipeline (image, copy, tracking page) without duplicating it.
async function generateMockup(base, item) {
  const cookie = 'aiwp=' + encodeURIComponent(sign(ownerEmail(), Date.now()));
  const business = { name: item.name, location: item.location, category: item.category, phones: item.phone ? [item.phone] : [] };
  // 'auto' marks the mockup as machine-made in the activity log (reporting splits man vs machine)
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 170000);
  try {
    const r = await fetch(base + '/api/generate', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ business: business, auto: true }),
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.slug) return { ok: true, slug: d.slug, viewUrl: d.viewUrl || (base + '/v/' + d.slug) };
    return { ok: false, error: (d && d.error) || ('generate failed ' + r.status) };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: (e && e.message) || 'generate error' };
  }
}

function renderMessage(template, item, base) {
  const biz = humaniseBusinessName(item.name) || item.name;
  let msg = String(template || '')
    .split('{business}').join(biz)
    .split('{name}').join(biz)                       // templates written for WhatsApp use {name}
    .split('{industry}').join(item.category || 'business')
    .split('{category}').join(item.category || 'business')
    .split('{location}').join(item.location || 'your area')
    .split('{reviews}').join((item.reviews != null && item.reviews !== '') ? String(item.reviews) : 'only a few')
    .split('{rating}').join((item.rating != null && item.rating !== '') ? String(item.rating) : '')
    .split('{link}').join(item.view_url || '');
  // Opt-out footer, the SOFT opt-out. A tap-to-opt-out LINK instead of "reply STOP": a link click
  // does not count against the carrier opt-out metric the way a STOP text does, so the number stays
  // healthy. STOP still works silently for anyone who types it. We only skip adding the link if one
  // (or an unsubscribe link) is ALREADY in the message, a stray mention of the word "stop" no longer
  // suppresses it. Fall back to the STOP wording only if we somehow have no item id to sign.
  const hasLink = /\/optout\b|unsubscribe/i.test(msg);
  if (!hasLink) {
    msg += item.id ? ('\nNot interested? Opt out: ' + optOutUrl(base, item.id)) : '\nReply STOP to opt out';
  }
  return msg.slice(0, 640);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isCron(req)) { res.status(401).json({ error: 'Cron only.' }); return; }

  const now = Date.now();
  const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';
  const owner = ownerEmail();
  const day = todayKey(new Date(now));
  const capExtra = await todayCapExtra(day); // one-day-only boost to the daily cap
  // number pool: each number paces its OWN daily allowance, so a second number adds capacity
  // rather than sharing the first one's. The default TWILIO_FROM uses the standing 'sms' cap.
  const PRIMARY = process.env.TWILIO_FROM || '';
  const numbersPool = ((await readJson('sms/_numbers.json')) || {}).numbers || [];
  const numCap = (fromNum, baseCap) => { const n = numbersPool.find((x) => x && x.phone === fromNum); return (n && Number(n.cap) > 0) ? Number(n.cap) : baseCap; };
  const capKindFor = (fromNum) => (!fromNum || fromNum === PRIMARY) ? 'sms' : ('smsn:' + fromNum);
  const out = { campaigns: 0, mockups: 0, sent: 0, failed: 0, held: [] };

  // Auto STOP-rate safety-brake, evaluated once per tick. When paused, only COLD sends (openers +
  // nudges) are held. Warm follow-ups to people who already replied YES keep flowing: those are
  // wanted replies, not cold outreach, and holding them would be rude.
  try { await ensureBaseVersions(); } catch (e) { /* message-experiment backfill, non-fatal */ }
  let brake = { paused: false };
  try { brake = await evalStopBrake(now); } catch (e) { /* fail open: never let the brake itself stop everything */ }
  out.stopRate = Math.round((brake.rate || 0) * 10) / 10;
  if (brake.paused) {
    out.coldPaused = true; out.coldPausedUntil = brake.until;
    out.held.push('cold sends paused: STOP rate ' + out.stopRate + '% (' + brake.stops + '/' + brake.sent + '), resumes ' + (brake.until || 'soon'));
    if (brake.reason === 'tripped') { try { await logActivity(owner, owner, 'sms_brake', 'Cold SMS auto-paused: STOP rate ' + out.stopRate + '% (' + brake.stops + '/' + brake.sent + ' in ' + STOP_WINDOW_HOURS + 'h). Resumes ' + brake.until); } catch (e) { /* nothing */ } }
  }

  // Mockups are only generated AFTER a positive reply (no credits burned on the uninterested),
  // so a YES may wait one extra tick while its mockup builds. These warm follow-ups go first,
  // any time of day and outside the cold cap: they are replies to a conversation THEY continued.
  let genBudget = MOCKUPS_PER_TICK;
  if (smsConfigured()) {
    const due = await dueLinkSends(new Date(now).toISOString(), 15);
    for (const it of due) {
      if (!it.view_url) {
        if (genBudget <= 0) { out.held.push('mockup queue full, ' + it.name + ' next tick'); continue; }
        genBudget--;
        const g = await generateMockup(base, it);
        if (!g.ok) {
          // one retry next tick, then give up and tell the owner rather than ghosting a YES
          if (it.error) { await setItem(it.id, { state: 'failed', error: g.error }); out.failed++; }
          else await setItem(it.id, { error: g.error });
          continue;
        }
        await setItem(it.id, { slug: g.slug, viewUrl: g.viewUrl });
        it.view_url = g.viewUrl;
        out.mockups++;
      }
      const msg = renderMessage(it.link_message || 'Here it is: {link}', it, base);
      const r = await sendSms(it.phone, msg, base, it.from_number || PRIMARY); // reply from the same number they know
      if (r.ok) {
        await markLinkSent(it.id, r.sid);
        await logActivity(it.created_by || owner, owner, 'message_sent', it.name + ' (mockup link after YES)', it.name);
        out.linked = (out.linked || 0) + 1;
      } else { out.held.push('link send failed: ' + r.error); }
    }
  }

  // rolling phone validation (one lookup per number, ever)
  if (smsConfigured()) { try { out.checked = await validatePhones(base); } catch (e) { /* next tick */ } }
  // Google enrichment of old records, only when armed via Admin (costs money)
  try { out.enriched = await enrichCallList(); } catch (e) { /* next tick */ }

  // Nudges for non-responders: a campaign can have SEVERAL, sent in order. For each candidate we
  // work out which nudge is next (nudge_count) and whether its gap has elapsed (per-nudge hours,
  // measured from the previous message). Still cold, so it obeys the window, daily cap and pacing.
  if (smsConfigured() && inSendWindow(now) && !brake.paused) {
    const cands = await dueNudges(400);
    let sentThisTick = 0;
    for (const it of cands) {
      if (sentThisTick >= SENDS_PER_TICK) break;
      let list = [];
      try { list = Array.isArray(it.nudges) ? it.nudges : (it.nudges ? JSON.parse(it.nudges) : []); } catch (e) { list = []; }
      if (!list.length && it.nudge_message) list = [{ message: it.nudge_message, hours: it.nudge_hours || 24 }];
      if (!list.length) continue;
      let count = Number(it.nudge_count) || 0;
      if (!count && it.nudged_at) count = 1;            // legacy single nudge already sent
      if (count >= list.length) continue;              // all this person's nudges are done
      const nud = list[count] || {};
      const baseTs = count === 0 ? it.sent_at : it.nudged_at; // gap measured from the previous message
      if (!baseTs) continue;
      const gapMs = Math.min(Math.max(Number(nud.hours) || 24, 1), 168) * 3600000;
      if (now < new Date(baseTs).getTime() + gapMs) continue; // not due yet
      const who = it.created_by || owner;
      const fromNum = it.from_number || PRIMARY;
      const isPrimary = !it.from_number || it.from_number === PRIMARY;
      const capKind = capKindFor(fromNum);
      const cap = numCap(fromNum, await limitFor('sms', who)) + (isPrimary ? capExtra : 0);
      const used = await getDailyUsage(who, capKind, day);
      if (paceRoom(cap, used, now) <= 0) { out.held.push('nudges held, pacing/cap'); break; }
      const r = await sendSms(it.phone, renderMessage(nud.message || '', it, base), base, fromNum);
      if (r.ok) {
        await markNudged(it.id, count + 1);
        await bumpDailyUsage(who, capKind, 1, day);
        await logActivity(who, owner, 'message_sent', it.name + ' (nudge ' + (count + 1) + ', no reply)', it.name);
        out.nudged = (out.nudged || 0) + 1; sentThisTick++;
      } else { await markNudged(it.id, count + 1); out.held.push('nudge failed: ' + r.error); }
    }
  }

  const campaigns = await dueCampaigns(new Date(now).toISOString());
  for (const c of campaigns) {
    out.campaigns++;

    // Evergreen: pull in any NEW records that now match this campaign's criteria and queue them.
    // buildAudience already excludes anyone ever messaged, opted out or dead; excludeKeys stops
    // re-adding records already in this campaign. So the same criteria keep working forever.
    if (c.evergreen) {
      const lastTop = c.topped_up_at ? new Date(c.topped_up_at).getTime() : 0;
      const dueTop = (now - lastTop) >= TOPUP_EVERY_HOURS * 3600000;
      if (dueTop) {
        try {
          const have = await campaignKeys(c.id);
          const fresh = await buildAudience(c.filters || {}, { excludeKeys: have, max: TOPUP_PER_TICK });
          if (fresh.items && fresh.items.length) out.toppedUp = (out.toppedUp || 0) + await addItemsToCampaign(c.id, fresh.items);
          else await stampToppedUp(c.id); // no new matches, but record the check so we do not re-scan for 11h
        } catch (e) { out.held.push('topup failed for ' + c.id); }
      }
    }

    // 1. build mockups upfront ONLY for link mode (the link goes in the first text). Ask mode
    // holds fire: the mockup is generated after a YES, so no credits die on the uninterested.
    if (c.mode !== 'ask') {
      const pending = await itemsInState(c.id, 'pending', genBudget);
      for (const it of pending) {
        if (genBudget <= 0) break;
        genBudget--;
        const g = await generateMockup(base, it);
        if (g.ok) { await setItem(it.id, { state: 'ready', slug: g.slug, viewUrl: g.viewUrl }); out.mockups++; }
        else {
          // one retry on the next tick, then give up on this recipient
          if (it.error) { await setItem(it.id, { state: 'failed', error: g.error }); out.failed++; }
          else await setItem(it.id, { error: g.error });
        }
      }
    } else {
      // ask mode: pending items are simply ready to be asked
      const pend = await itemsInState(c.id, 'pending', SENDS_PER_TICK);
      for (const it of pend) await setItem(it.id, { state: 'ready' });
    }

    // 2. send: inside the window, under the daily cap, AND paced so the allowance spreads across
    // the day instead of firing all at once
    if (!smsConfigured()) { out.held.push('Twilio keys not set yet'); continue; }
    if (brake.paused) { continue; } // STOP-rate brake: hold cold openers (already logged above)
    if (!inSendWindow(now)) { out.held.push('outside send window'); continue; }
    const fromNum = c.from_number || PRIMARY;                       // this campaign's number
    const isPrimary = !c.from_number || c.from_number === PRIMARY;
    const capKind = capKindFor(fromNum);
    const cap = numCap(fromNum, await limitFor('sms', c.created_by || owner)) + (isPrimary ? capExtra : 0);
    const used = await getDailyUsage(c.created_by || owner, capKind, day);
    const room = paceRoom(cap, used, now);
    if (!room) { out.held.push(used >= cap ? ('daily cap reached (' + cap + ')') : 'paced, more later today'); continue; }

    const ready = await itemsInState(c.id, 'ready', Math.min(SENDS_PER_TICK, room));
    const cur = ready.length ? await currentMsg(c.id, day) : null; // the opener version LIVE today
    const curMsgId = cur ? cur.id : null;
    const curText = (cur && cur.text) || c.message; // active version's text (a scheduled one only kicks in on its start day)
    for (const it of ready) {
      const msg = renderMessage(curText, it, base);
      const r = await sendSms(it.phone, msg, base, fromNum);
      if (r.ok) {
        await setItem(it.id, { state: 'sent', sid: r.sid, msgId: curMsgId });
        await bumpDailyUsage(c.created_by || owner, capKind, 1, day);
        await logActivity(c.created_by || owner, owner, 'message_sent', it.name + ' (SMS campaign ' + c.id + ')', it.name);
        out.sent++;
      } else {
        await setItem(it.id, { state: 'failed', error: r.error });
        out.failed++;
      }
    }

    // finished? every item is in a terminal state and none are pending/ready. Ask-mode links
    // are handled by dueLinkSends above even after the campaign is done.
    const stillPending = (await itemsInState(c.id, 'pending', 1)).length;
    const stillReady = (await itemsInState(c.id, 'ready', 1)).length;
    // an evergreen campaign never finishes: it waits for the next matching record
    if (!c.evergreen && !stillPending && !stillReady) await setCampaignStatus(c.id, 'done');
  }

  res.status(200).json(out);
};

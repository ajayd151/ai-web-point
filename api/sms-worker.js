// The campaign engine, run by cron every 5 minutes. Each tick, for every running campaign:
//   1. generate mockups for a couple of pending recipients (each takes up to a minute or two)
//   2. send a small batch of ready ones, so the number drips politely instead of blasting
// Sends only happen inside working hours (Mon-Fri, 09:00-17:59 UK) and inside the daily 'sms'
// cap from Admin > Limits. Without Twilio keys, mockups still build but sends wait, so a campaign
// can be prepared before the account exists.
const { dueCampaigns, itemsInState, setItem, setCampaignStatus, dueLinkSends, markLinkSent, dueNudges, markNudged, campaignKeys, addItemsToCampaign } = require('../lib/smsdb');
const { buildAudience } = require('../lib/smsaudience');
const { sendSms, smsConfigured, lookupPhone } = require('../lib/sms');
const { list, put } = require('@vercel/blob');
const { sign } = require('../lib/auth');
const { ownerEmail } = require('../lib/tenant');
const { getDailyUsage, bumpDailyUsage, logActivity } = require('../lib/db');
const { limitFor } = require('../lib/ratelimit');
const { londonHour, todayKey } = require('../lib/digest');
const { humaniseBusinessName } = require('../lib/names');

const MOCKUPS_PER_TICK = 2;  // each is a slow AI image, and the function has 300s
const LOOKUPS_PER_TICK = 20; // phone validation, ~0.8p each, each number only ever checked once
const TOPUP_PER_TICK = 50;   // evergreen: new matching records pulled into a campaign per tick
const SENDS_PER_TICK = 10;   // ~120/hour ceiling, gentle on carrier filtering

function isCron(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.includes('vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && String((req.headers && req.headers.authorization) || '') === 'Bearer ' + secret;
}
function workingHours(now) {
  const day = new Date(now).getUTCDay(); // cheap weekend check; hour check is London-aware
  const h = londonHour(new Date(now));
  return day >= 1 && day <= 5 && h >= 9 && h < 18;
}

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
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

function renderMessage(template, item) {
  const biz = humaniseBusinessName(item.name) || item.name;
  let msg = String(template || '')
    .split('{business}').join(biz)
    .split('{name}').join(biz)                       // templates written for WhatsApp use {name}
    .split('{industry}').join(item.category || 'business')
    .split('{category}').join(item.category || 'business')
    .split('{location}').join(item.location || 'your area')
    .split('{link}').join(item.view_url || '');
  if (!/stop/i.test(msg)) msg += '\nReply STOP to opt out';
  return msg.slice(0, 640);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isCron(req)) { res.status(401).json({ error: 'Cron only.' }); return; }

  const now = Date.now();
  const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';
  const owner = ownerEmail();
  const day = todayKey(new Date(now));
  const out = { campaigns: 0, mockups: 0, sent: 0, failed: 0, held: [] };

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
      const msg = renderMessage(it.link_message || 'Here it is: {link}', it);
      const r = await sendSms(it.phone, msg, base);
      if (r.ok) {
        await markLinkSent(it.id, r.sid);
        await logActivity(it.created_by || owner, owner, 'message_sent', it.name + ' (mockup link after YES)', it.name);
        out.linked = (out.linked || 0) + 1;
      } else { out.held.push('link send failed: ' + r.error); }
    }
  }

  // rolling phone validation (one lookup per number, ever)
  if (smsConfigured()) { try { out.checked = await validatePhones(base); } catch (e) { /* next tick */ } }

  // One nudge each for non-responders whose window is up. Still a cold-ish touch, so it obeys
  // working hours and the daily cap, and each recipient only ever gets one.
  if (smsConfigured() && workingHours(now)) {
    const nudges = await dueNudges(SENDS_PER_TICK);
    for (const it of nudges) {
      const who = it.created_by || owner;
      const cap = await limitFor('sms', who);
      const used = await getDailyUsage(who, 'sms', day);
      if (used >= cap) { out.held.push('nudges held, daily cap'); break; }
      const r = await sendSms(it.phone, renderMessage(it.nudge_message, it), base);
      if (r.ok) {
        await markNudged(it.id);
        await bumpDailyUsage(who, 'sms', 1, day);
        await logActivity(who, owner, 'message_sent', it.name + ' (nudge, no reply after ask)', it.name);
        out.nudged = (out.nudged || 0) + 1;
      } else { await markNudged(it.id); out.held.push('nudge failed: ' + r.error); }
    }
  }

  const campaigns = await dueCampaigns(new Date(now).toISOString());
  for (const c of campaigns) {
    out.campaigns++;

    // Evergreen: pull in any NEW records that now match this campaign's criteria and queue them.
    // buildAudience already excludes anyone ever messaged, opted out or dead; excludeKeys stops
    // re-adding records already in this campaign. So the same criteria keep working forever.
    if (c.evergreen) {
      try {
        const have = await campaignKeys(c.id);
        const fresh = await buildAudience(c.filters || {}, { excludeKeys: have, max: TOPUP_PER_TICK });
        if (fresh.items && fresh.items.length) {
          const added = await addItemsToCampaign(c.id, fresh.items);
          out.toppedUp = (out.toppedUp || 0) + added;
        }
      } catch (e) { out.held.push('topup failed for ' + c.id); }
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

    // 2. send (working hours + Twilio + daily cap only)
    if (!smsConfigured()) { out.held.push('Twilio keys not set yet'); continue; }
    if (!workingHours(now)) { out.held.push('outside working hours'); continue; }
    const cap = await limitFor('sms', c.created_by || owner);
    const used = await getDailyUsage(c.created_by || owner, 'sms', day);
    const room = Math.max(0, cap - used);
    if (!room) { out.held.push('daily cap reached (' + cap + ')'); continue; }

    const ready = await itemsInState(c.id, 'ready', Math.min(SENDS_PER_TICK, room));
    for (const it of ready) {
      const msg = renderMessage(c.message, it);
      const r = await sendSms(it.phone, msg, base);
      if (r.ok) {
        await setItem(it.id, { state: 'sent', sid: r.sid });
        await bumpDailyUsage(c.created_by || owner, 'sms', 1, day);
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

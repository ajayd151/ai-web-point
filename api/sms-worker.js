// The campaign engine, run by cron every 5 minutes. Each tick, for every running campaign:
//   1. generate mockups for a couple of pending recipients (each takes up to a minute or two)
//   2. send a small batch of ready ones, so the number drips politely instead of blasting
// Sends only happen inside working hours (Mon-Fri, 09:00-17:59 UK) and inside the daily 'sms'
// cap from Admin > Limits. Without Twilio keys, mockups still build but sends wait, so a campaign
// can be prepared before the account exists.
const { dueCampaigns, itemsInState, setItem, setCampaignStatus, dueLinkSends, markLinkSent } = require('../lib/smsdb');
const { sendSms, smsConfigured } = require('../lib/sms');
const { sign } = require('../lib/auth');
const { ownerEmail } = require('../lib/tenant');
const { getDailyUsage, bumpDailyUsage, logActivity } = require('../lib/db');
const { limitFor } = require('../lib/ratelimit');
const { londonHour, todayKey } = require('../lib/digest');
const { humaniseBusinessName } = require('../lib/names');

const MOCKUPS_PER_TICK = 2;  // each is a slow AI image, and the function has 300s
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

  const campaigns = await dueCampaigns(new Date(now).toISOString());
  for (const c of campaigns) {
    out.campaigns++;

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
    if (!stillPending && !stillReady) await setCampaignStatus(c.id, 'done');
  }

  res.status(200).json(out);
};

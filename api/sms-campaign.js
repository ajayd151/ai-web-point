// SMS campaigns (owner-only). Audience comes from SEARCH CRITERIA over the call list, not
// hand-ticking: industry / location / status / prowled / not-already-messaged, capped at a max.
// POST action=preview -> who matches, with counts and a cost estimate. Nothing is saved.
// POST action=create  -> snapshot the audience into a campaign for the worker to run.
// POST action=pause|resume|cancel, GET -> campaigns + replies, GET ?id= -> one campaign's items.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ukMobile, smsConfigured } = require('../lib/sms');
const { createCampaign, listCampaigns, campaignItems, setCampaignStatus, sentKeys, optoutSet, listInbound, readyToCall } = require('../lib/smsdb');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

// The one place the audience rules live.
async function buildAudience(filters) {
  const f = filters || {};
  const calls = (await readJson('calls/_list.json')) || {};
  const idx = (await readJson('notes/_index.json')) || {};
  const chk = (await readJson('calls/_phonecheck.json')) || {}; // Twilio Lookup verdicts
  const already = await sentKeys();
  const optout = await optoutSet();
  const wantCat = String(f.category || '').trim().toLowerCase();
  const wantLoc = String(f.location || '').trim().toLowerCase();
  const wantStatus = String(f.status || 'any'); // 'any' | 'new' | a status value
  const notMessaged = f.notMessaged !== false;  // default ON: do not text the same business twice
  const max = Math.min(Math.max(Number(f.max) || 50, 1), 200);
  // criteria the record was FOUND with (stamped by search, or backfilled): website filter used
  // ('any' | 'none' = found via the No-website filter | 'has'), and the search's ratings range
  const wantSite = String(f.foundWebsite || 'any');
  const rFrom = Number.isFinite(Number(f.critRatingsFrom)) && f.critRatingsFrom !== '' && f.critRatingsFrom != null ? Number(f.critRatingsFrom) : null;
  const rTo = Number.isFinite(Number(f.critRatingsTo)) && f.critRatingsTo !== '' && f.critRatingsTo != null ? Number(f.critRatingsTo) : null;

  const out = []; const skipped = { noMobile: 0, optedOut: 0, alreadyMessaged: 0, filtered: 0, deadNumber: 0 };
  let scanned = 0;
  for (const c of Object.values(calls)) {
    if (!c || !c.name) continue;
    scanned++;
    const st = (idx[c.key] && idx[c.key].status) || '';
    const crit = c.crit || {};
    // the tag (search industry term) and the Google category both count as the industry
    if (wantCat && (String(c.tag || '') + ' ' + String(c.category || '')).toLowerCase().indexOf(wantCat) < 0) { skipped.filtered++; continue; }
    // location matches the record's own location OR the search location that found it
    if (wantLoc && (String(c.location || '') + ' ' + String(crit.location || '')).toLowerCase().indexOf(wantLoc) < 0) { skipped.filtered++; continue; }
    if (wantSite !== 'any' && String(crit.website || '') !== wantSite) { skipped.filtered++; continue; }
    // ratings: the search range that found this record must overlap the range asked for
    if (rFrom != null || rTo != null) {
      if (crit.ratingsFrom == null && crit.ratingsTo == null) { skipped.filtered++; continue; }
      const cFrom = crit.ratingsFrom != null ? Number(crit.ratingsFrom) : 0;
      const cTo = crit.ratingsTo != null ? Number(crit.ratingsTo) : Infinity;
      if ((rTo != null && cFrom > rTo) || (rFrom != null && cTo < rFrom)) { skipped.filtered++; continue; }
    }
    if (wantStatus === 'new' ? st !== '' : (wantStatus !== 'any' && st !== wantStatus)) { skipped.filtered++; continue; }
    const mob = ukMobile(c.phone);
    if (!mob) { skipped.noMobile++; continue; }
    if (chk[c.key] && chk[c.key].valid === false) { skipped.deadNumber++; continue; } // Twilio says not in service
    if (optout.has(mob)) { skipped.optedOut++; continue; }
    if (notMessaged && already.has(c.key)) { skipped.alreadyMessaged++; continue; }
    out.push({ key: c.key, name: c.name, location: c.location || '', category: c.tag || c.category || '', phone: mob });
    if (out.length >= max) break;
  }
  return { items: out, skipped: skipped, scanned: scanned };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.id) { res.status(200).json({ items: await campaignItems(Number(q.id)) }); return; }
    res.status(200).json({
      campaigns: await listCampaigns(),
      replies: await listInbound(100),
      callNow: await readyToCall(50),
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
    });
    if (!id) { res.status(500).json({ error: 'Could not save the campaign.' }); return; }
    res.status(200).json({ ok: true, id: id, count: a.items.length, skipped: a.skipped });
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

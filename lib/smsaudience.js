// The one place the SMS audience rules live, shared by the campaign endpoint (preview / create)
// and the worker (evergreen top-up). Given a set of saved criteria, it returns the matching
// call-list records that are textable: a UK mobile, not opted out, not a known-dead number, and
// (by default) not already messaged by any campaign.
//
// opts.max        override the cap (default 200; the worker passes a smaller per-tick number)
// opts.excludeKeys a Set of keys already queued in this campaign, so an evergreen top-up returns
//                  genuinely NEW records rather than the same first 200 every tick.
const { list } = require('@vercel/blob');
const { ukMobile } = require('./sms');
const { sentKeys, optoutSet } = require('./smsdb');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

async function buildAudience(filters, opts) {
  const f = filters || {};
  const o = opts || {};
  const exclude = o.excludeKeys instanceof Set ? o.excludeKeys : new Set();
  const calls = (await readJson('calls/_list.json')) || {};
  const idx = (await readJson('notes/_index.json')) || {};
  const chk = (await readJson('calls/_phonecheck.json')) || {}; // Twilio Lookup verdicts
  const enr = (await readJson('calls/_enrichdata.json')) || {}; // Google enrichment (website/reviews)
  const already = await sentKeys();
  const optout = await optoutSet();
  const wantCat = String(f.category || '').trim().toLowerCase();
  // tolerate singular/plural: "salons" should match a "beauty salon" category, and vice versa
  const wantCatAlt = wantCat.length > 3 ? (wantCat.endsWith('s') ? wantCat.slice(0, -1) : wantCat + 's') : wantCat;
  const wantLoc = String(f.location || '').trim().toLowerCase();
  const wantStatus = String(f.status || 'any'); // 'any' | 'new' | a status value
  const notMessaged = f.notMessaged !== false;  // default ON: do not text the same business twice
  // blank / 0 = everyone who matches (dripped safely by the daily cap), up to a safety ceiling.
  // A typed number caps the campaign at that size. The worker top-up passes its own opts.max.
  const CEIL = 20000;
  const max = o.max != null ? Math.max(Number(o.max) || 0, 0)
    : (f.max === '' || f.max == null ? CEIL : Math.min(Math.max(Number(f.max) || 1, 1), CEIL));
  const wantSite = String(f.foundWebsite || 'any');
  const rFrom = Number.isFinite(Number(f.critRatingsFrom)) && f.critRatingsFrom !== '' && f.critRatingsFrom != null ? Number(f.critRatingsFrom) : null;
  const rTo = Number.isFinite(Number(f.critRatingsTo)) && f.critRatingsTo !== '' && f.critRatingsTo != null ? Number(f.critRatingsTo) : null;

  const out = []; const skipped = { noMobile: 0, optedOut: 0, alreadyMessaged: 0, filtered: 0, deadNumber: 0 };
  let scanned = 0; let matched = 0;
  for (const c of Object.values(calls)) {
    if (!c || !c.name) continue;
    if (exclude.has(c.key)) continue; // already queued in this campaign
    scanned++;
    const st = (idx[c.key] && idx[c.key].status) || '';
    const crit = c.crit || {};
    if (wantCat) { const hay = (String(c.tag || '') + ' ' + String(c.category || '')).toLowerCase(); if (hay.indexOf(wantCat) < 0 && hay.indexOf(wantCatAlt) < 0) { skipped.filtered++; continue; } }
    if (wantLoc && (String(c.location || '') + ' ' + String(crit.location || '')).toLowerCase().indexOf(wantLoc) < 0) { skipped.filtered++; continue; }
    const ed = enr[c.key] || {};
    // website: actual status from the record, then the Google enrichment, then the old search stamp
    if (wantSite !== 'any') {
      const recWeb = (c.web === 'has' || c.web === 'none') ? c.web
        : ((ed.web === 'has' || ed.web === 'none') ? ed.web
        : ((crit.website === 'has' || crit.website === 'none') ? crit.website : null));
      if (!recWeb || recWeb !== wantSite) { skipped.filtered++; continue; }
    }
    // reviews: the business's ACTUAL Google review count (record, then enrichment)
    if (rFrom != null || rTo != null) {
      const rev = (c.reviews != null) ? Number(c.reviews) : (ed.reviews != null ? Number(ed.reviews) : null);
      if (rev == null) { skipped.filtered++; continue; }
      if ((rFrom != null && rev < rFrom) || (rTo != null && rev > rTo)) { skipped.filtered++; continue; }
    }
    if (wantStatus === 'new' ? st !== '' : (wantStatus !== 'any' && st !== wantStatus)) { skipped.filtered++; continue; }
    const mob = ukMobile(c.phone);
    if (!mob) { skipped.noMobile++; continue; }
    if (chk[c.key] && chk[c.key].valid === false) { skipped.deadNumber++; continue; }
    if (optout.has(mob)) { skipped.optedOut++; continue; }
    if (notMessaged && already.has(c.key)) { skipped.alreadyMessaged++; continue; }
    matched++;
    if (out.length < max) out.push({ key: c.key, name: c.name, location: c.location || '', category: c.tag || c.category || '', phone: mob });
  }
  return { items: out, skipped: skipped, scanned: scanned, matched: matched };
}

module.exports = { buildAudience };

// 📞 Call List: businesses queued for a phone call (the safe first-touch).
// Stored server-side in Blob (calls/_list.json) so the list built on desktop is
// there on the phone when out making calls. Status + notes reuse the existing
// CRM (/api/note keyed by the same key), so the Call List, All Leads and Lead
// Profile all show one status. Login-gated.
// GET            -> { calls: [entries] }
// POST {add}     -> add a business  (key = its mockup slug if known, else name-location)
// POST {remove}  -> remove by key
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { tenantPrefix, emailOf, accountEmailOf } = require('../lib/tenant');
const { requirePermission, account } = require('../lib/access');
const { logActivity } = require('../lib/db');

async function readList(PATH) {
  try {
    const { blobs } = await list({ prefix: PATH });
    const b = blobs.find((x) => x.pathname === PATH);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none yet */ }
  return {};
}

function keyFor(a) {
  const slug = String(a.slug || '').replace(/[^a-z0-9-]/gi, '');
  if (slug) return slug;
  return String((a.name || '') + '-' + (a.location || '')).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'lead';
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  const PATH = tenantPrefix(req) + 'calls/_list.json'; // owner -> 'calls/_list.json' (unchanged); other customers -> u/<hash>/calls/_list.json

  if (req.method !== 'POST') {
    if (!(await requirePermission(req, res, 'viewCallList'))) return; // team-member tab-visibility gate
    const map = await readList(PATH);
    const calls = Object.values(map).sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    res.status(200).json({ calls });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  // team-member permission gates: adding needs 'callList', removing needs 'deleteLeads'
  if (body.add && !(await requirePermission(req, res, 'callList'))) return;
  if (body.remove && !(await requirePermission(req, res, 'deleteLeads'))) return;
  const map = await readList(PATH);

  // Names of the records this request ACTUALLY added, i.e. excluding any already on the list, plus
  // how many were skipped as duplicates. The audit log records both: counting the submitted total
  // would overstate the work, but the skipped count is worth keeping, it shows when the same search
  // is being added over and over.
  let freshNames = [];
  let skipped = 0;

  // `add` may be a single business OR an array (batch add from the search page).
  // Merging them all in this ONE read-modify-write avoids the blob race that loses
  // writes when many single adds overlap.
  if (body.add) {
    const items = Array.isArray(body.add) ? body.add : [body.add];
    const fresh = items.filter((a) => a && a.name && !map[keyFor(a)]); // only genuinely-new ones count toward a cap
    freshNames = fresh.map((a) => a.name);
    skipped = items.filter((a) => a && a.name).length - freshNames.length; // already on the list
    // team-member call-list cap: they can only build up to their allowed number of records
    const acct = await account(req);
    if (acct.member && acct.limits && acct.limits.callListMax) {
      const mine = Object.values(map).filter((e) => String(e.addedBy || '').toLowerCase() === acct.email).length;
      if (mine + fresh.length > acct.limits.callListMax) {
        res.status(403).json({ error: 'limit_reached', message: 'You have reached your call-list limit (' + acct.limits.callListMax + '). Ask your admin to raise it.' });
        return;
      }
    }
    const who = acct.member ? acct.email : '';
    let added = 0;
    for (const a of items) {
      if (!a || !a.name) continue;
      const key = keyFor(a);
      // the search criteria that found this record (tag = the industry term). Kept for
      // retargeting: "text every business tagged salons in London that had no website".
      // Preserved on re-add so a context-free add (e.g. from Prowl) never wipes them.
      let crit;
      if (a.crit && typeof a.crit === 'object') {
        crit = {};
        ['industry', 'location', 'website', 'phone', 'email', 'company'].forEach((k) => { if (a.crit[k]) crit[k] = String(a.crit[k]).slice(0, 80); });
        ['ratingsFrom', 'ratingsTo'].forEach((k) => { const n = Number(a.crit[k]); if (Number.isFinite(n)) crit[k] = n; });
        if (!Object.keys(crit).length) crit = undefined;
      }
      map[key] = {
        key,
        name: String(a.name || '').slice(0, 120),
        location: String(a.location || '').slice(0, 80),
        category: String(a.category || '').slice(0, 80),
        phone: String(a.phone || '').slice(0, 30),
        placeId: String(a.placeId || '').slice(0, 80),
        slug: String(a.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120),
        mapsUrl: String(a.mapsUrl || '').slice(0, 300),
        tag: String(a.tag || '').trim().toLowerCase().slice(0, 60) || (map[key] && map[key].tag) || undefined,
        crit: crit || (map[key] && map[key].crit) || undefined,
        addedAt: (map[key] && map[key].addedAt) || new Date().toISOString(),
        addedBy: (map[key] && map[key].addedBy) || who || undefined,
      };
      added++;
    }
    if (!added) { res.status(400).json({ error: 'Nothing to add.' }); return; }
  } else if (body.remove) {
    delete map[String(body.remove)];
  } else if (body.retag) {
    // one-off backfill: records that pre-date tagging get their Google category as the tag,
    // which is the best signal we still have (the original search terms were never stored)
    let n = 0;
    Object.values(map).forEach((c) => {
      if (c && !c.tag && c.category) { c.tag = String(c.category).trim().toLowerCase().slice(0, 60); n++; }
    });
    if (!n) { res.status(200).json({ ok: true, tagged: 0 }); return; }
    try { await put(PATH, JSON.stringify(map), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
    catch (e) { res.status(500).json({ error: 'Could not save the tags.' }); return; }
    res.status(200).json({ ok: true, tagged: n });
    return;
  } else {
    res.status(400).json({ error: 'Nothing to do.' });
    return;
  }

  try { await put(PATH, JSON.stringify(map), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
  catch (e) { res.status(500).json({ error: 'Could not save the call list.' }); return; }
  // audit. The detail always ends with the number ACTUALLY added in brackets, which is what the
  // Activity report sums. `meta` carries the duplicate count alongside it, so a batch that added
  // nothing still tells the story rather than vanishing.
  if (body.add) {
    const dup = skipped ? (', ' + skipped + ' already on the list') : '';
    const detail = freshNames.length
      ? (freshNames.slice(0, 5).join(', ') + (freshNames.length > 5 ? ' +' + (freshNames.length - 5) + ' more' : '') + dup + ' (' + freshNames.length + ')')
      : ('Nothing new, all ' + skipped + ' already on the list (0)');
    await logActivity(emailOf(req), accountEmailOf(req), 'call_add', detail, null, { added: freshNames.length, skipped: skipped });
  } else if (body.remove) {
    await logActivity(emailOf(req), accountEmailOf(req), 'call_remove', String(body.remove));
  }
  res.status(200).json({ ok: true, count: Object.keys(map).length });
};

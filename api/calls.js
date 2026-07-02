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
const { tenantPrefix } = require('../lib/tenant');

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
    const map = await readList(PATH);
    const calls = Object.values(map).sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    res.status(200).json({ calls });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const map = await readList(PATH);

  // `add` may be a single business OR an array (batch add from the search page).
  // Merging them all in this ONE read-modify-write avoids the blob race that loses
  // writes when many single adds overlap.
  if (body.add) {
    const items = Array.isArray(body.add) ? body.add : [body.add];
    let added = 0;
    for (const a of items) {
      if (!a || !a.name) continue;
      const key = keyFor(a);
      map[key] = {
        key,
        name: String(a.name || '').slice(0, 120),
        location: String(a.location || '').slice(0, 80),
        category: String(a.category || '').slice(0, 80),
        phone: String(a.phone || '').slice(0, 30),
        placeId: String(a.placeId || '').slice(0, 80),
        slug: String(a.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120),
        mapsUrl: String(a.mapsUrl || '').slice(0, 300),
        addedAt: (map[key] && map[key].addedAt) || new Date().toISOString(),
      };
      added++;
    }
    if (!added) { res.status(400).json({ error: 'Nothing to add.' }); return; }
  } else if (body.remove) {
    delete map[String(body.remove)];
  } else {
    res.status(400).json({ error: 'Nothing to do.' });
    return;
  }

  try { await put(PATH, JSON.stringify(map), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
  catch (e) { res.status(500).json({ error: 'Could not save the call list.' }); return; }
  res.status(200).json({ ok: true, count: Object.keys(map).length });
};

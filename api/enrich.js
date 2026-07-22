// Owner-only control for enriching the call list from Google (website presence, rating, review
// count) so the SMS filters work on OLD records too. Google Places is NOT free, so this NEVER
// runs on its own: it is armed by a click here and the worker drips it. GET = progress + cost so
// far. POST {start} arms it, POST {stop} disarms it.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');

const COST_EACH = 0.0135; // GBP per Place Details Pro call (websiteUri only, $17/1000)
const FREE_TIER = 5000;    // Google's free Place Details Pro calls per month

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

  const calls = (await readJson('calls/_list.json')) || {};
  const ctrl = (await readJson('calls/_enrich.json')) || {};
  const enr = (await readJson('calls/_enrichdata.json')) || {};
  const all = Object.values(calls).filter((c) => c && c.name);
  const done = all.filter((c) => c.web !== undefined || enr[c.key]).length; // real website data (record or backfill)
  const enrichable = all.filter((c) => c.placeId).length; // only records with a Google id can be looked up
  const todo = Math.max(0, enrichable - done);

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    body = body || {};
    if (body.stop) { ctrl.active = false; }
    else if (body.start) { ctrl.active = true; ctrl.startedAt = new Date().toISOString(); ctrl.startedBy = acct.email; }
    ctrl.spent = ctrl.spent || 0;
    await put('calls/_enrich.json', JSON.stringify(ctrl), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    res.status(200).json({ ok: true, active: !!ctrl.active });
    return;
  }

  res.status(200).json({
    active: !!ctrl.active,
    total: all.length,
    done: done,
    enrichable: enrichable,
    noId: all.length - enrichable,
    remaining: todo,
    estCost: Math.round(Math.max(0, todo - FREE_TIER) * COST_EACH * 100) / 100, // GBP AFTER the free tier
    withinFree: todo <= FREE_TIER,
    spent: Math.round((ctrl.spent || 0) * 100) / 100,
    costEach: COST_EACH,
  });
};

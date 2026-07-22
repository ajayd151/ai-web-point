// Owner-only control for enriching the call list from Google (website presence, rating, review
// count) so the SMS filters work on OLD records too. Google Places is NOT free, so this NEVER
// runs on its own: it is armed by a click here and the worker drips it. GET = progress + cost so
// far. POST {start} arms it, POST {stop} disarms it.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');

const COST_EACH = 0.025; // rough GBP per Google Place Details call (field-masked)

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
  const all = Object.values(calls).filter((c) => c && c.name);
  const done = all.filter((c) => c.web !== undefined).length; // already have real website data
  const todo = all.length - done;

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
    remaining: todo,
    estCost: Math.round(todo * COST_EACH * 100) / 100, // GBP to finish
    spent: Math.round((ctrl.spent || 0) * 100) / 100,
    costEach: COST_EACH,
  });
};

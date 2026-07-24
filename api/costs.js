// Server-side daily cost ledger, so the "today's cost" widget reflects REAL activity across the
// whole workspace (all users + the background SMS worker), not just what one browser clicked.
// Counts live in usage_daily keyed by the workspace owner email + kind 'cost:<x>', reset per day.
// GET  -> today's counts + per-unit costs + total (USD, rough).
// POST {kind} -> +1 for that kind (the client calls this whenever it does a costed action).
// The SMS worker writes its own sms / mockup / lookup counts directly via bumpDailyUsage.
const { verify, parseCookie } = require('../lib/auth');
const { accountEmailOf } = require('../lib/tenant');
const { getDailyUsage, bumpDailyUsage } = require('../lib/db');
const { todayKey } = require('../lib/digest');

// Rough USD per action. These are ESTIMATES for a quick gut-check; exact billing is on the
// Google Cloud / OpenAI / Twilio dashboards. Tune here if your bills differ.
const COST = { search: 0.05, mockup: 0.07, prowl: 0.05, pounce: 0.06, sms: 0.045, lookup: 0.01 };
const KINDS = Object.keys(COST);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in.' }); return; }
  const account = accountEmailOf(req); // the workspace owner email (team members roll up to it)
  const day = todayKey(new Date());

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    const kind = String((body && body.kind) || '');
    const n = Math.min(Math.max(Number(body && body.n) || 1, 1), 100);
    if (COST[kind] && account) { try { await bumpDailyUsage(account, 'cost:' + kind, n, day); } catch (e) { /* soft */ } }
    res.status(200).json({ ok: true });
    return;
  }

  const counts = {}; let total = 0;
  for (const k of KINDS) {
    const c = account ? await getDailyUsage(account, 'cost:' + k, day) : 0;
    counts[k] = c; total += c * COST[k];
  }
  res.status(200).json({ counts: counts, cost: COST, total: total, day: day });
};

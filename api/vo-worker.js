// Video Outreach cron worker (vercel.json: every 10 minutes). Continues resumable sourcing runs,
// starts scheduled campaigns when due, re-checks stale prospects, runs the LinkedIn automation ticks
// and sends auto follow-ups where a campaign has that switched on. Cron or the signed-in owner only.
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach } = require('../lib/access');
const db = require('../lib/vo-db');
const J = require('../lib/vo-jobs');

function isCron(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.includes('vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && String((req.headers && req.headers.authorization) || '') === 'Bearer ' + secret;
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let ok = isCron(req);
  if (!ok && verify(parseCookie(req, 'aiwp'), Date.now())) { const a = await account(req); ok = canVideoOutreach(a.email, a); }
  if (!ok) { res.status(401).json({ error: 'Cron only.' }); return; }
  const base = process.env.APP_BASE_URL || 'https://www.sitepounce.com';
  const started = Date.now(); const out = { ticks: [] };
  try {
    const accounts = await db.allAccounts();
    for (const acct of accounts) {
      const left = 280000 - (Date.now() - started); if (left < 15000) { out.truncated = true; break; }
      out.ticks.push(await J.tick(acct, 'worker', { base: base, runBudgetMs: Math.min(left - 10000, 200000) }));
    }
  } catch (e) { out.error = e.message; }
  out.ms = Date.now() - started;
  res.status(200).json(out);
};

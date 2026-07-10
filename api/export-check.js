// Gate CSV exports for team members with a per-day records cap. The client calls this
// with the row count BEFORE downloading. Owners/customers and members without an
// exportPerDay cap are always allowed. Records the usage on approval.
const { verify, parseCookie } = require('../lib/auth');
const { account } = require('../lib/access');
const { getDailyUsage, bumpDailyUsage } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  const cap = acct.member && acct.limits ? acct.limits.exportPerDay : null;
  if (!cap) { res.status(200).json({ ok: true, unlimited: true }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  const rows = Math.max(0, Math.floor(Number((body && body.rows)) || 0));
  const day = new Date().toISOString().slice(0, 10);
  const used = await getDailyUsage(acct.email, 'export', day);
  const remaining = Math.max(0, cap - used);
  if (used + rows > cap) {
    res.status(403).json({ ok: false, error: 'limit_reached', cap: cap, used: used, remaining: remaining,
      message: 'You can export ' + cap + ' records per day. You have ' + remaining + ' left today.' });
    return;
  }
  await bumpDailyUsage(acct.email, 'export', rows, day);
  res.status(200).json({ ok: true, remaining: cap - (used + rows) });
};

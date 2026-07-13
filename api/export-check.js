// Gate + audit CSV exports. The client calls this with the row count and a kind
// (which export) BEFORE downloading. It records the export for the activity report
// (everyone), and for team members with an exportPerDay cap it enforces + counts it.
const { verify, parseCookie } = require('../lib/auth');
const { account } = require('../lib/access');
const { emailOf, accountEmailOf } = require('../lib/tenant');
const { getDailyUsage, bumpDailyUsage, logActivity } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  const rows = Math.max(0, Math.floor(Number((body && body.rows)) || 0));
  const kind = String((body && body.kind) || 'CSV').slice(0, 60);

  const cap = acct.member && acct.limits ? acct.limits.exportPerDay : null;
  if (cap) {
    const day = new Date().toISOString().slice(0, 10);
    const used = await getDailyUsage(acct.email, 'export', day);
    const remaining = Math.max(0, cap - used);
    if (used + rows > cap) {
      res.status(403).json({ ok: false, error: 'limit_reached', cap: cap, used: used, remaining: remaining,
        message: 'You can export ' + cap + ' records per day. You have ' + remaining + ' left today.' });
      return;
    }
    await bumpDailyUsage(acct.email, 'export', rows, day);
  }
  await logActivity(emailOf(req), accountEmailOf(req), 'csv_export', kind + ' (' + rows + ' rows)');
  res.status(200).json({ ok: true });
};

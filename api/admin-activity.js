// Owner-only per-person activity report. GET (no email) -> list of people you can pick
// (team members + customers). GET ?email=X&days=N -> that person's activity report.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { listTeamMembers, listUsers, activityReport } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const q = req.query || {};

  if (q.email) {
    const from = q.from ? String(q.from) : null;
    const to = q.to ? String(q.to) : null;
    const report = await activityReport(String(q.email).toLowerCase(), from, to);
    res.status(200).json({ report: report || { counts: [], recent: [] } });
    return;
  }

  // people picker: team members + customers + you
  const map = {};
  const put = (email, name, type) => { const e = String(email || '').toLowerCase(); if (!e) return; if (!map[e]) map[e] = { email: e, name: name || '', type: type }; };
  put(acct.email, 'You (owner)', 'You');
  (await listTeamMembers(acct.email)).forEach((m) => put(m.member_email, ((m.first_name || '') + ' ' + (m.last_name || '')).trim(), 'Team'));
  (await listUsers()).forEach((u) => put(u.email, '', 'Customer'));
  const people = Object.values(map);
  res.status(200).json({ people: people });
};

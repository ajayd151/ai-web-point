// Owner-only counts for the Admin overview dashboard. Read-only, fails soft to zeros.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { listTeamMembers, feedbackCounts, countActiveCustomers } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  const members = await listTeamMembers(acct.email);
  const active = members.filter((m) => !m.suspended).length;
  const feedback = await feedbackCounts();
  const customers = await countActiveCustomers();

  res.status(200).json({
    team: { total: members.length, active: active, suspended: members.length - active },
    feedback: feedback, // { total, new, done, ignored }
    customers: customers,
  });
};

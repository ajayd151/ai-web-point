// A team member has just set their own password (via Clerk on the client). Clear their
// must_change flag so they are not prompted again. Member-only; fails soft.
const { verify, parseCookie } = require('../lib/auth');
const { account } = require('../lib/access');
const { clearMustChange } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (acct.member) { try { await clearMustChange(acct.email); } catch (e) { /* ignore */ } }
  res.status(200).json({ ok: true });
};

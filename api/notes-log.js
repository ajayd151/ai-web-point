// Owner-only centralised notes: every note anyone in the workspace has written, with
// who wrote it and on which business. GET ?email=X filters to one author.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { notesLog } = require('../lib/db');
const { accountEmailOf } = require('../lib/tenant');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const q = req.query || {};
  const notes = await notesLog(accountEmailOf(req), { author: q.email ? String(q.email).toLowerCase() : null, limit: q.limit });
  res.status(200).json({ notes: notes });
};

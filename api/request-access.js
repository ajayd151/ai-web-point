// A team member hit a limit or a blocked feature and asked for more access.
// Emails their account owner so it can be granted manually in Admin > Team.
const { verify, parseCookie } = require('../lib/auth');
const { account } = require('../lib/access');
const { getTeamMember } = require('../lib/db');
const { sendAccessRequestEmail } = require('../lib/email');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const acct = await account(req);
  if (!acct.member) { res.status(200).json({ ok: true }); return; } // only team members request

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  const feature = String((body && body.feature) || 'more access').slice(0, 80);
  const note = String((body && body.note) || '').slice(0, 500);

  let owner = '';
  try { const tm = await getTeamMember(acct.email); owner = tm ? tm.owner_email : ''; } catch (e) { /* ignore */ }
  await sendAccessRequestEmail({ ownerEmail: owner, memberEmail: acct.email, feature: feature, note: note });
  res.status(200).json({ ok: true });
};

// Owner-only Team management (Admin -> Team). Lets the account owner invite a colleague
// to SHARE their workspace: the member logs in with their own email but sees the same
// leads/call list/searches, free (comped) on the owner's plan. Add / suspend / remove.
//   GET                          -> { members: [...] }
//   POST {action:'add', email}   -> add (or re-activate) a member
//   POST {action:'suspend'|'unsuspend'|'remove', email}
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped, PERM_KEYS, cleanLimits } = require('../lib/access');
const { listTeamMembers, addTeamMember, setTeamSuspended, setTeamPermissions, removeTeamMember, getUserByEmail } = require('../lib/db');
const { sendTeamInviteEmail, sendTeamAddedAdminEmail } = require('../lib/email');
const { createClerkUser } = require('../lib/clerkadmin');
const crypto = require('crypto');

// Readable random starting password (no ambiguous chars).
function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.randomBytes(14);
  let out = ''; for (let i = 0; i < 14; i++) out += chars[buf[i] % chars.length];
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Keep only known permission keys, coerced to booleans.
function cleanPerms(p) {
  const out = {}; const src = p || {};
  PERM_KEYS.forEach((k) => { out[k] = src[k] !== false; }); // default allow unless explicitly false
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const owner = acct.email; // the account this team belongs to

  if (req.method === 'GET') {
    res.status(200).json({ members: await listTeamMembers(owner) });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Enter a valid email address.' }); return; }
  if (email === owner) { res.status(400).json({ error: "That's your own account." }); return; }

  if (action === 'add') {
    const firstName = String(body.firstName || '').trim().slice(0, 60);
    const lastName = String(body.lastName || '').trim().slice(0, 60);
    if (!firstName || !lastName) { res.status(400).json({ error: 'First name and surname are required.' }); return; }
    // Don't hijack someone who already pays for their own separate subscription.
    try { const u = await getUserByEmail(email); if (u && ['active', 'trialing'].includes(u.status)) { res.status(409).json({ error: 'That email already has its own paid account.' }); return; } } catch (e) { /* ignore */ }
    // Create their login so they can just SIGN IN (no separate signup). A generated
    // starting password is returned to the owner once; the member is forced to change
    // it on first login (must_change).
    const password = genPassword();
    let created = { ok: false };
    try { created = await createClerkUser({ email: email, firstName: firstName, lastName: lastName, password: password }); } catch (e) { created = { error: 'failed' }; }
    const ok = await addTeamMember(owner, email, firstName, lastName, cleanPerms(body.permissions), cleanLimits(body.limits), !!created.ok);
    if (!ok) { res.status(500).json({ error: 'Could not add, please try again.' }); return; }
    // Emails: notify the admin; invite the member (fail soft, awaited for Vercel).
    await sendTeamInviteEmail({ to: email, firstName: firstName, ownerEmail: owner, hasPassword: !!created.ok });
    await sendTeamAddedAdminEmail({ adminTo: owner, memberName: (firstName + ' ' + lastName).trim(), memberEmail: email });
    res.status(200).json({ ok: true, tempPassword: created.ok ? password : null, accountExisted: !!created.exists }); return;
  }
  if (action === 'permissions') {
    const ok = await setTeamPermissions(owner, email, cleanPerms(body.permissions), cleanLimits(body.limits));
    if (!ok) { res.status(404).json({ error: 'Member not found.' }); return; }
    res.status(200).json({ ok: true }); return;
  }
  if (action === 'suspend' || action === 'unsuspend') {
    const ok = await setTeamSuspended(owner, email, action === 'suspend');
    if (!ok) { res.status(404).json({ error: 'Member not found.' }); return; }
    res.status(200).json({ ok: true }); return;
  }
  if (action === 'remove') {
    const ok = await removeTeamMember(owner, email);
    if (!ok) { res.status(404).json({ error: 'Member not found.' }); return; }
    res.status(200).json({ ok: true }); return;
  }
  res.status(400).json({ error: 'Unknown action.' });
};

// Owner-only: everyone who has signed up, with their plan + status. Merges Clerk sign-ups
// (the accounts) with our users table (plan/status/Stripe id). Read-only, fails soft.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { listUsers } = require('../lib/db');
const { listClerkUsers } = require('../lib/clerkadmin');

function iso(ms) { try { return ms ? new Date(Number(ms)).toISOString() : null; } catch (e) { return null; } }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  const dbUsers = await listUsers();
  const clerk = await listClerkUsers(300); // null if Clerk secret not set, [] on error

  const map = {};
  const put = (email, obj) => { const e = String(email || '').toLowerCase(); if (!e) return; map[e] = Object.assign(map[e] || { email: e }, obj); };

  if (Array.isArray(clerk)) {
    clerk.forEach((c) => put(c.email, { name: c.name, clerkId: c.clerkId, signedUp: iso(c.createdAt), lastActive: iso(c.lastSignInAt) }));
  }
  dbUsers.forEach((u) => put(u.email, {
    plan: u.plan, status: u.status, founding: u.founding,
    stripeCustomerId: u.stripe_customer_id, dbCreated: u.created_at,
  }));

  const customers = Object.values(map).map((c) => ({
    email: c.email,
    name: c.name || '',
    plan: c.plan || 'none',
    status: c.status || 'signed up', // no db row = signed up but never subscribed
    signedUp: c.signedUp || c.dbCreated || null,
    lastActive: c.lastActive || null,
    stripeCustomerId: c.stripeCustomerId || '',
    founding: !!c.founding,
  }));
  customers.sort((a, b) => String(b.signedUp || '').localeCompare(String(a.signedUp || '')));

  res.status(200).json({ customers: customers, source: Array.isArray(clerk) ? 'clerk+db' : 'db-only' });
};

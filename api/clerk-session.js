// Exchanges a verified Clerk session token for the app's existing `aiwp` session
// cookie. This is the ONLY place Clerk is checked on the backend, so every other
// protected endpoint keeps working unchanged. Dormant until CLERK_SECRET_KEY is
// set in Vercel, and nobody gets in unless their email is in ALLOWED_EMAILS.
const { sign } = require('../lib/auth');
const { verifyClerkToken } = require('../lib/clerkauth');
const { getTeamMember } = require('../lib/db');

const ISSUER = process.env.CLERK_ISSUER || 'https://major-cod-60.clerk.accounts.dev';

function isAllowed(email) {
  const list = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false; // safe default: nobody until the allow-list is set
  return list.includes(String(email || '').toLowerCase());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  // on-switch: stays dormant until the Clerk secret is configured in Vercel
  if (!process.env.CLERK_SECRET_KEY && !process.env.CLERK_ENABLED) {
    res.status(503).json({ error: 'Clerk is not enabled yet.' });
    return;
  }
  try {
    const authH = (req.headers && req.headers.authorization) || '';
    let token = authH.startsWith('Bearer ') ? authH.slice(7) : '';
    if (!token && req.body) {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
      token = (b && b.token) || '';
    }
    const claims = await verifyClerkToken(token, ISSUER);
    if (!claims) { res.status(401).json({ error: 'Invalid session.' }); return; }

    const email = claims.email || '';
    // Two modes:
    //  - default (SIGNUP_OPEN unset): allow-list only, so the live app is owner-only
    //    exactly as before, nothing changes until we are ready to sell.
    //  - open (SIGNUP_OPEN=1): anyone who signs in via Clerk gets a session cookie, but
    //    paid features stay gated by subscription (see lib/access.js). This is the
    //    "public sign-up" switch we flip when going live with real Stripe billing.
    // Team member? They share their owner's workspace and don't need the allow-list or a
    // subscription. `account` is baked into the cookie so the data layer scopes them to the owner.
    let member = null;
    try { member = await getTeamMember(email); } catch (e) { /* treat as non-member */ }
    const isTeam = !!(member && !member.suspended);

    const signupOpen = process.env.SIGNUP_OPEN === '1' || process.env.SIGNUP_OPEN === 'true';
    if (!signupOpen && !isAllowed(email) && !isTeam) { res.status(403).json({ error: 'not_allowed', email }); return; }

    const account = isTeam ? String(member.owner_email || '').toLowerCase() : email;
    const cookie = sign(email, Date.now(), account);
    res.setHeader('Set-Cookie', `aiwp=${encodeURIComponent(cookie)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
    res.status(200).json({ ok: true, email });
  } catch (err) {
    res.status(500).json({ error: 'Sign-in failed.' });
  }
};

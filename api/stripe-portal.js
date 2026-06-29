// Opens the Stripe Customer Portal so a subscriber can manage or cancel their plan.
// Login-gated; looks up the user's Stripe customer id from our users table.
const { verify, identity, parseCookie } = require('../lib/auth');
const { stripeReq, configured } = require('../lib/stripe');
const { getUserByEmail } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!configured()) { res.status(503).json({ error: 'Billing is not set up yet.' }); return; }
  const token = parseCookie(req, 'aiwp');
  if (!verify(token, Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const email = (identity(token, Date.now()) || '').toLowerCase();
  try {
    const user = await getUserByEmail(email);
    if (!user || !user.stripe_customer_id) { res.status(400).json({ error: 'No subscription found for this account.' }); return; }
    const base = process.env.APP_BASE_URL || ('https://' + (req.headers['x-forwarded-host'] || req.headers.host));
    const session = await stripeReq('POST', 'billing_portal/sessions', { customer: user.stripe_customer_id, return_url: base + '/' });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not open billing portal. ' + (err.message || '') });
  }
};

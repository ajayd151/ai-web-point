// Creates a Stripe Checkout Session for the chosen tier and returns its URL.
// Login-gated (the same aiwp cookie every other endpoint uses); the signed-in
// email is attached to the session so the webhook/confirm can set their plan.
// Dormant until STRIPE_SECRET_KEY + the price IDs are configured in Vercel.
const { verify, identity, parseCookie } = require('../lib/auth');
const { stripeReq, configured } = require('../lib/stripe');

function priceFor(tier) {
  const map = { scout: process.env.STRIPE_PRICE_SCOUT, hunter: process.env.STRIPE_PRICE_HUNTER, apex: process.env.STRIPE_PRICE_APEX };
  return map[String(tier || '').toLowerCase()] || '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!configured()) { res.status(503).json({ error: 'Billing is not set up yet.' }); return; }
  const token = parseCookie(req, 'aiwp');
  if (!verify(token, Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const email = identity(token, Date.now());
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    body = body || {};
    const price = priceFor(body.tier);
    if (!price) { res.status(400).json({ error: 'Unknown plan.' }); return; }
    const base = process.env.APP_BASE_URL || ('https://' + (req.headers['x-forwarded-host'] || req.headers.host));
    const session = await stripeReq('POST', 'checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: price, quantity: 1 }],
      success_url: base + '/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/?checkout=cancel',
      customer_email: email || undefined,
      client_reference_id: email || undefined,
      allow_promotion_codes: true,
      metadata: { email: email || '', tier: String(body.tier).toLowerCase() },
      subscription_data: { metadata: { email: email || '', tier: String(body.tier).toLowerCase() } },
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not start checkout. ' + (err.message || '') });
  }
};

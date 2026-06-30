// After Stripe redirects back with a session_id, we verify the session straight
// from Stripe (the source of truth) and set the user's plan. Login-gated, and the
// session's email must match the signed-in user.
const { verify, identity, parseCookie } = require('../lib/auth');
const { stripeReq, configured } = require('../lib/stripe');
const { upsertUser, markWelcomed } = require('../lib/db');
const { sendNewCustomerEmails } = require('../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!configured()) { res.status(503).json({ error: 'Billing is not set up yet.' }); return; }
  const token = parseCookie(req, 'aiwp');
  if (!verify(token, Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const email = (identity(token, Date.now()) || '').toLowerCase();
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    const sessionId = (body && body.session_id) || '';
    if (!sessionId) { res.status(400).json({ error: 'Missing session.' }); return; }

    const s = await stripeReq('GET', 'checkout/sessions/' + encodeURIComponent(sessionId), { expand: ['subscription'] });
    const paid = s.status === 'complete' || s.payment_status === 'paid';
    const sEmail = String((s.metadata && s.metadata.email) || s.customer_email || '').toLowerCase();
    if (!paid) { res.status(402).json({ ok: false, error: 'Payment not completed.' }); return; }
    if (sEmail && email && sEmail !== email) { res.status(403).json({ ok: false, error: 'This checkout belongs to another account.' }); return; }

    const tier = String((s.metadata && s.metadata.tier) || '').toLowerCase() || 'scout';
    const sub = s.subscription && typeof s.subscription === 'object' ? s.subscription.id : s.subscription;
    const updated = await upsertUser(email || sEmail, {
      plan: tier, status: 'active', stripe_customer_id: s.customer, stripe_subscription_id: sub || null,
    });
    // first-time-only welcome + admin notification (deduped by markWelcomed)
    try {
      if (await markWelcomed(email || sEmail)) {
        const nm = (s.customer_details && s.customer_details.name) || '';
        sendNewCustomerEmails({ email: email || sEmail, name: nm, plan: tier }).catch(() => {});
      }
    } catch (e) { /* fail soft */ }
    res.status(200).json({ ok: true, plan: (updated && updated.plan) || tier });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not confirm payment. ' + (err.message || '') });
  }
};

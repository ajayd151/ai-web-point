// Stripe webhook for ongoing subscription changes (renewals, cancellations,
// failed payments). Rather than wrestle Vercel's body parser for signature
// verification, we treat the event as a NUDGE and re-fetch the real object from
// Stripe by id (the source of truth) before changing anything, so a forged event
// can't grant a plan that isn't backed by a real, active subscription.
const { stripeReq, configured } = require('../lib/stripe');
const { upsertUser, markWelcomed } = require('../lib/db');
const { sendNewCustomerEmails } = require('../lib/email');

function tierFromPrice(pid) {
  if (!pid) return '';
  if (pid === process.env.STRIPE_PRICE_SCOUT) return 'scout';
  if (pid === process.env.STRIPE_PRICE_HUNTER) return 'hunter';
  if (pid === process.env.STRIPE_PRICE_APEX) return 'apex';
  return '';
}

async function applySubscription(subId) {
  if (!subId) return;
  const sub = await stripeReq('GET', 'subscriptions/' + encodeURIComponent(subId), {});
  const email = String((sub.metadata && sub.metadata.email) || '').toLowerCase();
  if (!email) return;
  const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  const tier = (sub.metadata && sub.metadata.tier) || tierFromPrice(priceId) || 'scout';
  const active = sub.status === 'active' || sub.status === 'trialing';
  const dead = sub.status === 'canceled' || sub.status === 'incomplete_expired' || sub.status === 'unpaid';
  await upsertUser(email, {
    plan: dead ? 'none' : tier,
    status: active ? 'active' : sub.status,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
  });
  // first-time-only welcome + admin notification (deduped; only for a live subscription)
  if (active && await markWelcomed(email)) {
    let nm = '';
    try { const cust = await stripeReq('GET', 'customers/' + encodeURIComponent(sub.customer), {}); nm = (cust && cust.name) || ''; } catch (e) { /* optional */ }
    try { await sendNewCustomerEmails({ email: email, name: nm, plan: tier }); } catch (e) { /* fail soft */ }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!configured()) { res.status(200).json({ received: true }); return; }
  try {
    let evt = req.body;
    if (typeof evt === 'string') { try { evt = JSON.parse(evt || '{}'); } catch (e) { evt = {}; } }
    const type = evt && evt.type;
    const obj = (evt && evt.data && evt.data.object) || {};
    if (type === 'checkout.session.completed') {
      const s = await stripeReq('GET', 'checkout/sessions/' + encodeURIComponent(obj.id), { expand: ['subscription'] });
      const sub = s.subscription && typeof s.subscription === 'object' ? s.subscription.id : s.subscription;
      if (sub) await applySubscription(sub);
    } else if (type && type.indexOf('customer.subscription.') === 0) {
      await applySubscription(obj.id);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.status(200).json({ received: true, note: 'handled with error' });
  }
};

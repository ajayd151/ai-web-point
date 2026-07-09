// Owner-only counts for the Admin overview dashboard. Read-only, fails soft to zeros.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { listTeamMembers, feedbackCounts, countActiveCustomers } = require('../lib/db');
const { stripeReq, configured } = require('../lib/stripe');

const PLAN_BY_AMOUNT = { 2900: 'Scout', 5900: 'Hunter', 12900: 'Apex' };

// Real revenue from Stripe: active subscriptions -> monthly value per customer, MRR + ARPU.
// Amounts are gross (list price); returns null if Stripe isn't configured, or {error} on failure.
async function stripeRevenue() {
  if (!configured()) return null;
  try {
    const resp = await stripeReq('GET', 'subscriptions', { status: 'active', limit: 100, expand: ['data.customer'] });
    const subs = (resp && resp.data) || [];
    let mrrPence = 0;
    const customers = [];
    subs.forEach((s) => {
      let monthly = 0; let firstAmount = 0;
      const items = (s.items && s.items.data) || [];
      items.forEach((it) => {
        const price = it.price || {};
        const amt = (price.unit_amount || 0) * (it.quantity || 1);
        if (!firstAmount) firstAmount = price.unit_amount || 0;
        const interval = (price.recurring && price.recurring.interval) || 'month';
        monthly += interval === 'year' ? amt / 12 : (interval === 'week' ? (amt * 52) / 12 : amt);
      });
      mrrPence += monthly;
      const cust = (s.customer && typeof s.customer === 'object') ? s.customer : {};
      const plan = PLAN_BY_AMOUNT[firstAmount] || ((items[0] && items[0].price && items[0].price.nickname) || '');
      customers.push({ email: cust.email || '(unknown)', name: cust.name || '', plan: plan, monthly: Math.round(monthly) / 100 });
    });
    customers.sort((a, b) => b.monthly - a.monthly);
    const count = subs.length;
    const mrr = Math.round(mrrPence) / 100;
    return { mrr: mrr, arpu: count ? Math.round(mrrPence / count) / 100 : 0, count: count, currency: 'GBP', customers: customers };
  } catch (e) { return { error: e.message }; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  const members = await listTeamMembers(acct.email);
  const active = members.filter((m) => !m.suspended).length;
  const feedback = await feedbackCounts();
  const customers = await countActiveCustomers();
  const revenue = await stripeRevenue();

  res.status(200).json({
    team: { total: members.length, active: active, suspended: members.length - active },
    feedback: feedback, // { total, new, done, ignored }
    customers: customers,
    revenue: revenue, // { mrr, arpu, count, currency, customers:[{email,plan,monthly}] } or null / {error}
  });
};

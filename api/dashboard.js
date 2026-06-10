// Performance dashboard data: aggregates send/open/click events into stats +
// plain-English insights. Login-gated.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { dashboardData } = require('../lib/db');

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtHour(h) {
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return hr + ampm;
}
function nameFromSlug(slug) {
  return String(slug || '').replace(/-[0-9a-f]{8}$/i, '').split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ').trim() || slug;
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }

  const days = Math.max(0, parseInt((req.query && req.query.days) || '0', 10) || 0);
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;

  // total mockups generated (blob metadata files), respecting the date range
  let generated = 0;
  try {
    const { blobs } = await list({ prefix: 'mockups/', limit: 1000 });
    generated = blobs.filter((b) => b.pathname.endsWith('.json') && (!since || new Date(b.uploadedAt).toISOString() >= since)).length;
  } catch (e) { /* ignore */ }

  // CRM statuses (slug -> status) from the notes index
  let statuses = {};
  const declineReasonCount = {};
  try {
    const { blobs } = await list({ prefix: 'notes/_index.json' });
    const b = blobs.find((x) => x.pathname === 'notes/_index.json');
    if (b) {
      const idx = await (await fetch(b.url + '?t=' + Date.now())).json();
      for (const k in idx) {
        if (idx[k] && idx[k].status) statuses[k] = idx[k].status;
        if (idx[k] && idx[k].status === 'declined' && idx[k].declineReason) declineReasonCount[idx[k].declineReason] = (declineReasonCount[idx[k].declineReason] || 0) + 1;
      }
    }
  } catch (e) { /* ignore */ }
  const declineReasons = Object.keys(declineReasonCount).map((r) => ({ reason: r, n: declineReasonCount[r] })).sort((a, b) => b.n - a.n);

  const d = await dashboardData(since);
  if (!d) { res.status(200).json({ configured: false, generated, statuses }); return; }

  const counts = {};
  d.counts.forEach((c) => { counts[c.event] = c; });
  const sent = (counts.sent && counts.sent.slugs) || 0;
  const opened = (counts.view && counts.view.slugs) || 0;
  const demoClicks = (counts.cta && counts.cta.slugs) || 0;
  const signups = (counts.signup && counts.signup.slugs) || 0;
  const declined = (counts.decline && counts.decline.slugs) || 0;
  const openRate = sent ? Math.round((opened / sent) * 100) : 0;
  const demoRate = sent ? Math.round((demoClicks / sent) * 100) : 0;
  const declineRate = opened ? Math.round((declined / opened) * 100) : 0;
  const signupRate = sent ? Math.round((signups / sent) * 100) : 0;

  const ch = { w: { sent: 0, opened: 0, rate: 0 }, s: { sent: 0, opened: 0, rate: 0 } };
  d.channel.forEach((r) => {
    if (!ch[r.platform]) return;
    if (r.event === 'sent') ch[r.platform].sent = r.slugs;
    if (r.event === 'view') ch[r.platform].opened = r.slugs;
  });
  ['w', 's'].forEach((c) => { ch[c].rate = ch[c].sent ? Math.round((ch[c].opened / ch[c].sent) * 100) : 0; });

  const hours = Array.from({ length: 24 }, (_, h) => ({ h, n: 0 }));
  d.byHour.forEach((r) => { if (hours[r.h]) hours[r.h].n = r.n; });
  const dows = Array.from({ length: 7 }, (_, dd) => ({ d: dd, n: 0 }));
  d.byDow.forEach((r) => { if (dows[r.d]) dows[r.d].n = r.n; });

  const avgTto = d.avgTtoMin != null ? Math.round(d.avgTtoMin) : null;

  const rows = d.rows.map((r) => ({
    slug: r.slug,
    name: nameFromSlug(r.slug),
    sentAt: r.sent_at,
    sentVia: r.sent_via || '',
    openedAt: r.opened_at,
    opens: r.opens,
    demoClicks: r.demo_clicks,
    signedUp: (r.signups || 0) > 0,
  }));

  // ---- insights / recommendations ----
  const insights = [];
  if (sent === 0) {
    insights.push('No sends logged yet, message a few businesses (WhatsApp/SMS) and your stats will start building here automatically.');
  } else {
    insights.push(`You've messaged ${sent} ${sent === 1 ? 'business' : 'businesses'}; ${opened} viewed their mockup, a ${openRate}% view rate.`);
    if (avgTto != null) {
      insights.push(avgTto < 90
        ? `People typically open within about ${avgTto} minute${avgTto === 1 ? '' : 's'} of you sending.`
        : `People typically open within about ${(avgTto / 60).toFixed(1)} hours of you sending.`);
    }
    if (opened >= 5) {
      const bestH = hours.slice().sort((a, b) => b.n - a.n)[0];
      if (bestH.n > 0) insights.push(`Opens peak around ${fmtHour(bestH.h)} (UK time), try sending in the hour or two before then.`);
      const bestD = dows.slice().sort((a, b) => b.n - a.n)[0];
      if (bestD.n > 0) insights.push(`${DOW[bestD.d]} is your strongest day for opens so far.`);
    } else {
      insights.push('Once you have a handful more opens (5+), I\'ll start recommending the best times and days to send.');
    }
    if (ch.w.sent >= 3 && ch.s.sent >= 3) {
      const better = ch.w.rate >= ch.s.rate ? 'WhatsApp' : 'SMS';
      insights.push(`${better} is converting better so far, WhatsApp ${ch.w.rate}% vs SMS ${ch.s.rate}% view rate.`);
    }
    if (demoClicks > 0) {
      insights.push(`${demoClicks} ${demoClicks === 1 ? 'prospect' : 'prospects'} clicked "Request a demo", chase those first, they're warmest.`);
    } else if (opened >= 5) {
      insights.push('No demo clicks yet, consider a follow-up nudge to the people who opened but didn\'t click.');
    }
    if (signups > 0) {
      insights.push(`🤑 ${signups} ${signups === 1 ? 'prospect' : 'prospects'} clicked "Yes, sign me up" on a preview, your hottest signal. Call them before anything else.`);
    }
    if (declined > 0) {
      const top = declineReasons[0];
      insights.push(`🙅 ${declined} ${declined === 1 ? 'prospect' : 'prospects'} clicked "No thanks" on the mockup${top ? ` (top reason: "${top.reason}")` : ''}. They are auto-marked "Not interested (via mockup)", separate from the leads you mark not interested yourself, so you will not chase them.`);
    }
  }

  res.status(200).json({
    configured: true,
    generated,
    statuses,
    declineReasons,
    totals: { generated, sent, opened, demoClicks, signups, declined },
    rates: { openRate, demoRate, signupRate, declineRate },
    avgTtoMin: avgTto,
    byChannel: ch,
    opensByHour: hours,
    opensByDow: dows,
    rows,
    insights,
  });
};

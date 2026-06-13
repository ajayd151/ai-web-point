// PUBLIC: a visitor submitted the contact/quote form on a Pounce site (/s/<slug>
// or a client subdomain). Store-first (the lead is saved to Blob so it's never
// lost and costs nothing), then a best-effort SendGrid notification on top.
// No auth (the visitor isn't logged in). Anti-spam / abuse caps:
//   - a honeypot field + the slug must map to a real site,
//   - a per-IP throttle (default 5/hour) drops bot floods silently, and
//   - a per-site daily cap (default 50/day) on email-sending enquiries: over the
//     cap the lead is STILL stored (shows in the inbox) but no email is sent, so
//     no single site can run away with the SendGrid quota or the sender reputation.
// Both caps use append-only event blobs counted via list() (race-safe: no
// read-modify-write), and are env-overridable (CONTACT_IP_HOURLY / CONTACT_SITE_DAILY).
const crypto = require('crypto');
const { list, put, del } = require('@vercel/blob');

const IP_WINDOW_MS = 60 * 60 * 1000;                            // per-IP throttle window: 1 hour
const SITE_WINDOW_MS = 24 * 60 * 60 * 1000;                     // per-site cap window: 24 hours
const IP_MAX = Number(process.env.CONTACT_IP_HOURLY || 5);     // max submissions per IP per hour
const SITE_MAX = Number(process.env.CONTACT_SITE_DAILY || 50); // max email-sending enquiries per site per day
const CLRL_RE = /^clrl\/(\d+)-([0-9a-f]+)-(.+)__[0-9a-f]+\.txt$/;

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

function ipHash(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || String(req.headers['x-real-ip'] || '') || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12); // hashed, no raw IP stored
}

// Count recent submissions per-IP (1h) and per-site (24h) from the append-only
// event blobs, and prune events older than the 24h window. No read-modify-write.
async function enquiryUsage(slug, iph, nowMs) {
  let blobs;
  try { blobs = (await list({ prefix: 'clrl/' })).blobs || []; }
  catch (e) { return { degraded: true, ipCount: 0, siteCount: 0 }; } // storage hiccup, fail open
  const events = blobs.map((b) => {
    const m = b.pathname.match(CLRL_RE);
    return m ? { t: Number(m[1]), iph: m[2], slug: m[3], url: b.url } : null;
  }).filter(Boolean);
  const expired = events.filter((e) => nowMs - e.t >= SITE_WINDOW_MS);
  if (expired.length) { try { await del(expired.map((e) => e.url)); } catch (e) {} }
  return {
    ipCount: events.filter((e) => e.iph === iph && nowMs - e.t < IP_WINDOW_MS).length,
    siteCount: events.filter((e) => e.slug === slug && nowMs - e.t < SITE_WINDOW_MS).length,
  };
}

async function recordEnquiry(slug, iph, nowMs) {
  try {
    await put(`clrl/${nowMs}-${iph}-${slug}__${crypto.randomUUID().slice(0, 8)}.txt`, '1', {
      access: 'public', addRandomSuffix: false, contentType: 'text/plain',
    });
  } catch (e) { /* best effort */ }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST.' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};

  // honeypot: real people leave _hp empty; bots fill every field. Pretend success, drop it.
  if (String(body._hp || '').trim()) { res.status(200).json({ ok: true }); return; }

  const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n]{3,}/g, '\n\n').trim().slice(0, n);
  const lead = {
    name: clip(body.name, 120),
    phone: clip(body.phone, 40),
    email: clip(body.email, 160),
    service: clip(body.service, 120),
    message: clip(body.message, 2000),
  };
  if (!slug || !lead.name || (!lead.phone && !lead.email)) { res.status(400).json({ error: 'Missing details.' }); return; }

  // the slug must map to a real Pounce site (stops spam to made-up slugs, and gives us the business name)
  const site = await readJson('sites/' + slug + '.json');
  if (!site) { res.status(404).json({ error: 'Unknown site.' }); return; }
  const bizName = (site.business && site.business.name) || slug;

  // abuse caps (per-IP throttle + per-site daily email cap)
  const nowMs = Date.now();
  const iph = ipHash(req);
  const usage = await enquiryUsage(slug, iph, nowMs);

  // per-IP throttle: a real person never needs >5/hour. Over that = a bot; drop
  // silently (no store, no email, no reveal) to protect the inbox + sender reputation.
  if (usage.ipCount >= IP_MAX) {
    if (body._debug === 'aiwp') { res.status(200).json({ ok: true, blocked: 'ip', ipCount: usage.ipCount, ipMax: IP_MAX }); return; }
    res.status(200).json({ ok: true }); return;
  }
  const siteCapped = usage.siteCount >= SITE_MAX; // over the daily cap: store but don't email
  if (!usage.degraded) await recordEnquiry(slug, iph, nowMs); // count this accepted submission

  const now = new Date().toISOString();
  const entry = Object.assign({ slug, business: bizName, receivedAt: now, ua: String(req.headers['user-agent'] || '').slice(0, 200) }, lead);

  // 1) store-first: the durable record (free, never lost) — happens even when capped
  try { await put('leads/' + slug + '/' + nowMs + '.json', JSON.stringify(entry), { access: 'public', contentType: 'application/json', addRandomSuffix: true }); }
  catch (e) { /* storage hiccup, still try to email below */ }

  // 2) best-effort notifications via SendGrid. The lead is already stored above, so
  // any email failure is non-fatal.
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.ERROR_EMAIL_FROM;             // a verified SendGrid sender
  const operator = process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO; // you
  const agency = process.env.AGENCY_NAME || 'Ai Web Point';
  const agencyUrl = process.env.AGENCY_URL || 'https://aiwebpoint.com';

  // The business's own live address, built from TRUSTED server data (the subdomain we
  // assigned at publish time), never from visitor input. Only set once the site is live.
  const SUBDOMAIN_ROOT = process.env.SUBDOMAIN_ROOT || 'aiwebpoint.com';
  const businessHost = site.subdomain ? site.subdomain + '.' + SUBDOMAIN_ROOT : '';
  const businessUrl = businessHost ? 'https://' + businessHost : '';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const br = (s) => esc(s).replace(/\n/g, '<br>');
  // The plain-text signature carries NO raw URL (a bare link reads as spammy); the
  // HTML version turns "Powered by Ai Web Point" into a tidy clickable link instead.
  const sigText = '\n\nPowered by ' + agency;
  const sigHtml = '<p style="margin:22px 0 0;color:#9097a3;font-size:13px">Powered by ' +
    '<a href="' + agencyUrl + '" style="color:#9097a3">' + esc(agency) + '</a></p>';
  const htmlWrap = (inner) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6">' + inner + sigHtml + '</div>';
  // Transactional mail: turn OFF SendGrid click + open tracking so links are never
  // rewritten to ct.sendgrid.net (which looks like phishing) and no pixel is added.
  const trackingOff = { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } };

  // Who should receive the enquiry: the business owner if one was set at build time,
  // otherwise you. When it goes to the owner, you get a silent BCC for visibility.
  const ownerEmail = (site.leadEmail || '').trim();
  const ownerName = (site.leadName || '').trim();
  const notifyTo = ownerEmail || operator;

  const diag = {}; // temporary: surfaces what SendGrid did (no email addresses leaked)
  const send = async (label, payload) => {
    try {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(payload),
      });
      diag[label] = r.status;
      if (r.status >= 400) diag[label + '_err'] = (await r.text().catch(() => '')).slice(0, 200);
    } catch (e) { diag[label] = 'fetch_error'; diag[label + '_err'] = String(e && e.message || e).slice(0, 120); }
  };

  if (!siteCapped && key && from && notifyTo) {
    // a) notify the business (owner, or you) that a new enquiry came in
    const personal = { to: [{ email: notifyTo, name: ownerName || undefined }] };
    const bcc = new Set();
    if (ownerEmail && operator && operator.toLowerCase() !== ownerEmail.toLowerCase()) bcc.add(operator); // keep your own copy when it routes to the client
    const alwaysBcc = (process.env.LEAD_BCC_ALWAYS || '').trim(); // optional: a copy of EVERY enquiry (testing / oversight)
    if (alwaysBcc && alwaysBcc.toLowerCase() !== String(notifyTo).toLowerCase()) bcc.add(alwaysBcc);
    if (bcc.size) personal.bcc = [...bcc].map((email) => ({ email }));
    const ownerText = 'You have a new website enquiry' + (ownerName ? ', ' + ownerName : '') + '.\n\n' +
      'Name: ' + lead.name + '\nPhone: ' + (lead.phone || '(none)') + '\nEmail: ' + (lead.email || '(none)') + '\n' +
      'Service: ' + (lead.service || '(not specified)') + '\n\nMessage:\n' + (lead.message || '(none)') + '\n\n' +
      'Reply to this email to respond to ' + lead.name + ' directly.\nReceived: ' + now + sigText;
    const ownerHtml = htmlWrap(
      '<p>You have a new website enquiry' + (ownerName ? ', ' + esc(ownerName) : '') + '.</p>' +
      '<p><b>Name:</b> ' + esc(lead.name) + '<br><b>Phone:</b> ' + esc(lead.phone || '(none)') +
      '<br><b>Email:</b> ' + esc(lead.email || '(none)') + '<br><b>Service:</b> ' + esc(lead.service || '(not specified)') + '</p>' +
      '<p><b>Message:</b><br>' + br(lead.message || '(none)') + '</p>' +
      '<p>Reply to this email to respond to ' + esc(lead.name) + ' directly.</p>' +
      '<p style="color:#9097a3;font-size:13px">Received ' + esc(now) + '</p>');
    try {
      await send('owner', {
        personalizations: [personal],
        from: { email: from, name: bizName + ' website' },
        reply_to: lead.email ? { email: lead.email, name: lead.name } : undefined,
        subject: 'New enquiry from ' + bizName + "'s website",
        tracking_settings: trackingOff,
        content: [{ type: 'text/plain', value: ownerText }, { type: 'text/html', value: ownerHtml }],
      });
    } catch (e) { /* best-effort */ }

    // b) confirmation back to the customer, styled as if from the business
    if (lead.email) {
      const bizLinkText = businessUrl ? '\n\nVisit us: ' + businessUrl : '';
      const bizLinkHtml = businessUrl ? '<p style="margin:16px 0 0">Visit us at <a href="' + businessUrl + '">' + esc(businessHost) + '</a></p>' : '';
      const custText = 'Hi ' + lead.name + ',\n\n' +
        'Thanks for getting in touch with ' + bizName + '. We have received your enquiry' +
        (lead.service ? ' about ' + lead.service : '') + ' and will get back to you as soon as we can.\n\n' +
        (lead.message ? 'For your records, here is what you sent:\n' + lead.message + '\n\n' : '') +
        'Speak soon,\n' + bizName + bizLinkText + sigText;
      const custHtml = htmlWrap(
        '<p>Hi ' + esc(lead.name) + ',</p>' +
        '<p>Thanks for getting in touch with ' + esc(bizName) + '. We have received your enquiry' +
        (lead.service ? ' about ' + esc(lead.service) : '') + ' and will get back to you as soon as we can.</p>' +
        (lead.message ? '<p style="color:#555"><b>For your records, here is what you sent:</b><br>' + br(lead.message) + '</p>' : '') +
        '<p>Speak soon,<br>' + esc(bizName) + '</p>' + bizLinkHtml);
      try {
        await send('customer', {
          personalizations: [{ to: [{ email: lead.email, name: lead.name }] }],
          from: { email: from, name: bizName },
          reply_to: { email: ownerEmail || operator, name: bizName },
          subject: 'Thanks for contacting ' + bizName,
          tracking_settings: trackingOff,
          content: [{ type: 'text/plain', value: custText }, { type: 'text/html', value: custHtml }],
        });
      } catch (e) { /* best-effort */ }
    }
  }

  if (body._debug === 'aiwp') {
    res.status(200).json({
      ok: true,
      env: { key: !!key, from: !!from, operator: !!operator },
      routing: { ownerEmailSet: !!ownerEmail, customerEmailGiven: !!lead.email, businessUrl: businessUrl || '(none)' },
      caps: { ipCount: usage.ipCount, ipMax: IP_MAX, siteCount: usage.siteCount, siteMax: SITE_MAX, siteCapped, emailSkipped: siteCapped },
      sendgrid: diag,
    });
    return;
  }
  res.status(200).json({ ok: true });
};

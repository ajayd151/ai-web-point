// PUBLIC: a visitor submitted the contact/quote form on a Pounce site (/s/<slug>
// or a client subdomain). Store-first (the lead is saved to Blob so it's never
// lost and costs nothing), then a best-effort SendGrid notification on top.
// No auth (the visitor isn't logged in). Anti-spam: a honeypot field + the slug
// must map to a real site.
const { list, put } = require('@vercel/blob');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
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

  const now = new Date().toISOString();
  const entry = Object.assign({ slug, business: bizName, receivedAt: now, ua: String(req.headers['user-agent'] || '').slice(0, 200) }, lead);

  // 1) store-first: the durable record (free, never lost)
  try { await put('leads/' + slug + '/' + Date.now() + '.json', JSON.stringify(entry), { access: 'public', contentType: 'application/json', addRandomSuffix: true }); }
  catch (e) { /* storage hiccup, still try to email below */ }

  // 2) best-effort notifications via SendGrid (free tier covers normal volume).
  // The lead is already stored above, so any email failure is non-fatal.
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.ERROR_EMAIL_FROM;             // a verified SendGrid sender
  const operator = process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO; // you
  const agency = process.env.AGENCY_NAME || 'Ai Web Point';
  const agencyUrl = process.env.AGENCY_URL || 'https://aiwebpoint.com';
  const signature = '\n\n- - -\nPowered by ' + agency + '\n' + agencyUrl + '\n';

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

  if (key && from && notifyTo) {
    // a) notify the business (owner, or you) that a new enquiry came in
    const personal = { to: [{ email: notifyTo, name: ownerName || undefined }] };
    const bcc = new Set();
    if (ownerEmail && operator && operator.toLowerCase() !== ownerEmail.toLowerCase()) bcc.add(operator); // keep your own copy when it routes to the client
    const alwaysBcc = (process.env.LEAD_BCC_ALWAYS || '').trim(); // optional: a copy of EVERY enquiry (testing / oversight)
    if (alwaysBcc && alwaysBcc.toLowerCase() !== String(notifyTo).toLowerCase()) bcc.add(alwaysBcc);
    if (bcc.size) personal.bcc = [...bcc].map((email) => ({ email }));
    try {
      await send('owner', {
        personalizations: [personal],
        from: { email: from, name: bizName + ' website' },
        reply_to: lead.email ? { email: lead.email, name: lead.name } : undefined,
        subject: 'New enquiry from ' + bizName + "'s website",
        content: [{
          type: 'text/plain',
          value: 'You have a new website enquiry' + (ownerName ? ', ' + ownerName : '') + '.\n\n' +
            'Name: ' + lead.name + '\nPhone: ' + (lead.phone || '(none)') + '\nEmail: ' + (lead.email || '(none)') + '\n' +
            'Service: ' + (lead.service || '(not specified)') + '\n\nMessage:\n' + (lead.message || '(none)') + '\n\n' +
            'Reply to this email to respond to ' + lead.name + ' directly.\n' +
            'Received: ' + now + signature,
        }],
      });
    } catch (e) { /* best-effort */ }

    // b) confirmation back to the customer, styled as if from the business
    if (lead.email) {
      try {
        await send('customer', {
          personalizations: [{ to: [{ email: lead.email, name: lead.name }] }],
          from: { email: from, name: bizName },
          reply_to: { email: ownerEmail || operator, name: bizName },
          subject: 'Thanks for contacting ' + bizName,
          content: [{
            type: 'text/plain',
            value: 'Hi ' + lead.name + ',\n\n' +
              'Thanks for getting in touch with ' + bizName + '. We have received your enquiry' +
              (lead.service ? ' about ' + lead.service : '') + ' and will get back to you as soon as we can.\n\n' +
              'For your records, here is what you sent:\n' +
              (lead.message ? lead.message + '\n\n' : '') +
              'Speak soon,\n' + bizName + signature,
          }],
        });
      } catch (e) { /* best-effort */ }
    }
  }

  if (body._debug === 'aiwp') {
    res.status(200).json({
      ok: true,
      env: { key: !!key, from: !!from, operator: !!operator },
      routing: { ownerEmailSet: !!ownerEmail, customerEmailGiven: !!lead.email },
      sendgrid: diag,
    });
    return;
  }
  res.status(200).json({ ok: true });
};

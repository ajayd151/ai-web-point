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

  // 2) best-effort notification via existing SendGrid (free tier covers normal volume)
  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO;
  const from = process.env.ERROR_EMAIL_FROM;
  if (key && to && from) {
    try {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from, name: 'Site Pounce leads' },
          reply_to: lead.email ? { email: lead.email, name: lead.name } : undefined,
          subject: 'New enquiry from ' + bizName + "'s website",
          content: [{
            type: 'text/plain',
            value: 'New website enquiry for ' + bizName + ':\n\n' +
              'Name: ' + lead.name + '\nPhone: ' + lead.phone + '\nEmail: ' + (lead.email || '(none)') + '\n' +
              'Service: ' + (lead.service || '(not specified)') + '\n\nMessage:\n' + (lead.message || '(none)') + '\n\n' +
              'Site: /s/' + slug + '\nReceived: ' + now + '\n',
          }],
        }),
      });
    } catch (e) { /* email is best-effort, the lead is already stored */ }
  }

  res.status(200).json({ ok: true });
};

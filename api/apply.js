// Public founding-member application form handler.
// Captures the application to Postgres (best-effort) AND emails it via SendGrid.
const { recordApplication } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};

  // honeypot: silently accept + drop bots
  if (body.hp) { res.status(200).json({ ok: true }); return; }

  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().slice(0, 160);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'A name and valid email are required.' });
    return;
  }
  const a = {
    name,
    email,
    phone: String(body.phone || '').trim().slice(0, 40),
    jobtitle: String(body.jobtitle || '').trim().slice(0, 100),
    business: String(body.business || '').trim().slice(0, 160),
    website: String(body.website || '').trim().slice(0, 200),
    role: String(body.role || '').trim().slice(0, 80),
    volume: String(body.volume || '').trim().slice(0, 40),
    channels: String(body.channels || '').trim().slice(0, 1200),
    why: String(body.why || '').trim().slice(0, 2400),
  };

  // best-effort DB capture (never blocks the response)
  try { await recordApplication(a); } catch (e) { /* fail soft */ }

  // email the operator via SendGrid (if configured)
  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO;
  const from = process.env.ERROR_EMAIL_FROM;
  if (key && to && from) {
    try {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from, name: 'Site Pounce' },
          reply_to: { email: a.email, name: a.name },
          subject: 'Site Pounce, Founding Member Application: ' + a.name,
          content: [{
            type: 'text/plain',
            value: `New founding-member application:\n\n` +
              `Name: ${a.name}\nJob title: ${a.jobtitle}\nEmail: ${a.email}\nPhone: ${a.phone}\n` +
              `Business: ${a.business}\nWebsite: ${a.website}\n` +
              `Role: ${a.role}\nSites/month: ${a.volume}\nWins clients via: ${a.channels}\n\n` +
              `Why they'd make a great founder:\n${a.why}\n`,
          }],
        }),
      });
    } catch (e) { /* fail soft */ }
  }

  res.status(200).json({ ok: true });
};

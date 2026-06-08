// Emails an error report to the operator via SendGrid.
// Login-gated (so it can't be used as an open email relay).
// No-op (returns ok:false, skipped:true) unless these env vars are set:
//   SENDGRID_API_KEY  – your SendGrid API key
//   ERROR_EMAIL_TO    – where alerts go (e.g. you@aimpro.co.uk)
//   ERROR_EMAIL_FROM  – a SendGrid-verified sender address
const { verify, parseCookie } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ ok: false }); return; }

  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.ERROR_EMAIL_TO;
  const from = process.env.ERROR_EMAIL_FROM;
  if (!key || !to || !from) { res.status(200).json({ ok: false, skipped: true }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const message = String(body.message || '(no message)').slice(0, 2000);
  const context = String(body.context || 'app').slice(0, 200);
  const url = String(body.url || '').slice(0, 400);
  const when = String(body.when || '').slice(0, 60);

  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: 'SitePounce' },
        subject: 'SitePounce Error, ' + context,
        content: [{
          type: 'text/plain',
          value: `A SitePounce error was reported.\n\nError:\n${message}\n\nContext: ${context}\nPage: ${url}\nWhen: ${when}\n`,
        }],
      }),
    });
    res.status(200).json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
};

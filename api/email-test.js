// TEMPORARY diagnostic: reports the email config and does a live SendGrid send,
// returning SendGrid's HTTP status. Gated by a secret key in the query so it
// can't be abused. DELETE after debugging.
module.exports = async (req, res) => {
  if ((req.query && req.query.k) !== 'aiwp-emaildbg-7731') { res.status(404).end(); return; }
  const cfg = {
    hasKey: !!process.env.SENDGRID_API_KEY,
    from: process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM || null,
    adminTo: process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO || null,
  };
  const to = (req.query && req.query.to) || cfg.adminTo;
  let sg = null;
  if (cfg.hasKey && cfg.from && to) {
    try {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: cfg.from, name: 'Site Pounce' },
          subject: 'Site Pounce email test',
          content: [{ type: 'text/plain', value: 'This is a Site Pounce email-system test.' }],
        }),
      });
      sg = { status: r.status, body: (await r.text()).slice(0, 500) };
    } catch (e) { sg = { error: String(e && e.message) }; }
  }
  res.status(200).json({ cfg, to, sg });
};

// Owner alert texts for Ajay's other sites (first user: Automation Growth Lab, which has no Twilio
// account of its own). SitePounce already holds the Twilio number, so the other site posts here.
//
// Locked down on purpose so it can never be used to text anyone else:
//   - the caller must send x-alert-secret matching ALERT_SMS_SECRET (set in both Vercel projects),
//   - the recipients are fixed server side (ALERT_SMS_TO, comma separated; Ajay's alert mobile by
//     default), the caller cannot choose a number,
//   - the message is capped at 320 characters.
const { sendSms, smsConfigured } = require('../lib/sms');

const DEFAULT_TO = '+447866555555';

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  if (x.length !== y.length || !x.length) return false;
  return require('crypto').timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!process.env.ALERT_SMS_SECRET || !safeEqual(req.headers['x-alert-secret'], process.env.ALERT_SMS_SECRET)) {
    return res.status(401).json({ ok: false, error: 'Not authorised.' });
  }
  if (!smsConfigured()) return res.status(503).json({ ok: false, error: 'Twilio is not configured.' });
  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  const message = String(body.message || '').trim().slice(0, 320);
  if (!message) return res.status(400).json({ ok: false, error: 'No message.' });
  const to = String(process.env.ALERT_SMS_TO || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const n of to) results.push(Object.assign({ to: n.slice(-4) }, await sendSms(n, message)));
  res.status(results.some((r) => r.ok) ? 200 : 502).json({ ok: results.some((r) => r.ok), results });
};

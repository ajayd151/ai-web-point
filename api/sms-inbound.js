// Twilio webhook for replies. No cookie auth (Twilio calls it), verified with the X-Twilio-
// Signature HMAC instead when SMS_WEBHOOK_URL is set. Each reply: stored, matched to the business
// by phone number, appended to that business's notes, and emailed to the owner. STOP opts the
// number out permanently and campaigns will never text it again.
const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
const { recordInbound, addOptout } = require('../lib/smsdb');
const { ukMobile } = require('../lib/sms');
const { ownerEmail } = require('../lib/tenant');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

// Twilio signature: HMAC-SHA1 of the exact webhook URL + params sorted by key, base64.
function validSignature(req, params) {
  const url = process.env.SMS_WEBHOOK_URL;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!url || !token) return true; // not configured for validation yet: accept, but keep it simple to turn on
  const sig = String((req.headers && req.headers['x-twilio-signature']) || '');
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expect = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch (e) { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  // Twilio posts application/x-www-form-urlencoded
  let params = req.body;
  if (typeof params === 'string') {
    const p = new URLSearchParams(params); params = {};
    for (const [k, v] of p.entries()) params[k] = v;
  }
  params = params || {};
  if (!validSignature(req, params)) { res.status(403).send('bad signature'); return; }

  const from = ukMobile(params.From) || String(params.From || '');
  const body = String(params.Body || '').trim().slice(0, 1000);

  // match the number back to a business on the call list
  let matched = null;
  try {
    const calls = (await readJson('calls/_list.json')) || {};
    matched = Object.values(calls).find((c) => c && ukMobile(c.phone) === from) || null;
  } catch (e) { matched = null; }

  await recordInbound({ from: from, body: body, matchedKey: matched && matched.key, matchedName: matched && matched.name });

  if (/^\s*stop\b/i.test(body)) {
    await addOptout(from, 'reply');
  } else if (matched && matched.key) {
    // put the reply into the business's notes so it shows in Prowl / Lead Profile / Call List
    try {
      const path = 'notes/' + matched.key + '.json';
      const data = (await readJson(path)) || { slug: matched.key, status: '', statusAt: '', comments: [] };
      data.comments = data.comments || [];
      data.comments.push({ text: '📱 SMS reply: ' + body, at: new Date().toISOString(), by: 'sms' });
      data.updatedAt = new Date().toISOString();
      await put(path, JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    } catch (e) { /* the inbound row is already stored */ }
  }

  // tell the owner (await it: never fire-and-forget on Vercel)
  try {
    const key = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
    if (key && fromEmail) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ownerEmail() }] }],
          from: { email: fromEmail, name: 'Site Pounce' },
          subject: '📱 SMS reply' + (matched ? (' from ' + matched.name) : (' from ' + from)),
          content: [{ type: 'text/plain', value: 'From: ' + from + (matched ? (' (' + matched.name + ')') : '') + '\n\n' + body + '\n\nSee all replies in Admin > SMS.\n' }],
        }),
      });
    }
  } catch (e) { /* reply is stored regardless */ }

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
};

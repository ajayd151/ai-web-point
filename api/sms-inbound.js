// Twilio webhook for replies. No cookie auth (Twilio calls it), verified with the X-Twilio-
// Signature HMAC instead when SMS_WEBHOOK_URL is set. Each reply: stored, matched to the business
// by phone number, appended to that business's notes, and emailed to the owner. STOP opts the
// number out permanently and campaigns will never text it again.
const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
const { recordInbound, addOptout, latestItemByPhone, setReply, setPostReply } = require('../lib/smsdb');
const { ukMobile } = require('../lib/sms');
const { ownerEmail } = require('../lib/tenant');

// What did they mean? Keyword fast-path first; the AI referee only for genuinely unclear replies.
const POS = /\b(yes+|yeah|yep|yup|ok(ay)?|sure|go on|go ahead|send( it)?( over)?|please do|sounds good|interested|why not|alright|fine|great|definitely|absolutely)\b/i;
const NEG = /\b(no+|nope|not interested|no thanks?|dont|don't|do not|leave me|remove|unsubscribe|never|go away|not for (me|us)|already have|busy)\b/i;
async function classify(text) {
  const t = String(text || '').trim();
  if (!t) return 'other';
  if (/^\s*stop\b/i.test(t)) return 'stop';
  const pos = POS.test(t); const neg = NEG.test(t);
  if (pos && !neg) return 'positive';
  if (neg && !pos) return 'negative';
  // ambiguous ("yes but no", "who is this?"): ask the AI, fail to 'other' so nothing auto-fires
  const key = process.env.OPENAI_API_KEY;
  if (!key) return 'other';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'A small business was texted an offer of a free website design. Classify their reply. Return ONLY JSON {"verdict":"positive"|"negative"|"other"}. positive = they want it or are open to it. negative = they are declining. other = a question or unclear.' },
          { role: 'user', content: t.slice(0, 300) },
        ],
      }),
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    const out = JSON.parse((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}');
    return ['positive', 'negative'].indexOf(out.verdict) >= 0 ? out.verdict : 'other';
  } catch (e) { return 'other'; }
}

// Reflect the reply into the CRM so the Call List shows it without anyone re-typing: positive =
// Interested (call them), negative = Not interested. Same shape as api/note.js writes.
async function setCrmStatus(key, status, noteText) {
  try {
    const path = 'notes/' + key + '.json';
    const data = (await readJson(path)) || { slug: key, status: '', statusAt: '', comments: [] };
    const now = new Date().toISOString();
    if (status) { data.status = status; data.statusAt = now; } // falsy = keep whatever it was, just add the note
    if (noteText) { data.comments = data.comments || []; data.comments.push({ text: noteText, at: now, by: 'sms' }); }
    data.updatedAt = now;
    await put(path, JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    const idxPath = 'notes/_index.json';
    const idx = (await readJson(idxPath)) || {};
    idx[key] = { status: data.status || '', at: now };
    await put(idxPath, JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { /* the reply itself is already stored */ }
}

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

  // whose reply is this? The campaign item is the source of truth (it knows the workflow stage);
  // the call list is the fallback for anyone texted outside a campaign.
  const item = await latestItemByPhone(from);
  let matched = item ? { key: item.key, name: item.name } : null;
  if (!matched) {
    try {
      const calls = (await readJson('calls/_list.json')) || {};
      const c = Object.values(calls).find((x) => x && ukMobile(x.phone) === from) || null;
      if (c) matched = { key: c.key, name: c.name };
    } catch (e) { /* none */ }
  }

  const verdict = await classify(body);
  await recordInbound({ from: from, body: body, matchedKey: matched && matched.key, matchedName: matched && matched.name, verdict: verdict });

  if (verdict === 'stop') {
    await addOptout(from, 'reply');
  } else if (item) {
    // drive the workflow forward
    if (item.link_sent_at) {
      // they have SEEN the mockup: this is the response that matters most
      await setPostReply(item.id, verdict);
      if (verdict === 'positive' && matched) await setCrmStatus(matched.key, 'interested', '📱 SMS reply after seeing the mockup: "' + body + '" → CALL THEM');
      if (verdict === 'negative' && matched) await setCrmStatus(matched.key, 'not-interested', '📱 SMS reply after seeing the mockup: "' + body + '"');
    } else {
      // reply to the ask: a YES schedules the mockup link after the campaign's delay
      const linkDue = (verdict === 'positive' && item.mode === 'ask')
        ? new Date(Date.now() + (Number(item.link_delay_min) || 1) * 60000).toISOString() : null;
      await setReply(item.id, verdict, linkDue);
      if (verdict === 'positive' && matched) await setCrmStatus(matched.key, 'interested', '📱 SMS reply: "' + body + '" (mockup link auto-sends in ' + (Number(item.link_delay_min) || 1) + ' min)');
      if (verdict === 'negative' && matched) await setCrmStatus(matched.key, 'not-interested', '📱 SMS reply: "' + body + '"');
    }
  }
  // any reply that is not part of the workflow still lands in the notes
  if (matched && verdict !== 'stop' && !item) {
    await setCrmStatus(matched.key, verdict === 'positive' ? 'interested' : (verdict === 'negative' ? 'not-interested' : ''), '📱 SMS reply: ' + body);
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

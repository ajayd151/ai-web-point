// Zero-dep Twilio client (same pattern as lib/stripe.js). Until the TWILIO_* env vars are set it
// reports unconfigured and the worker holds sends rather than failing them.
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (the UK number, +447...).
function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

// Normalise a UK number to E.164. Returns '' when it is not a UK MOBILE (07 / +447): SMS to a
// landline is money down the drain, so those are skipped rather than attempted.
function ukMobile(raw) {
  let d = String(raw || '').replace(/[^0-9+]/g, '');
  if (d.startsWith('+44')) d = '0' + d.slice(3);
  else if (d.startsWith('44')) d = '0' + d.slice(2);
  if (!/^07\d{9}$/.test(d)) return '';
  return '+44' + d.slice(1);
}

async function sendSms(to, body, base, from) {
  if (!smsConfigured()) return { ok: false, error: 'Twilio is not configured yet.' };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
  const fromNum = from || process.env.TWILIO_FROM; // campaign's chosen number, or the default
  const form = new URLSearchParams({ To: to, From: fromNum, Body: body });
  // delivery receipts (sent/delivered/failed) come back to us per message
  if (base) form.set('StatusCallback', base.replace(/\/$/, '') + '/api/sms-status');
  try {
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.sid) return { ok: true, sid: d.sid };
    return { ok: false, error: (d && d.message) || ('Twilio error ' + r.status) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'network error' };
  }
}

// Twilio Lookup v2: is this number real, and what is it (mobile / landline / voip)?
// ~0.8p per lookup for the line-type data. It catches invalid and unallocated numbers; it cannot
// promise a human answers, nothing can.
async function lookupPhone(e164) {
  if (!smsConfigured() || !e164) return { checked: false };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
  try {
    const r = await fetch('https://lookups.twilio.com/v2/PhoneNumbers/' + encodeURIComponent(e164) + '?Fields=line_type_intelligence', {
      headers: { Authorization: auth },
    });
    if (r.status === 404) return { checked: true, valid: false, type: '' }; // not a real number
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { checked: false };
    return {
      checked: true,
      valid: d.valid !== false,
      type: (d.line_type_intelligence && d.line_type_intelligence.type) || '',
    };
  } catch (e) { return { checked: false }; }
}

// A friendly opt-out LINK (tap instead of texting STOP). STOP counts against the carrier
// opt-out metric; a link click does not, so routing opt-outs through a link keeps the number
// healthy. STOP still works silently either way. The token signs the sms_items id so no phone
// number ever appears in the URL.
const crypto = require('crypto');
function ooSecret() { return process.env.SMS_OPTOUT_SECRET || process.env.TWILIO_AUTH_TOKEN || process.env.APP_SESSION_SECRET || 'sp-optout'; }
function optOutToken(id) {
  const b = Buffer.from(String(id)).toString('base64url');
  const sig = crypto.createHmac('sha256', ooSecret()).update(String(id)).digest('base64url').slice(0, 12);
  return b + '.' + sig;
}
function verifyOptOutToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 2) return null;
  let id; try { id = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch (e) { return null; }
  const sig = crypto.createHmac('sha256', ooSecret()).update(id).digest('base64url').slice(0, 12);
  return sig === parts[1] ? id : null;
}
function optOutUrl(base, id) {
  return (base || 'https://www.sitepounce.com').replace(/\/$/, '') + '/optout?t=' + encodeURIComponent(optOutToken(id));
}

module.exports = { smsConfigured, ukMobile, sendSms, lookupPhone, optOutToken, verifyOptOutToken, optOutUrl };

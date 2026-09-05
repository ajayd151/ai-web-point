// Video Outreach email sends (spec 4.8, Phase 2). Goes through SendGrid like the rest of SitePounce
// (lib/email.js pattern) but from the campaign's own sender, because these are AJ's Shekipro.com
// messages, not Site Pounce transactional mail. Opens are tracked with our own pixel (api/vo-track.js)
// so no SendGrid event webhook is needed. Never throws: returns { ok, error }.
const crypto = require('crypto');

function fromAddress(profile) {
  const p = profile || {};
  return { email: p.email_from || process.env.VO_EMAIL_FROM || process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM || '', name: p.email_from_name || (p.sender_first ? (p.sender_first + ' at ' + (p.service_name || '')).trim() : 'Site Pounce') };
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function token(id) { return crypto.createHmac('sha256', process.env.APP_PASSWORD || 'vo').update('vo-open:' + id).digest('hex').slice(0, 24); }
function pixelUrl(base, prospectId) { return (base || 'https://www.sitepounce.com') + '/api/vo-track?p=' + encodeURIComponent(prospectId) + '&t=' + token(prospectId); }
function linkify(text) { return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'); }
function html(text, pixel) {
  const paras = String(text || '').split(/\n\n+/).map((p) => '<p style="margin:0 0 14px">' + linkify(p).replace(/\n/g, '<br>') + '</p>').join('');
  return '<div style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:600px">' + paras + (pixel ? '<img src="' + pixel + '" width="1" height="1" alt="" style="display:block;opacity:0" />' : '') + '</div>';
}
function subjectFor(kind, prospect) {
  const b = prospect.brand || 'your brand';
  if (kind === 'message_a') return 'Free sample video for ' + b;
  if (kind === 'message_b') return 'A free sample video for ' + b + '?';
  if (kind === 'followup_1') return 'Re: Free sample video for ' + b;
  return 'Re: ' + b + ' videos';
}
async function sendProspectEmail(opts) {
  const o = opts || {};
  const key = process.env.SENDGRID_API_KEY;
  const to = String(o.to || '').trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: 'No valid email on this prospect. Add dm_email in the editable fields first.' };
  const from = fromAddress(o.profile);
  if (!from.email) return { ok: false, error: 'No sender address. Set VO_EMAIL_FROM in Vercel (a SendGrid verified sender).' };
  const subject = o.subject || subjectFor(o.kind, o.prospect || {});
  const pixel = o.trackOpens === false ? '' : pixelUrl(o.base, o.prospect && o.prospect.id);
  if (!key) return { ok: false, error: 'SendGrid is not configured (SENDGRID_API_KEY).', subject: subject };
  const msg = {
    personalizations: [{ to: [{ email: to, name: o.toName || undefined }] }],
    from: from, reply_to: o.replyTo ? { email: o.replyTo } : undefined, subject: subject,
    content: [{ type: 'text/plain', value: String(o.text || '') }, { type: 'text/html', value: html(o.text, pixel) }],
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
    custom_args: { vo_prospect: String(o.prospect && o.prospect.id || ''), vo_kind: String(o.kind || '') },
  };
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(msg) });
    if (r.ok) return { ok: true, subject: subject, from: from.email };
    let detail = ''; try { detail = String(await r.text() || '').slice(0, 300); } catch (e) {}
    return { ok: false, error: 'SendGrid rejected the email: ' + r.status + ' ' + detail, subject: subject };
  } catch (e) { return { ok: false, error: 'SendGrid send failed: ' + (e.message || e), subject: subject }; }
}
// Owner notifications (a reply arrived, the LinkedIn account was restricted, a run finished).
async function notifyOwner(subject, text) {
  const key = process.env.SENDGRID_API_KEY; const { ownerEmail } = require('./tenant');
  const to = process.env.VO_NOTIFY_EMAIL || ownerEmail(); const from = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM || '';
  if (!key || !to || !from) return false;
  try { const r = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from, name: 'Site Pounce' }, subject: subject, content: [{ type: 'text/plain', value: text }], tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } } }) }); return r.ok; } catch (e) { return false; }
}
module.exports = { notifyOwner, sendProspectEmail, subjectFor, token, pixelUrl, fromAddress, html };

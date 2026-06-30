// Transactional emails for new subscribers, sent via SendGrid.
// 1. Admin notification (who just subscribed).
// 2. Welcome email to the customer (what they got + how to log in + a getting-started nudge).
// NOTE: with Clerk (Google / email sign-in) there is no password to send, so the welcome
// email gives the login link and tells them to sign in the way they signed up.
const PLAN_NAMES = { scout: 'Scout', hunter: 'Hunter', apex: 'Apex' };

function noTracking() {
  return { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } };
}

async function sgSend(msg) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return;
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(msg),
    });
  } catch (e) { /* fail soft, never block the request */ }
}

function welcomeText(name, planName, base) {
  const hi = name ? ('Hi ' + name + ',') : 'Hi,';
  return hi + '\n\n' +
    'Welcome to Site Pounce, and thank you for subscribing' + (planName ? (' to the ' + planName + ' plan') : '') + '.\n\n' +
    'Log in here: ' + base + '\n' +
    'Sign in the same way you signed up (Google, or your email). There is no separate password to remember.\n\n' +
    'Getting started: pick a trade and a town, hit "Search businesses", and Site Pounce pulls a clean list of local leads for you to call, message, and win.\n\n' +
    'Any questions, just reply to this email.\n\n' +
    'The Site Pounce team\n' +
    'hello@sitepounce.com\n';
}

function welcomeHtml(name, planName, base) {
  const hi = name ? ('Hi ' + esc(name) + ',') : 'Hi,';
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15233B;line-height:1.6;font-size:15px;">' +
    '<p>' + hi + '</p>' +
    '<p>Welcome to <b>Site Pounce</b>, and thank you for subscribing' + (planName ? (' to the <b>' + esc(planName) + '</b> plan') : '') + '.</p>' +
    '<p><a href="' + esc(base) + '" style="display:inline-block;background:#0FB6A8;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;">Log in to Site Pounce</a></p>' +
    '<p>Sign in the same way you signed up (Google, or your email), there is no separate password to remember.</p>' +
    '<p><b>Getting started:</b> pick a trade and a town, hit <b>Search businesses</b>, and Site Pounce pulls a clean list of local leads for you to call, message, and win.</p>' +
    '<p>Any questions, just reply to this email.</p>' +
    '<p style="margin-top:18px;">The Site Pounce team<br><a href="mailto:hello@sitepounce.com" style="color:#0FB6A8;">hello@sitepounce.com</a></p>' +
    '</div>';
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Fire the admin + welcome emails for a brand-new subscriber. Caller must ensure
// this only runs once per customer (see db.markWelcomed).
async function sendNewCustomerEmails({ email, name, plan }) {
  if (!process.env.SENDGRID_API_KEY || !email) return;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  if (!fromEmail) return;
  const adminTo = process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO;
  const planName = PLAN_NAMES[plan] || plan || '';
  const base = process.env.APP_BASE_URL || 'https://sitepounce.com';

  if (adminTo) {
    await sgSend({
      personalizations: [{ to: [{ email: adminTo }] }],
      from: { email: fromEmail, name: 'Site Pounce' },
      reply_to: { email: email, name: name || email },
      subject: 'New Site Pounce customer: ' + (name || email),
      tracking_settings: noTracking(),
      content: [{ type: 'text/plain', value: 'A new customer just subscribed on Site Pounce.\n\nName: ' + (name || '(not given)') + '\nEmail: ' + email + '\nPlan: ' + (planName || '(unknown)') + '\n' }],
    });
  }
  await sgSend({
    personalizations: [{ to: [{ email: email, name: name || undefined }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: 'hello@sitepounce.com', name: 'Site Pounce' },
    subject: 'Welcome to Site Pounce',
    tracking_settings: noTracking(),
    content: [
      { type: 'text/plain', value: welcomeText(name, planName, base) },
      { type: 'text/html', value: welcomeHtml(name, planName, base) },
    ],
  });
}

module.exports = { sendNewCustomerEmails };

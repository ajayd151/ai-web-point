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

// Notify the owner when someone submits in-app feedback. Same SendGrid config as the
// new-customer admin email. Fails soft; never blocks the /api/feedback response.
const IMPORTANCE_LABELS = { thought: 'Just a thought', nice: 'Nice to have', important: 'Important', critical: 'Critical / blocking' };
const TYPE_LABELS = { idea: 'Idea / feature request', bug: 'Something is broken', question: 'Question', praise: 'Praise', other: 'Other' };

async function sendFeedbackEmail(f) {
  if (!process.env.SENDGRID_API_KEY) return;
  const g = f || {};
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  const adminTo = process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO;
  if (!fromEmail || !adminTo) return;
  const type = TYPE_LABELS[g.type] || g.type || 'Other';
  const importance = IMPORTANCE_LABELS[g.importance] || g.importance || '';
  const who = g.email || '(unknown)';
  const lines = [
    'New feedback from Site Pounce.',
    '',
    'From: ' + who,
    'Plan: ' + (g.plan || '(unknown)') + (g.status ? (' (' + g.status + ')') : ''),
    'Type: ' + type,
    'Importance: ' + importance,
    'Page: ' + (g.page || '(unknown)'),
    g.url ? ('URL: ' + g.url) : '',
    '',
    'Message:',
    g.message || '',
  ].filter((x) => x !== null && x !== undefined);
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15233B;line-height:1.6;font-size:15px;">' +
    '<p><b>New feedback</b> from Site Pounce.</p>' +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    ['From', 'Plan', 'Type', 'Importance', 'Page'].map((label, i) => {
      const vals = [esc(who), esc((g.plan || '(unknown)') + (g.status ? (' (' + g.status + ')') : '')), esc(type), esc(importance), esc(g.page || '(unknown)')];
      return '<tr><td style="padding:2px 12px 2px 0;color:#6b7585;">' + label + '</td><td style="padding:2px 0;"><b>' + vals[i] + '</b></td></tr>';
    }).join('') +
    (g.url ? '<tr><td style="padding:2px 12px 2px 0;color:#6b7585;">URL</td><td style="padding:2px 0;"><a href="' + esc(g.url) + '">' + esc(g.url) + '</a></td></tr>' : '') +
    '</table>' +
    '<p style="margin-top:14px;"><b>Message</b></p>' +
    '<p style="white-space:pre-wrap;background:#f7fafb;border:1px solid #e7eaf0;border-radius:8px;padding:12px;">' + esc(g.message || '') + '</p>' +
    '</div>';
  await sgSend({
    personalizations: [{ to: [{ email: adminTo }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: g.email || fromEmail, name: g.email || 'Site Pounce' },
    subject: 'Site Pounce feedback' + (importance ? (' [' + importance + ']') : '') + ': ' + type,
    tracking_settings: noTracking(),
    content: [
      { type: 'text/plain', value: lines.join('\n') },
      { type: 'text/html', value: html },
    ],
  });
}

// Invite a new team member (SendGrid). They go to the app, sign up with THIS email and
// choose their own password (Clerk handles the password; we never see it). Fails soft.
async function sendTeamInviteEmail({ to, firstName, ownerEmail, hasPassword, password }) {
  if (!process.env.SENDGRID_API_KEY || !to) return;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  if (!fromEmail) return;
  const base = process.env.APP_BASE_URL || 'https://sitepounce.com';
  const hi = firstName ? ('Hi ' + firstName + ',') : 'Hi,';
  const by = ownerEmail ? (' by ' + ownerEmail) : '';
  const creds = (hasPassword && password)
    ? ('Your login:\nEmail: ' + to + '\nStarting password: ' + password + '\n')
    : '';
  const steps = (hasPassword && password)
    ? ('Signing in:\n1. Go to ' + base + ' and choose "Sign in".\n2. Sign in with the email and starting password above.\n3. You will be asked to set your own password.\n')
    : (hasPassword
      ? ('Signing in:\n1. Go to ' + base + ' and choose "Sign in".\n2. Sign in with THIS email (' + to + ') and the starting password your admin will give you.\n3. You will be asked to set your own password.\n')
      : ('Set up your account:\n1. Go to ' + base + ' and choose "Get started".\n2. Sign up with THIS email (' + to + ') and create your own password.\n'));
  const text = hi + '\n\n' +
    'You have been added to a Site Pounce team workspace' + by + '.\n\n' + (creds ? creds + '\n' : '') + steps + '\n' +
    'Please use Site Pounce professionally. All searches and activity are logged and visible to your admin.\n\n' +
    'The Site Pounce team\nhello@sitepounce.com\n';
  const credsHtml = (hasPassword && password)
    ? '<div style="background:#f2fbfa;border:1px solid #0FB6A8;border-radius:10px;padding:12px 14px;margin:6px 0 12px;font-size:15px;">Email: <b>' + esc(to) + '</b><br>Starting password: <b style="letter-spacing:.5px;">' + esc(password) + '</b></div>'
    : '';
  const stepsHtml = (hasPassword && password)
    ? '<ol><li>Click the button above (or go to ' + esc(base) + ') and choose <b>Sign in</b>.</li><li>Sign in with the email and starting password above.</li><li>You will be asked to set your own password.</li></ol>'
    : (hasPassword
      ? '<ol><li>Go to <b>' + esc(base) + '</b> and choose <b>Sign in</b>.</li><li>Sign in with this email (<b>' + esc(to) + '</b>) and the starting password your admin gives you.</li><li>You will be asked to set your own password.</li></ol>'
      : '<ol><li>Choose <b>Get started</b> and sign up with this email: <b>' + esc(to) + '</b></li><li>Create your own password (only you will know it).</li></ol>');
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15233B;line-height:1.6;font-size:15px;">' +
    '<p>' + esc(hi) + '</p>' +
    '<p>You have been added to a <b>Site Pounce</b> team workspace' + esc(by) + '.</p>' +
    '<p><a href="' + esc(base) + '" style="display:inline-block;background:#0FB6A8;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;">Open Site Pounce</a></p>' +
    credsHtml +
    stepsHtml +
    '<p style="color:#6b7585;">Please use Site Pounce professionally. All searches and activity are logged and visible to your admin.</p>' +
    '<p style="margin-top:18px;">The Site Pounce team<br><a href="mailto:hello@sitepounce.com" style="color:#0FB6A8;">hello@sitepounce.com</a></p>' +
    '</div>';
  await sgSend({
    personalizations: [{ to: [{ email: to, name: firstName || undefined }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: 'hello@sitepounce.com', name: 'Site Pounce' },
    subject: 'You have been added to Site Pounce',
    tracking_settings: noTracking(),
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
  });
}

// Tell the admin (owner) that a team member was added. Always sent to the owner. Fails soft.
async function sendTeamAddedAdminEmail({ adminTo, memberName, memberEmail }) {
  if (!process.env.SENDGRID_API_KEY || !adminTo) return;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  if (!fromEmail) return;
  const who = memberName ? (memberName + ' (' + memberEmail + ')') : memberEmail;
  await sgSend({
    personalizations: [{ to: [{ email: adminTo }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: memberEmail || fromEmail, name: memberName || memberEmail },
    subject: 'Team member added: ' + (memberName || memberEmail),
    tracking_settings: noTracking(),
    content: [{ type: 'text/plain', value: 'You added a team member to your Site Pounce workspace.\n\nName: ' + (memberName || '(not given)') + '\nEmail: ' + memberEmail + '\n\nThey have been emailed an invite to set up their account and password.\n' }],
  });
}

// A team member hit a limit / blocked action and asked for more access. Email the owner.
async function sendAccessRequestEmail({ ownerEmail, memberEmail, feature, note }) {
  if (!process.env.SENDGRID_API_KEY) return;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  const adminTo = ownerEmail || process.env.LEAD_EMAIL_TO || process.env.APPLY_EMAIL_TO || process.env.ERROR_EMAIL_TO;
  if (!fromEmail || !adminTo) return;
  const text = 'A team member is requesting more access on Site Pounce.\n\n' +
    'Member: ' + (memberEmail || '(unknown)') + '\n' +
    'Wants: ' + (feature || 'more access') + '\n' +
    (note ? ('Note: ' + note + '\n') : '') +
    '\nGrant it in Admin > Team (tick the permission or raise their cap).\n';
  await sgSend({
    personalizations: [{ to: [{ email: adminTo }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: memberEmail || fromEmail, name: memberEmail || 'Site Pounce' },
    subject: 'Access request from ' + (memberEmail || 'a team member') + ': ' + (feature || 'more access'),
    tracking_settings: noTracking(),
    content: [{ type: 'text/plain', value: text }],
  });
}

// Tell a feedback submitter their suggestion is done + invite them to test it. Fails soft.
async function sendFeedbackDoneEmail({ to, message, url }) {
  if (!process.env.SENDGRID_API_KEY || !to) return;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  if (!fromEmail) return;
  const base = process.env.APP_BASE_URL || 'https://sitepounce.com';
  const link = url || base;
  const text = 'Hi,\n\nGreat news, the feedback you sent us is now done and live.\n\n' +
    (message ? ('You said:\n"' + message + '"\n\n') : '') +
    'Please have a look and try it out:\n' + link + '\n\n' +
    'If it does not work the way you wanted, just reply to this email and let us know.\n\n' +
    'Thanks for helping us make Site Pounce better.\n\nThe Site Pounce team\nhello@sitepounce.com\n';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#15233B;line-height:1.6;font-size:15px;">' +
    '<p>Hi,</p>' +
    '<p>🎉 <b>Great news</b>, the feedback you sent us is now done and live.</p>' +
    (message ? ('<p style="background:#f7fafb;border:1px solid #e7eaf0;border-radius:8px;padding:11px 13px;white-space:pre-wrap;"><i>' + esc(message) + '</i></p>') : '') +
    '<p><a href="' + esc(link) + '" style="display:inline-block;background:#0FB6A8;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;">Have a look</a></p>' +
    '<p>If it does not work the way you wanted, just reply to this email and let us know.</p>' +
    '<p style="margin-top:18px;">Thanks for helping us make Site Pounce better.<br>The Site Pounce team<br><a href="mailto:hello@sitepounce.com" style="color:#0FB6A8;">hello@sitepounce.com</a></p>' +
    '</div>';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    reply_to: { email: 'hello@sitepounce.com', name: 'Site Pounce' },
    subject: '🎉 Your Site Pounce suggestion is done',
    tracking_settings: noTracking(),
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
  });
}

module.exports = { sendNewCustomerEmails, sendFeedbackEmail, sendTeamInviteEmail, sendTeamAddedAdminEmail, sendAccessRequestEmail, sendFeedbackDoneEmail };

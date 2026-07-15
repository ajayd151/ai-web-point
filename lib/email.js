// Transactional emails for new subscribers, sent via SendGrid.
// 1. Admin notification (who just subscribed).
// 2. Welcome email to the customer (what they got + how to log in + a getting-started nudge).
// NOTE: with Clerk (Google / email sign-in) there is no password to send, so the welcome
// email gives the login link and tells them to sign in the way they signed up.
const PLAN_NAMES = { scout: 'Scout', hunter: 'Hunter', apex: 'Apex' };

function noTracking() {
  return { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } };
}

// Every SendGrid email is blind-copied to the owner, so there is one inbox showing exactly what
// went out to customers and team members. Skipped when the owner is already a recipient, so the
// admin emails that already come to them do not arrive twice. Set EMAIL_BCC='' to turn it off.
function withOwnerBcc(msg) {
  const bcc = String(process.env.EMAIL_BCC == null ? 'ajay@aimpro.co.uk' : process.env.EMAIL_BCC).trim().toLowerCase();
  if (!bcc || !msg || !Array.isArray(msg.personalizations)) return msg;
  msg.personalizations.forEach((p) => {
    const listed = (arr) => (arr || []).some((x) => String((x && x.email) || '').trim().toLowerCase() === bcc);
    if (listed(p.to) || listed(p.cc) || listed(p.bcc)) return; // already getting it, do not duplicate
    p.bcc = (p.bcc || []).concat([{ email: bcc }]);
  });
  return msg;
}

async function sgSend(msg) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return;
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(withOwnerBcc(msg)),
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

// ---- the 8am "how you got on yesterday" digest ----
const D_NAVY = '#15233B'; const D_TEAL = '#0FB6A8'; const D_UP = '#17A673';
const D_DOWN = '#E0913A'; const D_MUTED = '#6B7A90'; const D_LINE = '#E4EAF1';

// A small "vs last working day" movement chip. Up is celebrated in green. Down stays factual in a
// calm slate (never alarm red), because the point of Daily Insights is encouragement, not a rollicking.
function moveChip(now, prev, cname) {
  const n = Number(now) || 0; const p = Number(prev) || 0; const d = n - p;
  let col = D_MUTED; let txt = 'same as ' + esc(cname);
  if (d > 0) { col = D_UP; txt = '&#9650; ' + d + ' more than ' + esc(cname); }
  else if (d < 0) { col = D_MUTED; txt = Math.abs(d) + ' fewer than ' + esc(cname); }
  return '<span style="display:inline-block;font-size:12px;font-weight:700;color:' + col + ';">' + txt + '</span>';
}
// One big number tile.
function tile(label, value, chip, bg) {
  return '<td width="33%" style="padding:6px;" valign="top">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + bg + ';border-radius:12px;">' +
    '<tr><td style="padding:16px 14px;text-align:center;">' +
    '<div style="font-size:34px;line-height:1.1;font-weight:800;color:' + D_NAVY + ';">' + esc(value) + '</div>' +
    '<div style="font-size:12px;font-weight:700;color:' + D_MUTED + ';text-transform:uppercase;letter-spacing:.04em;margin:6px 0 4px;">' + esc(label) + '</div>' +
    (chip || '') +
    '</td></tr></table></td>';
}

function digestHtml(name, d, base) {
  const w = d.window;
  const hi = name ? ('Good morning ' + esc(name)) : 'Good morning';
  let h = '<div style="background:#F4F7FA;padding:20px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">' +
    '<table role="presentation" align="center" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;">' +
    // header
    '<tr><td style="background:' + D_NAVY + ';padding:22px 24px 24px;">' +
    '<div style="font-size:12px;font-weight:800;color:' + D_TEAL + ';letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px;">&#128161; Daily Insights</div>' +
    '<div style="font-size:22px;font-weight:800;color:#fff;">' + hi + '</div>' +
    '<div style="font-size:15px;color:#9DB0C9;margin-top:4px;">Here is how <b style="color:' + D_TEAL + ';">' + esc(w.label) + '</b> went for you.</div>' +
    (d.praise ? '<div style="font-size:14px;color:#fff;background:rgba(15,182,168,.18);border-left:3px solid ' + D_TEAL + ';padding:9px 12px;border-radius:0 8px 8px 0;margin-top:14px;line-height:1.5;">' + esc(d.praise) + '</div>' : '') +
    '</td></tr>' +
    // hours strip
    '<tr><td style="padding:18px 22px 4px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EAFBF9;border-radius:12px;">' +
    '<tr><td style="padding:14px 16px;font-size:15px;color:' + D_NAVY + ';line-height:1.6;">' +
    'You started at <b>' + esc(d.start || '') + '</b> and your last activity was <b>' + esc(d.end || '') + '</b>, ' +
    'so you were on it for <b style="color:' + D_TEAL + ';">' + esc(d.hoursLabel) + '</b>. ' +
    '<span style="color:' + D_MUTED + ';font-size:13px;">(' + esc(w.cname) + ': ' + esc(d.prevHoursLabel) + ')</span>' +
    '</td></tr></table></td></tr>' +
    // tiles
    '<tr><td style="padding:8px 16px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    tile('Activities', d.total, moveChip(d.total, d.prevTotal, w.cname), '#F4F7FA') +
    tile('Businesses worked', d.uniqueBusinesses, moveChip(d.uniqueBusinesses, d.prevUniqueBusinesses, w.cname), '#F4F7FA') +
    tile('Meetings booked', d.meetingsBooked, moveChip(d.meetingsBooked, d.prevMeetingsBooked, w.cname), d.meetingsBooked ? '#EAFBF9' : '#F4F7FA') +
    '</tr></table></td></tr>';

  // breakdown table
  if (d.rows && d.rows.length) {
    h += '<tr><td style="padding:14px 22px 4px;">' +
      '<div style="font-size:13px;font-weight:800;color:' + D_NAVY + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">What you did</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + D_LINE + ';border-radius:12px;">';
    d.rows.forEach((r, i) => {
      const bg = i % 2 ? '#FBFCFE' : '#fff';
      h += '<tr style="background:' + bg + ';">' +
        '<td style="padding:11px 14px;font-size:14px;color:' + D_NAVY + ';border-top:' + (i ? '1px solid ' + D_LINE : '0') + ';">' + esc(r.label) + '</td>' +
        '<td align="right" style="padding:11px 14px;font-size:18px;font-weight:800;color:' + D_NAVY + ';border-top:' + (i ? '1px solid ' + D_LINE : '0') + ';">' + r.n + '</td>' +
        '<td align="right" width="150" style="padding:11px 14px;border-top:' + (i ? '1px solid ' + D_LINE : '0') + ';">' + moveChip(r.n, r.prev, w.cname) + '</td>' +
        '</tr>';
    });
    h += '</table></td></tr>';
  }

  // what their notes said, and what to do about it today
  const ins = d.insights;
  if (ins && (ins.found.length || ins.advice.length || ins.objections.length)) {
    const readTitle = ins.scope === 'day'
      ? ('What I found in your notes from ' + esc(w.name))
      : 'What I found in your recent notes';
    h += '<tr><td style="padding:18px 22px 4px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8EC;border-radius:12px;">' +
      '<tr><td style="padding:16px 18px;">';
    if (ins.found.length) {
      h += '<div style="font-size:15px;font-weight:800;color:' + D_NAVY + ';margin-bottom:10px;">' + readTitle + '</div>';
      ins.found.forEach((f) => {
        h += '<div style="font-size:13px;color:' + D_NAVY + ';line-height:1.6;margin-bottom:7px;padding-left:14px;position:relative;">' +
          '<span style="color:' + D_TEAL + ';font-weight:800;">&bull;</span> ' + esc(f) + '</div>';
      });
    }
    if (ins.advice.length) {
      h += '<div style="font-size:15px;font-weight:800;color:' + D_NAVY + ';margin:16px 0 9px;">My advice for today</div>';
      ins.advice.forEach((a, i) => {
        h += '<div style="margin-bottom:11px;">' +
          '<div style="font-size:14px;font-weight:700;color:' + D_NAVY + ';line-height:1.5;">' + (i + 1) + '. ' + esc(a.advice || '') + '</div>' +
          (a.why ? '<div style="font-size:13px;color:' + D_MUTED + ';line-height:1.6;margin-top:3px;"><b style="color:' + D_TEAL + ';">Why:</b> ' + esc(a.why) + '</div>' : '') +
          '</div>';
      });
    }
    if (ins.objections.length) {
      h += '<div style="font-size:15px;font-weight:800;color:' + D_NAVY + ';margin:16px 0 9px;">Objections you heard, and how to handle them</div>';
      ins.objections.forEach((o) => {
        h += '<div style="margin-bottom:10px;padding-left:10px;border-left:3px solid ' + D_TEAL + ';">' +
          '<div style="font-size:13px;font-weight:700;color:' + D_NAVY + ';">&ldquo;' + esc(o.objection || '') + '&rdquo;</div>' +
          '<div style="font-size:13px;color:' + D_MUTED + ';line-height:1.6;margin-top:2px;">' + esc(o.handling || '') + '</div>' +
          '</div>';
      });
    }
    h += '</td></tr></table></td></tr>';
  }

  // CTA + footer
  h += '<tr><td style="padding:20px 22px 26px;text-align:center;">' +
    '<a href="' + esc(base) + '" style="display:inline-block;background:' + D_TEAL + ';color:#fff;text-decoration:none;font-weight:800;padding:13px 26px;border-radius:10px;font-size:15px;">Pick up where you left off</a>' +
    '<div style="font-size:12px;color:' + D_MUTED + ';margin-top:14px;">Have a great day. You have got this.</div>' +
    '</td></tr>' +
    '</table></div>';
  return h;
}

function digestText(name, d) {
  const w = d.window;
  let t = 'DAILY INSIGHTS\n\n' +
    (name ? ('Good morning ' + name) : 'Good morning') + ',\n\n' +
    'Here is how ' + w.label + ' went for you.\n' +
    (d.praise ? (d.praise + '\n') : '') + '\n' +
    'You started at ' + (d.start || '') + ' and your last activity was ' + (d.end || '') + ', so you were on it for ' + d.hoursLabel + ' (' + w.cname + ': ' + d.prevHoursLabel + ').\n\n' +
    'Activities: ' + d.total + ' (' + w.cname + ': ' + d.prevTotal + ')\n' +
    'Businesses worked: ' + d.uniqueBusinesses + ' (' + w.cname + ': ' + d.prevUniqueBusinesses + ')\n' +
    'Meetings booked: ' + d.meetingsBooked + ' (' + w.cname + ': ' + d.prevMeetingsBooked + ')\n';
  if (d.rows && d.rows.length) {
    t += '\nWhat you did:\n';
    d.rows.forEach((r) => { t += '- ' + r.label + ': ' + r.n + ' (' + w.cname + ': ' + r.prev + ')\n'; });
  }
  const ins = d.insights;
  if (ins && ins.found.length) {
    t += '\n' + (ins.scope === 'day' ? ('What I found in your notes from ' + w.name) : 'What I found in your recent notes') + ':\n';
    ins.found.forEach((f) => { t += '- ' + f + '\n'; });
  }
  if (ins && ins.advice.length) {
    t += '\nMy advice for today:\n';
    ins.advice.forEach((a, i) => {
      t += (i + 1) + '. ' + (a.advice || '') + '\n';
      if (a.why) t += '   Why: ' + a.why + '\n';
    });
  }
  if (ins && ins.objections.length) {
    t += '\nObjections you heard, and how to handle them:\n';
    ins.objections.forEach((o) => { t += '- "' + (o.objection || '') + '" -> ' + (o.handling || '') + '\n'; });
  }
  t += '\nHave a great day. You have got this.\n\nSite Pounce\n';
  return t;
}

// "Daily Insights" is the fixed brand so it is instantly recognisable ("did you get your Daily
// Insights?"). The day and headline stat vary, which also stops Gmail collapsing every day's email
// into one thread. Never lead with a zero: on a no-meeting day we lead with businesses worked.
function digestSubject(d) {
  const head = d.meetingsBooked > 0
    ? (d.total + ' activities and ' + d.meetingsBooked + ' meeting' + (d.meetingsBooked === 1 ? '' : 's') + ' booked')
    : (d.total + ' activities and ' + d.uniqueBusinesses + ' business' + (d.uniqueBusinesses === 1 ? '' : 'es') + ' worked');
  return '💡 Daily Insights, ' + d.window.name + ': ' + head;
}

// Send one person their Daily Insights. Caller decides who qualifies (see api/cron-digest.js).
async function sendDailyDigestEmail({ to, firstName, digest }) {
  if (!process.env.SENDGRID_API_KEY || !to || !digest || digest.empty) return false;
  const fromEmail = process.env.SITEPOUNCE_FROM_EMAIL || process.env.ERROR_EMAIL_FROM;
  if (!fromEmail) return false;
  const base = process.env.APP_BASE_URL || 'https://sitepounce.com';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: 'Site Pounce' },
    subject: digestSubject(digest),
    content: [
      { type: 'text/plain', value: digestText(firstName, digest) },
      { type: 'text/html', value: digestHtml(firstName, digest, base) },
    ],
    tracking_settings: noTracking(),
  });
  return true;
}

module.exports = { sendNewCustomerEmails, sendFeedbackEmail, sendTeamInviteEmail, sendTeamAddedAdminEmail, sendAccessRequestEmail, sendFeedbackDoneEmail, sendDailyDigestEmail, digestHtml };

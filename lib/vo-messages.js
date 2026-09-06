// Video Outreach messages (spec v4 section 4.7 templates, Appendix C5 post-checks in code).
// Every message is short separate paragraphs with a blank line between them, never one block.
// Rules enforced here, not in a prompt: no em dash, say "Meta" never "Meta library", sign-off
// present, "[insert URL here]" in Message A until a video URL is pasted, connection note under
// 300 characters with no link.

const DEFAULT_PROFILE = {
  service_name: 'ShekiPro.com',
  service_desc: 'AI product videos',
  sender_first: 'Aj',
  sender_title: 'Co-founder, ShekiPro.com',
  signature: '', // optional block under "Thanks,", one line per row; blank = first name then title on two rows
  signoff: 'Thanks',
  offer_line: '20 to 30 product videos a month for supplement brands from £1,000',
  pilot_line: 'can start with a 10-video pilot',
  sample_what: 'product video',
};
const URL_PLACEHOLDER = '[insert URL here]';

function profileWith(p) { return Object.assign({}, DEFAULT_PROFILE, p || {}); }
// The signature block: the profile's signature lines, else name and title on two rows. Single line breaks are allowed here only.
function senderLine(pr) { const sig = String(pr.signature || '').trim(); if (sig) return sig.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n'); return pr.sender_first + (pr.sender_title ? '\n' + pr.sender_title : ''); }

// First name from "Dan Freed" / "Michael Rutigliano Jr" / blank / "Verify founder" -> "Dan" / "[Name]"
function firstName(dmName) {
  const s = String(dmName || '').trim();
  if (!s || /^(not found|verify|tbc|unknown)/i.test(s)) return '[Name]';
  const first = s.split(/\s+/)[0].replace(/[.,]+$/, '');
  return first.length > 1 ? first : '[Name]';
}

// Phase 1 observation: built from category and creative style until Phase 3's ad analysis
// supplies the real one. Max 25 words, mentions Meta (never "Meta library"), no em dash.
function genericObservation(p) {
  const cat = String(p.category || 'product').trim().toLowerCase().replace(/\s+/g, ' ');
  const style = String(p.creative_style || '');
  if (style === 'Static') return 'your ' + cat + ' ads on Meta, which are mostly static, so video would work harder for you';
  return 'your ' + cat + ' video ads on Meta';
}

// An observation slots in after "Came across", so it must not start with "Came across", "I saw" or a
// capital, and must not end with a full stop (the template adds one). The AI sometimes does both.
function cleanObservation(s) {
  let t = String(s || '').trim();
  t = t.replace(/^(i\s+)?(came across|saw|noticed|spotted|found)\s+/i, '').replace(/[.\s]+$/, '').trim();
  if (/^Your\b/.test(t)) t = 'y' + t.slice(1);
  return t;
}
function productLabel(p) {
  return String(p.suggested_product_name || '').trim() || 'your hero product';
}

function joinParas(paras) { return paras.map((x) => String(x).trim()).filter(Boolean).join('\n\n'); }

function connectionNote(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  let obs = ctx.observation;
  let note = 'Hey ' + first + ', I run ' + pr.service_name + ' (' + pr.service_desc + '). Came across ' + obs + ' and made you a free sample video for ' + ctx.product + '. OK to send it over?';
  if (note.length > 300) { // shorten the observation first, then the product, to stay under 300
    obs = obs.split(',')[0];
    note = 'Hey ' + first + ', I run ' + pr.service_name + '. Came across ' + obs + ' and made you a free sample video for ' + ctx.product + '. OK to send it over?';
  }
  return note.slice(0, 300);
}

function messageA(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'I run ' + pr.service_name + '. Came across ' + ctx.observation + '.',
    'So I made you a free sample for ' + ctx.product + ': ' + (ctx.video_url || URL_PLACEHOLDER),
    "If you like it, let's have a chat about doing these on an ongoing basis.",
    pr.signoff + ',',
    senderLine(pr),
  ]);
}

function messageB(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'I run ' + pr.service_name + '. Came across ' + ctx.observation + '.',
    'Happy to make you a free sample for ' + ctx.product + ', no strings. Want me to?',
    pr.signoff + ',',
    senderLine(pr),
  ]);
}

function followUp1(ctx) {
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Quick one, ' + first + '. In case the sample got buried: ' + (ctx.video_url || URL_PLACEHOLDER) + '.',
    "If the angle is wrong, tell me what you'd test instead and I'll redo it, it takes me about 30 minutes.",
  ]);
}

function followUp2(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Last note from me, ' + first + '.',
    'If creative volume ever becomes the bottleneck, we do ' + pr.offer_line + ', and ' + pr.pilot_line + '.',
    'Otherwise, good luck with ' + (ctx.seasonal_event || 'the season ahead') + '.',
  ]);
}


// ---- Template sets (Phase 4, spec 2.1 "Message template set", editable per campaign) ----
// Placeholders: {first} {service_name} {service_desc} {observation} {product} {video_url} {signoff}
// {sender_first} {sender_title} {sender_line} {offer_line} {pilot_line} {seasonal_event}. A blank line (or " / ") separates paragraphs.
const DEFAULT_TEMPLATES = {
  connection_note: 'Hey {first}, I run {service_name} ({service_desc}). Came across {observation} and made you a free sample video for {product}. OK to send it over?',
  message_a: 'Hey {first}\n\nI run {service_name}. Came across {observation}.\n\nSo I made you a free sample for {product}: {video_url}\n\nIf you like it, let\'s have a chat about doing these on an ongoing basis.\n\n{signoff},\n\n{sender_line}',
  message_b: 'Hey {first}\n\nI run {service_name}. Came across {observation}.\n\nHappy to make you a free sample for {product}, no strings. Want me to?\n\n{signoff},\n\n{sender_line}',
  followup_1: 'Quick one, {first}. In case the sample got buried: {video_url}.\n\nIf the angle is wrong, tell me what you\'d test instead and I\'ll redo it, it takes me about 30 minutes.',
  followup_2: 'Last note from me, {first}.\n\nIf creative volume ever becomes the bottleneck, we do {offer_line}, and {pilot_line}.\n\nOtherwise, good luck with {seasonal_event}.',
};
function render(template, ctx) {
  const pr = profileWith(ctx.profile);
  const vars = { first: ctx.first || firstName(ctx.dm_name), service_name: pr.service_name, service_desc: pr.service_desc, observation: ctx.observation || '', product: ctx.product || 'your hero product',
    video_url: ctx.video_url || URL_PLACEHOLDER, signoff: pr.signoff, sender_first: pr.sender_first, sender_title: pr.sender_title || '', sender_line: senderLine(pr), signature: senderLine(pr), offer_line: pr.offer_line, pilot_line: pr.pilot_line, seasonal_event: ctx.seasonal_event || 'the season ahead' };
  const t = String(template || '').replace(/\s\/\s/g, '\n\n');
  return joinParas(t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))).split(/\n\n+/));
}
function templatesWith(set) { const out = Object.assign({}, DEFAULT_TEMPLATES); for (const k of Object.keys(DEFAULT_TEMPLATES)) if (set && typeof set[k] === 'string' && set[k].trim()) out[k] = set[k]; return out; }

// Appendix C5 post-checks. Returns { ok, errors: [] }. kind: 'note' | 'message_a' | 'message_b' | 'followup'
function postCheck(text, opts) {
  const o = opts || {};
  const pr = profileWith(o.profile);
  const t = String(text || '');
  const errors = [];
  if (/\u2014/.test(t)) errors.push('contains an em dash'); // U+2014, written as an escape so the character never appears in source
  if (/meta library/i.test(t) || /meta ad library/i.test(t)) errors.push('says "Meta library"');
  if (o.kind === 'note') {
    if (t.length > 300) errors.push('connection note over 300 characters (' + t.length + ')');
    if (/https?:\/\/|www\.|\.com\/|\[insert URL here\]/i.test(t.replace(pr.service_name, ''))) errors.push('connection note contains a link');
  } else {
    const paras = t.split('\n\n');
    if (paras.length < 2) errors.push('not split into paragraphs');
    if (paras.slice(0, -1).some((p) => p.includes('\n'))) errors.push('a paragraph contains a line break, use a blank line between paragraphs (only the signature block may)');
    if (paras.some((p) => !p.trim())) errors.push('empty paragraph');
    if (o.kind !== 'followup') {
      if (t.indexOf(pr.sender_first) < 0) errors.push('missing sign-off name');
      if (t.indexOf(pr.signoff) < 0) errors.push('missing sign-off');
    }
    if (o.kind === 'message_a') {
      if (!o.video_url && t.indexOf(URL_PLACEHOLDER) < 0) errors.push('Message A must contain "' + URL_PLACEHOLDER + '" until a video URL is pasted');
      if (o.video_url && t.indexOf(o.video_url) < 0) errors.push('Message A must contain the video URL');
    }
  }
  return { ok: errors.length === 0, errors: errors };
}

// Build everything for one prospect. Throws if a generated message fails its own post-check,
// which is a bug in the templates and must never reach a user.
function generate(prospect, profile, videoUrl, templateSet) {
  const ctx = {
    profile: profileWith(profile),
    dm_name: prospect.dm_name,
    first: firstName(prospect.dm_name),
    observation: cleanObservation(prospect.observation) || genericObservation(prospect),
    product: productLabel(prospect),
    video_url: videoUrl || prospect.video_url || null,
    seasonal_event: prospect.seasonal_event || null,
  };
  const custom = templateSet && typeof templateSet === 'object' ? templateSet : null;
  const pick = (key, builtIn) => (custom && typeof custom[key] === 'string' && custom[key].trim() ? render(custom[key], ctx) : builtIn(ctx));
  const out = {
    observation: ctx.observation,
    connection_note: custom && custom.connection_note ? render(custom.connection_note, ctx).slice(0, 300) : connectionNote(ctx),
    message_a: pick('message_a', messageA),
    message_b: pick('message_b', messageB),
    followup_1: pick('followup_1', followUp1),
    followup_2: pick('followup_2', followUp2),
  };
  const checks = {
    connection_note: postCheck(out.connection_note, { kind: 'note', profile: ctx.profile }),
    message_a: postCheck(out.message_a, { kind: 'message_a', profile: ctx.profile, video_url: ctx.video_url }),
    message_b: postCheck(out.message_b, { kind: 'message_b', profile: ctx.profile }),
    followup_1: postCheck(out.followup_1, { kind: 'followup', profile: ctx.profile }),
    followup_2: postCheck(out.followup_2, { kind: 'followup', profile: ctx.profile }),
  };
  const failed = Object.entries(checks).filter(([, c]) => !c.ok);
  if (failed.length) throw new Error('message post-check failed: ' + failed.map(([k, c]) => k + ': ' + c.errors.join('; ')).join(' | '));
  return out;
}

module.exports = { DEFAULT_PROFILE, DEFAULT_TEMPLATES, render, templatesWith, URL_PLACEHOLDER, firstName, cleanObservation, genericObservation, connectionNote, messageA, messageB, followUp1, followUp2, postCheck, generate };

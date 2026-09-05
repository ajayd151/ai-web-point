// Video Outreach messages (spec v4 section 4.7 templates, Appendix C5 post-checks in code).
// Every message is short separate paragraphs with a blank line between them, never one block.
// Rules enforced here, not in a prompt: no em dash, say "Meta" never "Meta library", sign-off
// present, "[insert URL here]" in Message A until a video URL is pasted, connection note under
// 300 characters with no link.

const DEFAULT_PROFILE = {
  service_name: 'Shekipro.com',
  service_desc: 'AI product videos',
  sender_first: 'AJ',
  signoff: 'Thanks',
  offer_line: '20 to 30 product videos a month for supplement brands from £1,000',
  pilot_line: 'can start with a 10-video pilot',
  sample_what: 'product video',
};
const URL_PLACEHOLDER = '[insert URL here]';

function profileWith(p) { return Object.assign({}, DEFAULT_PROFILE, p || {}); }

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
    pr.sender_first,
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
    pr.sender_first,
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
    if (paras.some((p) => p.includes('\n'))) errors.push('a paragraph contains a line break, use a blank line between paragraphs');
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
function generate(prospect, profile, videoUrl) {
  const ctx = {
    profile: profileWith(profile),
    dm_name: prospect.dm_name,
    first: firstName(prospect.dm_name),
    observation: String(prospect.observation || '').trim() || genericObservation(prospect),
    product: productLabel(prospect),
    video_url: videoUrl || prospect.video_url || null,
    seasonal_event: prospect.seasonal_event || null,
  };
  const out = {
    observation: ctx.observation,
    connection_note: connectionNote(ctx),
    message_a: messageA(ctx),
    message_b: messageB(ctx),
    followup_1: followUp1(ctx),
    followup_2: followUp2(ctx),
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

module.exports = { DEFAULT_PROFILE, URL_PLACEHOLDER, firstName, genericObservation, connectionNote, messageA, messageB, followUp1, followUp2, postCheck, generate };

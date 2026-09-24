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
  offer_line: '20 to 30 product videos a month from £1,000',
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
  // the 'mostly static' point is made by the proof line now, so the observation stays a plain sighting
  if (style === 'Static') return 'your ' + cat + ' ads on Meta';
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
// A short clause with a real number, only when the count is trustworthy (a full page count, a recount, or the researched tracker).
// Reads inside the sentence: "Came across your X ads on Meta, 9 new ones this month, so I made you..."
function countsTrusted(p) {
  if (p.source === 'import' || p.source === 'demo' || p.source === 'fixture') return true;
  if (p.meta_page_id) return true;
  if (p.last_checked_at && p.created_at && new Date(p.last_checked_at) > new Date(new Date(p.created_at).getTime() + 60000)) return true;
  return false;
}
function proofLine(p) {
  if (!countsTrusted(p)) return '';
  const n30 = Number(p.new_ads_30d) || 0; const active = Number(p.active_meta_ads) || 0; const style = String(p.creative_style || '');
  if (n30 >= 5) return ', ' + n30 + ' new ones this month';
  if (active >= 30) return ', ' + active + ' running right now';
  if (style === 'Static' && active > 0) return ', mostly still images';
  return '';
}
// The second product on the shortlist, for the closing question ("want me to do one for X next?")
function nextProduct(p) { const c = Array.isArray(p.product_candidates) ? p.product_candidates : []; const n = c[1] && c[1].name && c[1].name !== p.suggested_product_name ? shortProduct(c[1].name) : ''; return n && n !== productLabel(p) ? n : ''; }
// Store titles carry specs ("Core - Creatine Monohydrate Gummies - 1.5g per Gummy"). For the message keep the name, drop the specs.
function shortProduct(title) {
  let t = String(title || '').split('|')[0];
  t = t.replace(/\[[^\]]*\]/g, ' ');                                                        // [Amazon #1], [New]
  t = t.replace(/\(([^)]*)\)/g, ' ');                                                        // (30 servings)
  t = t.replace(/\b(new\s+)?detail\s+page\b/gi, ' ').replace(/\b(official|best\s*seller|bestseller|top\s+rated|amazon'?s?\s*choice|amazon)\b/gi, ' '); // store labels, not product words
  t = t.replace(/^\s*(new!?|sale!?|hot!?)\s+/i, ' ').replace(/#\s*\d+/g, ' ');                 // NEW! / SALE / #1
  t = t.replace(/^\s*(EU|US|UK|CA|AU|USA|GB|DE|FR|ES|IT|NL)\s+(?=\S)/, ' ');                        // store-variant region prefix: EU Collagen Mask
  t = t.replace(/\b\d+\s*(bags?|bottles?|boxes?|packs?|jars?|tubs?)\s+of\b/gi, ' ');           // 3 Bags of
  t = t.replace(/\b\d[\d,.]*\s?(g|mg|mcg|ml|oz|lb|lbs|kg|ct|servings?|caps?|capsules?|tablets?|count)\b/gi, ' '); // 1.5g, 5,000 mg
  t = t.replace(/\bper\s+\w+/gi, ' ').replace(/\b\d+\s*x\b/gi, ' ').replace(/\b\d+-pack\b/gi, ' ');   // per Gummy, 2 x, 3-pack
  t = t.replace(/\s+-\s+|\s+–\s+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s,:-]+$/g, '').trim();
  let words = t.split(' ').filter(Boolean);
  while (words.length > 1 && words.slice(0, -1).map((w) => w.toLowerCase()).includes(words[words.length - 1].toLowerCase())) words.pop(); // a dangling repeat left by a removed spec
  if (words.length > 7) words = words.slice(0, 7);
  return words.join(' ') || String(title || '').trim();
}
function productLabel(p) {
  return shortProduct(p.suggested_product_name) || 'your hero product';
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

// Connection note B for the 50:50 test: refers to their product or brand, gives nothing away, no offer, no link.
// A: the offer note above. B: this. The queue alternates them and Results shows acceptance and replies per note.
function softNote(p, profile) {
  const first = firstName(p.dm_name);
  const product = shortProduct(p.suggested_product_name || '');
  const what = product ? 'your ' + product + ' ads' : (p.brand ? 'the ' + p.brand + ' ads' : 'your ads');
  let note = 'Hey ' + first + ', ' + what + ' keep showing up in my Meta feed. Would be good to connect.';
  if (note.length > 300) note = 'Hey ' + first + ', your ads keep showing up in my Meta feed. Would be good to connect.';
  return note.slice(0, 300);
}
const NOTE_VARIANTS = { offer: 'A: says what we do and offers the free sample', soft: 'B: mentions their product, no offer' };

// Attachment sends: the sample is in the message itself, so the sentence ends "it is attached below" instead of a link.
const ATTACHED = ', attached below.';
function forAttachment(text) { return String(text || '').replace(/:\s*(\[insert URL here\]|https:\/\/\S+)/, ATTACHED); }
function forLink(text, url) { return String(text || '').replace(/, (?:it is )?attached below\.?/, ': ' + (url || URL_PLACEHOLDER)); }

// The ask after the sample: not another one-off, a standing supply of ads and a time to talk about it.
const CLOSING_CHAT = 'If you like it, I can make these for you daily or weekly. Open to a quick chat? Send me a day and time and I will set it up.';

function messageA(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'I run ' + pr.service_name + '. Saw ' + ctx.observation + (ctx.proof || '') + ', so I made you a free sample video for ' + ctx.product + ': ' + (ctx.video_url || URL_PLACEHOLDER),
    CLOSING_CHAT,
    pr.signoff + ',',
    senderLine(pr),
  ]);
}

function messageB(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'I run ' + pr.service_name + '. Came across ' + ctx.observation + (ctx.proof || '') + '.',
    'Happy to make you a free sample for ' + ctx.product + ', no strings. Want me to?',
    pr.signoff + ',',
    senderLine(pr),
  ]);
}

function followUp1(ctx) {
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'Quick one in case the sample got buried: ' + (ctx.video_url || URL_PLACEHOLDER),
    "If the angle is wrong, tell me what you'd test instead and I'll redo it.",
  ]);
}

// The season hook for Follow-up 3, worked out at the moment of sending from the brand's own country calendar
// (Thanksgiving is US only, Mothering Sunday moves with Easter in the UK and Ireland, Father's Day is September in Australia).
// Only an occasion at least 14 days ahead is named, never one that has passed or is days away; otherwise a neutral line.
function nthWeekday(y, m, weekday, n) { const d = new Date(Date.UTC(y, m - 1, 1)); const shift = (weekday - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m - 1, 1 + shift + (n - 1) * 7)); }
function lastWeekday(y, m, weekday) { const d = new Date(Date.UTC(y, m, 0)); const shift = (d.getUTCDay() - weekday + 7) % 7; return new Date(Date.UTC(y, m - 1, d.getUTCDate() - shift)); }
function easter(y) { // Gregorian computus (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function day(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
function blackFriday(y) { return addDays(nthWeekday(y, 11, 4, 4), 1); } // the day after US Thanksgiving, the same date everywhere it is run
const COUNTRY_ALIAS = { GB: 'UK', 'UNITED KINGDOM': 'UK', ENGLAND: 'UK', 'UNITED STATES': 'US', USA: 'US', CANADA: 'CA', AUSTRALIA: 'AU', IRELAND: 'IE', 'NEW ZEALAND': 'NZ' };
function countryCode(c) { const u = String(c || 'US').trim().toUpperCase(); return COUNTRY_ALIAS[u] || u; }
function occasionsFor(country, y) {
  const cc = countryCode(country);
  const xmas = { name: 'Christmas', major: true, date: day(y, 12, 25) };
  const ny = { name: 'the new year', major: true, date: day(y + 1, 1, 1) };
  const val = { name: "Valentine's Day", major: true, date: day(y, 2, 14) };
  const bf = { name: 'Black Friday', major: true, date: blackFriday(y) };
  if (cc === 'US') return [val,
    { name: "Mother's Day", major: true, date: nthWeekday(y, 5, 0, 2) },
    { name: 'Memorial Day', major: false, date: lastWeekday(y, 5, 1) },
    { name: "Father's Day", major: true, date: nthWeekday(y, 6, 0, 3) },
    { name: 'the 4th of July', major: false, date: day(y, 7, 4) },
    { name: 'Labor Day', major: false, date: nthWeekday(y, 9, 1, 1) },
    { name: 'Halloween', major: false, date: day(y, 10, 31) },
    { name: 'Thanksgiving and Black Friday', major: true, date: nthWeekday(y, 11, 4, 4) },
    xmas, ny];
  if (cc === 'UK' || cc === 'IE') return [val,
    { name: "Mother's Day", major: true, date: addDays(easter(y), -21) },
    { name: 'Easter', major: false, date: easter(y) },
    { name: "Father's Day", major: true, date: nthWeekday(y, 6, 0, 3) },
    { name: 'Halloween', major: false, date: day(y, 10, 31) },
    bf, xmas, ny].concat(cc === 'IE' ? [{ name: "St Patrick's Day", major: false, date: day(y, 3, 17) }] : []);
  if (cc === 'CA') return [val,
    { name: "Mother's Day", major: true, date: nthWeekday(y, 5, 0, 2) },
    { name: "Father's Day", major: true, date: nthWeekday(y, 6, 0, 3) },
    { name: 'Canada Day', major: false, date: day(y, 7, 1) },
    { name: 'Halloween', major: false, date: day(y, 10, 31) },
    bf, { name: 'Christmas and Boxing Day', major: true, date: day(y, 12, 25) }, ny];
  if (cc === 'AU' || cc === 'NZ') return [val,
    { name: "Mother's Day", major: true, date: nthWeekday(y, 5, 0, 2) },
    { name: 'the end of financial year sales', major: false, date: day(y, cc === 'AU' ? 6 : 3, cc === 'AU' ? 30 : 31) },
    { name: "Father's Day", major: true, date: nthWeekday(y, 9, 0, 1) },
    bf, { name: 'Christmas and Boxing Day', major: true, date: day(y, 12, 25) }, ny];
  // anywhere else we sell to: only the moments that are the same date in every market
  return [val, bf, xmas, ny];
}
function upcomingOccasion(now, country) {
  const t = now || new Date(); const y = t.getUTCFullYear();
  const all = occasionsFor(country, y - 1).concat(occasionsFor(country, y), occasionsFor(country, y + 1)).map((o) => Object.assign({}, o, { days: Math.floor((o.date - t) / 86400000) }));
  // the big shopping moments first (14 to 75 days ahead: brands plan Black Friday from late September), smaller sale weekends (14 to 45 days) only if none
  const ok = all.filter((o) => o.days >= 14 && o.days <= 75).sort((a, b) => a.days - b.days);
  return ok.find((o) => o.major) || ok.find((o) => !o.major && o.days <= 45) || null;
}
function seasonalHook(now, country) {
  const o = upcomingOccasion(now, country);
  return o ? 'With ' + o.name + ' coming up' : 'Ahead of your next campaign';
}
function followUp3(ctx) {
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    seasonalHook(ctx.now, ctx.country) + ', most brands we talk to are short on fresh video ads. If you want, I can make a second sample for ' + (ctx.next_product || 'another of your products') + ', free as before.',
  ]);
}
function followUp2(ctx) {
  const pr = profileWith(ctx.profile);
  const first = ctx.first || firstName(ctx.dm_name);
  return joinParas([
    'Hey ' + first,
    'Last note from me. If creative volume ever becomes the bottleneck, we do ' + pr.offer_line + ', and ' + pr.pilot_line + '.',
    'Otherwise, good luck with ' + (ctx.seasonal_event || 'the season ahead') + '.',
  ]);
}


// ---- Template sets (Phase 4, spec 2.1 "Message template set", editable per campaign) ----
// Placeholders: {first} {service_name} {service_desc} {observation} {product} {video_url} {signoff}
// {sender_first} {sender_title} {sender_line} {proof} {closing_question} {offer_line} {pilot_line} {seasonal_event}. A blank line (or " / ") separates paragraphs.
const DEFAULT_TEMPLATES = {
  connection_note: 'Hey {first}, I run {service_name} ({service_desc}). Came across {observation} and made you a free sample video for {product}. OK to send it over?',
  message_a: 'Hey {first}\n\nI run {service_name}. Saw {observation}{proof}, so I made you a free sample video for {product}: {video_url}\n\n{closing_question}\n\n{signoff},\n\n{sender_line}',
  message_b: 'Hey {first}\n\nI run {service_name}. Came across {observation}{proof}.\n\nHappy to make you a free sample for {product}, no strings. Want me to?\n\n{signoff},\n\n{sender_line}',
  followup_1: 'Hey {first}\n\nQuick one in case the sample got buried: {video_url}\n\nIf the angle is wrong, tell me what you\'d test instead and I\'ll redo it.',
  followup_2: 'Hey {first}\n\nLast note from me. If creative volume ever becomes the bottleneck, we do {offer_line}, and {pilot_line}.\n\nOtherwise, good luck with {seasonal_event}.',
};
function render(template, ctx) {
  const pr = profileWith(ctx.profile);
  const vars = { first: ctx.first || firstName(ctx.dm_name), service_name: pr.service_name, service_desc: pr.service_desc, observation: ctx.observation || '', product: ctx.product || 'your hero product',
    video_url: ctx.video_url || URL_PLACEHOLDER, signoff: pr.signoff, sender_first: pr.sender_first, sender_title: pr.sender_title || '', sender_line: senderLine(pr), signature: senderLine(pr), proof: ctx.proof || '', next_product: ctx.next_product || '', closing_question: CLOSING_CHAT, offer_line: pr.offer_line, pilot_line: pr.pilot_line, seasonal_event: ctx.seasonal_event || 'the season ahead' };
  const t = String(template || '').replace(/\s\/\s/g, '\n\n');
  return joinParas(t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').split(/\n\n+/));
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
    if (o.kind === 'message_a' && o.attachment) {
      if (t.indexOf(URL_PLACEHOLDER) >= 0) errors.push('Message A still says "' + URL_PLACEHOLDER + '"; with an attachment it should say the sample is attached');
      if (!/attached/i.test(t)) errors.push('Message A should tell them the sample is attached below');
    } else if (o.kind === 'message_a') {
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
    proof: proofLine(prospect),
    next_product: nextProduct(prospect),
    country: prospect.country || 'US',
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
    followup_3: pick('followup_3', followUp3),
  };
  const checks = {
    connection_note: postCheck(out.connection_note, { kind: 'note', profile: ctx.profile }),
    message_a: postCheck(out.message_a, { kind: 'message_a', profile: ctx.profile, video_url: ctx.video_url }),
    message_b: postCheck(out.message_b, { kind: 'message_b', profile: ctx.profile }),
    followup_1: postCheck(out.followup_1, { kind: 'followup', profile: ctx.profile }),
    followup_2: postCheck(out.followup_2, { kind: 'followup', profile: ctx.profile }),
    followup_3: postCheck(out.followup_3, { kind: 'followup', profile: ctx.profile }),
  };
  const failed = Object.entries(checks).filter(([, c]) => !c.ok);
  if (failed.length) throw new Error('message post-check failed: ' + failed.map(([k, c]) => k + ': ' + c.errors.join('; ')).join(' | '));
  return out;
}

module.exports = { seasonalHook, upcomingOccasion, occasionsFor, easter, CLOSING_CHAT, forAttachment, forLink, ATTACHED, softNote, NOTE_VARIANTS, DEFAULT_PROFILE, DEFAULT_TEMPLATES, render, templatesWith, URL_PLACEHOLDER, firstName, cleanObservation, genericObservation, proofLine, countsTrusted, nextProduct, shortProduct, connectionNote, messageA, messageB, followUp1, followUp2, postCheck, generate };

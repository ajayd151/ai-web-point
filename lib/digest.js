// The "how you got on" daily summary for one person.
// Window = the last working day. Monday's digest covers Friday (and any weekend work), so nothing
// is ever lost. It is compared against the working day before that. Shared by the 8am cron email
// and the dashboard card, so both always show exactly the same numbers.
const { activityReport, activitySpan, notesLog } = require('./db');

const TZ = 'Europe/London';

// ---- London-aware date helpers (the server runs UTC, the working day is UK) ----
function londonOffsetMs(d) {
  const s = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return s.getTime() - u.getTime();
}
function londonYmd(d) {
  const b = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).split('-').map(Number);
  return { y: b[0], m: b[1], d: b[2] };
}
// Current hour in London (0-23). Lets the cron fire at 8am UK in both GMT and BST.
function londonHour(d) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d || new Date()));
}
// The UTC instant of midnight-in-London for a given London date.
function londonMidnightUtc(x) {
  const guess = Date.UTC(x.y, x.m - 1, x.d, 0, 0, 0);
  return new Date(guess - londonOffsetMs(new Date(guess)));
}
function noonUtc(x) { return new Date(Date.UTC(x.y, x.m - 1, x.d, 12, 0, 0)); }
function addDays(x, n) {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n, 12, 0, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function isWeekend(x) { const w = noonUtc(x).getUTCDay(); return w === 0 || w === 6; }
function prevWorkingDay(x) { let c = addDays(x, -1); while (isWeekend(c)) c = addDays(c, -1); return c; }
function dayLabel(x) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(noonUtc(x));
}
function dayName(x) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(noonUtc(x));
}
function timeLabel(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
function todayKey(d) { const x = londonYmd(d || new Date()); return x.y + '-' + String(x.m).padStart(2, '0') + '-' + String(x.d).padStart(2, '0'); }

// The window this morning's digest covers, and the one it is measured against.
function windows(now) {
  const today = londonYmd(now || new Date());
  const day = prevWorkingDay(today);   // Mon -> Friday, so weekend work rolls into Monday's email
  const cday = prevWorkingDay(day);
  return {
    day: day, cday: cday,
    label: dayLabel(day), name: dayName(day),
    clabel: dayLabel(cday), cname: dayName(cday),
    from: londonMidnightUtc(day).toISOString(),
    to: londonMidnightUtc(today).toISOString(),
    cfrom: londonMidnightUtc(cday).toISOString(),
    cto: londonMidnightUtc(day).toISOString(),
  };
}

// The activity types we report on, in the order they matter to a salesperson.
const ACTIONS = [
  { key: 'status_update', label: 'Status updates' },
  { key: 'call_add', label: 'Leads added to call list' },
  { key: 'prowl', label: 'Leads researched' },
  { key: 'message_sent', label: 'Messages sent' },
  { key: 'mockup', label: 'Mockups created' },
  { key: 'pounce', label: 'Websites built' },
  { key: 'search', label: 'Searches run' },
  { key: 'csv_export', label: 'CSV exports' },
];

function hoursBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000);
}
function hoursLabel(h) {
  const m = Math.round((h || 0) * 60);
  if (m < 1) return '0m';
  const hh = Math.floor(m / 60); const mm = m % 60;
  if (!hh) return mm + 'm';
  return mm ? (hh + 'h ' + mm + 'm') : (hh + 'h');
}

// The encouraging one-liner. Always positive: a quieter day gets credit for the graft, never a
// telling-off. Built here so the email and the dashboard card always say the same thing.
function praiseLine(cur, prev, cname) {
  if (cur.meetingsBooked > 1) return 'Brilliant day. ' + cur.meetingsBooked + ' appointments booked is exactly how it is done.';
  if (cur.meetingsBooked === 1) return 'Great work, you booked an appointment. That is the one that counts.';
  if (cur.total > prev.total) return 'Strong day, you put in more than ' + cname + '. Keep that rhythm going.';
  if (cur.uniqueBusinesses >= 10) return 'Good graft, ' + cur.uniqueBusinesses + ' businesses worked. The numbers game pays you back.';
  if (cur.uniqueBusinesses > 0) return 'Nice work. Every conversation moves you closer to the next yes.';
  return 'Good to see you at it. Today is a fresh run at it.';
}

async function statsFor(actor, from, to) {
  const rep = await activityReport(actor, from, to);
  const span = await activitySpan(actor, from, to);
  const counts = {};
  ((rep && rep.counts) || []).forEach((c) => { counts[c.action] = c.n; });
  return {
    counts: counts,
    total: (span && span.total) || 0,
    first: (span && span.first) ? new Date(span.first).toISOString() : null,
    last: (span && span.last) ? new Date(span.last).toISOString() : null,
    uniqueBusinesses: (rep && rep.uniqueBusinesses) || 0,
    meetingsBooked: (rep && rep.meetingsBooked) || 0,
  };
}

const INSIGHT_SYS = [
  'You coach a UK salesperson who finds local businesses with no website and sells them one.',
  'You are given the call notes THEY wrote (each line: [business] note).',
  'First tell them what you actually found in those notes. Then give specific advice for today based on it.',
  'found = 2 to 4 short observations about what really happened, naming the real businesses involved.',
  'advice = 2 to 3 specific actions to take today. Each needs a one line reason, and a concrete next step.',
  'objections = objections that actually came up, each with a line to handle it AND a question to ask next.',
  // The two rules that make the advice actually usable on a call.
  'RULE 1: every piece of advice must end in a concrete next step. Say what to do, what to say, and when.',
  'A good next step names a timeframe or a specific ask, for example "ask to book a 15 minute call in 3 weeks to see how they are getting on",',
  'or a practical forward question the notes open up, for example "ask how they plan to market the new site, because that is best started early".',
  'RULE 2: never leave an objection as a rebuttal. Acknowledge or congratulate them first, then ask a specific question that keeps the conversation open.',
  'For example, if they say they are already on page 1, congratulate them, then ask which keywords they are on page 1 for, and for which town.',
  'A question they have to think about beats a counter argument every time.',
  // Future pacing: talk about the win as though it has already happened, then make saying yes easy.
  'RULE 3: write the next step using future pacing. Talk as if the good outcome has already happened, so they picture themselves in it.',
  'Say "to see how you got on with the new site" rather than "to see if you want a site". That quietly presupposes the win.',
  'Then make it easy to say yes: propose ONE specific weekday and time in business hours, never a vague window like "in 3 weeks".',
  'A named day and time gets acted on far more often than a rough window, so always commit to one.',
  'Work real dates out from today\'s date, which is given below. Never propose a Saturday or a Sunday.',
  'Write nextStep as the actual words to say, first person, ready to use. For example:',
  '"I would love to give you a quick call to see how you are getting on with the new site, would Tuesday 4 August at 2pm suit you?"',
  'Use the same future pacing in the objection questions where it fits naturally.',
  'Be encouraging and concrete. Quote the real businesses and the real wording from the notes.',
  'Never invent anything that is not in the notes. If a section has nothing, return an empty array.',
  'Never use em dashes; use commas, full stops or brackets.',
  'Return ONLY JSON: {"found":["..."],"advice":[{"advice":"...","why":"...","nextStep":"..."}],"objections":[{"objection":"...","handling":"...","ask":"..."}]}.',
].join(' ');

// What their notes actually said, and what to do about it today.
// Reads the notes written on the day being reported (that is the point of a daily digest). If that
// day was thin on notes, it widens to the last 14 days so the advice still has something real to
// work with, and says so via `scope` so the heading stays honest about what it read.
async function insightsFor(actor, w, now) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !actor || !w) return null;
  let rows = [];
  try { rows = await notesLog(null, { author: actor, limit: 200 }); } catch (e) { return null; }

  const from = Date.parse(w.from); const to = Date.parse(w.to);
  const tsOf = (r) => (r.ts ? new Date(r.ts).getTime() : 0);
  let notes = rows.filter((r) => r.note && tsOf(r) >= from && tsOf(r) < to);
  let scope = 'day';
  if (notes.length < 2) {
    const cutoff = Date.now() - 14 * 86400000;
    const wider = rows.filter((r) => r.note && tsOf(r) >= cutoff);
    if (wider.length > notes.length) { notes = wider; scope = 'recent'; }
  }
  if (!notes.length) return null;

  let corpus = ''; const cap = 9000;
  for (const n of notes) {
    const line = '[' + (n.business || 'Unknown') + '] ' + n.note + '\n';
    if (corpus.length + line.length > cap) break;
    corpus += line;
  }
  // The model needs today's date to be able to propose a real day ("Tuesday 4 August at 2pm").
  const today = dayLabel(londonYmd(now || new Date()));
  const header = 'Today is ' + today + '. Work out any dates you propose from that, weekdays only.\n\n' +
    (scope === 'day'
      ? ('My notes from ' + w.label + ' (' + notes.length + '):')
      : ('My notes from the last 14 days (' + notes.length + '):'));
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: INSIGHT_SYS }, { role: 'user', content: header + '\n\n' + corpus }],
      }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    let parsed = {}; try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = {}; }
    const found = Array.isArray(parsed.found) ? parsed.found.slice(0, 4) : [];
    const advice = Array.isArray(parsed.advice) ? parsed.advice.slice(0, 3) : [];
    const objections = Array.isArray(parsed.objections) ? parsed.objections.slice(0, 3) : [];
    if (!found.length && !advice.length && !objections.length) return null;
    return { found: found, advice: advice, objections: objections, scope: scope, noteCount: notes.length };
  } catch (e) { return null; }
}

// Build one person's digest. Returns { empty:true } when they did nothing (we then send no email).
async function buildDigest(actor, opts) {
  const o = opts || {};
  const w = windows(o.now);
  const cur = await statsFor(actor, w.from, w.to);
  if (!cur.total) return { actor: actor, empty: true, window: w };
  const prev = await statsFor(actor, w.cfrom, w.cto);

  const hours = hoursBetween(cur.first, cur.last);
  const rows = ACTIONS
    .map((a) => ({ key: a.key, label: a.label, n: cur.counts[a.key] || 0, prev: prev.counts[a.key] || 0 }))
    .filter((r) => r.n || r.prev);
  const insights = o.insights === false ? null : await insightsFor(actor, w, o.now || new Date());

  return {
    actor: actor,
    empty: false,
    window: w,
    praise: praiseLine(cur, prev, w.cname),
    start: timeLabel(cur.first),
    end: timeLabel(cur.last),
    hours: hours,
    hoursLabel: hoursLabel(hours),
    prevHoursLabel: hoursLabel(hoursBetween(prev.first, prev.last)),
    total: cur.total, prevTotal: prev.total,
    uniqueBusinesses: cur.uniqueBusinesses, prevUniqueBusinesses: prev.uniqueBusinesses,
    meetingsBooked: cur.meetingsBooked, prevMeetingsBooked: prev.meetingsBooked,
    rows: rows,
    insights: insights,
  };
}

module.exports = { buildDigest, windows, londonHour, todayKey, hoursLabel, ACTIONS };

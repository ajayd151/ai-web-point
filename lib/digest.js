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
  if (cur.meetingsBooked > 1) return 'Brilliant day. ' + cur.meetingsBooked + ' meetings booked is exactly how it is done.';
  if (cur.meetingsBooked === 1) return 'Great work, you booked a meeting. That is the one that counts.';
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
  'You are given their own recent call notes (each: [business] note).',
  'Return the 3 most useful insights from THEIR notes, each with a specific, practical suggestion for today.',
  'Also pull out the objections that actually came up in the notes, each with a specific line to handle it.',
  'Be encouraging and positive, but concrete. Reference real businesses and real wording from the notes.',
  'Never use em dashes; use commas, full stops or brackets.',
  'Return ONLY JSON: {"insights":[{"insight":"...","suggestion":"..."}],"objections":[{"objection":"...","handling":"..."}]}.',
  'Maximum 3 insights and 3 objections. If the notes show nothing useful, return empty arrays.',
].join(' ');

// Top insights from this person's OWN notes (author-attributed), last `days` days.
async function insightsFor(actor, days) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !actor) return null;
  let rows = [];
  try { rows = await notesLog(null, { author: actor, limit: 150 }); } catch (e) { return null; }
  const cutoff = Date.now() - (days || 14) * 86400000;
  const notes = rows.filter((r) => {
    const t = r.ts ? new Date(r.ts).getTime() : 0;
    return r.note && (!t || t >= cutoff);
  });
  if (!notes.length) return null;

  let corpus = ''; const cap = 9000;
  for (const n of notes) {
    const line = '[' + (n.business || 'Unknown') + '] ' + n.note + '\n';
    if (corpus.length + line.length > cap) break;
    corpus += line;
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: INSIGHT_SYS }, { role: 'user', content: 'My notes (' + notes.length + ', last ' + (days || 14) + ' days):\n\n' + corpus }],
      }),
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    let parsed = {}; try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = {}; }
    const insights = Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [];
    const objections = Array.isArray(parsed.objections) ? parsed.objections.slice(0, 3) : [];
    if (!insights.length && !objections.length) return null;
    return { insights: insights, objections: objections, noteCount: notes.length };
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
  const insights = o.insights === false ? null : await insightsFor(actor, 14);

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

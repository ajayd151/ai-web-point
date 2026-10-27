// Week-by-week running costs for the graph on Video Outreach > Analytics (27 Oct 2026, Ajay asked after
// a £311 Twilio month). Real bills where the provider gives them, our own estimates where it does not:
//   Twilio  (real, GBP): Usage Records Daily for sms, lookups and the account total (numbers, calls)
//   Apify   (real, USD): /users/me/usage/monthly daily totals, one call per billing cycle
//   Apollo + AI for Video Outreach searches (estimate): each run's cost minus its Apify rows
//   SitePounce tools (estimate): the usage_daily cost:* ledger (Google searches, mockups, Prowl, Pounce)
// Everything is shown in pounds; dollars are converted at USD_GBP. The result is cached for 6 hours.
const S = require('./vo-services');
const db = require('./vo-db');
const { usageSince } = require('./db');

const USD_GBP = Number(process.env.USD_GBP || 0.79);
const WEEKS = 12;
// rough USD per SitePounce action, the same figures as api/costs.js (sms and lookup come from Twilio for real)
const TOOL_USD = { search: 0.05, mockup: 0.07, prowl: 0.05, pounce: 0.06 };

function ymd(d) { return d.toISOString().slice(0, 10); }
function mondayOf(day) { const d = new Date(day + 'T12:00:00Z'); const g = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - g); return ymd(d); }

async function twilioDaily(category, start, end) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  const auth = 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64');
  let url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Usage/Records/Daily.json?Category=' + category + '&StartDate=' + start + '&EndDate=' + end + '&PageSize=1000';
  const out = [];
  for (let page = 0; url && page < 5; page++) {
    const r = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return out.length ? out : null;
    const j = await r.json();
    (j.usage_records || []).forEach((x) => out.push({ day: String(x.start_date).slice(0, 10), price: Math.abs(Number(x.price) || 0), unit: x.price_unit || 'GBP', count: Number(x.count) || 0 }));
    url = j.next_page_uri ? 'https://api.twilio.com' + j.next_page_uri : null;
  }
  return out;
}

async function costTrend(account, owner) {
  const today = ymd(new Date());
  const firstMonday = (() => { const d = new Date(mondayOf(today) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * (WEEKS - 1)); return ymd(d); })();
  const weeks = []; for (let i = 0; i < WEEKS; i++) { const d = new Date(firstMonday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7 * i); weeks.push(ymd(d)); }
  const series = { twilio_sms: {}, twilio_lookup: {}, twilio_other: {}, apify: {}, vo_est: {}, tools_est: {} };
  const add = (k, day, gbp) => { const w = mondayOf(day); if (w < firstMonday) return; series[k][w] = (series[k][w] || 0) + gbp; };
  const notes = [];

  // Twilio, real (the account currency is GBP; anything else is converted as if USD)
  const fx = (p, unit) => (String(unit || '').toUpperCase() === 'GBP' ? p : p * USD_GBP);
  try {
    const [sms, look, all] = await Promise.all([twilioDaily('sms', firstMonday, today), twilioDaily('lookups', firstMonday, today), twilioDaily('totalprice', firstMonday, today)]);
    if (!all) notes.push('Twilio figures could not be read (check the Twilio keys in Vercel).');
    const byDay = {};
    (sms || []).forEach((x) => { add('twilio_sms', x.day, fx(x.price, x.unit)); byDay[x.day] = (byDay[x.day] || 0) + fx(x.price, x.unit); });
    (look || []).forEach((x) => { add('twilio_lookup', x.day, fx(x.price, x.unit)); byDay[x.day] = (byDay[x.day] || 0) + fx(x.price, x.unit); });
    (all || []).forEach((x) => { const rest = fx(x.price, x.unit) - (byDay[x.day] || 0); if (rest > 0.0001) add('twilio_other', x.day, rest); });
  } catch (e) { notes.push('Twilio figures could not be read: ' + e.message); }

  // Apify, real, one call per billing cycle that overlaps the window
  try {
    const seen = new Set(); let probe = new Date(today + 'T12:00:00Z');
    for (let i = 0; i < 5; i++) {
      const cyc = await S.apifyDaily(ymd(probe));
      if (!cyc || !cyc.start || seen.has(cyc.start)) break;
      seen.add(cyc.start);
      cyc.days.forEach((x) => add('apify', x.day, x.usd * USD_GBP));
      const st = new Date(cyc.start); if (ymd(st) <= firstMonday) break;
      probe = new Date(st.getTime() - 86400000);
    }
    if (!seen.size) notes.push('Apify figures could not be read (check APIFY_TOKEN).');
  } catch (e) { notes.push('Apify figures could not be read: ' + e.message); }

  // Video Outreach searches: Apollo and AI by our estimate (each run's cost minus its Apify rows)
  try {
    const per1k = Number(process.env.VO_COST_APIFY_1K || 0.6);
    (await db.runCostsSince(account, firstMonday + 'T00:00:00Z')).forEach((r) => {
      const est = Math.max(0, Number(r.cost) - (Number(r.apify_rows) || 0) / 1000 * per1k);
      add('vo_est', ymd(new Date(r.started_at)), est * USD_GBP);
    });
  } catch (e) { /* estimate only */ }

  // SitePounce tools by our ledger (estimate)
  try {
    (await usageSince(owner, 'cost:', firstMonday)).forEach((r) => {
      const k = String(r.kind).slice(5); if (!TOOL_USD[k]) return;
      add('tools_est', r.day, (Number(r.count) || 0) * TOOL_USD[k] * USD_GBP);
    });
  } catch (e) { /* estimate only */ }

  const round = (v) => Math.round((v || 0) * 100) / 100;
  const rows = weeks.map((w) => {
    const o = { week: w }; let t = 0;
    Object.keys(series).forEach((k) => { o[k] = round(series[k][w]); t += o[k]; });
    o.total = round(t); return o;
  });
  return { weeks: rows, usd_gbp: USD_GBP, notes: notes, at: new Date().toISOString(), partial_week: mondayOf(today) };
}

module.exports = { costTrend };

// Owner-only: what YOUR OWN data says about which industries are worth calling, as opposed to the
// static playbook. Joins the call list (each record carries its Google category) with the CRM
// statuses, and aggregates engagement per industry. ?ai=1 additionally has the AI read the team's
// recent notes and say what patterns it sees, industry by industry.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { notesLog } = require('../lib/db');

// how a status counts. Engaged = they are talking to us; negative = a clear no.
const ENGAGED = { interested: 1, 'appointment-link-sent': 1, 'meeting-booked': 1, callback: 1, won: 1 };
const NEGATIVE = { 'not-interested': 1, declined: 1, lost: 1 };
const WINS = { 'meeting-booked': 1, won: 1 };

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

const AI_SYS = [
  'You advise a UK agency that sells websites to local businesses. You are given their own CRM call',
  'notes, each tagged with the business and its industry where known, plus a per-industry summary of',
  'engagement. Say what THEIR OWN data shows: which industries are responding, who the receptive',
  'people are, and what is working or failing per industry. Ground every claim in the notes given,',
  'never invent. Never use em dashes; use commas, full stops or brackets.',
  'Return ONLY JSON: {"verdicts":[{"industry":"...","verdict":"...","evidence":"..."}],"advice":["..."]}.',
  'verdicts = up to 5 industries with a one-line verdict and the evidence from the notes.',
  'advice = 2 to 4 practical takeaways for where to spend calling time next.',
].join(' ');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  const calls = (await readJson('calls/_list.json')) || {};
  const idx = (await readJson('notes/_index.json')) || {};

  const cats = {};
  Object.values(calls).forEach((c) => {
    if (!c || !c.name) return;
    const cat = String(c.category || '').trim() || 'Uncategorised';
    const st = (idx[c.key] && idx[c.key].status) || '';
    const o = (cats[cat] = cats[cat] || { category: cat, worked: 0, outcomes: 0, engaged: 0, negative: 0, wins: 0 });
    o.worked++;
    if (st) o.outcomes++;
    if (ENGAGED[st]) o.engaged++;
    if (NEGATIVE[st]) o.negative++;
    if (WINS[st]) o.wins++;
  });
  // engagement rate is engaged / businesses with any outcome. Fewer than 3 outcomes is noise, they
  // are listed but flagged so a 1-of-1 does not read as a 100% banker.
  const rows = Object.values(cats)
    .map((o) => Object.assign(o, {
      rate: o.outcomes ? Math.round((o.engaged / o.outcomes) * 100) : 0,
      thin: o.outcomes < 3,
    }))
    .filter((o) => o.outcomes > 0)
    .sort((a, b) => (a.thin - b.thin) || (b.rate - a.rate) || (b.engaged - a.engaged));

  // optional AI read of the notes themselves
  let ai = null;
  const q = req.query || {};
  if (String(q.ai || '') === '1' && process.env.OPENAI_API_KEY) {
    try {
      const catByKey = {}; const catByName = {};
      Object.values(calls).forEach((c) => { if (c && c.key) { catByKey[c.key] = c.category || ''; catByName[String(c.name || '').toLowerCase()] = c.category || ''; } });
      const notes = await notesLog(null, { limit: 250 });
      let corpus = ''; const cap = 10000;
      for (const n of notes) {
        if (!n.note) continue;
        const cat = catByKey[n.slug] || catByName[String(n.business || '').toLowerCase()] || 'unknown industry';
        const line = '[' + cat + ' | ' + (n.business || 'Unknown') + '] ' + n.note + '\n';
        if (corpus.length + line.length > cap) break;
        corpus += line;
      }
      if (corpus) {
        const summary = rows.slice(0, 12).map((r) => r.category + ': ' + r.engaged + ' engaged of ' + r.outcomes + ' outcomes (' + r.rate + '%)').join('; ');
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 25000);
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
          body: JSON.stringify({
            model: 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: AI_SYS }, { role: 'user', content: 'Per-industry engagement: ' + summary + '\n\nNotes:\n' + corpus }],
          }),
        });
        clearTimeout(to);
        const d = await r.json().catch(() => ({}));
        const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        try { ai = JSON.parse(out || '{}'); } catch (e) { ai = null; }
      }
    } catch (e) { ai = null; }
  }

  res.status(200).json({ rows: rows, totalWorked: Object.values(calls).length, ai: ai });
};

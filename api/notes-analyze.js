// Owner-only: reads the team's notes over a window (default 30 days) and asks the AI for a
// COMBINED analysis (themes, objections + handling, targeting tips, follow-ups). On-demand.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ownsSlug } = require('../lib/tenant');

function deslug(slug) {
  let s = String(slug || '').replace(/^[0-9a-f]{16}--/, '').replace(/-[0-9a-f]{6,12}$/i, '').replace(/-/g, ' ').trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const SYS = [
  'You analyse CRM call notes for a UK agency that finds local businesses and sells them websites.',
  'You are given many short notes (each: [business] note). Produce a COMBINED analysis, not per note.',
  'Be concise, specific and practical. Never use em dashes; use commas, full stops or brackets.',
  'Return ONLY JSON: {"themes":["..."],"objections":[{"objection":"...","handling":"..."}],"targeting":["..."],"followups":["Business: what and when"]}.',
  'themes = 3 to 6 recurring patterns. objections = common objections each with a one-line way to handle it.',
  'targeting = 2 to 5 tips on which trades/areas/timing respond well. followups = specific callbacks or actions the notes mention that are due or upcoming, each starting with the business name.',
  'If a section has nothing useful, return an empty array for it.',
].join(' ');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(200).json({ error: 'AI is not configured (no OpenAI key set).' }); return; }
  const days = Math.min(Math.max(Number(req.query && req.query.days) || 30, 1), 365);
  const cutoff = Date.now() - days * 86400000;

  let notes = [];
  try {
    const { blobs } = await list({ prefix: 'notes/' });
    const mine = blobs.filter((b) => b.pathname.endsWith('.json') && b.pathname !== 'notes/_index.json'
      && ownsSlug(req, b.pathname.replace(/^notes\//, '').replace(/\.json$/, '')));
    const docs = await Promise.all(mine.slice(0, 500).map((b) =>
      fetch(b.url + '?t=' + Date.now()).then((r) => r.json()).then((j) => ({ slug: b.pathname.replace(/^notes\//, '').replace(/\.json$/, ''), j })).catch(() => null)));
    docs.forEach((d) => {
      if (!d || !d.j || !Array.isArray(d.j.comments)) return;
      const biz = deslug(d.slug);
      d.j.comments.forEach((c) => {
        if (!c || !c.text) return;
        const t = Date.parse(c.at || '');
        if (!isNaN(t) && t < cutoff) return;
        notes.push({ biz: biz, note: c.text, at: c.at });
      });
    });
  } catch (e) { notes = []; }
  if (!notes.length) { res.status(200).json({ empty: true, count: 0, days: days }); return; }

  notes.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  let corpus = ''; let used = 0; const cap = 12000;
  for (const n of notes) { const line = '[' + n.biz + '] ' + n.note + '\n'; if (used + line.length > cap) break; corpus += line; used += line.length; }

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: 'Notes (' + notes.length + ' total, last ' + days + ' days):\n\n' + corpus }] }),
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    let parsed = {}; try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = {}; }
    res.status(200).json({ count: notes.length, days: days, analysis: parsed });
  } catch (e) { res.status(200).json({ error: 'Could not analyse just now, please try again.' }); }
};

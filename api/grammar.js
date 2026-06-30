// Operator-only: lightly fix the grammar of an outreach message so the {category}
// substitution reads naturally (e.g. "looking for Electrician" -> "looking for an
// electrician"). Controlled by the "AI Grammar Fix" toggle in Templates. gpt-4o-mini,
// cheap. ANY failure returns the original text unchanged, so it never blocks a send.
const { verify, parseCookie } = require('../lib/auth');
const { check, record } = require('../lib/ratelimit');
const { tenantPrefix } = require('../lib/tenant');
const { requirePaid } = require('../lib/access');

const SYS = [
  'You lightly correct the grammar of a short, casual outreach message so it reads naturally and professionally.',
  'Fix ONLY: articles (a/an/the), singular vs plural, and clear grammatical slips, especially around the business type/category',
  '(e.g. "looking for Electrician" becomes "looking for an electrician"; "a Lawn Mowers" becomes "a lawn mower company").',
  'Do NOT change the meaning, the tone, the greeting, the sign-off name, the line breaks, or the sentence structure beyond the minimal fix.',
  'Do NOT add or remove information or sentences.',
  'Keep any token of the form [[U0]], [[U1]] EXACTLY as-is.',
  'Never use em dashes; use commas or full stops instead.',
  'Return ONLY the corrected message text, nothing else.',
].join(' ');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in.' }); return; }
  if (!(await requirePaid(req, res))) return; // paywall: needs an active subscription (owner/allow-list comped)
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  const text = String((body && body.text) || '').slice(0, 2000);
  if (!text.trim()) { res.status(400).json({ error: 'No text.' }); return; }

  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(200).json({ text }); return; } // no key, return unchanged

  // generous cost cap (the call is tiny, this just stops a runaway loop)
  const rl = await check('grammar', Date.now(), tenantPrefix(req));
  if (!rl.ok) { res.status(200).json({ text }); return; } // over cap, return original

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      signal: ctrl.signal,
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 700, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (out && out.trim()) { await record('grammar', Date.now(), tenantPrefix(req)); res.status(200).json({ text: out.trim() }); return; }
  } catch (e) { /* fall through to original */ }
  res.status(200).json({ text });
};

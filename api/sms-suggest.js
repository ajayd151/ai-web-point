// Owner-only: draft a matching follow-up + nudge from the first message, so the three messages
// read as one voice. gpt-4o-mini. The follow-up is what auto-sends on a YES (must carry {link});
// the nudge is the gentle chase if they go quiet (no link).
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');

const SYS = [
  'You write SMS for a UK web-design agency doing polite ask-first outreach to local businesses.',
  'You are given their FIRST message, which asks permission to send a free 1-page website mockup.',
  'Write two short SMS in the SAME warm, human, first-person voice, matching their wording and sign-off.',
  'followUp: sent the moment the prospect replies YES. It MUST contain the token {link} exactly once.',
  'Talk as if the website already exists (future pacing), keep it 1 to 2 sentences, and end by offering',
  'to show them the full version, ideally suggesting a quick call. Warm, not salesy.',
  'nudge: sent only if they never reply. One gentle sentence, no pressure, and it MUST NOT contain {link}.',
  'Use {business} for their business name and {category} for their trade where it reads naturally.',
  'Never use em dashes, use commas or full stops. No corporate jargon. Return ONLY JSON:',
  '{"followUp":"...","nudge":"..."}',
].join(' ');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(200).json({ error: 'AI is not configured.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  const first = String((body && body.first) || '').trim().slice(0, 600);
  if (!first) { res.status(400).json({ error: 'Write the first message first.' }); return; }

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.6, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: 'Their first message:\n\n' + first }],
      }),
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    let p = {}; try { p = JSON.parse(out || '{}'); } catch (e) { p = {}; }
    let followUp = String(p.followUp || '').trim();
    const nudge = String(p.nudge || '').trim().replace(/\{link\}/g, '').trim();
    if (followUp && followUp.indexOf('{link}') < 0) followUp += ' {link}'; // safety: the follow-up must carry the link
    if (!followUp && !nudge) { res.status(200).json({ error: 'Could not draft one just now, please try again.' }); return; }
    res.status(200).json({ followUp: followUp, nudge: nudge });
  } catch (e) { res.status(200).json({ error: 'Could not draft one just now, please try again.' }); }
};

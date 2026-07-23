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
  'nudge: sent only if they never reply. Gentle, no pressure, no {link}. Always provide one.',
  'The nudge should slip in ONE honest, concrete reason a website helps a business like theirs,',
  'tailored to {category}, for example that most people check online before they call so a simple',
  'site helps a {category} get found and trusted by locals, or turns Google Maps views into calls.',
  'NEVER invent statistics, percentages or numbers of any kind. No "40% more enquiries" style claims.',
  'Keep it truthful and specific, 1 to 2 short sentences.',
  'Use {business} for their business name and {category} for their trade where it reads naturally.',
  'Never use em dashes, use commas or full stops. No corporate jargon. Return ONLY JSON:',
  '{"followUp":"...","nudge":"..."}',
].join(' ');

// Rewrite an opener to be GENTLER / lower-pressure, to bring a high STOP rate down. Same channel
// rules: ask-first (no {link}), warm and human, keep {business}, no opt-out wording (added
// automatically), no invented numbers, no em dashes, no name bolted onto a sentence.
const SYS_OPENER = [
  'You improve the FIRST cold SMS a UK web-design agency sends to a local business, asking permission',
  'to send a free 1-page website mockup. The current one is getting too many STOP opt-outs, so rewrite',
  'it to feel less salesy and less like spam: warmer, more human, lower pressure, clearly from a real',
  'person, and quick to read. 1 to 2 short sentences.',
  'Keep the token {business} for their name (use it once, in a natural greeting, never bolted onto the',
  'end of a sentence with a comma). You may use {category} for their trade if it reads naturally.',
  'Do NOT include {link} (the link goes in a later follow-up). Do NOT mention STOP or opting out',
  '(that is added automatically). NEVER invent statistics or numbers. Never use em dashes.',
  'Make it feel like a genuine offer, not a broadcast. Return ONLY JSON: {"opener":"..."}',
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

  // opener mode: soften an existing first message
  if (body && body.opener) {
    const cur = String(body.opener).trim().slice(0, 600);
    if (!cur) { res.status(400).json({ error: 'Nothing to improve.' }); return; }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.7, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYS_OPENER }, { role: 'user', content: 'Current first message:\n\n' + cur }] }),
      });
      clearTimeout(to);
      const d = await r.json().catch(() => ({}));
      const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      let p = {}; try { p = JSON.parse(out || '{}'); } catch (e) { p = {}; }
      const opener = String(p.opener || '').replace(/\{link\}/g, '').trim();
      if (!opener) { res.status(200).json({ error: 'Could not draft one just now, please try again.' }); return; }
      res.status(200).json({ opener: opener });
    } catch (e) { res.status(200).json({ error: 'Could not draft one just now, please try again.' }); }
    return;
  }

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

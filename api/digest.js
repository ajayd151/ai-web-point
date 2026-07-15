// The signed-in person's own morning summary, so the dashboard shows exactly what the 8am email
// said. Same builder, same numbers. Anyone signed in can see their own; no permission needed.
const { verify, parseCookie } = require('../lib/auth');
const { account } = require('../lib/access');
const { buildDigest } = require('../lib/digest');
const { digestHtml } = require('../lib/email');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  const q = req.query || {};
  // ?light=1 skips the AI insights (faster first paint; the card asks for the full one after).
  const light = String(q.light || '') === '1';
  const digest = await buildDigest(acct.email, { insights: !light });

  // ?preview=1 renders your own digest exactly as the 8am email looks, so the design can be
  // checked in a browser before anything is sent.
  if (String(q.preview || '') === '1') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!digest || digest.empty) { res.status(200).send('<p style="font-family:sans-serif;padding:24px;">No activity on the last working day, so no email would be sent to you.</p>'); return; }
    res.status(200).send(digestHtml('', digest, process.env.APP_BASE_URL || 'https://sitepounce.com'));
    return;
  }
  res.status(200).json({ digest: digest });
};

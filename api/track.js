// Public beacon: the preview page calls this from JS when a real person opens
// it ('view') or clicks the demo CTA ('cta'). Fired via JS so link-preview
// crawlers (which don't run JS) don't create false opens; we also filter known
// bot user-agents server-side as a backstop. Always returns 204 quickly.
const { recordEvent } = require('../lib/db');

// crawlers / link-unfurlers that may execute or fetch — never count these
const BOT_RE = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|embedly|preview|pinterest|google-inspectiontool|bingpreview|headless|monitor|uptime|curl|wget|python-requests|axios|node-fetch/i;

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = String(q.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  const event = q.e === 'cta' ? 'cta' : 'view';
  const ch = q.c || q.p; // 'c' (channel) is canonical; 'p' kept for older links
  const platform = (ch === 'w' || ch === 's' || ch === 'e') ? ch : ''; // how it was sent
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);

  // never block the response on the DB write
  res.setHeader('Cache-Control', 'no-store');
  if (slug && !BOT_RE.test(ua)) {
    try { await recordEvent(slug, event, ua, platform); } catch (e) { /* fail soft */ }
  }
  res.status(204).end();
};

// Public beacon: the preview page calls this from JS when a real person opens
// it ('view') or clicks the demo CTA ('cta'). Fired via JS so link-preview
// crawlers (which don't run JS) don't create false opens; we also filter known
// bot user-agents server-side as a backstop. Always returns 204 quickly.
const { recordEvent, logActivity } = require('../lib/db');
const { emailOf, accountEmailOf } = require('../lib/tenant');

const CH_LABEL = { w: 'WhatsApp', s: 'SMS', e: 'email' };

// crawlers / link-unfurlers that may execute or fetch, never count these
const BOT_RE = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|embedly|preview|pinterest|google-inspectiontool|bingpreview|headless|monitor|uptime|curl|wget|python-requests|axios|node-fetch/i;

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = String(q.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  // 'sent' = you messaged a prospect; 'signup' = prospect clicked "Yes, sign me up" on a preview
  const event = (q.e === 'cta' || q.e === 'sent' || q.e === 'signup') ? q.e : 'view';
  const ch = q.c || q.p; // 'c' (channel) is canonical; 'p' kept for older links
  const platform = (ch === 'w' || ch === 's' || ch === 'e') ? ch : ''; // how it was sent
  const tpl = String(q.t || '').replace(/[^a-z0-9]/gi, '').slice(0, 40); // which first-message template
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);

  // never block the response on the DB write
  res.setHeader('Cache-Control', 'no-store');
  if (slug && !BOT_RE.test(ua)) {
    try { await recordEvent(slug, event, ua, platform, tpl); } catch (e) { /* fail soft */ }
    // a 'sent' beacon comes from the OPERATOR's browser (has their cookie): audit who sent it
    if (event === 'sent') {
      const actor = emailOf(req);
      if (actor) { try { await logActivity(actor, accountEmailOf(req), 'message_sent', slug + (platform ? ' via ' + (CH_LABEL[platform] || platform) : ''), slug); } catch (e) { /* fail soft */ } }
    }
  }
  res.status(204).end();
};

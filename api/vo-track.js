// Open pixel for Video Outreach emails (lib/vo-email.js). No login (it is loaded by the recipient's
// mail client), so the prospect id is protected by an HMAC token. Records the first open as an event.
const db = require('../lib/vo-db');
const { token } = require('../lib/vo-email');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Type', 'image/gif');
  const id = Number((req.query && req.query.p) || 0); const t = String((req.query && req.query.t) || '');
  if (id && t && t === token(id)) {
    try {
      const p = await db.prospectById(id);
      if (p && !p.email_opened_at) { await db.markEmail(id, 'opened'); await db.addEvent(p.account, 'email-pixel', p, { channel: 'Email', step: 'Email opened', detail: 'First open recorded' }); }
    } catch (e) { /* a pixel must never fail loudly */ }
  }
  res.status(200).send(GIF);
};

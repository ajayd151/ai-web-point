// 📨 Enquiries inbox: every form submission from a Pounce site (preview or live).
// Visitors' submissions are stored by /api/contact under leads/<slug>/<ts>.json.
// This reads them all back for the in-app inbox. Login-gated (operator only).
// GET -> { enquiries: [ {slug, business, name, phone, email, service, message, receivedAt} ] }
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { requirePermission } = require('../lib/access');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (!(await requirePermission(req, res, 'viewEnquiries'))) return; // team tab-visibility gate
  res.setHeader('Cache-Control', 'no-store');

  let blobs = [];
  try { ({ blobs } = await list({ prefix: 'leads/', limit: 1000 })); } catch (e) { /* none */ }

  // newest first by the timestamp in the pathname (leads/<slug>/<ts>-<rand>.json)
  blobs.sort((a, b) => String(b.pathname).localeCompare(String(a.pathname)));

  const enquiries = (await Promise.all(blobs.slice(0, 300).map(async (b) => {
    try {
      const j = await (await fetch(b.url + '?t=' + Date.now())).json();
      return {
        slug: j.slug || '', business: j.business || j.slug || '',
        name: j.name || '', phone: j.phone || '', email: j.email || '',
        service: j.service || '', message: j.message || '',
        receivedAt: j.receivedAt || '',
      };
    } catch (e) { return null; }
  }))).filter(Boolean);

  enquiries.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  res.status(200).json({ enquiries });
};

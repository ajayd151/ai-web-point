// Returns which lead slugs have been Prowled (a dossier) and Pounced (a site),
// so the Leads view can flag each business. Login-gated. Lists blob prefixes once.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const prowled = [];
  const pounced = [];
  try {
    const { blobs } = await list({ prefix: 'dossiers/' });
    blobs.forEach((b) => { const m = b.pathname.match(/^dossiers\/(.+)\.json$/); if (m) prowled.push(m[1]); });
  } catch (e) { /* ignore */ }
  try {
    const { blobs } = await list({ prefix: 'sites/' });
    blobs.forEach((b) => { const m = b.pathname.match(/^sites\/([^/]+)\.json$/); if (m) pounced.push(m[1]); });
  } catch (e) { /* ignore */ }
  // statuses from the notes index (slug -> status)
  let statuses = {};
  try {
    const { blobs } = await list({ prefix: 'notes/_index.json' });
    const b = blobs.find((x) => x.pathname === 'notes/_index.json');
    if (b) { const idx = await (await fetch(b.url + '?t=' + Date.now())).json(); for (const k in idx) { if (idx[k] && idx[k].status) statuses[k] = idx[k].status; } }
  } catch (e) { /* ignore */ }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ prowled, pounced, statuses });
};

// Lists every generated preview site (the tidy-up registry). Login-gated, read-only.
// Each Pounce build writes sites/<slug>.json with mode + createdAt; this surfaces them
// so old previews can be reviewed/cleaned up in a later tidy-up session.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  try {
    const { blobs } = await list({ prefix: 'sites/' });
    const sites = [];
    for (const b of blobs) {
      if (!/\.json$/.test(b.pathname)) continue;
      const slug = b.pathname.replace(/^sites\//, '').replace(/\.json$/, '');
      let name = slug, mode = 'preview', createdAt = b.uploadedAt || '';
      try {
        const j = await (await fetch(b.url)).json();
        name = (j.business && j.business.name) || slug;
        mode = j.mode || 'preview';
        createdAt = j.createdAt || createdAt;
      } catch (e) { /* keep defaults */ }
      sites.push({ slug, name, mode, createdAt, url: '/s/' + slug });
    }
    sites.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ count: sites.length, previews: sites.filter((s) => s.mode !== 'published').length, sites });
  } catch (e) { res.status(500).json({ error: 'Could not list sites.' }); }
};

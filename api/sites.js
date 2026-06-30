// Lists every generated preview site (the tidy-up registry). Login-gated, read-only.
// Each Pounce build writes sites/<slug>.json with mode + createdAt; this surfaces them
// so old previews can be reviewed/cleaned up in a later tidy-up session.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { ownsSlug } = require('../lib/tenant');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
  try {
    const { blobs } = await list({ prefix: 'sites/' });
    const sites = [];
    for (const b of blobs) {
      if (!/\.json$/.test(b.pathname)) continue;
      const slug = b.pathname.replace(/^sites\//, '').replace(/\.json$/, '');
      if (!ownsSlug(req, slug)) continue; // only this tenant's sites
      let name = slug, mode = 'preview', createdAt = b.uploadedAt || '', subdomain = '';
      try {
        const j = await (await fetch(b.url)).json();
        name = (j.business && j.business.name) || slug;
        mode = j.mode || 'preview';
        createdAt = j.createdAt || createdAt;
        subdomain = j.subdomain || '';
      } catch (e) { /* keep defaults */ }
      const liveUrl = (mode === 'published' && subdomain) ? `https://${subdomain}.aiwebpoint.com` : `${linkBase}/s/${slug}`;
      sites.push({ slug, name, mode, createdAt, subdomain, url: liveUrl });
    }
    sites.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ count: sites.length, previews: sites.filter((s) => s.mode !== 'published').length, sites });
  } catch (e) { res.status(500).json({ error: 'Could not list sites.' }); }
};

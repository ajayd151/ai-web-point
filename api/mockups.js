// Lists every mockup ever generated (from Vercel Blob) so the "Recent mockups"
// table can show them on any device — reopen to download or re-send.
// Login-gated.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { statsBySlug } = require('../lib/db');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }

  try {
    const { blobs } = await list({ prefix: 'mockups/', limit: 1000 });
    const metas = blobs.filter((b) => b.pathname.endsWith('.json'));
    metas.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    const top = metas.slice(0, 40);

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;

    const [out, stats] = await Promise.all([
      Promise.all(top.map(async (b) => {
        const slug = b.pathname.replace(/^mockups\//, '').replace(/\.json$/, '');
        try {
          const r = await fetch(b.url + '?t=' + Date.now());
          const m = await r.json();
          return {
            slug,
            date: b.uploadedAt,
            name: m.name || '',
            loc: m.loc || '',
            who: m.who || '',
            category: m.category || '',
            phone: m.phone || '',
            img: `${linkBase}/i/${slug}.png`, // branded — hides the blob host
            viewUrl: `${linkBase}/v/${slug}`,
          };
        } catch (e) { return null; }
      })),
      statsBySlug(),
    ]);

    const mockups = out.filter(Boolean).map((m) => {
      const s = stats[m.slug] || {};
      return {
        ...m,
        opens: (s.view && s.view.n) || 0,
        lastOpen: (s.view && s.view.last) || null,
        ctaClicks: (s.cta && s.cta.n) || 0,
        platform: s.platform || '',
      };
    });

    res.status(200).json({ mockups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

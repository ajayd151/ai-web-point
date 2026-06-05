// Serves a mockup PNG from our own domain (e.g. preview.aiwebpoint.com/i/<slug>.png)
// so the public blob/Vercel hostname is never exposed in emails or to prospects.
// Public; long-cached (slugs are immutable). Add ?download=1 to force a file save.
const { list } = require('@vercel/blob');

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = String(q.slug || '').replace(/\.png$/i, '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  if (!slug) { res.status(400).send('Missing image.'); return; }
  const download = q.download === '1' || q.dl === '1';

  try {
    const path = 'mockups/' + slug + '.png';
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) { res.status(404).send('Image not found.'); return; }

    const r = await fetch(b.url);
    if (!r.ok) { res.status(502).send('Could not fetch image.'); return; }
    const buf = Buffer.from(await r.arrayBuffer());

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Robots-Tag', 'noindex'); // keep prospect mockup images out of search
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${slug}.png"`);
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).send('Image failed.');
  }
};

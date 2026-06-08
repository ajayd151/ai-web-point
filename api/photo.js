// Proxies a Google Place photo so the API key is never exposed in the page.
// Public; cached; noindex. Validates the photo resource name to prevent SSRF.
module.exports = async (req, res) => {
  const name = String((req.query && req.query.n) || '');
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) { res.status(400).send('Bad request'); return; }
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) { res.status(503).send('Not configured'); return; }
  try {
    const r = await fetch('https://places.googleapis.com/v1/' + name + '/media?maxWidthPx=1600&key=' + key);
    if (!r.ok) { res.status(502).send('Upstream error'); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(200).send(buf);
  } catch (e) { res.status(500).send('Error'); }
};

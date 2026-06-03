// Proxies a generated mockup so the browser saves it as a file (cross-origin
// blob URLs ignore the download attribute). Only allows Vercel Blob URLs.
module.exports = async (req, res) => {
  const img = (req.query && req.query.img) || '';
  if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/[^\s]+$/i.test(img)) {
    res.status(400).send('Invalid image URL.');
    return;
  }
  try {
    const r = await fetch(img);
    if (!r.ok) { res.status(502).send('Could not fetch image.'); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    const name = (img.split('/').pop() || 'website-mockup.png').split('?')[0];
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).send('Download failed.');
  }
};

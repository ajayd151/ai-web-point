// Publish / unpublish a Pounce site: flips sites/<slug>.json `mode` between
// 'published' (live, indexable, no preview bar) and 'preview' (private draft).
// The renderer (api/site.js) already honours the flag, so this is instant, no
// redeploy. Login-gated (an agency action).
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST.' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  if (!slug) { res.status(400).json({ error: 'Missing slug.' }); return; }
  const mode = body.publish ? 'published' : 'preview';

  const path = 'sites/' + slug + '.json';
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) { res.status(404).json({ error: 'Site not found, build it with Pounce first.' }); return; }
    const site = await (await fetch(b.url + '?t=' + Date.now())).json();
    site.mode = mode;
    site.publishedAt = mode === 'published' ? new Date().toISOString() : '';
    await put(path, JSON.stringify(site), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) {
    res.status(500).json({ error: 'Could not update the site.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, slug, mode });
};

// Video Outreach: a photo of the product, uploaded by hand when a store blocks readers (or to replace a poor store image).
// The browser resizes the image first (max 1600 px, JPEG), so the body stays well under Vercel's 4.5 MB limit.
// Stored in Vercel Blob, the URL saved on the prospect (product_photo_url) and shown as the product photo on Ready to send.
const { put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach } = require('../lib/access');
const { accountEmailOf, emailOf } = require('../lib/tenant');
const db = require('../lib/vo-db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!canVideoOutreach(acct.email, acct)) { res.status(404).json({ error: 'Not found.' }); return; }
  const owner = accountEmailOf(req) || acct.email;
  const actor = emailOf(req) || acct.email;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = Number(body.id); const data = String(body.data || '');
    const m = data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!id || !m) { res.status(400).json({ error: 'Send a prospect id and a JPEG, PNG or WebP image' }); return; }
    const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found' }); return; }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3.5 * 1048576) { res.status(413).json({ error: 'Photo must be under 3.5 MB after resizing' }); return; }
    const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
    const slug = String(p.brand || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
    const blob = await put('vo/photos/' + id + '-' + slug + '-' + Date.now() + '.' + ext, buf, { access: 'public', contentType: m[1], addRandomSuffix: true });
    await db.setProductPhoto(owner, actor, id, blob.url, body.name ? String(body.name).slice(0, 120) : null);
    res.status(200).json({ ok: true, url: blob.url });
  } catch (e) { res.status(500).json({ error: e.message || 'Upload failed' }); }
};

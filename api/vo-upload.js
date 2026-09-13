// Video Outreach: upload a video file from the computer for a Ready to send card.
// Vercel caps a request body at 4.5 MB, so the browser sends the file in 2.5 MB chunks (base64), each stored as its
// own blob, then "finish" joins them into one .mp4 in Vercel Blob and puts its URL on the prospect. The browser has
// already compressed anything over the limit (VO_VIDEO_MAX_MB, default 20), and "finish" enforces the limit again.
const { put, del } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, canVideoOutreach } = require('../lib/access');
const { accountEmailOf, emailOf } = require('../lib/tenant');
const db = require('../lib/vo-db');
const V = require('../lib/vo-video');

const CHUNK_MAX = 3 * 1048576;
function safeId(s) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }

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
    const id = Number(body.id); const uploadId = safeId(body.upload_id);
    if (!id || !uploadId) { res.status(400).json({ error: 'Missing prospect id or upload id' }); return; }
    const p = await db.getProspect(owner, id); if (!p) { res.status(404).json({ error: 'Prospect not found' }); return; }
    const prefix = 'vo/uploads/' + owner.replace(/[^a-z0-9]/gi, '_') + '/' + uploadId + '/';
    if (body.step === 'chunk') {
      const index = Number(body.index); const buf = Buffer.from(String(body.data || ''), 'base64');
      if (!Number.isInteger(index) || index < 0 || index > 40 || !buf.length || buf.length > CHUNK_MAX) { res.status(400).json({ error: 'Bad chunk' }); return; }
      const b = await put(prefix + String(index).padStart(3, '0') + '.bin', buf, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: false });
      res.status(200).json({ ok: true, index: index, bytes: buf.length, url: b.url }); return;
    }
    if (body.step === 'finish') {
      const urls = Array.isArray(body.chunk_urls) ? body.chunk_urls.map(String) : [];
      if (!urls.length || urls.length > 41) { res.status(400).json({ error: 'No chunks to join' }); return; }
      const parts = [];
      for (const u of urls) { const r = await fetch(u); if (!r.ok) { res.status(500).json({ error: 'A chunk could not be read back (' + r.status + ')' }); return; } parts.push(Buffer.from(await r.arrayBuffer())); }
      const whole = Buffer.concat(parts);
      const max = V.maxMb() * 1048576;
      if (whole.length > max) { try { await del(urls); } catch (e) {} res.status(413).json({ error: V.sizeError(whole.length) }); return; }
      const slug = String(p.brand || 'sample').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sample';
      const ext = /webm/i.test(String(body.type || '')) ? 'webm' : 'mp4';
      const out = await put('vo/videos/' + id + '-' + slug + '-' + Date.now() + '.' + ext, whole, { access: 'public', contentType: ext === 'webm' ? 'video/webm' : 'video/mp4', addRandomSuffix: true });
      try { await del(urls); } catch (e) {}
      await db.setVideoUrl(owner, actor, id, out.url);
      await db.addEvent(owner, actor, p, { step: 'note', detail: 'Video file uploaded (' + V.mb(whole.length) + ' MB' + (body.compressed ? ', compressed in the browser from ' + V.mb(Number(body.original_bytes) || 0) + ' MB' : '') + ')' });
      res.status(200).json({ ok: true, url: out.url, bytes: whole.length, mb: V.mb(whole.length) }); return;
    }
    res.status(400).json({ error: 'Unknown step' });
  } catch (e) { res.status(500).json({ error: e.message || 'Upload failed' }); }
};

// Per-lead CRM status + timestamped notes. GET ?slug= reads; POST {slug, status?,
// comment?} sets the status and/or appends a timestamped comment. Stored in Blob
// (notes/<slug>.json) so it persists and is shared across devices. A small
// notes/_index.json maps slug -> status so the Leads view can show status cheaply.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { tenantSlug, emailOf, accountEmailOf } = require('../lib/tenant');
const { logActivity, recordNote } = require('../lib/db');

const STATUSES = ['contacted', 'no-answer', 'interested', 'callback', 'not-interested', 'declined', 'invalid-phone', 'won', 'lost'];

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  const isPost = req.method === 'POST';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = tenantSlug(req, String((isPost ? body.slug : (req.query && req.query.slug)) || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120)); // tenant-namespaced (idempotent)
  if (!slug) { res.status(400).json({ error: 'Missing slug.' }); return; }
  const path = 'notes/' + slug + '.json';
  const data = (await readJson(path)) || { slug, status: '', statusAt: '', comments: [] };

  if (isPost) {
    const now = new Date().toISOString();
    if (body.status !== undefined) {
      const s = String(body.status || '');
      if (s === '' || STATUSES.indexOf(s) >= 0) { data.status = s; data.statusAt = now; }
    }
    const comment = String(body.comment || '').trim().slice(0, 2000);
    const author = emailOf(req);
    const bizName = String(body.name || '').slice(0, 160);
    if (comment) {
      data.comments = data.comments || [];
      data.comments.push({ text: comment, at: now, by: author }); // author stamped for attribution
      await recordNote({ account: accountEmailOf(req), author: author, slug: slug, business: bizName, note: comment });
    }
    data.updatedAt = now;
    await logActivity(author, accountEmailOf(req), 'status_update',
      (bizName || slug) + (body.status !== undefined ? (' → ' + (body.status || 'cleared')) : '') + (comment ? ' (note added)' : ''));
    try { await put(path, JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* ignore */ }
    // keep the lightweight status index up to date
    try {
      const idxPath = 'notes/_index.json';
      const idx = (await readJson(idxPath)) || {};
      idx[slug] = { status: data.status || '', at: now };
      await put(idxPath, JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    } catch (e) { /* ignore */ }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ note: data });
};

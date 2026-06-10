// PUBLIC: a prospect clicked "No thanks" on their preview. Records a 'decline'
// event (for Performance) and sets the lead's status to 'declined' with their
// reason/feedback in the notes. No auth (the prospect is not logged in).
const { list, put } = require('@vercel/blob');
const { recordEvent } = require('../lib/db');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

module.exports = async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  if (!slug) { res.status(400).json({ error: 'Missing slug.' }); return; }
  const reason = String(body.reason || '').slice(0, 120);
  const feedback = String(body.feedback || '').slice(0, 1000);

  // count the decline as an event (shows up in Performance)
  try { await recordEvent(slug, 'decline', String(req.headers['user-agent'] || '').slice(0, 300), ''); } catch (e) { /* fail soft */ }

  // set the CRM status + reason + a note, so it shows in Leads / Hot Leads / dashboard
  try {
    const now = new Date().toISOString();
    const path = 'notes/' + slug + '.json';
    const data = (await readJson(path)) || { slug, status: '', statusAt: '', comments: [] };
    data.status = 'declined';
    data.statusAt = now;
    data.comments = data.comments || [];
    data.comments.push({ text: 'Not interested (via mockup)' + (reason ? ': ' + reason : '') + (feedback ? ', ' + feedback : ''), at: now });
    data.declineReason = reason || '';
    await put(path, JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    const idxPath = 'notes/_index.json';
    const idx = (await readJson(idxPath)) || {};
    idx[slug] = { status: 'declined', at: now, declineReason: reason || '' };
    await put(idxPath, JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { /* fail soft */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
};

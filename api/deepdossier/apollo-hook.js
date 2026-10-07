// POST /api/deepdossier/apollo-hook?run=<id>&t=<token>
// Apollo delivers the mobiles, direct lines and extra emails it found for a Deep Dossier run here, a minute or two after
// the search. The link is signed per run (lib/deepdossier.js hookToken), so only Apollo, holding that exact link, can post.
// The payload is stored as-is in Blob; /api/deepdossier/phones parses it when the page asks.
const { put } = require('@vercel/blob');
const crypto = require('crypto');
const { hookToken } = require('../../lib/deepdossier');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const q = req.query || {};
  const run = String(q.run || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
  const t = String(q.t || '');
  const want = run ? hookToken(run) : '';
  if (!run || t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) { res.status(403).json({ error: 'bad link' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = { raw: body.slice(0, 20000) }; } }
  try {
    await put('deepdossier/phones/' + run + '/hook-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json', JSON.stringify(body || {}), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'could not store' }); }
};

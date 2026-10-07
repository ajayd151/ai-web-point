// POST /api/vo-sender-hook?k=<key>&t=<token>
// Unipile calls this when someone finishes the hosted sign-in link from Settings, Senders ("Connect another LinkedIn"):
// { status: 'CREATION_SUCCESS', account_id, name }. The link is signed per key and the key must be one we issued, so only
// that sign-in can add a sender. Their LinkedIn password never passes through SitePounce.
const crypto = require('crypto');
const db = require('../lib/vo-db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const q = req.query || {}; const key = String(q.k || '').replace(/[^a-z0-9]/gi, '').slice(0, 40); const t = String(q.t || '');
  const want = key ? crypto.createHmac('sha256', String(process.env.APP_PASSWORD || 'sitepounce')).update('sender:' + key).digest('hex').slice(0, 32) : '';
  if (!key || t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) { res.status(403).json({ error: 'bad link' }); return; }
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  b = b || {};
  try {
    const s = await db.linkedinSettings();
    const pend = (s.senders_pending || []).find((p) => p.key === key);
    if (!pend) { res.status(200).json({ ok: false, reason: 'unknown or expired link' }); return; }
    if (!/SUCCESS|RECONNECTED|CONNECTED/i.test(String(b.status || '')) || !b.account_id) { res.status(200).json({ ok: false, status: b.status || null }); return; }
    const list = (s.senders || []).filter((x) => x.account_id !== b.account_id);
    list.push({ account_id: String(b.account_id), name: pend.name, first: pend.first, active: true, added_at: new Date().toISOString(), added_by: pend.by || 'sign-in link' });
    await db.setConfig('linkedin', Object.assign({}, s, { senders: list, senders_pending: (s.senders_pending || []).filter((p) => p.key !== key) }));
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'could not save' }); }
};

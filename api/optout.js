// Tap-to-opt-out page (served at /optout via a rewrite). The SMS footer links here instead of
// asking people to text STOP: a link click does not count against the carrier opt-out metric the
// way a STOP reply does, so the sending number stays healthy. The effect is identical to STOP:
//   - the phone is added to the permanent opt-out list (never texted again, even if re-added), and
//   - the call-list record is marked Do Not Contact (DND), so no channel driven off it reaches out.
// The link carries a SIGNED sms_items id, never the phone number, so it cannot be forged or leak
// anyone's number in the URL. Public (no login): the recipient is the one clicking.
const { list, put } = require('@vercel/blob');
const { verifyOptOutToken } = require('../lib/sms');
const { getItemById, addOptout, recordInbound } = require('../lib/smsdb');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

async function markDnd(key, name) {
  if (!key) return;
  try {
    const path = 'notes/' + key + '.json';
    const data = (await readJson(path)) || { slug: key, status: '', statusAt: '', comments: [] };
    const now = new Date().toISOString();
    data.status = 'dnd'; data.statusAt = now; data.updatedAt = now;
    (data.comments = data.comments || []).push({ text: '🚫 Opted out via the unsubscribe link. Marked Do Not Contact (DND).', at: now, by: 'sms' });
    await put(path, JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    const idx = (await readJson('notes/_index.json')) || {};
    idx[key] = { status: 'dnd', at: now };
    await put('notes/_index.json', JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (e) { /* the opt-out itself is already recorded */ }
}

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + '<title>' + title + '</title><style>'
    + 'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
    + 'background:#f4f6f8;color:#1f2933;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}'
    + '.card{background:#fff;max-width:440px;width:100%;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.08);padding:34px 30px;text-align:center}'
    + '.tick{font-size:44px;line-height:1;margin-bottom:12px}'
    + 'h1{font-size:20px;margin:0 0 10px}p{font-size:15px;line-height:1.5;color:#52606d;margin:0}'
    + '</style></head><body><div class="card">' + body + '</div></body></html>';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const tok = (req.query && req.query.t) || '';
  const id = verifyOptOutToken(tok);
  if (!id) {
    res.status(400).send(page('Link not recognised', '<div class="tick">⚠️</div><h1>This link is not valid</h1><p>The unsubscribe link looks incomplete. If you replied to one of our texts with STOP, you are already opted out.</p>'));
    return;
  }
  const item = await getItemById(id);
  if (item && item.phone) {
    await addOptout(item.phone, 'link');
    await markDnd(item.key, item.name);
    try { await recordInbound({ from: item.phone, body: '[opted out via link]', matchedKey: item.key, matchedName: item.name, verdict: 'stop' }); } catch (e) { /* non-fatal */ }
  }
  res.status(200).send(page('You have been unsubscribed', '<div class="tick">✅</div><h1>You are unsubscribed</h1><p>You will not be contacted again. Sorry for the interruption, and thank you.</p>'));
};

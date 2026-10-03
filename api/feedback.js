// In-app "Give feedback" button. POST records one submission (any signed-in user);
// GET returns the recent list for the owner only (Super Admin review). The message +
// importance come from the user; email/plan/status/user-agent are captured server-side
// so the review shows who said it and on which plan. Fails soft; never blocks the app.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { recordFeedback, feedbackList, setFeedbackStatus, deleteFeedback, getFeedbackById } = require('../lib/db');
const { sendFeedbackEmail, sendFeedbackDoneEmail } = require('../lib/email');

const TYPES = ['bug', 'idea', 'question', 'praise', 'other'];
const IMPORTANCE = ['thought', 'nice', 'important', 'critical'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);

  // GET: owner-only review of everything submitted (optional ?status= filter).
  if (req.method === 'GET') {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    const q = req.query || {};
    const items = await feedbackList(q.limit, q.status);
    res.status(200).json({ items });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};

  // Owner-only admin actions on an existing item (set status / delete).
  if (body.action) {
    if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
    const id = Number(body.id);
    if (!id) { res.status(400).json({ error: 'Missing id.' }); return; }
    if (body.action === 'status') {
      const ok = await setFeedbackStatus(id, String(body.status || ''));
      if (!ok) { res.status(500).json({ error: 'Could not update.' }); return; }
      // optional: email the submitter that their suggestion is done (owner clicked "Done & notify")
      if (body.notify && String(body.status) === 'done') {
        // `note` is what the owner typed in the prompt: the "what to do next" instructions, shown
        // highlighted at the top of their email. Optional.
        const note = String(body.note || '').trim().slice(0, 1200);
        try { const f = await getFeedbackById(id); if (f && f.email) await sendFeedbackDoneEmail({ to: f.email, message: f.message, url: f.url, note: note }); } catch (e) { /* fail soft */ }
      }
      res.status(200).json({ ok: true }); return;
    }
    if (body.action === 'delete') {
      const ok = await deleteFeedback(id);
      if (!ok) { res.status(500).json({ error: 'Could not delete.' }); return; }
      res.status(200).json({ ok: true }); return;
    }
    res.status(400).json({ error: 'Unknown action.' }); return;
  }

  const message = String(body.message || '').trim().slice(0, 4000);
  if (!message) { res.status(400).json({ error: 'Please add a message.' }); return; }
  const type = TYPES.includes(String(body.type)) ? String(body.type) : 'other';
  const importance = IMPORTANCE.includes(String(body.importance)) ? String(body.importance) : 'nice';
  const page = String(body.page || '').slice(0, 80);
  const url = String(body.url || '').slice(0, 500);
  const ua = String(req.headers['user-agent'] || '').slice(0, 500);

  // the screenshot taken when Feedback was pressed (a browser-made JPEG, ticked by default), stored in our Blob store
  let screenshot_url = null;
  const shot = String(body.screenshot || '');
  const m = shot.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (m && m[2].length < 4 * 1024 * 1024) {
    try { const { put } = require('@vercel/blob'); const b = await put('feedback/' + Date.now() + '-shot.' + (m[1] === 'png' ? 'png' : 'jpg'), Buffer.from(m[2], 'base64'), { access: 'public', contentType: 'image/' + m[1], addRandomSuffix: true }); screenshot_url = b.url; } catch (e) { /* a lost screenshot never loses the note */ }
  }
  const version = require('../lib/version').buildStamp();
  let context = null;
  try { const c = body.context && typeof body.context === 'object' ? body.context : {}; const txt = JSON.stringify(c); context = txt.length > 8000 ? { truncated: true, raw: txt.slice(0, 8000) } : c; } catch (e) {}
  const record = { email: acct.email, plan: acct.plan, status: acct.status, type, importance, message, page, url, ua, screenshot_url, version, context };
  const ok = await recordFeedback(record);
  if (!ok) { res.status(500).json({ error: 'Could not save just now, please try again.' }); return; }
  // Notify the owner by email. MUST await (Vercel freezes the function after the response,
  // so a fire-and-forget send would be dropped). Fails soft inside sendFeedbackEmail.
  await sendFeedbackEmail(record);
  res.status(200).json({ ok: true });
};

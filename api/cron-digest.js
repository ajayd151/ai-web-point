// 8am London, Mon to Fri: email everyone who actually worked on the last working day a summary of
// how they got on, with AI insights from their own notes. People who did nothing get no email.
//
// SAFETY: until DIGEST_LIVE=1 is set, this only ever emails the owner, so the wording can be
// checked before it reaches customers and team members.
//
// Vercel cron is UTC, so we fire at 07:00 and 08:00 UTC and let the London-hour guard pick the
// right one (07:00 UTC in BST, 08:00 UTC in GMT). That way it is always 8am UK.
const { activeActors, getTeamMember, getDailyUsage, bumpDailyUsage } = require('../lib/db');
const { buildDigest, windows, londonHour, todayKey } = require('../lib/digest');
const { sendDailyDigestEmail } = require('../lib/email');
const { ownerEmail } = require('../lib/tenant');

function isCron(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.includes('vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  const auth = String((req.headers && req.headers.authorization) || '');
  return !!secret && auth === 'Bearer ' + secret;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isCron(req)) { res.status(401).json({ error: 'Cron only.' }); return; }

  const q = req.query || {};
  const now = new Date();
  // Only the 8am-London firing does the work (the other UTC firing exits quietly).
  if (londonHour(now) !== 8 && !q.force) {
    res.status(200).json({ skipped: 'not 8am London', londonHour: londonHour(now) });
    return;
  }

  const owner = ownerEmail();
  const live = process.env.DIGEST_LIVE === '1';
  const w = windows(now);
  const day = todayKey(now);

  let actors = [];
  try { actors = await activeActors(w.from, w.to); } catch (e) { actors = []; }
  if (!live) actors = actors.filter((a) => String(a.actor).toLowerCase() === owner);

  const out = { day: day, covering: w.label, live: live, considered: actors.length, sent: 0, skipped: [] };

  for (const a of actors) {
    const email = String(a.actor).toLowerCase();
    try {
      // never send the same person twice in one day, even if the cron double-fires
      if (await getDailyUsage(email, 'digest', day)) { out.skipped.push({ email: email, why: 'already sent' }); continue; }

      const digest = await buildDigest(email, { now: now });
      if (!digest || digest.empty) { out.skipped.push({ email: email, why: 'no activity' }); continue; }

      let firstName = '';
      try { const m = await getTeamMember(email); if (m && m.first_name) firstName = m.first_name; } catch (e) { /* no name is fine */ }

      // await the send (never fire-and-forget on Vercel, the function freezes)
      const ok = await sendDailyDigestEmail({ to: email, firstName: firstName, digest: digest });
      if (ok) { await bumpDailyUsage(email, 'digest', 1, day); out.sent++; }
      else out.skipped.push({ email: email, why: 'send failed' });
    } catch (e) {
      out.skipped.push({ email: email, why: 'error' });
    }
  }

  res.status(200).json(out);
};

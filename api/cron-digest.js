// 8am London, Mon to Fri: email everyone who actually worked on the last working day a summary of
// how they got on, with AI insights from their own notes. People who did nothing get no email.
//
// LIVE by default. Set DIGEST_LIVE=0 to pause it (it then only ever emails the owner), which is
// the kill switch if the wording ever needs rechecking.
//
// Vercel cron is UTC, so we fire hourly across the morning and let the London-hour guard decide
// which invocations do work. That way 8am UK is correct in both BST and GMT.
//
// 8am is the real send. 10am and midday are CATCH-UP passes: if the 8am run failed for someone
// (SendGrid blip, AI timeout, DB wobble) they were never marked as sent, so the catch-up picks
// them up. Anyone already sent is skipped by the same-day guard, so nobody can ever get two.
//
// The owner can also fire it by hand while signed in (?force=1), which is how the very first send
// was done and how a missed morning can be re-run.
const { activeActors, getTeamMember, getDailyUsage, bumpDailyUsage } = require('../lib/db');
const { buildDigest, windows, londonHour, todayKey } = require('../lib/digest');
const { sendDailyDigestEmail } = require('../lib/email');
const { ownerEmail } = require('../lib/tenant');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');

function isCron(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.includes('vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  const auth = String((req.headers && req.headers.authorization) || '');
  return !!secret && auth === 'Bearer ' + secret;
}
// Cron, or the signed-in owner. Nobody else can make this send anything.
async function allowed(req) {
  if (isCron(req)) return true;
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) return false;
  try { const acct = await account(req); return isComped(acct.email); } catch (e) { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await allowed(req))) { res.status(401).json({ error: 'Cron or owner only.' }); return; }

  const q = req.query || {};
  const now = new Date();
  // 8am is the send. 10am and midday only mop up anyone the 8am run failed to reach.
  const DIGEST_HOURS = [8, 10, 12];
  const hour = londonHour(now);
  if (!DIGEST_HOURS.includes(hour) && !q.force) {
    res.status(200).json({ skipped: 'not a digest hour', londonHour: hour });
    return;
  }

  const owner = ownerEmail();
  const live = process.env.DIGEST_LIVE !== '0'; // live by default; DIGEST_LIVE=0 is the pause switch
  const w = windows(now);
  const day = todayKey(now);

  const dry = String(q.dry || '') === '1'; // ?dry=1 lists who would get it, sends nothing

  let actors = [];
  try { actors = await activeActors(w.from, w.to); } catch (e) { actors = []; }
  if (!live) actors = actors.filter((a) => String(a.actor).toLowerCase() === owner);

  const out = { day: day, covering: w.label, live: live, dryRun: dry, pass: (hour === 8 ? 'main' : 'catch-up'), londonHour: hour, considered: actors.length, sent: 0, failed: 0, recipients: [], skipped: [] };

  for (const a of actors) {
    const email = String(a.actor).toLowerCase();
    try {
      // never send the same person twice in one day, even if the cron double-fires
      if (!dry && await getDailyUsage(email, 'digest', day)) { out.skipped.push({ email: email, why: 'already sent' }); continue; }

      const digest = await buildDigest(email, { now: now, insights: !dry });
      if (!digest || digest.empty) { out.skipped.push({ email: email, why: 'no activity' }); continue; }

      let firstName = '';
      try { const m = await getTeamMember(email); if (m && m.first_name) firstName = m.first_name; } catch (e) { /* no name is fine */ }

      if (dry) {
        out.recipients.push({ email: email, name: firstName, activities: digest.total, meetingsBooked: digest.meetingsBooked });
        continue;
      }
      // await the send (never fire-and-forget on Vercel, the function freezes)
      const ok = await sendDailyDigestEmail({ to: email, firstName: firstName, digest: digest });
      // Only mark as sent when SendGrid really accepted it. A failure stays unmarked so the
      // catch-up pass tries again later this morning.
      if (ok) { await bumpDailyUsage(email, 'digest', 1, day); out.sent++; out.recipients.push({ email: email, name: firstName, activities: digest.total, meetingsBooked: digest.meetingsBooked }); }
      else { out.failed++; out.skipped.push({ email: email, why: 'send failed, will retry on the catch-up pass' }); }
    } catch (e) {
      out.failed++;
      out.skipped.push({ email: email, why: 'error, will retry on the catch-up pass' });
    }
  }

  if (out.failed) console.error('Daily Insights: ' + out.failed + ' send(s) failed on the ' + out.pass + ' pass, covering ' + w.label);
  res.status(200).json(out);
};

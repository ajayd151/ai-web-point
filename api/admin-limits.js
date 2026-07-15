// Owner-only: view and change each person's usage caps without touching Vercel.
// GET  -> everyone (you + team + customers) with their caps and the current defaults.
// POST -> { email, limits: { search: 200, prowl: null, ... } } to save. A null/blank value means
//         "use the default", which is why blanks are stored as absent rather than zero.
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ownerEmail } = require('../lib/tenant');
const { listTeamMembers, listUsers, listRateLimits, setRateLimits, logActivity } = require('../lib/db');
const { globalLimit, WINDOW_HOURS, RATE_KINDS } = require('../lib/ratelimit');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) { res.status(400).json({ error: 'Which person? No email given.' }); return; }

    // Keep only real, positive numbers. Anything blank is dropped so it falls back to the default.
    const clean = {};
    RATE_KINDS.forEach((k) => {
      const raw = (body.limits || {})[k];
      if (raw === null || raw === undefined || raw === '') return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) clean[k] = Math.floor(n);
    });

    const ok = await setRateLimits(email, clean);
    if (!ok) { res.status(500).json({ error: 'Could not save that, please try again.' }); return; }
    await logActivity(acct.email, acct.email, 'limits_update', email + ' → ' + JSON.stringify(clean), email);
    res.status(200).json({ ok: true, email: email, limits: clean });
    return;
  }

  // GET: build the people list the same way the Activity picker does, then attach saved caps.
  const owner = ownerEmail();
  const map = {};
  const put = (email, name, type) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e || map[e]) return;
    map[e] = { email: e, name: name || '', type: type, limits: {} };
  };
  put(owner, 'You (owner)', 'You');
  (await listTeamMembers(owner)).forEach((m) => {
    const nm = ((m.first_name || '') + ' ' + (m.last_name || '')).trim();
    put(m.member_email, nm, m.suspended ? 'Team (suspended)' : 'Team');
  });
  (await listUsers()).forEach((u) => put(u.email, '', 'Customer'));

  (await listRateLimits()).forEach((r) => {
    const e = String(r.email || '').toLowerCase();
    if (!e) return;
    if (!map[e]) put(e, '', 'Other'); // has caps saved but is no longer a team member or customer
    if (map[e]) map[e].limits = r.limits || {};
  });

  const defaults = {};
  RATE_KINDS.forEach((k) => { defaults[k] = globalLimit(k); });

  res.status(200).json({
    people: Object.values(map),
    kinds: RATE_KINDS,
    defaults: defaults,
    windowHours: WINDOW_HOURS,
  });
};

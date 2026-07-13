// 🐾 Prowl, gathers public sales intelligence on a lead and turns it into a
// briefing ("ammunition"). Gather logic lives in lib/intel.js (shared with Pounce).
// Result is cached in Blob per slug.
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');
const { tenantPrefix, tenantSlug, emailOf, accountEmailOf } = require('../lib/tenant');
const { logActivity } = require('../lib/db');
const { requirePaid, requirePermission } = require('../lib/access');
const { gatherDossier, readDossier } = require('../lib/intel');

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (!(await requirePaid(req, res))) return; // paywall: needs an active subscription (owner/allow-list comped)
  if (!(await requirePermission(req, res, 'prowl'))) return; // team-member permission gate
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = tenantSlug(req, String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120)); // tenant-namespaced (idempotent)
  // peek: return the cached dossier (or null) without gathering, no credit spent
  if (body.peek) {
    if (!slug) { res.status(400).json({ error: 'Missing slug.' }); return; }
    const cached = await readDossier(slug);
    res.status(200).json({ dossier: cached || null, peek: true });
    return;
  }
  const name = String(body.name || '').trim();
  const location = String(body.location || '').trim();
  const category = String(body.category || '').trim() || 'local business';
  if (!slug || !name) { res.status(400).json({ error: 'Missing lead details.' }); return; }
  const refresh = !!body.refresh;

  // serve cached dossier (no credit) unless re-running
  if (!refresh) {
    const cached = await readDossier(slug);
    if (cached) { res.status(200).json({ dossier: cached, cached: true }); return; }
  }

  if (!process.env.GOOGLE_PLACES_API_KEY) { res.status(503).json({ error: 'Google Places key is not set.' }); return; }
  const rl = await checkAndRecord('prowl', Date.now(), tenantPrefix(req), emailOf(req));
  if (!rl.ok) { res.status(429).json({ error: `Prowl limit reached (${rl.limit} per ${rl.windowHours} hours). Try again in ~${rl.retryHours}h.` }); return; }

  try {
    const dossier = await gatherDossier({ slug, name, location, category, phone: body.phone || '' });
    await logActivity(emailOf(req), accountEmailOf(req), 'prowl', String(name || slug));
    res.status(200).json({ dossier, cached: false });
  } catch (e) {
    res.status(500).json({ error: 'Prowl failed to gather intel.' });
  }
};

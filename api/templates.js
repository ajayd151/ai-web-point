// Shared message templates for the whole workspace. Until now templates lived in each browser's
// localStorage, so a template made on one machine did not exist on another. They now live in one
// blob per workspace (settings/templates.json); a team member reads and writes the owner's copy
// because tenantPrefix resolves them to the owner's namespace.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { requirePaid, requirePermission } = require('../lib/access');
const { tenantPrefix } = require('../lib/tenant');

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  if (!(await requirePaid(req, res))) return;
  const path = tenantPrefix(req) + 'settings/templates.json';

  if (req.method === 'GET') {
    const data = (await readJson(path)) || {};
    res.status(200).json({ waTemplates: Array.isArray(data.waTemplates) ? data.waTemplates : null, tplSeq: Number(data.tplSeq) || 0 });
    return;
  }

  if (!(await requirePermission(req, res, 'viewTemplates'))) return; // members without the Templates tab cannot edit them
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const tpls = Array.isArray(body.waTemplates) ? body.waTemplates.slice(0, 100).map((t) => ({
    id: String((t && t.id) || '').slice(0, 40),
    name: String((t && t.name) || '').slice(0, 80),
    body: String((t && t.body) || '').slice(0, 2000),
    v: Number.isFinite(Number(t && t.v)) ? Number(t.v) : undefined,
    locked: !!(t && t.locked) || undefined,
  })).filter((t) => t.id && t.body) : null;
  if (!tpls || !tpls.length) { res.status(400).json({ error: 'No templates given.' }); return; }
  try {
    // THE RULE, enforced centrally now templates are shared: a locked template's message is
    // immutable (that is what keeps per-template open rates honest), and a locked template can
    // never be deleted, or its stats would point at nothing. Renames are allowed; a changed body
    // on a locked id is silently kept as the locked original. Duplicate to make a new version.
    const cur = (await readJson(path)) || {};
    const lockedById = {};
    (Array.isArray(cur.waTemplates) ? cur.waTemplates : []).forEach((t) => { if (t && t.locked && t.id) lockedById[t.id] = t; });
    const merged = tpls.map((t) => {
      const lk = lockedById[t.id];
      if (!lk) return t;
      return { id: lk.id, name: t.name || lk.name, body: lk.body, v: lk.v, locked: true }; // rename ok, body immutable
    });
    Object.values(lockedById).forEach((lk) => { if (!merged.some((t) => t.id === lk.id)) merged.push(lk); }); // deletion of locked = ignored
    const seq = Math.max(Number(body.tplSeq) || 0, Number(cur.tplSeq) || 0);
    await put(path, JSON.stringify({ waTemplates: merged, tplSeq: seq, updatedAt: new Date().toISOString() }),
      { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    res.status(200).json({ ok: true, count: merged.length });
  } catch (e) { res.status(500).json({ error: 'Could not save the templates.' }); }
};

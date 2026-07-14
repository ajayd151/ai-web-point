// Owner-only centralised notes: reads EVERY note in the workspace straight from the note
// store (notes/<slug>.json), so the full history shows (not just notes written since this
// feature shipped). Each note carries its author (new notes) + timestamp. ?email= filters
// to one author.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { account, isComped } = require('../lib/access');
const { ownsSlug } = require('../lib/tenant');

// Turn a slug back into a readable business name for display (strip the tenant prefix and
// the random code suffix mockup slugs carry, e.g. "the-detail-factory-c71c123f").
function deslug(slug) {
  let s = String(slug || '').replace(/^[0-9a-f]{16}--/, '').replace(/-[0-9a-f]{6,12}$/i, '').replace(/-/g, ' ').trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const acct = await account(req);
  if (!isComped(acct.email)) { res.status(403).json({ error: 'Owner only.' }); return; }
  const authorFilter = req.query && req.query.email ? String(req.query.email).toLowerCase() : '';

  let out = [];
  try {
    const { blobs } = await list({ prefix: 'notes/' });
    const mine = blobs.filter((b) => b.pathname.endsWith('.json') && b.pathname !== 'notes/_index.json'
      && ownsSlug(req, b.pathname.replace(/^notes\//, '').replace(/\.json$/, '')));
    const docs = await Promise.all(mine.slice(0, 500).map((b) =>
      fetch(b.url + '?t=' + Date.now()).then((r) => r.json()).then((j) => ({ slug: b.pathname.replace(/^notes\//, '').replace(/\.json$/, ''), j })).catch(() => null)));
    docs.forEach((d) => {
      if (!d || !d.j || !Array.isArray(d.j.comments)) return;
      const business = deslug(d.slug);
      d.j.comments.forEach((c) => {
        if (!c || !c.text) return;
        if (authorFilter && String(c.by || '').toLowerCase() !== authorFilter) return;
        out.push({ ts: c.at || null, author: c.by || '', slug: d.slug, business: business, note: c.text });
      });
    });
    out.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    out = out.slice(0, 400);
  } catch (e) { out = []; }
  res.status(200).json({ notes: out });
};

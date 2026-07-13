// Hot leads = prospects who clicked "Request a demo" on their preview.
// Returns their contact details (from the mockup metadata). Login-gated.
const { list } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { requirePermission } = require('../lib/access');
const { hotLeadRows } = require('../lib/db');
const { ownsSlug } = require('../lib/tenant');

function nameFromSlug(slug) {
  return String(slug || '').replace(/-[0-9a-f]{8}$/i, '').split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ').trim() || slug;
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (!(await requirePermission(req, res, 'viewWarmLeads'))) return; // team tab-visibility gate

  let blobs = [];
  try { blobs = (await list({ prefix: 'mockups/', limit: 1000 })).blobs || []; } catch (e) { /* ignore */ }
  const byPath = {};
  blobs.forEach((b) => { byPath[b.pathname] = b.url; });
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;

  let rows = [];
  try { rows = await hotLeadRows(); } catch (e) { rows = []; }
  rows = rows.filter((r) => ownsSlug(req, r.slug)); // only this tenant's hot leads

  // CRM statuses (slug -> status) from the notes index, so cards can show them
  let statusMap = {};
  try {
    const idxBlob = blobs.find((b) => b.pathname === 'notes/_index.json') || (await list({ prefix: 'notes/_index.json' })).blobs.find((b) => b.pathname === 'notes/_index.json');
    if (idxBlob) { const idx = await (await fetch(idxBlob.url + '?t=' + Date.now())).json(); for (const k in idx) { if (idx[k] && idx[k].status) statusMap[k] = idx[k].status; } }
  } catch (e) { /* ignore */ }

  const hotLeads = await Promise.all(rows.map(async (r) => {
    let meta = {};
    const url = byPath['mockups/' + r.slug + '.json'];
    if (url) { try { meta = await (await fetch(url + '?t=' + Date.now())).json(); } catch (e) { /* ignore */ } }
    return {
      slug: r.slug,
      name: meta.name || nameFromSlug(r.slug),
      phone: meta.phone || '',
      location: meta.loc || '',
      category: meta.category || '',
      mapsUrl: meta.mapsUrl || '',
      who: meta.who || '',
      demoAt: r.demo_at,
      signupAt: r.signup_at,
      signups: r.signups || 0,
      openedAt: r.opened_at,
      status: statusMap[r.slug] || '',
      viewUrl: `${linkBase}/v/${r.slug}`,
    };
  }));

  res.status(200).json({ hotLeads });
};

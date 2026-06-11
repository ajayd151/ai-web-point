// Publish / unpublish a Pounce site: flips sites/<slug>.json `mode` between
// 'published' (live, indexable, no preview bar) and 'preview' (private draft).
// Optionally puts it on a subdomain (<sub>.aiwebpoint.com): adds the domain to
// the Vercel project via the API (Vercel auto-issues SSL) and records the
// subdomain -> slug map in domains/_index.json (read by api/site.js via the
// middleware rewrite). Login-gated. The renderer honours `mode`, so this is
// instant, no redeploy.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const vercel = require('../lib/vercel');

const RESERVED = ['www', 'preview', 'app', 'api', 'mail', 'ftp', 'admin', 'cdn', 'static', 'assets'];
const ROOT = 'aiwebpoint.com';

async function readJson(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST.' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  if (!slug) { res.status(400).json({ error: 'Missing slug.' }); return; }
  const publish = !!body.publish;
  const mode = publish ? 'published' : 'preview';
  // optional subdomain (just the label, e.g. "ashgardens")
  const sub = String(body.subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);

  const path = 'sites/' + slug + '.json';
  let site;
  try {
    site = await readJson(path);
    if (!site) { res.status(404).json({ error: 'Site not found, build it with Pounce first.' }); return; }
  } catch (e) { res.status(500).json({ error: 'Could not load the site.' }); return; }

  const idxPath = 'domains/_index.json';
  let idx = (await readJson(idxPath)) || {};
  let host = '';

  // ---- assigning a subdomain (only when publishing) ----
  if (publish && sub) {
    if (RESERVED.indexOf(sub) >= 0) { res.status(400).json({ error: `"${sub}" is reserved, pick another.` }); return; }
    const owner = idx[sub];
    if (owner && owner !== slug) { res.status(409).json({ error: `Subdomain "${sub}" is already used by another site.` }); return; }
    if (!vercel.isConfigured()) { res.status(400).json({ error: 'Subdomains are not configured yet (missing Vercel API env vars).' }); return; }
    host = sub + '.' + ROOT;
    try { await vercel.addDomain(host); }
    catch (e) { res.status(502).json({ error: 'Could not register the subdomain with Vercel: ' + (e.message || e) }); return; }
    idx[sub] = slug;
    site.subdomain = sub;
  }

  // ---- write the site (mode + subdomain) ----
  site.mode = mode;
  site.publishedAt = mode === 'published' ? new Date().toISOString() : '';
  try { await put(path, JSON.stringify(site), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); }
  catch (e) { res.status(500).json({ error: 'Could not update the site.' }); return; }

  // ---- unpublish: free its subdomain (remove map + Vercel domain) ----
  if (!publish && site.subdomain) {
    const old = site.subdomain;
    delete idx[old];
    site.subdomain = '';
    try { await put(path, JSON.stringify(site), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* best effort */ }
    try { await vercel.removeDomain(old + '.' + ROOT); } catch (e) { /* best effort */ }
  }

  // persist the subdomain index if it changed
  if (publish && sub || (!publish && Object.keys(idx).length >= 0)) {
    try { await put(idxPath, JSON.stringify(idx), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* best effort */ }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, slug, mode, subdomain: site.subdomain || '', host: host || (site.subdomain ? site.subdomain + '.' + ROOT : '') });
};

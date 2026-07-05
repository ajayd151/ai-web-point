// POST /api/deepdossier/search  (SitePounce private MVP, Phase 1)
// Hidden internal tool. Gated by the DEEPDOSSIER_EMAILS allow-list: any request
// from a non-allow-listed user gets a flat 404 (the feature must not reveal it
// exists). Synchronous for Phase 1 (<=10 records fits inside maxDuration).
const { requireDeepDossier } = require('../../lib/access');
const { runDeepDossier, clampMax } = require('../../lib/deepdossier');
const { recordDeepDossierRun, saveDeepDossierLeads } = require('../../lib/db');

module.exports = async (req, res) => {
  // Gate FIRST, before we even look at the method, so nothing leaks.
  const acct = await requireDeepDossier(req, res);
  if (!acct) return; // 404 already sent

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};

  const input = {
    keywords: String(body.keywords || '').trim(),
    country: String(body.country || 'United Kingdom').trim(),
    sizeBand: String(body.sizeBand || '').trim(),
    titles: Array.isArray(body.titles) ? body.titles : String(body.titles || '').split(',').map((s) => s.trim()).filter(Boolean),
    seniority: Array.isArray(body.seniority) ? body.seniority.map((s) => String(s).trim()).filter(Boolean) : [],
    max: clampMax(body.max),
    deep: body.deep !== false, // paid add-on: Companies House + news + fit score
  };
  if (!input.keywords && !input.titles.length) {
    res.status(400).json({ error: 'Enter industry keywords or at least one job title.' });
    return;
  }

  try {
    const { rows, meta } = await runDeepDossier(input);
    // Bank every pulled lead into "Our Leads" (best-effort, upserts by email/name).
    saveDeepDossierLeads(acct.email, rows, input);
    // Log every run (best-effort). Cached re-runs are logged too, flagged cached (no re-bill).
    recordDeepDossierRun({
      email: acct.email,
      inputs: input,
      records: meta.count != null ? meta.count : rows.length,
      cached: meta.cached,
      mock: meta.mock,
      costGbp: meta.costGbp,
      msTotal: meta.msTotal,
      cacheKey: meta.cacheKey,
    });
    res.status(200).json({ rows, meta });
  } catch (e) {
    console.error('deepdossier search failed:', e && e.message);
    res.status(500).json({ error: 'DeepDossier run failed. Please try again.' });
  }
};

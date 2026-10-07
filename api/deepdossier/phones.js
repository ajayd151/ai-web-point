// GET /api/deepdossier/phones?run=<id>  (same gate as the search: allow-listed owner only, 404 otherwise)
// Returns the phones and emails Apollo has delivered so far for a run, keyed by Apollo person id, and saves them
// onto the matching rows in Our Leads.
const { requireDeepDossier } = require('../../lib/access');
const { readPhones } = require('../../lib/deepdossier');

module.exports = async (req, res) => {
  const acct = await requireDeepDossier(req, res);
  if (!acct) return;
  res.setHeader('Cache-Control', 'no-store');
  const run = String((req.query && req.query.run) || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
  if (!run) { res.status(400).json({ error: 'missing run' }); return; }
  try { res.status(200).json(await readPhones(run)); }
  catch (e) { res.status(200).json({ ready: false, people: {}, error: e.message }); }
};

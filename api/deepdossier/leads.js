// GET  /api/deepdossier/leads         -> all saved leads for the owner ("Our Leads")
// POST /api/deepdossier/leads {rows}   -> save/upsert an array of lead rows
// POST /api/deepdossier/leads {seed:1} -> one-time import of the real loss-adjuster
//                                          leads we already found (Companies House verified)
// Owner-only, same 404 gate as the rest of DeepDossier.
const { requireDeepDossier } = require('../../lib/access');
const { saveDeepDossierLeads, listDeepDossierLeads } = require('../../lib/db');

// The genuine records already found (contact from Apollo, company from Companies House).
const SEED = [
  { name: 'Des Bradshaw', title: 'Managing Director', company: 'TopMark Adjusters Ltd', email: 'des.bradshaw@topmarkadjusters.co.uk', mobile: '+44 7852 289340', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/des-bradshaw-1672b1129', location: 'Glasgow, United Kingdom', confidence: 92, match: { band: 'green', label: 'Strong match' }, companiesHouse: { found: true, name: 'TOPMARK ADJUSTERS LIMITED', number: 'SC227097', status: 'active', incorporated: '2002-01-18', address: '9 Blairtummock Place, Panorama Business Village, Glasgow, G33 4EN', directors: [{ name: 'Desmond Gerard Bradshaw' }], pscs: [{ name: 'TMA Glasgow Limited', control: ['owns 75%+ of shares'] }] }, news: [], sources: 'Apollo, Companies House' },
  { name: 'Chris Lewis', title: 'Managing Director', company: 'CRL Fire & Flood Damage Ltd', email: 'chris.lewis@crlfireflood.com', mobile: '+44 7770 424130', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/chris-lewis-53332426', location: 'Slough, United Kingdom', confidence: 90, match: { band: 'green', label: 'Strong match' }, companiesHouse: { found: true, name: 'CRL FIRE & FLOOD DAMAGE LTD', number: '04750280', status: 'active', incorporated: '2003-05-01', address: '242-242a Farnham Road, Slough, SL1 4XE', directors: [{ name: 'Christopher Raymond Lewis' }, { name: 'Michael John Lewis' }, { name: 'Charlotte Rebecca Lewis' }, { name: 'Joseph Edward Lewis' }], pscs: [{ name: 'Christopher Raymond Lewis', control: ['25-50% shares'] }, { name: 'Stephanie Jane Lewis', control: ['25-50% shares'] }] }, news: [], sources: 'Apollo, Companies House' },
  { name: 'Iain Johnston', title: 'Managing Director', company: 'Lorega', email: 'ijohnston@lorega.com', mobile: '+44 7867 314582', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/iain-johnston-bb494315', location: 'United Kingdom (London HQ)', confidence: 88, match: { band: 'green', label: 'Strong match' }, companiesHouse: { found: true, name: 'LOREGA LIMITED', number: '01921934', status: 'active', incorporated: '1985-06-12', address: '2 Minster Court, Mincing Lane, London, EC3R 7PD', directors: [{ name: 'Katherine Firmin' }, { name: 'Scott Lowe' }], pscs: [{ name: 'Lorega (UK) Limited', control: ['owns 75%+ of shares & votes'] }] }, news: [], sources: 'Apollo, Companies House' },
  { name: 'David Robinson', title: 'Managing Director', company: 'Marley Risk Consultants Ltd', email: 'david@marleyriskconsultants.com', mobile: '+44 7880 780652', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/david-robinson-3a312048', location: 'Shrewsbury, United Kingdom', confidence: 87, match: { band: 'green', label: 'Strong match' }, companiesHouse: { found: true, name: 'MARLEY RISK CONSULTANTS LIMITED', number: '08398403', status: 'active', incorporated: '2013-02-11', address: '33 St. Mary Axe, London, EC3A 8AA', directors: [{ name: 'David Robinson' }, { name: 'Kevin Alexander Drain' }, { name: 'Mordechai Sternhell' }, { name: 'Peter Dewey' }], pscs: [{ name: 'AmTrust International Limited', control: ['owns 75%+ of shares & votes'] }] }, news: [], sources: 'Apollo, Companies House' },
  { name: 'Neil Watson', title: 'Managing Director', company: 'Central Property Contracts Ltd', email: 'neil@centralpropertycontracts.co.uk', mobile: '+44 7999 655818', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/neil-watson-6bb280173', location: 'Glasgow, United Kingdom', confidence: 78, match: { band: 'amber', label: 'Partial match' }, companiesHouse: { found: true, name: 'CENTRAL PROPERTY CONTRACTS LIMITED', number: 'SC464578', status: 'active', incorporated: '2013-11-26', address: '216 West George Street, Glasgow, G2 2PQ', directors: [{ name: 'Neil Archibald Watson' }], pscs: [{ name: 'Neil Archibald Watson', control: ['25-50% shares'] }, { name: 'Amy Siobhan Watson', control: ['25-50% shares'] }] }, news: [], sources: 'Apollo, Companies House' },
  // Enriched live via the Apollo connector in-chat (verified emails; mobile not yet enriched).
  { name: 'Dan Steed', title: 'Managing Director', company: 'Engle Martin', email: 'dan.steed@englemartin.com', mobile: '', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/dan-steed-309b6911', location: 'London, United Kingdom', confidence: 74, match: { band: 'amber', label: 'Partial match' }, companiesHouse: { found: false }, news: [], sources: 'Apollo' },
  { name: 'Mike Higgins', title: 'Managing Director', company: 'Woodgate and Clark Limited', email: 'mike.higgins@woodgate-clark.co.uk', mobile: '', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/mike-higgins-2a689326', location: 'Manchester, United Kingdom', confidence: 76, match: { band: 'amber', label: 'Partial match' }, companiesHouse: { found: false }, news: [], sources: 'Apollo' },
  { name: 'Adam Humphrey', title: 'MD - Loss Adjusting', company: 'Complex Claims', email: 'ahumphrey@cci.partners', mobile: '', emailVerified: 'Yes', linkedin: 'https://www.linkedin.com/in/adam-humphrey-3a44736', location: 'London, United Kingdom', confidence: 75, match: { band: 'amber', label: 'Partial match' }, companiesHouse: { found: false }, news: [], sources: 'Apollo' },
];
const SEED_CRITERIA = { keywords: 'loss adjuster', country: 'United Kingdom', titles: ['Managing Director', 'Head of Claims'], seniority: ['Director', 'Head of'] };

module.exports = async (req, res) => {
  const acct = await requireDeepDossier(req, res);
  if (!acct) return; // 404 already sent

  if (req.method === 'GET') {
    let leads = await listDeepDossierLeads(acct.email);
    // First time the bank is empty, auto-import the real records we already found.
    if (!leads.length) {
      await saveDeepDossierLeads(acct.email, SEED, SEED_CRITERIA);
      leads = await listDeepDossierLeads(acct.email);
    }
    res.status(200).json({ leads });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    body = body || {};
    if (body.seed) {
      const n = await saveDeepDossierLeads(acct.email, SEED, SEED_CRITERIA);
      res.status(200).json({ saved: n, seeded: true });
      return;
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const n = await saveDeepDossierLeads(acct.email, rows, body.criteria || {});
    res.status(200).json({ saved: n });
    return;
  }

  res.status(405).json({ error: 'Method not allowed.' });
};

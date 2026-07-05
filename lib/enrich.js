// Deeper enrichment for DeepDossier: UK company depth (Companies House) and
// recent news mentions (GDELT, free). Both are the "value beyond Apollo" layer,
// so they live here and are called per contact by lib/deepdossier.js.
//
// Companies House: free official UK register (needs COMPANIES_HOUSE_API_KEY,
// already used elsewhere in the app). Returns registration status, incorporation
// date, SIC codes, registered office, latest-accounts dates, active directors and
// PSCs (persons of significant control, i.e. the real owners).
//
// News: GDELT Doc API is free and needs NO key, so it works out of the box. If a
// MEDIASTACK_API_KEY is present we use Mediastack instead (cleaner UK sourcing).
// Everything fails soft: a slow or missing source drops that block, never the run.
const { fetchRetry } = require('./backoff');

const CHKEY = () => process.env.COMPANIES_HOUSE_API_KEY;
const MEDIASTACK_KEY = () => process.env.MEDIASTACK_API_KEY;

// ---- Companies House (deep) ----------------------------------------------
async function chGet(path) {
  const auth = 'Basic ' + Buffer.from(CHKEY() + ':').toString('base64');
  const r = await fetchRetry('https://api.company-information.service.gov.uk' + path, {
    headers: { Authorization: auth },
  }, { retries: 2, timeoutMs: 9000 });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

function addressText(a) {
  if (!a) return '';
  return [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .filter(Boolean).join(', ');
}

async function companiesHouseDeep(name) {
  const miss = { found: false, note: 'No Companies House match (likely a sole trader or an unregistered name).' };
  if (!CHKEY()) return { found: false, note: 'Companies House not connected (add COMPANIES_HOUSE_API_KEY to enable).' };
  const clean = String(name || '').trim();
  if (!clean) return miss;
  try {
    const sd = await chGet('/search/companies?items_per_page=5&q=' + encodeURIComponent(clean));
    const items = (sd && sd.items) || [];
    const item = items.find((i) => i.company_status === 'active') || items[0];
    if (!item) return miss;
    const num = item.company_number;

    const [profile, officersData, pscData] = await Promise.all([
      chGet('/company/' + num),
      chGet('/company/' + num + '/officers?items_per_page=35').catch(() => null),
      chGet('/company/' + num + '/persons-with-significant-control?items_per_page=15').catch(() => null),
    ]);
    const p = profile || {};

    const directors = (((officersData && officersData.items) || [])
      .filter((o) => !o.resigned_on && /director/i.test(o.officer_role || ''))
      .map((o) => ({ name: o.name, role: o.officer_role, appointed: o.appointed_on || '' }))
      .slice(0, 8));

    const pscs = (((pscData && pscData.items) || [])
      .filter((x) => !x.ceased_on)
      .map((x) => ({
        name: x.name,
        kind: x.kind || '',
        control: Array.isArray(x.natures_of_control) ? x.natures_of_control.map(humaniseControl) : [],
      }))
      .slice(0, 8));

    const acc = p.accounts || {};
    return {
      found: true,
      name: p.company_name || item.title,
      number: num,
      status: p.company_status || item.company_status || '',
      incorporated: p.date_of_creation || '',
      type: p.type || '',
      sic: p.sic_codes || [],
      address: addressText(p.registered_office_address),
      accountsNextDue: (acc.next_accounts && acc.next_accounts.due_on) || '',
      accountsLastMadeUpTo: (acc.last_accounts && acc.last_accounts.made_up_to) || '',
      directors,
      pscs,
    };
  } catch (e) { return { found: false, note: 'Companies House lookup failed.' }; }
}

// Turn Companies House control codes into plain English (no jargon in the dossier).
function humaniseControl(code) {
  const s = String(code || '');
  if (/ownership-of-shares-75/.test(s)) return 'owns 75%+ of shares';
  if (/ownership-of-shares-50/.test(s)) return 'owns over 50% of shares';
  if (/ownership-of-shares-25/.test(s)) return 'owns 25-50% of shares';
  if (/voting-rights-75/.test(s)) return '75%+ voting rights';
  if (/voting-rights-50/.test(s)) return 'over 50% voting rights';
  if (/voting-rights-25/.test(s)) return '25-50% voting rights';
  if (/appoint-and-remove-directors/.test(s)) return 'can appoint/remove directors';
  if (/significant-influence/.test(s)) return 'significant influence or control';
  return s.replace(/-/g, ' ');
}

// ---- Recent news mentions -------------------------------------------------
// Returns up to `limit` recent articles: [{ title, url, source, date }].
async function companyNews(name, limit) {
  const clean = String(name || '').trim();
  limit = limit || 5;
  if (clean.length < 3) return [];
  if (MEDIASTACK_KEY()) {
    const viaMs = await mediastackNews(clean, limit);
    if (viaMs) return viaMs;
  }
  return await gdeltNews(clean, limit);
}

// GDELT Doc API: free, no key. Phrase-matched company name, most recent first.
async function gdeltNews(name, limit) {
  try {
    const q = '"' + name.replace(/"/g, '') + '"';
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q)
      + '&mode=artlist&maxrecords=' + limit + '&sort=datedesc&timespan=6m&format=json';
    const r = await fetchRetry(url, {}, { retries: 1, timeoutMs: 8000 });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    return ((d && d.articles) || []).slice(0, limit).map((a) => ({
      title: a.title || '',
      url: a.url || '',
      source: a.domain || '',
      date: gdeltDate(a.seendate),
    })).filter((x) => x.title && x.url);
  } catch (e) { return []; }
}

function gdeltDate(s) {
  // GDELT seendate looks like 20260701T101500Z; show as YYYY-MM-DD.
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

async function mediastackNews(name, limit) {
  try {
    const url = 'http://api.mediastack.com/v1/news?access_key=' + encodeURIComponent(MEDIASTACK_KEY())
      + '&keywords=' + encodeURIComponent('"' + name + '"') + '&languages=en&sort=published_desc&limit=' + limit;
    const r = await fetchRetry(url, {}, { retries: 1, timeoutMs: 8000 });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    if (!d || !Array.isArray(d.data)) return null;
    return d.data.slice(0, limit).map((a) => ({
      title: a.title || '',
      url: a.url || '',
      source: a.source || '',
      date: (a.published_at || '').slice(0, 10),
    })).filter((x) => x.title && x.url);
  } catch (e) { return null; }
}

module.exports = { companiesHouseDeep, companyNews };

// 🐾 Prowl — gathers public sales intelligence on a lead and turns it into a
// briefing ("ammunition"). Free sources: Companies House (if key set) + Google
// Places (existing key) + OpenAI synthesis. Result is cached in Blob per slug.
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');

const GKEY = () => process.env.GOOGLE_PLACES_API_KEY;
const OKEY = () => process.env.OPENAI_API_KEY;
const CHKEY = () => process.env.COMPANIES_HOUSE_API_KEY;

async function googleSearch(query, mask) {
  if (!GKEY()) return [];
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY(), 'X-Goog-FieldMask': mask },
      body: JSON.stringify({ textQuery: query, pageSize: 20, regionCode: 'GB', languageCode: 'en' }),
    });
    const d = await r.json().catch(() => ({}));
    return d.places || [];
  } catch (e) { return []; }
}

async function googleDetails(placeId, mask) {
  if (!placeId || !GKEY()) return null;
  try {
    const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId), {
      headers: { 'X-Goog-Api-Key': GKEY(), 'X-Goog-FieldMask': mask },
    });
    return await r.json().catch(() => null);
  } catch (e) { return null; }
}

async function companiesHouse(name) {
  if (!CHKEY()) return { found: false, note: 'Companies House not connected yet (add the free API key to enable).' };
  try {
    const auth = 'Basic ' + Buffer.from(CHKEY() + ':').toString('base64');
    const sr = await fetch('https://api.company-information.service.gov.uk/search/companies?items_per_page=5&q=' + encodeURIComponent(name), { headers: { Authorization: auth } });
    const sd = await sr.json().catch(() => ({}));
    const item = (sd.items || []).find((i) => i.company_status === 'active') || (sd.items || [])[0];
    if (!item) return { found: false, note: 'No Companies House match — likely a sole trader.' };
    const num = item.company_number;
    const profile = await (await fetch('https://api.company-information.service.gov.uk/company/' + num, { headers: { Authorization: auth } })).json().catch(() => ({}));
    let director = '';
    try {
      const od = await (await fetch('https://api.company-information.service.gov.uk/company/' + num + '/officers?items_per_page=10', { headers: { Authorization: auth } })).json().catch(() => ({}));
      const active = (od.items || []).filter((o) => !o.resigned_on && /director/i.test(o.officer_role || ''));
      director = active.length ? active[0].name : '';
    } catch (e) { /* ignore */ }
    return {
      found: true,
      name: profile.company_name || item.title,
      number: num,
      established: profile.date_of_creation || '',
      status: profile.company_status || '',
      type: profile.type || '',
      sic: profile.sic_codes || [],
      director,
      address: profile.registered_office_address ? Object.values(profile.registered_office_address).filter(Boolean).join(', ') : '',
    };
  } catch (e) { return { found: false, note: 'Companies House lookup failed.' }; }
}

async function synthesize(ctx) {
  const fallback = { services: [], reputationSummary: '', ammunition: [], openingLine: '' };
  if (!OKEY()) return fallback;
  const reviewsText = (ctx.reviews || []).map((r) => `(${r.rating}★) ${r.text}`).join('\n').slice(0, 3000);
  const compText = (ctx.competitors || []).map((c) => `${c.name}: ${c.reviews} reviews, ${c.score}★, site ${c.website}`).join('\n') || 'none found';
  const chText = ctx.ch && ctx.ch.found
    ? `Companies House: ${ctx.ch.name}, established ${ctx.ch.established}, status ${ctx.ch.status}, SIC codes ${(ctx.ch.sic || []).join(', ')}, director ${ctx.ch.director || 'unknown'}`
    : 'Not a registered company (likely a sole trader).';
  const prompt = `You are a sales-intelligence analyst helping a web-design agency pitch a local business that currently has NO website. Turn these facts into a punchy, specific sales briefing.\n\nBusiness: ${ctx.name} (${ctx.category}) in ${ctx.location}.\nGoogle: ${ctx.google.reviews} reviews at ${ctx.google.rating} stars. Website: ${ctx.google.website || 'NONE'}.\n${chText}\nNearby competitors:\n${compText}\nRecent reviews:\n${reviewsText || 'none available'}\n\nReturn JSON: {"services":["short service labels they offer"],"reputationSummary":"one sentence on their reputation","ammunition":["3-5 specific, persuasive talking points the salesperson can literally say, citing the REAL numbers and gaps — e.g. strong reviews with nowhere to send people, competitors who have sites, no online booking"],"openingLine":"a warm, non-salesy opening message line referencing something specific about them"}. Use the real numbers. Be concrete, no fluff.`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 22000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OKEY() },
      signal: ctrl.signal,
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You output only JSON.' }, { role: 'user', content: prompt }] }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    const p = JSON.parse(txt || '{}');
    return {
      services: Array.isArray(p.services) ? p.services.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
      reputationSummary: String(p.reputationSummary || ''),
      ammunition: Array.isArray(p.ammunition) ? p.ammunition.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
      openingLine: String(p.openingLine || ''),
    };
  } catch (e) { return fallback; }
}

module.exports = async (req, res) => {
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const slug = String(body.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 120);
  const name = String(body.name || '').trim();
  const location = String(body.location || '').trim();
  const category = String(body.category || '').trim() || 'local business';
  if (!slug || !name) { res.status(400).json({ error: 'Missing lead details.' }); return; }
  const refresh = !!body.refresh;

  const path = 'dossiers/' + slug + '.json';
  // serve cached dossier (no credit) unless re-running
  if (!refresh) {
    try {
      const { blobs } = await list({ prefix: path });
      const b = blobs.find((x) => x.pathname === path);
      if (b) { const cached = await (await fetch(b.url + '?t=' + Date.now())).json(); res.status(200).json({ dossier: cached, cached: true }); return; }
    } catch (e) { /* fall through to fresh gather */ }
  }

  if (!GKEY()) { res.status(503).json({ error: 'Google Places key is not set.' }); return; }
  const rl = await checkAndRecord('prowl', Date.now());
  if (!rl.ok) { res.status(429).json({ error: `Prowl limit reached (${rl.limit} per 12 hours). Try again in ~${rl.retryHours}h.` }); return; }

  const mask = 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount';
  const [ch, leadResults, compResults] = await Promise.all([
    companiesHouse(name),
    googleSearch(`${name} ${location}`, mask),
    googleSearch(`${category} in ${location}`, mask),
  ]);

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const leadNorm = norm(name);
  const nameOf = (p) => (p.displayName && p.displayName.text) || '';
  const leadPlace = leadResults.find((p) => norm(nameOf(p)) === leadNorm)
    || leadResults.find((p) => norm(nameOf(p)).includes(leadNorm) || leadNorm.includes(norm(nameOf(p))))
    || leadResults[0] || null;
  const google = leadPlace
    ? { placeId: leadPlace.id, rating: leadPlace.rating || 0, reviews: leadPlace.userRatingCount || 0, website: leadPlace.websiteUri || '', mapsUrl: 'https://www.google.com/maps/place/?q=place_id:' + leadPlace.id }
    : { placeId: '', rating: 0, reviews: 0, website: '', mapsUrl: '' };

  const competitors = compResults
    .filter((p) => p.websiteUri && norm(nameOf(p)) !== leadNorm)
    .sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0))
    .slice(0, 3)
    .map((p) => ({ name: nameOf(p), website: p.websiteUri || '', reviews: p.userRatingCount || 0, score: p.rating || 0 }));

  let reviews = [];
  if (google.placeId) {
    const det = await googleDetails(google.placeId, 'reviews');
    reviews = ((det && det.reviews) || [])
      .map((r) => ({ rating: r.rating || 0, text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '' }))
      .filter((r) => r.text).slice(0, 5);
  }

  const synthesis = await synthesize({ name, location, category, ch, google, competitors, reviews });

  const dossier = {
    business: { name, location, category, phone: body.phone || '' },
    companiesHouse: ch,
    google,
    competitors,
    reviewCount: reviews.length,
    services: synthesis.services,
    reputationSummary: synthesis.reputationSummary,
    ammunition: synthesis.ammunition,
    openingLine: synthesis.openingLine,
    generatedAt: new Date().toISOString(),
  };

  try { await put(path, JSON.stringify(dossier), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* ignore */ }
  res.status(200).json({ dossier, cached: false });
};

// Shared lead-intelligence gather used by 🐾 Prowl (api/prowl.js) and, when no
// dossier exists yet, auto-run by 🐆 Pounce (api/pounce.js) so a website always
// has intel behind it. Sources: Google Places + Companies House + OpenAI synthesis.
// Stores the dossier at dossiers/<slug>.json and returns it.
const { list, put } = require('@vercel/blob');

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
    if (!item) return { found: false, note: 'No Companies House match, likely a sole trader.' };
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
  const fallback = { services: [], reputationSummary: '', strengths: [], weaknesses: [], ammunition: [], objections: [], openingLine: '' };
  if (!OKEY()) return fallback;
  const reviewsText = (ctx.reviews || []).map((r) => `(${r.rating}★) ${r.text}`).join('\n').slice(0, 3000);
  const compText = (ctx.competitors || []).map((c) => `${c.name}: ${c.reviews} reviews, ${c.score}★, site ${c.website}`).join('\n') || 'none found';
  const chText = ctx.ch && ctx.ch.found
    ? `Companies House: ${ctx.ch.name}, established ${ctx.ch.established}, status ${ctx.ch.status}, SIC codes ${(ctx.ch.sic || []).join(', ')}, director ${ctx.ch.director || 'unknown'}`
    : 'Not a registered company (likely a sole trader).';
  const prompt = `You are a sales-intelligence analyst prepping a web-design agency for a PHONE CALL to a local business that currently has NO website. Be honest, not flattering: the prospect's weaknesses are the reason to buy. Write like a sharp human who actually makes these calls, NOT a marketing brochure. Turn these facts into a call briefing.\n\nBusiness: ${ctx.name} (${ctx.category}) in ${ctx.location}.\nGoogle: ${ctx.google.reviews} reviews at ${ctx.google.rating} stars. Website: ${ctx.google.website || 'NONE'}.\n${chText}\nNearby competitors:\n${compText}\nRecent reviews:\n${reviewsText || 'none available'}\n\nReturn JSON:\n{\n"services":["short service labels they offer"],\n"reputationSummary":"one honest sentence on their reputation",\n"strengths":["1-3 genuine strengths to acknowledge on the call to build rapport, citing real numbers, e.g. '28 five-star Google reviews'"],\n"weaknesses":[{"severity":"high","label":"short, specific gap to improve, e.g. 'No website at all' or 'Only 28 reviews vs 1,473 for the area leader' or 'No way to book or enquire online'"}],\n"ammunition":["3-5 PUNCHY talking points, each ONE short line you can glance at mid-call. Make them feel the GAP and the TRANSFORMATION, all about THEM (the jobs they are losing, what changes for them), so the reaction is 'I need that'. Cite the REAL numbers. NO 'we/our/I can help' framing, no features, only their loss and gain. At least ONE point MUST name a specific nearby competitor from the list who HAS a website and is winning the work this business is invisible for, e.g. 'Someone Googles a ${ctx.category} in ${ctx.location} and [Competitor] comes up, you do not, that job is theirs'"],\n"objections":[{"objection":"a likely brush-off they'll give, e.g. 'I get enough work by word of mouth'","response":"a short, warm, persuasive reply"}],\n"openingLine":"the FIRST thing to say on the call. SPOKEN English, how a real person actually talks, NOT marketing copy. Lead with THEIR specific situation, not your offer, and END ON A QUESTION that gets them talking. 1 to 2 short sentences max. Example shape: 'Hi [name], honest cold call, quick one, you have got ${ctx.google.reviews} five-star reviews but no website, is that on purpose or just never got round to it?'"\n}\nRules: severity is "high" (a serious gap, red) or "medium" (worth improving, amber). Give 2-4 weaknesses and 2-3 objections. Use the REAL numbers. Be concrete, no fluff. BANNED corporate phrases everywhere (never use these): 'reach out', 'touch base', 'came across your fantastic reviews', 'connect with even more customers', 'help you grow', 'take your business to the next level', 'in today's digital world'. Never use em dashes; use commas or full stops instead.`;
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
      strengths: Array.isArray(p.strengths) ? p.strengths.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [],
      weaknesses: Array.isArray(p.weaknesses) ? p.weaknesses.map((w) => ({
        severity: (w && /high|red/i.test(String(w.severity))) ? 'high' : 'medium',
        label: String((w && (w.label || w.text)) || (typeof w === 'string' ? w : '')).trim(),
      })).filter((w) => w.label).slice(0, 5) : [],
      ammunition: Array.isArray(p.ammunition) ? p.ammunition.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
      objections: Array.isArray(p.objections) ? p.objections.map((o) => ({
        objection: String((o && o.objection) || '').trim(),
        response: String((o && o.response) || '').trim(),
      })).filter((o) => o.objection && o.response).slice(0, 4) : [],
      openingLine: String(p.openingLine || ''),
    };
  } catch (e) { return fallback; }
}

// Read a cached dossier (or null). Used to avoid re-gathering.
async function readDossier(slug) {
  try {
    const path = 'dossiers/' + slug + '.json';
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

// Gather a fresh dossier and store it. No auth / rate-limit here (callers gate).
async function gatherDossier({ slug, name, location, category, phone }) {
  if (!GKEY()) throw new Error('Google Places key is not set.');
  const cat = category || 'local business';
  const mask = 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount';
  const [ch, leadResults, compResults] = await Promise.all([
    companiesHouse(name),
    googleSearch(`${name} ${location}`, mask),
    googleSearch(`${cat} in ${location}`, mask),
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

  const synthesis = await synthesize({ name, location, category: cat, ch, google, competitors, reviews });

  const dossier = {
    business: { name, location, category: cat, phone: phone || '' },
    companiesHouse: ch,
    google,
    competitors,
    reviewCount: reviews.length,
    services: synthesis.services,
    reputationSummary: synthesis.reputationSummary,
    strengths: synthesis.strengths,
    weaknesses: synthesis.weaknesses,
    ammunition: synthesis.ammunition,
    objections: synthesis.objections,
    openingLine: synthesis.openingLine,
    generatedAt: new Date().toISOString(),
  };

  try { await put('dossiers/' + slug + '.json', JSON.stringify(dossier), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* ignore */ }
  return dossier;
}

module.exports = { gatherDossier, readDossier };

// 🐆 Pounce — builds a real 1-page website for a lead and stores it as a PREVIEW.
// Sources: Google Place Details (real photos + 4-5★ reviews + hours/address) +
// the cached Prowl dossier (services) + OpenAI copywriting. Stored as
// sites/<slug>.json with mode:'preview' (the preview registry for tidy-ups).
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');

const GKEY = () => process.env.GOOGLE_PLACES_API_KEY;
const OKEY = () => process.env.OPENAI_API_KEY;

async function gSearch(query, mask) {
  if (!GKEY()) return [];
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY(), 'X-Goog-FieldMask': mask },
      body: JSON.stringify({ textQuery: query, pageSize: 10, regionCode: 'GB', languageCode: 'en' }),
    });
    const d = await r.json().catch(() => ({}));
    return d.places || [];
  } catch (e) { return []; }
}
async function gDetails(placeId, mask) {
  if (!placeId || !GKEY()) return null;
  try {
    const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId), { headers: { 'X-Goog-Api-Key': GKEY(), 'X-Goog-FieldMask': mask } });
    return await r.json().catch(() => null);
  } catch (e) { return null; }
}
async function readDossier(slug) {
  try {
    const path = 'dossiers/' + slug + '.json';
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (b) return await (await fetch(b.url + '?t=' + Date.now())).json();
  } catch (e) { /* none */ }
  return null;
}

async function writeCopy(ctx) {
  const fallback = {
    headline: `${ctx.name}`, sub: `Trusted local ${ctx.category} in ${ctx.location}. Get in touch for a free, no-obligation quote.`,
    trust: ['Fully Insured', 'Free Quotes', 'Local & Trusted', '5★ Rated'],
    services: [{ icon: '⭐', title: 'Quality Service', desc: 'Professional, reliable work every time.' }],
    aboutHeading: `About ${ctx.name}`, aboutParas: [`${ctx.name} is a trusted local ${ctx.category} serving ${ctx.location} and the surrounding area.`],
    stats: [{ num: ctx.rating ? ctx.rating + '★' : '5★', label: 'Customer rating' }, { num: (ctx.reviews || 0) + '+', label: 'Happy customers' }],
    seoTitle: `${ctx.name} | ${ctx.category} in ${ctx.location}`, seoDesc: `${ctx.name} — trusted ${ctx.category} in ${ctx.location}. Free quotes.`,
  };
  if (!OKEY()) return fallback;
  const revs = (ctx.reviews_text || []).join('\n').slice(0, 2000);
  const svc = (ctx.dossierServices || []).join(', ');
  const prompt = `Write website copy for a local ${ctx.category} called "${ctx.name}" in ${ctx.location} (Google: ${ctx.reviews} reviews at ${ctx.rating}★). Known services: ${svc || 'infer from the trade'}. Recent reviews:\n${revs || 'none'}\n\nReturn JSON: {"headline":"punchy hero headline","sub":"1 sentence subheadline","trust":["3-4 short trust badges e.g. Fully Insured, Free Quotes"],"services":[{"icon":"a fitting emoji","title":"2-3 words","desc":"1 short sentence"} x4-6],"aboutHeading":"short","aboutParas":["2 short warm paragraphs about the business using the real reputation"],"stats":[{"num":"e.g. 10+","label":"short"} x3],"seoTitle":"SEO title <60 chars","seoDesc":"meta description <155 chars"}. Be specific to the trade, warm and credible. No fluff.`;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 22000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OKEY() }, signal: ctrl.signal,
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.6, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You output only JSON.' }, { role: 'user', content: prompt }] }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const p = JSON.parse((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}');
    return {
      headline: p.headline || fallback.headline, sub: p.sub || fallback.sub,
      trust: Array.isArray(p.trust) ? p.trust.slice(0, 4) : fallback.trust,
      services: Array.isArray(p.services) ? p.services.slice(0, 6) : fallback.services,
      aboutHeading: p.aboutHeading || fallback.aboutHeading,
      aboutParas: Array.isArray(p.aboutParas) ? p.aboutParas.slice(0, 3) : fallback.aboutParas,
      stats: Array.isArray(p.stats) ? p.stats.slice(0, 3) : fallback.stats,
      seoTitle: p.seoTitle || fallback.seoTitle, seoDesc: p.seoDesc || fallback.seoDesc,
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
  const phone = String(body.phone || '').trim();
  if (!slug || !name) { res.status(400).json({ error: 'Missing lead details.' }); return; }
  const refresh = !!body.refresh;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
  const siteUrl = `${linkBase}/s/${slug}`;
  const path = 'sites/' + slug + '.json';

  if (!refresh) {
    try {
      const { blobs } = await list({ prefix: path });
      if (blobs.find((x) => x.pathname === path)) { res.status(200).json({ siteUrl, slug, cached: true }); return; }
    } catch (e) { /* build fresh */ }
  }

  if (!GKEY()) { res.status(503).json({ error: 'Google Places key not set.' }); return; }
  const rl = await checkAndRecord('pounce', Date.now());
  if (!rl.ok) { res.status(429).json({ error: `Pounce limit reached (${rl.limit} per 12 hours).` }); return; }

  // find the place + pull details (photos, reviews, hours, address)
  const found = await gSearch(`${name} ${location}`, 'places.id,places.displayName');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const place = found.find((p) => norm(p.displayName && p.displayName.text) === norm(name)) || found[0];
  const det = place ? await gDetails(place.id, 'displayName,formattedAddress,nationalPhoneNumber,rating,userRatingCount,websiteUri,regularOpeningHours,reviews,photos') : null;

  const rating = (det && det.rating) || 0;
  const reviewCount = (det && det.userRatingCount) || 0;
  const goodReviews = ((det && det.reviews) || [])
    .filter((r) => (r.rating || 0) >= 4)
    .map((r) => ({ rating: r.rating || 5, text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '', name: (r.authorAttribution && r.authorAttribution.displayName) || 'Verified customer' }))
    .filter((r) => r.text).slice(0, 3);
  const photoUrls = ((det && det.photos) || []).slice(0, 5).map((p) => `${linkBase}/api/photo?n=${encodeURIComponent(p.name)}`);
  const hours = (det && det.regularOpeningHours && det.regularOpeningHours.weekdayDescriptions) || [];
  const address = (det && det.formattedAddress) || location;
  const realPhone = phone || (det && det.nationalPhoneNumber) || '';

  const dossier = await readDossier(slug);
  const copy = await writeCopy({
    name, location, category, rating, reviews: reviewCount,
    reviews_text: goodReviews.map((r) => r.text),
    dossierServices: dossier && dossier.services ? dossier.services : [],
  });

  const initials = (String(name).replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'SP').toUpperCase();

  const site = {
    slug, mode: 'preview', createdAt: new Date().toISOString(),
    business: { name, location, category, phone: realPhone, address, mapsUrl: place ? 'https://www.google.com/maps/place/?q=place_id:' + place.id : '' },
    initials,
    hero: { headline: copy.headline, sub: copy.sub, image: photoUrls[0] || '' },
    trust: copy.trust,
    services: copy.services,
    about: { heading: copy.aboutHeading, paras: copy.aboutParas, stats: copy.stats },
    gallery: photoUrls.slice(1, 5),
    reviews: goodReviews,
    contact: { phone: realPhone, area: location, hours },
    rating, reviewCount,
    seo: { title: copy.seoTitle, description: copy.seoDesc },
  };

  try { await put(path, JSON.stringify(site), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* ignore */ }
  res.status(200).json({ siteUrl, slug, cached: false });
};

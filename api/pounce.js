// 🐆 Pounce, builds a real 1-page website for a lead and stores it as a PREVIEW.
// Sources: Google Place Details (real photos + 4-5★ reviews + hours/address) +
// the cached Prowl dossier (services) + OpenAI copywriting. Stored as
// sites/<slug>.json with mode:'preview' (the preview registry for tidy-ups).
const { list, put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');
const { readDossier, gatherDossier } = require('../lib/intel');

const GKEY = () => process.env.GOOGLE_PLACES_API_KEY;
const OKEY = () => process.env.OPENAI_API_KEY;

// bump when the generator/template changes so cached previews auto-rebuild
const SITE_VERSION = 4;
const ACCENTS = {
  amber: { a: '#ffb703', d: '#f59e0b' }, blue: { a: '#2f6df6', d: '#1d4fd0' },
  green: { a: '#16a34a', d: '#0f7d39' }, red: { a: '#e23b3b', d: '#c01f1f' },
  purple: { a: '#7c3aed', d: '#5b21b6' }, teal: { a: '#0d9488', d: '#0b7268' },
  slate: { a: '#475569', d: '#334155' },
};
function parseAccent(v) {
  if (!v) return null;
  const k = String(v).toLowerCase().trim();
  if (ACCENTS[k]) return ACCENTS[k];
  if (/^#[0-9a-f]{6}$/i.test(k)) return { a: k, d: k };
  return null;
}

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

async function writeCopy(ctx) {
  const fallback = {
    headline: `${ctx.name}`, sub: `Trusted local ${ctx.category} in ${ctx.location}. Get in touch for a free, no-obligation quote.`,
    trust: ['Fully Insured', 'Free Quotes', 'Local & Trusted', '5★ Rated'],
    services: [{ icon: '⭐', title: 'Quality Service', desc: 'Professional, reliable work every time.' }],
    aboutHeading: `About ${ctx.name}`, aboutParas: [`${ctx.name} is a trusted local ${ctx.category} serving ${ctx.location} and the surrounding area.`],
    stats: [{ num: ctx.rating ? ctx.rating + '★' : '5★', label: 'Customer rating' }, { num: (ctx.reviews || 0) + '+', label: 'Happy customers' }],
    seoTitle: `${ctx.name} | ${ctx.category} in ${ctx.location}`, seoDesc: `${ctx.name}, trusted ${ctx.category} in ${ctx.location}. Free quotes.`,
    areasCovered: [],
  };
  fallback.faq = [];
  if (!OKEY()) return fallback;
  const o = ctx.opts || {};
  const revs = (ctx.reviews_text || []).join('\n').slice(0, 2000);
  const svc = (ctx.dossierServices || []).join(', ');
  const extras = [
    ctx.establishedYear ? `Established ${ctx.establishedYear}.` : '',
    ctx.reputation ? `Reputation summary: ${ctx.reputation}.` : '',
    o.highlightServices ? `Especially highlight these services: ${o.highlightServices}.` : '',
    o.usp ? `Their main selling point / what makes them different: ${o.usp}.` : '',
    o.notes ? `Extra notes from the agency: ${o.notes}.` : '',
  ].filter(Boolean).join(' ');
  const faqAsk = o.faq ? ',"faq":[{"q":"a real question a local customer would ask this trade","a":"a helpful 1-2 sentence answer"} (4-5 items)]' : '';
  const prompt = `Write website copy for a local ${ctx.category} called "${ctx.name}" in ${ctx.location} (Google: ${ctx.reviews} reviews at ${ctx.rating}★). Known services: ${svc || 'infer from the trade'}. ${extras}\nRecent reviews:\n${revs || 'none'}\n\nReturn JSON: {"headline":"punchy hero headline","sub":"1 sentence subheadline","trust":["3-4 short trust badges e.g. Fully Insured, Free Quotes"],"services":[{"icon":"a fitting emoji","title":"2-3 words","desc":"1 short sentence"} x4-6],"aboutHeading":"short","aboutParas":["2 short warm paragraphs about the business using the real reputation${ctx.establishedYear ? ' and mentioning they were established ' + ctx.establishedYear : ''}"],"stats":[{"num":"e.g. 10+","label":"short"} x3],"areasCovered":["4-6 real nearby towns/areas a ${ctx.category} based in ${ctx.location} would realistically cover"],"seoTitle":"SEO title <60 chars","seoDesc":"meta description <155 chars"${faqAsk}}. Be specific to the trade, warm and credible. No fluff. Never use em dashes anywhere in the copy; use commas, full stops or brackets instead.`;
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
      faq: Array.isArray(p.faq) ? p.faq.map((f) => ({ q: String(f.q || '').trim(), a: String(f.a || '').trim() })).filter((f) => f.q && f.a).slice(0, 6) : [],
      areasCovered: Array.isArray(p.areasCovered) ? p.areasCovered.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
    };
  } catch (e) { return fallback; }
}

// Vision: score each Google photo for hero / gallery suitability + flag junk.
// Returns [{ i, hero:0-10, gallery:0-10, junk:bool }] or null if it couldn't run.
async function rankPhotos(photoNames, category) {
  if (!photoNames.length || !OKEY()) return null;
  const imgs = [];
  for (let i = 0; i < photoNames.length; i++) {
    try {
      const r = await fetch(`https://places.googleapis.com/v1/${photoNames[i]}/media?maxWidthPx=512&key=${GKEY()}`);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || 'image/jpeg';
      imgs.push({ i, url: `data:${ct};base64,${buf.toString('base64')}` });
    } catch (e) { /* skip this photo */ }
  }
  if (!imgs.length) return null;
  const content = [{ type: 'text', text: `These are Google Business photos for a "${category}", given in order with their index. Rate EACH for use on a professional website. "hero" 0-10 = suitability as the big top banner (wide, sharp, bright, attractive, clearly on-trade); heavily PENALISE logos, text/posters, menus, receipts, screenshots, dark or blurry shots, plain storefront signage, and selfies. "gallery" 0-10 = suitability as a smaller portfolio thumbnail. "junk" = true if it is a logo, text, menu, receipt, screenshot or very low quality. Reply JSON {"photos":[{"i":<index>,"hero":<n>,"gallery":<n>,"junk":<bool>}]}.` }];
  imgs.forEach((im) => content.push({ type: 'image_url', image_url: { url: im.url, detail: 'low' } }));
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OKEY() }, signal: ctrl.signal,
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const p = JSON.parse((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}');
    const arr = Array.isArray(p.photos) ? p.photos : [];
    return arr.map((x) => ({ i: Number(x.i), hero: Number(x.hero) || 0, gallery: Number(x.gallery) || 0, junk: !!x.junk })).filter((x) => Number.isInteger(x.i) && x.i >= 0);
  } catch (e) { return null; }
}

// Curate: generate a clean, text-free, on-trade hero when no real photo is good
// enough. Stored to blob; returns its URL (or '' on failure).
async function generateHeroImage(slug, category) {
  if (!OKEY()) return '';
  const prompt = `Professional photorealistic wide-angle hero photograph for the website of a ${category} business in the UK. A clean, modern, well-lit real-world scene that represents this trade, either skilled work in progress or a pristine finished result. High-end commercial photography, natural daylight, shallow depth of field, vibrant and aspirational. Absolutely NO text, NO logos, NO watermarks, NO collage, NO people posing at the camera.`;
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OKEY() },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1536x1024', quality: process.env.OPENAI_IMAGE_QUALITY || 'medium', output_format: 'jpeg', n: 1 }),
    });
    const d = await resp.json().catch(() => ({}));
    const item = (d.data && d.data[0]) || {};
    let buf = null;
    if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
    else if (item.url) { const ir = await fetch(item.url); if (ir.ok) buf = Buffer.from(await ir.arrayBuffer()); }
    if (!buf) return '';
    const blob = await put(`sites/${slug}-hero.jpg`, buf, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false });
    return blob.url;
  } catch (e) { return ''; }
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
  const opts = {
    accent: parseAccent(body.accent),
    highlightServices: String(body.highlightServices || '').trim().slice(0, 300),
    usp: String(body.usp || '').trim().slice(0, 300),
    offer: String(body.offer || '').trim().slice(0, 160),
    faq: !!body.faq,
    notes: String(body.notes || '').trim().slice(0, 500),
    accreditations: Array.isArray(body.accreditations) ? body.accreditations.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
  };
  const hasOpts = !!(opts.accent || opts.highlightServices || opts.usp || opts.offer || opts.faq || opts.notes || opts.accreditations.length);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
  const siteUrl = `${linkBase}/s/${slug}`;
  const path = 'sites/' + slug + '.json';

  // Serve cache only if it's the current version AND the caller didn't pass new
  // answers; stale-version previews auto-rebuild on the next click.
  if (!refresh && !hasOpts) {
    try {
      const { blobs } = await list({ prefix: path });
      const hit = blobs.find((x) => x.pathname === path);
      if (hit) {
        const cached = await (await fetch(hit.url + '?t=' + Date.now())).json().catch(() => null);
        if (cached && cached.v === SITE_VERSION) { res.status(200).json({ siteUrl, slug, cached: true, heroSource: cached.hero && cached.hero.source }); return; }
      }
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
  // --- photo intelligence: vet Google photos; only a genuinely good one becomes
  // the hero; otherwise curate (generate) a clean professional hero ---
  const photoNames = ((det && det.photos) || []).slice(0, 8).map((p) => p.name);
  const proxy = (nm) => `${linkBase}/api/photo?n=${encodeURIComponent(nm)}`;
  const HERO_MIN = Number(process.env.POUNCE_HERO_MIN || 7);
  const GAL_MIN = Number(process.env.POUNCE_GALLERY_MIN || 5);
  const ranked = await rankPhotos(photoNames, category);

  let heroImage = '', heroSource = '', gallery = [];
  if (ranked) {
    const heroCand = ranked.filter((r) => !r.junk && r.hero >= HERO_MIN && photoNames[r.i]).sort((a, b) => b.hero - a.hero);
    const heroI = heroCand.length ? heroCand[0].i : -1;
    if (heroI >= 0) { heroImage = proxy(photoNames[heroI]); heroSource = 'google'; }
    gallery = ranked.filter((r) => !r.junk && r.gallery >= GAL_MIN && r.i !== heroI && photoNames[r.i])
      .sort((a, b) => b.gallery - a.gallery).slice(0, 4).map((r) => proxy(photoNames[r.i]));
  } else if (photoNames.length) {
    // vision unavailable: can't vet, use the first photo conservatively, no gallery
    heroImage = proxy(photoNames[0]); heroSource = 'google-unvetted';
  }
  if (!heroImage) {
    const gen = await generateHeroImage(slug, category);
    if (gen) { heroImage = gen; heroSource = 'generated'; }
  }
  const hours = (det && det.regularOpeningHours && det.regularOpeningHours.weekdayDescriptions) || [];
  const address = (det && det.formattedAddress) || location;
  const realPhone = phone || (det && det.nationalPhoneNumber) || '';

  // --- Prowl intel: reuse the cached dossier, or auto-gather it now so the site
  // always has intel (services, reputation, established year) behind it ---
  let dossier = await readDossier(slug);
  if (!dossier) {
    try { dossier = await gatherDossier({ slug, name, location, category, phone }); } catch (e) { dossier = null; }
  }
  const ch = dossier && dossier.companiesHouse && dossier.companiesHouse.found ? dossier.companiesHouse : null;
  const establishedYear = ch && ch.established ? String(ch.established).slice(0, 4) : '';
  const usedProwl = !!(dossier && (dossier.services || dossier.reputationSummary || establishedYear));
  const copy = await writeCopy({
    name, location, category, rating, reviews: reviewCount,
    reviews_text: goodReviews.map((r) => r.text),
    dossierServices: dossier && dossier.services ? dossier.services : [],
    reputation: dossier ? dossier.reputationSummary : '',
    establishedYear, opts,
  });

  const initials = (String(name).replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'SP').toUpperCase();

  const site = {
    slug, mode: 'preview', v: SITE_VERSION, createdAt: new Date().toISOString(),
    business: { name, location, category, phone: realPhone, address, mapsUrl: place ? 'https://www.google.com/maps/place/?q=place_id:' + place.id : '' },
    initials, accent: opts.accent || null, offer: opts.offer || '',
    accreditations: opts.accreditations || [],
    hero: { headline: copy.headline, sub: copy.sub, image: heroImage, source: heroSource },
    trust: copy.trust,
    services: copy.services,
    about: { heading: copy.aboutHeading, paras: copy.aboutParas, stats: copy.stats },
    gallery,
    reviews: goodReviews,
    faq: copy.faq || [],
    areasCovered: copy.areasCovered || [],
    contact: { phone: realPhone, area: location, hours },
    rating, reviewCount, establishedYear, usedProwl,
    seo: { title: copy.seoTitle, description: copy.seoDesc },
  };

  try { await put(path, JSON.stringify(site), { access: 'public', contentType: 'application/json', addRandomSuffix: false }); } catch (e) { /* ignore */ }
  res.status(200).json({ siteUrl, slug, cached: false, heroSource, usedProwl });
};

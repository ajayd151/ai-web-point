// Live business search via Google Places API (New) Text Search.
// Login-gated (protects your Google credit). Returns businesses in the same
// shape as the old mock data so filters + the mockup generator just work.
// NOTE: Google does not return email addresses, `email` is always null.
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');
const { tenantPrefix, emailOf } = require('../lib/tenant');
const { requirePaid, requirePermission } = require('../lib/access');
const { matchesFilters } = require('../lib/filters');

const SERVICE_MAP = {
  plumber: ['Emergency Plumbing', 'Boiler Repairs', 'Bathroom Installs', 'Leak Detection'],
  electrician: ['Rewiring', 'Fuse Board Upgrades', 'EV Chargers', 'Emergency Call-Outs'],
  builder: ['Extensions', 'Loft Conversions', 'Renovations', 'New Builds'],
  roofer: ['Roof Repairs', 'New Roofs', 'Guttering', 'Chimney Work'],
  gardener: ['Lawn Care', 'Hedge Trimming', 'Garden Design', 'Maintenance'],
  cleaner: ['Domestic Cleaning', 'End of Tenancy', 'Carpet Cleaning', 'Office Cleaning'],
  painter: ['Interior Painting', 'Exterior Painting', 'Wallpapering', 'Decorating'],
  mechanic: ['MOT Testing', 'Servicing', 'Diagnostics', 'Repairs'],
  hairdresser: ['Cuts & Styling', 'Colouring', 'Treatments', 'Bridal Hair'],
  dentist: ['Check-Ups', 'Whitening', 'Implants', 'Emergency Dental'],
  locksmith: ['Emergency Entry', 'Lock Changes', 'Key Cutting', 'Security Upgrades'],
};
const GENERIC_SERVICES = ['Free Consultation', 'Emergency Call-Outs', 'Repairs & Maintenance', 'Installations'];

const INDUSTRY_ACRONYMS = new Set(['mot', 'pat', 'epc', 'hvac', 'cctv', 'hgv', 'pcv', 'it', 'seo', 'ppc', 'tv', 'uk', 'dj', 'pa', 'hr']);
function titleCase(s) {
  return String(s || '').trim().split(/\s+/).map((w) => {
    const lw = w.toLowerCase();
    if (INDUSTRY_ACRONYMS.has(lw)) return lw.toUpperCase();
    return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  }).join(' ');
}

function servicesFor(industry) {
  const lower = String(industry || '').toLowerCase();
  for (const k of Object.keys(SERVICE_MAP)) {
    if (lower.indexOf(k) !== -1) return SERVICE_MAP[k];
  }
  const singular = lower.replace(/s$/, '');
  return SERVICE_MAP[singular] || GENERIC_SERVICES;
}

function hueFor(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.googleMapsUri', 'nextPageToken',
].join(',');

// Fallback list of nearby areas for big UK cities, used only if the AI
// suggestion call is unavailable. Keyed by lowercased location.
const NEARBY_FALLBACK = {
  birmingham: ['Harborne', 'Edgbaston', 'Sutton Coldfield', 'Solihull', 'Erdington'],
  london: ['Croydon', 'Ealing', 'Enfield', 'Bromley', 'Barnet'],
  manchester: ['Salford', 'Stockport', 'Oldham', 'Bolton', 'Trafford'],
  leeds: ['Bradford', 'Wakefield', 'Pudsey', 'Morley', 'Horsforth'],
  liverpool: ['Bootle', 'Birkenhead', 'St Helens', 'Wallasey', 'Crosby'],
  glasgow: ['Paisley', 'Clydebank', 'Rutherglen', 'Bearsden', 'Pollok'],
  bristol: ['Bath', 'Filton', 'Kingswood', 'Portishead', 'Clevedon'],
  sheffield: ['Rotherham', 'Barnsley', 'Chesterfield', 'Dronfield', 'Hillsborough'],
};

// Ask the AI for the nearest distinct towns/suburbs to a location (any UK
// place, not just the hardcoded ones). Falls back to the table above.
async function nearbyAreas(location, count) {
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You return only JSON.' },
            { role: 'user', content: `List the ${count} nearest distinct towns, suburbs or districts to "${location}" in the United Kingdom, ordered by proximity and size, suitable for finding local tradespeople. Exclude "${location}" itself. Respond as JSON exactly like {"areas":["Name 1","Name 2"]}.` },
          ],
        }),
      });
      clearTimeout(t);
      const d = await r.json().catch(() => ({}));
      const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      const parsed = JSON.parse(txt || '{}');
      if (Array.isArray(parsed.areas) && parsed.areas.length) {
        return parsed.areas.map((s) => String(s).trim()).filter(Boolean).slice(0, count);
      }
    } catch (e) { /* fall through to table */ }
  }
  return (NEARBY_FALLBACK[String(location).toLowerCase().trim()] || []).slice(0, count);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }
  if (!(await requirePaid(req, res))) return; // paywall: needs an active subscription (owner/allow-list comped)
  if (!(await requirePermission(req, res, 'search'))) return; // team-member permission gate

  let body = req.body;
  if (typeof body === 'string') body = JSON.parse(body || '{}');
  body = body || {};
  const industry = String(body.industry || '').trim();
  const location = String(body.location || '').trim();
  if (!industry || !location) { res.status(400).json({ error: 'Industry and location are required.' }); return; }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) { res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not set in Vercel yet.' }); return; }

  // 12-hour usage cap
  const rl = await checkAndRecord('search', Date.now(), tenantPrefix(req), emailOf(req));
  if (!rl.ok) {
    res.status(429).json({ error: `Search limit reached (${rl.limit} searches per ${rl.windowHours} hours). Try again in ~${rl.retryHours}h.` });
    return;
  }

  // how many MATCHING businesses to return; we page through Google (up to its
  // ~60 max) to find them, applying the filters server-side as we go.
  const want = Math.min(150, Math.max(1, Number(body.limit) || 20));
  const filters = body.filters || {};
  const excludeSet = new Set((Array.isArray(body.excludeIds) ? body.excludeIds : []).map(String));
  const services = servicesFor(industry);
  const category = titleCase(industry);

  const out = [];
  const seen = new Set();   // dedupe businesses across overlapping areas
  let scanned = 0;

  // Search a single area: pages through Google (up to ~60 results), filters
  // server-side, pushes unique matches into `out`. Throws on first-page error.
  async function searchArea(area) {
    let pageToken = null;
    let added = 0;
    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const reqBody = { textQuery: `${industry} in ${area}`, pageSize: 20, regionCode: 'GB', languageCode: 'en' };
      if (pageToken) reqBody.pageToken = pageToken;
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify(reqBody),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data.error && data.error.message) || ('Google Places error ' + r.status);
        if (pageNum === 0) throw new Error('Google Places: ' + msg);
        break;
      }
      (data.places || []).forEach((p) => {
        if (p.id && seen.has(p.id)) return;
        if (p.id) seen.add(p.id);
        if (p.id && excludeSet.has(p.id)) return; // already messaged, skip, keep digging for fresh ones
        scanned++;
        const name = (p.displayName && p.displayName.text) || 'Unknown business';
        const phone = p.nationalPhoneNumber || p.internationalPhoneNumber || null;
        const biz = {
          id: p.id,
          name,
          category,
          industry,
          location: area,
          searchLoc: location, // the core location you typed (area may be an auto-expanded nearby town)
          address: p.formattedAddress || area,
          phones: phone ? [phone] : [],
          email: null, // Google does not expose email
          website: p.websiteUri || null,
          rating: p.rating || 0,
          userRatingsTotal: p.userRatingCount || 0,
          services,
          mapsUrl: p.googleMapsUri || ('https://www.google.com/maps/search/' + encodeURIComponent(name + ' ' + area)),
          brandHue: hueFor(name),
        };
        if (matchesFilters(biz, filters)) { out.push(biz); added++; }
      });
      if (out.length >= want) break;       // got enough matches overall
      pageToken = data.nextPageToken || null;
      if (!pageToken) break;               // no more Google results for this area
    }
    return added;
  }

  const searchedLocations = [location];
  const expandedLocations = [];
  let primaryCount = 0;

  try {
    primaryCount = await searchArea(location);

    // If the primary area didn't yield the number asked for, auto-expand to
    // nearby areas (AI-picked) until we hit `want` or run out. Demand-driven: it
    // only digs into more areas when a bigger target needs them (cost scales with want).
    if (out.length < want) {
      const areas = await nearbyAreas(location, 15);
      for (const a of areas) {
        if (out.length >= want) break;
        if (!a || searchedLocations.some((s) => s.toLowerCase() === a.toLowerCase())) continue;
        searchedLocations.push(a);
        try {
          await searchArea(a);
          expandedLocations.push(a); // record every area we actually checked
        } catch (e) { /* skip a bad area, keep going */ }
      }
    }
  } catch (e) {
    // primary-area Google error → surface it (same behaviour as before)
    res.status(502).json({ error: e.message });
    return;
  }

  res.status(200).json({
    results: out.slice(0, want),
    matched: out.length,
    scanned,
    primaryLocation: location,
    primaryCount,
    expandedLocations,
    searchedLocations,
  });
};

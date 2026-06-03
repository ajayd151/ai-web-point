// Live business search via Google Places API (New) Text Search.
// Login-gated (protects your Google credit). Returns businesses in the same
// shape as the old mock data so filters + the mockup generator just work.
// NOTE: Google does not return email addresses — `email` is always null.
const { verify, parseCookie } = require('../lib/auth');

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

function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) { res.status(401).json({ error: 'Please log in first.' }); return; }

  let body = req.body;
  if (typeof body === 'string') body = JSON.parse(body || '{}');
  body = body || {};
  const industry = String(body.industry || '').trim();
  const location = String(body.location || '').trim();
  if (!industry || !location) { res.status(400).json({ error: 'Industry and location are required.' }); return; }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) { res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not set in Vercel yet.' }); return; }

  const services = servicesFor(industry);
  const category = titleCase(industry);
  const out = [];
  let pageToken = null;

  try {
    for (let page = 0; page < 3; page++) {
      const reqBody = { textQuery: `${industry} in ${location}`, pageSize: 20, regionCode: 'GB', languageCode: 'en' };
      if (pageToken) reqBody.pageToken = pageToken;
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify(reqBody),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data.error && data.error.message) || ('Google Places error ' + r.status);
        if (page === 0) { res.status(502).json({ error: 'Google Places: ' + msg }); return; }
        break;
      }
      (data.places || []).forEach((p) => {
        const name = (p.displayName && p.displayName.text) || 'Unknown business';
        const phone = p.nationalPhoneNumber || p.internationalPhoneNumber || null;
        out.push({
          id: p.id,
          name,
          category,
          industry,
          location,
          address: p.formattedAddress || location,
          phones: phone ? [phone] : [],
          email: null, // Google does not expose email
          website: p.websiteUri || null,
          rating: p.rating || 0,
          userRatingsTotal: p.userRatingCount || 0,
          services,
          mapsUrl: p.googleMapsUri || ('https://www.google.com/maps/search/' + encodeURIComponent(name + ' ' + location)),
          brandHue: hueFor(name),
        });
      });
      pageToken = data.nextPageToken || null;
      if (!pageToken) break;
    }
  } catch (e) {
    res.status(500).json({ error: 'Search failed: ' + e.message });
    return;
  }

  res.status(200).json({ results: out, total: out.length });
};

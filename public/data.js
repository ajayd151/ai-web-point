// Client-side business-data generator (no server needed).
// Same (industry, location) always produces the same list, so results are
// stable while you tweak filters. Replace generateBusinesses() with a real
// data source (Google Places etc.) later — keep the returned shape identical.
(function () {
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIRST_NAMES = ['James', 'David', 'Mark', 'Paul', 'Andrew', 'Steve', 'John', 'Mike', 'Chris', 'Tom', 'Sarah', 'Emma', 'Lisa', 'Karen', 'Raj', 'Amir', 'Sanjay', 'Wesley', 'Gary', 'Neil'];
  const SURNAMES = ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Patel', 'Khan', 'Evans', 'Roberts', 'Walker', 'Hughes', 'Green', 'Clarke', 'Hall', 'Wright', 'Turner', 'Hill', 'Cooper', 'Ward', 'Bryant'];
  const NAME_STYLES = [
    (ind, n) => `${n.surname} & Sons ${ind.title}`,
    (ind, n) => `${n.first} ${n.surname} ${ind.title}`,
    (ind, loc) => `${loc} ${ind.title} Co`,
    (ind) => `Elite ${ind.title}`,
    (ind) => `Premier ${ind.title}`,
    (ind, loc) => `${loc} ${ind.title} Services`,
    (ind, n) => `${n.surname}'s ${ind.title}`,
    (ind) => `A1 ${ind.title}`,
    (ind) => `Pro ${ind.title}`,
    (ind, loc) => `${loc} ${ind.singularTitle} Specialists`,
  ];
  const STREETS = ['High Street', 'Station Road', 'Church Lane', 'Victoria Road', 'Mill Lane', 'Kings Road', 'Queens Road', 'Park Avenue', 'New Street', 'Bristol Road', 'Coventry Road', 'Hagley Road', 'Alcester Road', 'Stratford Road', 'Moseley Street'];

  const SERVICE_MAP = {
    plumber: ['Emergency Plumbing', 'Boiler Repairs', 'Bathroom Installs', 'Leak Detection'],
    plumbing: ['Emergency Plumbing', 'Boiler Repairs', 'Bathroom Installs', 'Leak Detection'],
    electrician: ['Rewiring', 'Fuse Board Upgrades', 'EV Chargers', 'Emergency Call-Outs'],
    builder: ['Extensions', 'Loft Conversions', 'Renovations', 'New Builds'],
    roofer: ['Roof Repairs', 'New Roofs', 'Guttering', 'Chimney Work'],
    roofing: ['Roof Repairs', 'New Roofs', 'Guttering', 'Chimney Work'],
    gardener: ['Lawn Care', 'Hedge Trimming', 'Garden Design', 'Maintenance'],
    cleaner: ['Domestic Cleaning', 'End of Tenancy', 'Carpet Cleaning', 'Office Cleaning'],
    cleaning: ['Domestic Cleaning', 'End of Tenancy', 'Carpet Cleaning', 'Office Cleaning'],
    painter: ['Interior Painting', 'Exterior Painting', 'Wallpapering', 'Decorating'],
    mechanic: ['MOT Testing', 'Servicing', 'Diagnostics', 'Repairs'],
    hairdresser: ['Cuts & Styling', 'Colouring', 'Treatments', 'Bridal Hair'],
    dentist: ['Check-Ups', 'Whitening', 'Implants', 'Emergency Dental'],
    locksmith: ['Emergency Entry', 'Lock Changes', 'Key Cutting', 'Security Upgrades'],
  };
  const GENERIC_SERVICES = ['Free Consultation', 'Emergency Call-Outs', 'Repairs & Maintenance', 'Installations'];

  function titleCase(str) {
    return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }

  function industryInfo(industryRaw) {
    const industry = (industryRaw || 'Businesses').trim();
    const lower = industry.toLowerCase();
    const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
    const services = SERVICE_MAP[lower] || SERVICE_MAP[singular] || GENERIC_SERVICES;
    return { raw: industry, title: titleCase(industry), singularTitle: titleCase(singular), services };
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  }

  function generateBusinesses(industryRaw, locationRaw, count) {
    count = count || 45;
    const location = (locationRaw || 'Your Area').trim();
    const ind = industryInfo(industryRaw);
    const rand = mulberry32(hashString(ind.raw + '|' + location));
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

    const businesses = [];
    const usedNames = new Set();

    for (let i = 0; i < count; i++) {
      const n = { first: pick(FIRST_NAMES), surname: pick(SURNAMES) };
      const style = pick(NAME_STYLES);
      const useLoc = /Co|Services|Specialists/.test(style.toString());
      let name = style(ind, useLoc ? location : n);
      let guard = 0;
      while (usedNames.has(name) && guard++ < 5) name = pick(NAME_STYLES)(ind, n);
      usedNames.add(name);

      const hasWebsite = rand() < 0.55;
      const phoneCount = rand() < 0.9 ? (rand() < 0.25 ? 2 : 1) : 0;
      const emailChance = hasWebsite ? 0.55 : 0.22;
      const hasEmail = rand() < emailChance;

      const phones = [];
      for (let p = 0; p < phoneCount; p++) phones.push('0121 ' + int(200, 999) + ' ' + int(1000, 9999));

      const slug = slugify(name) || ('biz' + i);
      const email = hasEmail ? 'info@' + slug + '.co.uk' : null;
      const website = hasWebsite ? 'https://www.' + slug + '.co.uk' : null;
      const rating = Math.round((3 + rand() * 2) * 10) / 10;
      const userRatingsTotal = int(0, 1) ? int(3, 240) : int(0, 12);
      const address = int(1, 280) + ' ' + pick(STREETS) + ', ' + location;

      businesses.push({
        id: slug + '-' + i,
        name, category: ind.title, industry: ind.raw, location, address,
        phones, email, website, rating, userRatingsTotal,
        services: ind.services,
        mapsUrl: 'https://www.google.com/maps/search/' + encodeURIComponent(name + ' ' + location),
        brandHue: Math.floor(rand() * 360),
      });
    }
    return businesses;
  }

  function matchPresence(value, mode) {
    if (mode === 'has') return !!value;
    if (mode === 'none') return !value;
    return true;
  }

  // map a 0–5 rating to a star bucket (5 = excellent, not offered as a filter)
  function ratingBucket(r) {
    if (r < 1.5) return 1;
    if (r < 2.5) return 2;
    if (r < 3.5) return 3;
    if (r < 4.5) return 4;
    return 5;
  }

  function filterBusinesses(list, filters) {
    filters = filters || {};
    const website = filters.website || 'any';
    const phone = filters.phone || 'any';
    const email = filters.email || 'any';
    const maxRatingsCount = Number(filters.maxRatingsCount || 0); // 0 = no limit
    const starBuckets = filters.starBuckets || []; // empty = any rating

    return list.filter((b) => {
      if (!matchPresence(b.website, website)) return false;
      if (!matchPresence(b.phones && b.phones.length, phone)) return false;
      if (!matchPresence(b.email, email)) return false;
      if (maxRatingsCount > 0 && (b.userRatingsTotal || 0) > maxRatingsCount) return false;
      if (starBuckets.length && starBuckets.indexOf(ratingBucket(b.rating || 0)) === -1) return false;
      return true;
    });
  }

  window.BizData = { generateBusinesses, filterBusinesses };
})();

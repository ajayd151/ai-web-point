// Shared filter logic (server-side). Mirrors public/data.js so the search
// endpoint can page through Google's results and return only the matches.

function isUkMobile(phone) {
  let d = String(phone || '').replace(/[\s\-().]/g, '');
  d = d.replace(/^\+44/, '0').replace(/^0044/, '0');
  return /^07[1-57-9]/.test(d); // 071-075/077-079; excludes 070 personal + 076 pagers
}

function ratingBucket(r) {
  if (r < 1.5) return 1;
  if (r < 2.5) return 2;
  if (r < 3.5) return 3;
  if (r < 4.5) return 4;
  return 5;
}

function matchPresence(value, mode) {
  if (mode === 'has') return !!value;
  if (mode === 'none') return !value;
  return true;
}

function matchPhone(phones, mode) {
  phones = phones || [];
  if (mode === 'has') return phones.length > 0;
  if (mode === 'none') return phones.length === 0;
  if (mode === 'mobile') return phones.some(isUkMobile);
  if (mode === 'landline') return phones.some((p) => p && !isUkMobile(p));
  return true;
}

function matchesFilters(b, f) {
  f = f || {};
  if (!matchPresence(b.website, f.website || 'any')) return false;
  if (!matchPhone(b.phones, f.phone || 'any')) return false;
  if (!matchPresence(b.email, f.email || 'any')) return false;
  const n = b.userRatingsTotal || 0;
  if (f.ratingsFrom != null && f.ratingsFrom !== '' && n < Number(f.ratingsFrom)) return false;
  if (f.ratingsTo != null && f.ratingsTo !== '' && n > Number(f.ratingsTo)) return false;
  const sb = f.starBuckets || [];
  if (sb.length && sb.indexOf(ratingBucket(b.rating || 0)) === -1) return false;
  return true;
}

module.exports = { matchesFilters, isUkMobile };

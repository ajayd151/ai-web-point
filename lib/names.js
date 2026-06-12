// Make a business name read naturally for DISPLAY (mockup image, preview page,
// outreach message). KEEP IN SYNC with humaniseBusinessName() in public/app.js,
// including the WORDS list. Never use it for the slug or matching keys (those stay raw).
//
// It splits run-together names by recognising common business words:
//   "jjhomecarwash"      -> "JJ Home Car Wash"
//   "m1plumbing&heating" -> "M1 Plumbing & Heating"
//   "PerformanceCarValeting" -> "Performance Car Valeting"  (camelCase)
// also spaces out & / + "and", Title-Cases an ALL-lowercase name (leaving names
// that already have capitals/acronyms, e.g. MOT / Marks & Spencer), and trims a
// keyword-stuffed OVERLONG name to its first one or two phrases.
//
// SAFE BY DESIGN: a token is only split when the result is "clean" (every chunk
// after an optional short leading brand is a known word). If not confident, the
// name is left unchanged rather than mangled (so "specialist" stays "Specialist",
// never "special ist"). If a real name fails to split, add its words to WORDS.
const WORDS = new Set(('home homes house houses mobile local pro professional expert experts master masters quick fast best premier prime quality reliable friendly family the all total complete perfect super smart easy direct first prestige elite classic modern fresh clean bright shine sparkle gleam ' +
  'car cars auto autos van vans dog dogs pet pets garden gardens window windows door doors roof roofs drive driveway driveways kitchen kitchens bathroom bathrooms floor floors wall walls gutter gutters fence fences gate gates oven ovens carpet carpets blind blinds tyre tyres wheel wheels brick brickwork hair nails beauty ' +
  'wash washing valet valeting clean cleaning care repair repairs fitting fitters installation installations removal removals service services solution solutions maintenance grooming detailing polishing painting decorating plumbing plumber plumbers heating electrical electrician roofing gardening landscaping building builders plastering tiling flooring fencing paving glazing rendering scaffolding catering refurbishment alloy recovery transport haulage skip skips waste rubbish ' +
  'and of').split(' '));

function titleCaseWord(w) {
  if (!w) return w;
  if (w.length <= 3 && !/[aeiou]/.test(w) && /^[a-z]+$/.test(w)) return w.toUpperCase(); // jj -> JJ, jjg -> JJG
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function splitToken(tok) {
  if (tok.length < 6) return tok;
  const out = [];
  let brand = '', i = 0;
  while (i < tok.length) {
    let m = '';
    for (let L = Math.min(15, tok.length - i); L > 2; L--) { const c = tok.slice(i, i + L); if (WORDS.has(c)) { m = c; break; } }
    if (m) { if (brand) { out.push(brand); brand = ''; } out.push(m); i += m.length; } else { brand += tok.charAt(i); i++; }
  }
  if (brand) out.push(brand);
  const nd = [];
  for (let k = 0; k < out.length; k++) { if (!WORDS.has(out[k])) nd.push(k); }
  if (out.length >= 2 && (nd.length === 0 || (nd.length === 1 && nd[0] === 0 && out[0].length <= 10))) return out.join(' ');
  return tok;
}

// Drop words you would not say casually: legal suffixes (Ltd, Limited, Co...) always,
// and "fluff" adjectives (Independent, Professional...) only if 2+ real words remain
// (so "Reliable Roofing" keeps "Reliable", but "Turner's Independent Plumbing & Heating"
// loses "Independent"). KEEP IN SYNC with public/app.js.
const LEGAL = new Set('ltd limited llp plc llc inc incorporated co company cic cio'.split(' '));
const FLUFF = new Set('independent professional certified registered qualified experienced reliable trusted established genuine approved accredited insured dependable'.split(' '));
const CONNECT = new Set(['and', 'of', 'the']);
function norm(w) { return w.toLowerCase().replace(/[^a-z]/g, ''); }
function stripFiller(raw) {
  let toks = raw.split(' ');
  const kept = toks.filter((w) => !LEGAL.has(norm(w)));
  if (kept.some((w) => { const n = norm(w); return n && !CONNECT.has(n); })) toks = kept;
  const kept2 = toks.filter((w) => !FLUFF.has(norm(w)));
  const meaningful = kept2.filter((w) => { const n = norm(w); return n && !CONNECT.has(n); });
  if (meaningful.length >= 2) toks = kept2;
  const s = toks.join(' ').replace(/\s*([&/+])\s*([&/+])\s*/g, ' $1 ').replace(/^\s*[&/+]\s*/, '').replace(/\s*[&/+]\s*$/, '').replace(/\s+\band\b\s*$/i, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function humaniseBusinessName(name) {
  let raw = String(name == null ? '' : name).trim();
  if (!raw) return raw;
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  raw = raw.replace(/\s*&\s*/g, ' & ').replace(/\s*\/\s*/g, ' / ').replace(/\s*\+\s*/g, ' + ').replace(/\s*\band\b\s*/gi, ' and ');
  raw = raw.split(' ').map((t) => ((/^[a-z0-9]+$/.test(t) && t.length >= 6) ? splitToken(t) : t)).join(' ');
  raw = raw.replace(/\s{2,}/g, ' ').trim();
  raw = stripFiller(raw); // drop legal suffixes (Ltd) + fluff (Independent) so it reads casually
  if (!/[A-Z]/.test(raw)) {
    raw = raw.split(' ').map((w) => ((w === '&' || w === '/' || w === '+' || w === 'and' || w === 'of') ? w : titleCaseWord(w))).join(' ');
  }
  if (raw.length <= 34) return raw;
  const segments = raw.split(/\s*(?:,|&|\/|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return raw;
  let out = segments[0];
  if ((out + ' & ' + segments[1]).length <= 40) out += ' & ' + segments[1];
  return out;
}

module.exports = { humaniseBusinessName };

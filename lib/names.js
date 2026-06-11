// Make a business name read naturally for DISPLAY (mockup image, preview page,
// outreach message). Keep this in sync with humaniseBusinessName() in
// public/app.js. Never use it for the slug or for matching keys (those stay raw).
//
// Two passes:
//  1) split run-together names on camelCase boundaries
//     "PerformanceCarValeting" -> "Performance Car Valeting"
//     "JJGHomeCarWash"         -> "JJG Home Car Wash"  (acronyms like MOT stay intact)
//  2) trim a keyword-stuffed OVERLONG name (>34 chars, with , & / + "and"
//     separators) to its first one or two phrases
//     "JJG Home Car Wash, Mobile Valeting & Alloy Wheel Refurbishment"
//        -> "JJG Home Car Wash & Mobile Valeting"
// Short / normal names are returned untouched.
function humaniseBusinessName(name) {
  let raw = String(name == null ? '' : name).trim();
  if (!raw) return raw;
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ').trim();
  if (raw.length <= 34) return raw;
  const segments = raw.split(/\s*(?:,|&|\/|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return raw;
  let out = segments[0];
  if ((out + ' & ' + segments[1]).length <= 40) out += ' & ' + segments[1];
  return out;
}

module.exports = { humaniseBusinessName };

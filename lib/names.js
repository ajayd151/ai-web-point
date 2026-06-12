// Make a business name read naturally for DISPLAY (mockup image, preview page,
// outreach message). KEEP IN SYNC with humaniseBusinessName() in public/app.js.
// Never use it for the slug or matching keys (those stay raw).
//
// Handles, in order:
//  1) camelCase run-together: "PerformanceCarValeting" -> "Performance Car Valeting",
//     "JJGHomeCarWash" -> "JJG Home Car Wash" (acronyms preserved)
//  2) spacing around joining words/symbols: &  /  +  "and"
//  3) split a known trade word off a run-together token:
//     "m1plumbing" -> "m1 plumbing", "ashgardens" -> "ash gardens"
//  4) Title Case an ALL-lowercase name (leaves names that already have capitals/
//     acronyms alone, so MOT / Marks & Spencer are untouched):
//     "m1plumbing & heating" -> "M1 Plumbing & Heating"
//  5) trim a keyword-stuffed OVERLONG name (>34 chars) to its first one or two
//     phrases: "JJG Home Car Wash, Mobile Valeting & Alloy Wheel Refurbishment"
//        -> "JJG Home Car Wash & Mobile Valeting"
const SERVICE_WORDS = ['plumbing', 'plumber', 'plumbers', 'heating', 'electrical', 'electrician', 'electricians', 'electrics', 'roofing', 'roofer', 'roofers', 'cleaning', 'cleaners', 'gardening', 'gardeners', 'gardens', 'garden', 'landscaping', 'landscapes', 'building', 'builder', 'builders', 'joinery', 'plastering', 'plasterer', 'painting', 'painters', 'decorating', 'decorators', 'flooring', 'tiling', 'tilers', 'carpentry', 'carpenter', 'carpenters', 'fencing', 'paving', 'driveways', 'removals', 'valeting', 'detailing', 'grooming', 'services', 'solutions', 'maintenance', 'repairs', 'installations', 'windows', 'glazing', 'locksmith', 'locksmiths', 'bathrooms', 'kitchens', 'tyres', 'autos', 'motors', 'mechanics', 'mechanical', 'catering', 'barbers', 'scaffolding', 'guttering', 'rendering', 'brickwork', 'groundworks', 'handyman', 'properties', 'lettings', 'carpets', 'conservatories'];

function humaniseBusinessName(name) {
  let raw = String(name == null ? '' : name).trim();
  if (!raw) return raw;
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  raw = raw.replace(/\s*&\s*/g, ' & ').replace(/\s*\/\s*/g, ' / ').replace(/\s*\+\s*/g, ' + ').replace(/\s*\band\b\s*/gi, ' and ');
  for (let i = 0; i < SERVICE_WORDS.length; i++) {
    raw = raw.replace(new RegExp('([a-z0-9])(' + SERVICE_WORDS[i] + ')', 'gi'), '$1 $2');
  }
  raw = raw.replace(/\s{2,}/g, ' ').trim();
  if (!/[A-Z]/.test(raw)) {
    raw = raw.split(' ').map((w) => ((w === '&' || w === '/' || w === '+' || w === 'and') ? w : (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))).join(' ');
  }
  if (raw.length <= 34) return raw;
  const segments = raw.split(/\s*(?:,|&|\/|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return raw;
  let out = segments[0];
  if ((out + ' & ' + segments[1]).length <= 40) out += ' & ' + segments[1];
  return out;
}

module.exports = { humaniseBusinessName };

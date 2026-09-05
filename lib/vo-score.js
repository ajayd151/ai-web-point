// Video Outreach scoring engine (spec v4 section 4.5, Appendix A). Pure and deterministic: the
// same inputs and config always give the same result, so the fixtures test can assert every row.
// Band arrays mean "from this value upwards scores this many points": pick the last band whose
// threshold is less than or equal to the value. Disqualified keeps the A to D sub-scores (the
// tracker shows them) but forces the total to 0, tier Disqualified, priority Skip, number 6.
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'docs', 'video-outreach', 'scoring-v1.json');
let _defaultCfg = null;

function loadConfig(p) { return JSON.parse(fs.readFileSync(p || DEFAULT_CONFIG_PATH, 'utf8')); }
function defaultConfig() { if (!_defaultCfg) _defaultCfg = loadConfig(); return _defaultCfg; }

// number or null (blank, undefined and non-numeric all count as "not provided")
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
// true / false / null from Y/N, true/false, 1/0, yes/no
function bool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  return null;
}
function band(bands, value) {
  const v = num(value);
  if (v === null) return 0;
  let pts = 0;
  for (const pair of bands) { if (v >= pair[0]) pts = pair[1]; }
  return pts;
}

// Returns the full result including a per-signal breakdown for the detail screen.
function score(p, config) {
  const cfg = config || defaultConfig();
  const ads = num(p.active_meta_ads);
  if (ads === null) {
    // never checked: unscored, not zero (spec 4.5)
    return { unscored: true, score_a: null, score_b: null, score_c: null, score_d: null, score_total: null, tier: null, priority: null, priority_number: null, breakdown: null, score_version: cfg.version };
  }
  const A = cfg.A_need, B = cfg.B_afford, C = cfg.C_fit, D = cfg.D_access;

  // A. Need for video volume (40)
  const videoAds = num(p.video_ads) || 0;
  const share = ads > 0 ? videoAds / ads : 0;
  const a = {
    active_meta_ads: { value: ads, points: band(A.active_meta_ads, ads) },
    video_share: { value: Math.round(share * 1000) / 1000, points: band(A.video_share, share) },
    new_ads_30d: { value: num(p.new_ads_30d) || 0, points: band(A.new_ads_30d, num(p.new_ads_30d) || 0) },
    other_paid_channels: { value: num(p.other_paid_channels) || 0, points: band(A.other_paid_channels, num(p.other_paid_channels) || 0) },
    skus: { value: num(p.skus) || 0, points: band(A.skus, num(p.skus) || 0) },
  };
  const scoreA = Object.values(a).reduce((s, x) => s + x.points, 0);

  // B. Ability to pay (25). Blank employees scores 0 (band 0).
  const employees = num(p.employees);
  const mv = num(p.monthly_visits), ar = num(p.amazon_reviews_hero), sp = bool(p.shopify_plus);
  let traffic = (mv !== null && mv >= 30000 ? B.monthly_visits_30k : 0) + (ar !== null && ar >= 1000 ? B.amazon_reviews_1k : 0) + (sp === true ? B.shopify_plus : 0);
  traffic = Math.min(B.traffic_cap, traffic);
  const growthSignals = num(p.growth_signals) || 0;
  const growth = Math.min(B.growth_cap, growthSignals * B.growth_per_signal);
  const pays = bool(p.pays_for_creative) === true ? B.pays_for_creative : 0;
  const b = {
    employees: { value: employees, points: band(B.employees, employees === null ? 0 : employees) },
    traffic_proxy: { value: { monthly_visits: mv, amazon_reviews_hero: ar, shopify_plus: sp }, points: traffic },
    growth: { value: growthSignals, points: growth },
    pays_for_creative: { value: bool(p.pays_for_creative) === true, points: pays },
  };
  const scoreB = Object.values(b).reduce((s, x) => s + x.points, 0);

  // C. Opportunity fit (20)
  const gapRaw = num(p.creative_gap);
  const gap = [0, 4, 8].includes(gapRaw) ? gapRaw : 0;
  const vs = String(p.video_sourcing || '');
  const c = {
    creative_gap: { value: gap, points: gap },
    video_sourcing: { value: vs || 'Unknown', points: C.video_sourcing[vs] || 0 },
    trigger_event: { value: bool(p.trigger_event) === true, points: bool(p.trigger_event) === true ? C.trigger_event : 0 },
  };
  const scoreC = Object.values(c).reduce((s, x) => s + x.points, 0);

  // D. Accessibility (15)
  const dmActive = String(p.dm_active_90d || '');
  const d = {
    dm_active_90d: { value: dmActive || 'Not found', points: D.dm_active_90d[dmActive] || 0 },
    second_contact_with_email: { value: bool(p.second_contact_has_email) === true, points: bool(p.second_contact_has_email) === true ? D.second_contact_with_email : 0 },
    no_gatekeeper: { value: bool(p.gatekeeper) === false, points: bool(p.gatekeeper) === false ? D.no_gatekeeper : 0 },
  };
  const scoreD = Object.values(d).reduce((s, x) => s + x.points, 0);

  const disqualified = !!(p.disqualified_reason && String(p.disqualified_reason).trim());
  let total = scoreA + scoreB + scoreC + scoreD;
  let tier, priority;
  if (disqualified) {
    total = 0; tier = 'Disqualified'; priority = 'Skip';
  } else {
    tier = total >= cfg.tiers.A ? 'A' : (total >= cfg.tiers.B ? 'B' : 'Park');
    const ladder = Object.entries(cfg.priority).sort((x, y) => y[1] - x[1]); // highest threshold first
    priority = 'Unlikely';
    for (const [name, threshold] of ladder) { if (total >= threshold) { priority = name; break; } }
  }
  return {
    unscored: false,
    score_a: scoreA, score_b: scoreB, score_c: scoreC, score_d: scoreD,
    score_total: total, tier: tier, priority: priority,
    priority_number: cfg.priority_number[priority],
    breakdown: { A: a, B: b, C: c, D: d, disqualified: disqualified },
    score_version: cfg.version,
  };
}

module.exports = { score, loadConfig, defaultConfig, band, num, bool, DEFAULT_CONFIG_PATH };

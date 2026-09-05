// Appendix D: the scoring engine must reproduce every expected column of the v12 fixtures exactly.
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFixtures } = require('../lib/vo-import');
const { score, loadConfig } = require('../lib/vo-score');

const CSV = path.join(__dirname, '..', 'docs', 'video-outreach', 'video_outreach_fixtures_v12.csv');
const CFG = path.join(__dirname, '..', 'docs', 'video-outreach', 'scoring-v1.json');
const rows = parseFixtures(fs.readFileSync(CSV, 'utf8'));
const cfg = loadConfig(CFG);
const KEYS = ['score_a', 'score_b', 'score_c', 'score_d', 'score_total', 'tier', 'priority', 'priority_number'];

test('fixtures file loads with 74 rows', () => {
  assert.equal(rows.length, 74);
  assert.equal(cfg.version, 'v1-2026-09-05');
});

test('every fixture row scores exactly as the tracker (A, B, C, D, SCORE, Tier, PRIORITY, Priority Number)', () => {
  const failures = [];
  for (const { input, expected } of rows) {
    const r = score(input, cfg);
    for (const k of KEYS) if (r[k] !== expected[k]) failures.push(input.brand + ' ' + k + ': expected ' + JSON.stringify(expected[k]) + ' got ' + JSON.stringify(r[k]));
  }
  assert.deepEqual(failures, [], 'mismatches:\n' + failures.join('\n'));
});

// one readable sub-test per brand, so a failure names the row
for (const { input, expected } of rows) {
  test('row: ' + input.brand + ' -> ' + expected.priority + ' ' + expected.score_total, () => {
    const r = score(input, cfg);
    for (const k of KEYS) assert.equal(r[k], expected[k], k);
    assert.equal(r.score_version, cfg.version);
    assert.ok(r.breakdown && r.breakdown.A && r.breakdown.B && r.breakdown.C && r.breakdown.D, 'breakdown present');
  });
}

test('section 8 acceptance names land in the right bands', () => {
  const by = {}; rows.forEach(({ input }) => { by[input.brand] = score(input, cfg); });
  const p = (b) => by[b].priority;
  assert.equal(p('Arrae'), 'Must target'); assert.equal(p('beam'), 'Must target');
  assert.equal(p('Obvi'), 'Strong'); assert.equal(p('BUBS Naturals'), 'Strong');
  assert.equal(p('Black Girl Vitamins'), 'Possible'); assert.equal(p('Thesis'), 'Possible');
  assert.equal(p('Cowboy Colostrum'), 'Must target'); assert.equal(p('Create'), 'Must target'); assert.equal(p('Rho Nutrition'), 'Must target');
  for (const b of ['Nutrova', 'MuscleMax Nutrition', 'Micro Ingredients', 'Wonderbelly', 'Vitafive', 'Rootine', 'Elm & Rye', 'Sunwink']) {
    assert.equal(by[b].tier, 'Disqualified', b); assert.equal(by[b].priority, 'Skip', b); assert.equal(by[b].score_total, 0, b); assert.equal(by[b].priority_number, 6, b);
  }
  const photo = {}; rows.forEach(({ input }) => { photo[input.brand] = input.product_photo_check; });
  assert.match(photo['Perelel'], /^FAIL/); assert.match(photo['Legion Athletics'], /^FAIL/);
});

test('disqualified rows keep their sub-scores but force the total to 0', () => {
  const w = rows.find((r) => r.input.brand === 'Wonderbelly');
  const r = score(w.input, cfg);
  assert.deepEqual([r.score_a, r.score_b, r.score_c, r.score_d], [28, 13, 10, 8]);
  assert.equal(r.score_total, 0); assert.equal(r.tier, 'Disqualified'); assert.equal(r.priority, 'Skip'); assert.equal(r.priority_number, 6);
});

test('exact band edges from the spec prose', () => {
  const base = { active_meta_ads: 0, video_ads: 0, new_ads_30d: 0, other_paid_channels: 0, skus: 0, growth_signals: 0, pays_for_creative: 'N', creative_gap: 0, video_sourcing: 'Unknown', trigger_event: 'N', dm_active_90d: 'Not found', second_contact_has_email: 'N', gatekeeper: 'Y' };
  const emp = (n) => score(Object.assign({}, base, { employees: n }), cfg).score_b;
  assert.equal(emp(100), 5); assert.equal(emp(50), 8); assert.equal(emp(10), 5); assert.equal(emp(''), 0); assert.equal(emp(101), 0); assert.equal(emp(1), 2); assert.equal(emp(3), 5); assert.equal(emp(11), 8); assert.equal(emp(51), 5);
  const share = (ads, vid) => score(Object.assign({}, base, { active_meta_ads: ads, video_ads: vid }), cfg).breakdown.A.video_share.points;
  assert.equal(share(100, 19), 0); assert.equal(share(100, 20), 4); assert.equal(share(100, 50), 4); assert.equal(share(100, 51), 8); assert.equal(share(0, 0), 0);
  const traffic = score(Object.assign({}, base, { monthly_visits: 30000, amazon_reviews_hero: 1000, shopify_plus: 'Y' }), cfg).breakdown.B.traffic_proxy.points;
  assert.equal(traffic, 7);
  assert.equal(score(Object.assign({}, base, { growth_signals: 3 }), cfg).breakdown.B.growth.points, 5);
});

test('null active_meta_ads is Unscored, not zero', () => {
  const r = score({ active_meta_ads: null, employees: 20 }, cfg);
  assert.equal(r.unscored, true); assert.equal(r.score_total, null); assert.equal(r.tier, null); assert.equal(r.priority_number, null);
});

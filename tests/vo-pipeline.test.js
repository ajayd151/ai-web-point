// Phases 2, 3 and 5 run end to end against the dry-run providers and an in-memory store, so the
// pipeline, the stop rules, the product rule, the ad grouping and the LinkedIn safety limits are all
// checked without a single API key (spec section 8 acceptance, definitions of done for 2, 3, 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/vo-services');
const R = require('../lib/vo-run');
const L = require('../lib/vo-linkedin');
const M = require('../lib/vo-messages');
const { loadConfig, DEFAULT_CONFIG_PATH } = require('../lib/vo-score');

for (const k of ['APOLLO_API_KEY', 'APIFY_TOKEN', 'OPENAI_API_KEY', 'HUNTER_API_KEY', 'SENDGRID_API_KEY']) delete process.env[k];

function memStore() {
  const rows = []; const runs = new Map();
  return {
    rows: rows,
    async getRun(id) { return runs.get(id); },
    async saveRun(run, state, status) { run.state = state; run.status = status; runs.set(run.id, run); },
    async existingDomains() { return new Set(rows.map((r) => r.prospect.domain)); },
    async globalExclusions() { return []; },
    async scoringConfig() { return loadConfig(DEFAULT_CONFIG_PATH); },
    async profile() { return M.DEFAULT_PROFILE; },
    async insertProspect(campaign, runId, prospect, score, messages) { if (rows.some((r) => r.prospect.domain === prospect.domain)) return { inserted: false }; rows.push({ prospect, score, messages, runId }); return { inserted: true, id: rows.length }; },
  };
}
const campaign = { id: 1, name: 'Creatine test', keywords: ['creatine gummies'], countries: ['US'], size_bands: ['1-10', '11-50'], store_platform: 'Shopify only', meta_only: true, min_meta_ads: 10, target_per_run: 20, raw_cap: 400, cost_cap: 10, min_score: 55, role_rule_employees: 20, fetch_emails_for: 'priority_number <= 3', exclude_in_any_campaign: true };

test('groupAds: counts, style bands and the paid-creative pattern', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(S.normaliseAdRow({ pageId: 'p1', pageName: 'Acme', startDate: i < 3 ? new Date().toISOString() : '2026-01-01', isVideo: i < 7, adText: i === 0 ? 'Loved by creators #ad' : 'Buy now', linkUrl: 'https://www.acme-store.com/products/x' }));
  rows.push(S.normaliseAdRow({ pageId: 'p2', pageName: 'Static Co', startDate: '2026-01-01', isVideo: false, adText: 'Sale', linkUrl: 'https://staticco.com' }));
  const g = S.groupAds(rows);
  const acme = g.find((x) => x.page_name === 'Acme');
  assert.equal(acme.active_meta_ads, 10); assert.equal(acme.video_ads, 7); assert.equal(acme.new_ads_30d, 3);
  assert.equal(acme.creative_style, 'Video-led'); assert.equal(acme.pays_for_creative, true); assert.equal(acme.domain, 'acme-store.com');
  assert.equal(g.find((x) => x.page_name === 'Static Co').creative_style, 'Static');
});

test('pickProduct: needs 3 real photos, prefers the hero, falls back to weak pass then FAIL', () => {
  const img = (n, alt) => Array.from({ length: n }, (_, i) => ({ src: 'https://x/cdn/' + (alt ? 'facts' : 'shot') + i + '.jpg', alt: alt || 'Product shot' }));
  const products = [
    { handle: 'facts-heavy', title: 'Creatine Gummies', url: 'u1', images: img(1).concat(img(4, 'Supplement facts panel')) },
    { handle: 'clean', title: 'Collagen Powder', url: 'u2', images: img(5) },
    { handle: 'two', title: 'Omega 3', url: 'u3', images: img(2) },
  ];
  const hero = S.pickProduct(products, 'Creatine Gummies', []);
  assert.equal(hero.url, 'u2', 'hero fails the photo rule, so the next candidate wins'); assert.equal(hero.check, 'Pass (5)');
  assert.equal(S.pickProduct([products[2]], '', []).check, 'Weak pass (2)');
  assert.match(S.pickProduct([products[0]], '', []).check, /^FAIL \(1\)/);
  assert.equal(S.realPhotoCount(products[0]), 1);
});

test('dry-run sourcing for "creatine gummies" finds the tracker brands with counts and no duplicates', async () => {
  const src = await R.sourceCandidates(campaign, { existingDomains: new Set(['trycreate.co']) });
  assert.ok(src.candidates.length >= 1, 'found candidates');
  assert.ok(src.candidates.every((c) => c.domain !== 'trycreate.co'), 'an existing brand is never re-added');
  assert.equal(src.duplicates, 1);
  assert.ok(src.candidates.every((c) => c.active_meta_ads > 0 && c.creative_style));
});

test('full dry run reproduces the tracker: Create is Must target with a product pick, disqualified reasons stick', async () => {
  const store = memStore();
  const run = { id: 7, state: null };
  const wide = Object.assign({}, campaign, { keywords: ['gummies', 'colostrum', 'creatine', 'vitamins', 'protein', 'supplements', 'greens', 'collagen', 'organ', 'probiotic', 'magnesium', 'omega', 'electrolyte', 'sleep', 'hair'], target_per_run: 500, raw_cap: 500, cost_cap: 100 });
  const res = await R.stepRun(store, wide, run, { budgetMs: 60000 });
  assert.equal(res.done, true);
  const by = (b) => store.rows.find((r) => r.prospect.brand.toLowerCase() === b.toLowerCase());
  const create = by('Create'); assert.ok(create, 'Create was sourced');
  assert.equal(create.score.priority, 'Must target');
  assert.equal(create.prospect.suggested_product_name, 'Ads Creatine Monohydrate Gummies');
  assert.match(create.prospect.product_photo_check, /^Pass \(18\)/);
  assert.ok(create.messages && create.messages.message_a.includes(M.URL_PLACEHOLDER));
  assert.ok(!/\u2014/.test(create.messages.message_a));
  const beam = by('beam'); if (beam) assert.equal(beam.score.priority, 'Must target');
  const legion = by('Legion'); if (legion) assert.match(legion.prospect.product_photo_check, /^FAIL/);
  const micro = by('Micro Ingredients'); if (micro) { assert.equal(micro.score.priority, 'Skip'); assert.match(micro.prospect.disqualified_reason, /Too large/); }
  assert.ok(res.state.counts.qualified > 0 && res.state.counts.disqualified > 0);
  assert.equal(res.state.cost, 0, 'dry run costs nothing');
});

test('stop rules: target, raw cap and cost cap each end a run with the right status', async () => {
  const store = memStore();
  const r1 = await R.stepRun(store, Object.assign({}, campaign, { keywords: ['gummies', 'creatine', 'colostrum', 'vitamins'], target_per_run: 1 }), { id: 1, state: null }, { budgetMs: 60000 });
  assert.equal(r1.status, 'Done'); assert.match(r1.state.stop, /target reached/);
  const many = ['gummies', 'colostrum', 'creatine', 'vitamins', 'protein', 'supplements', 'greens', 'collagen', 'organ', 'probiotic', 'magnesium', 'omega', 'electrolyte', 'sleep', 'hair'];
  const r2 = await R.stepRun(memStore(), Object.assign({}, campaign, { keywords: many, raw_cap: 3, target_per_run: 50, min_score: 90 }), { id: 2, state: null }, { budgetMs: 60000 });
  assert.equal(r2.status, 'Stopped (cap)'); assert.match(r2.state.stop, /raw candidate cap/);
  const st = R.newState(); st.cost = 11; st.candidates = [{}, {}]; st.counts.processed = 1;
  assert.equal(R.stopReason(st, campaign).status, 'Stopped (cap)');
});

test('a run is resumable: a tiny time budget returns done=false and the cursor carries on', async () => {
  const store = memStore();
  const c = Object.assign({}, campaign, { keywords: ['gummies', 'creatine', 'colostrum', 'vitamins', 'protein'], target_per_run: 500, raw_cap: 500 });
  const run = { id: 3, state: null };
  const first = await R.stepRun(store, c, run, { budgetMs: -1 });
  assert.equal(first.done, false);
  let guard = 0; let last = first;
  while (!last.done && guard++ < 50) last = await R.stepRun(store, c, run, { budgetMs: 60000 });
  assert.equal(last.done, true);
  assert.equal(last.state.cursor, last.state.candidates.length);
});

test('keyword suggester works without a key, keyword matching is word-based', async () => {
  const k = await S.suggestKeywords('face creams', ['US'], 'English');
  assert.ok(k.keywords.length >= 10 && k.keywords.length <= 20);
  assert.equal(S.keywordMatch('Creatine gummies', ['creatine gummies']), true);
  assert.equal(S.keywordMatch('Collagen powder', ['creatine']), false);
});

test('cost estimate is zero in dry run and breaks down by provider', () => {
  const e = S.estimateRun(campaign);
  assert.equal(e.total, 0); assert.equal(e.dry.apify, true); assert.ok(e.brands > 0);
});

test('LinkedIn dry-run provider: invite, accept, message, reply, restriction, caps', async () => {
  process.env.VO_LINKEDIN_PROVIDER = 'dryrun';
  const P = L.provider(); P._reset();
  const me = await P.lookup('https://www.linkedin.com/in/dan-freed/');
  const inv = await P.sendInvitation(me.provider_id, 'Hey Dan');
  assert.equal(inv.ok, true);
  assert.equal((await P.listPendingInvitations()).length, 1);
  P._simulateAccept(me.provider_id);
  assert.equal((await P.listAccepted())[0].provider_id, me.provider_id);
  const m = await P.sendMessage(me.provider_id, 'Hello');
  assert.equal(m.ok, true);
  P._simulateReply(me.provider_id, 'Sounds good');
  assert.equal((await P.fetchNewMessages(null)).length, 1);
  P._simulateRestriction(true);
  assert.equal((await P.sendInvitation('x', 'y')).restricted, true);
  assert.equal(L.limits({ daily_requests: 99 }).daily_requests, L.HARD_DAILY_REQUESTS);
  assert.equal(L.limits({}).daily_requests, 20);
  assert.equal(L.inSendWindow(new Date('2026-09-05T15:00:00Z')), false, 'Saturday is outside the window');
  assert.equal(L.inSendWindow(new Date('2026-09-07T15:00:00Z')), true, 'Monday 11am New York is inside');
  delete process.env.VO_LINKEDIN_PROVIDER;
});

test('template sets: two service profiles produce differently worded messages (Phase 4)', () => {
  const p = { dm_name: 'Dan Freed', category: 'Creatine gummies', creative_style: 'Mixed', suggested_product_name: 'Gummies' };
  const a = M.generate(p, { service_name: 'Shekipro.com', sender_first: 'AJ' }, null);
  const b = M.generate(p, { service_name: 'Clipworks', sender_first: 'Sam', signoff: 'Cheers' }, null, { message_b: 'Hi {first} / {service_name} makes short product clips. Saw {observation}. / Want a free one for {product}? / {signoff}, / {sender_first}' });
  assert.notEqual(a.message_b, b.message_b);
  assert.ok(b.message_b.includes('Clipworks') && b.message_b.endsWith('Cheers,\n\nSam'));
  assert.equal(M.postCheck(b.message_b, { kind: 'message_b', profile: { sender_first: 'Sam', signoff: 'Cheers' } }).ok, true);
});

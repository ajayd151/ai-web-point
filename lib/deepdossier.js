// DeepDossier core (SitePounce private MVP, Phase 1). Combines several licensed
// data sources into a single verified prospect record. Called only by
// api/deepdossier/search.js, which does the auth/allow-list gating.
//
// Flow: expand job-title synonyms (OpenAI) -> find people+companies (Apollo)
//   -> verify each work email (Hunter) -> UK legitimacy signal (Companies House)
//   -> score + shape rows. Every external call fails soft: a slow/broken source
//   degrades one field, it never sinks the whole run (Vercel timeout safety).
//
// KEYLESS MODE: if APOLLO_API_KEY / HUNTER_API_KEY are absent, we return clearly
// labelled MOCK rows (mock:true) derived from the search inputs, so the full UI
// and flow are testable now and the real keys drop in later with no code change.
//
// ⚠️ BEFORE GOING LIVE: the Apollo request/response mapping and the Hunter verify
// mapping below follow each vendor's documented v1 shape, but were written without
// live keys to test against. Verify field names against current Apollo/Hunter docs
// when you add the keys (isolated in apolloSearch / hunterVerify for easy fixing).
const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
const { fetchRetry } = require('./backoff');
const { companiesHouse } = require('./intel');

const OKEY = () => process.env.OPENAI_API_KEY;
const APOLLO_KEY = () => process.env.APOLLO_API_KEY;
const HUNTER_KEY = () => process.env.HUNTER_API_KEY;

const HARD_CAP = 10;            // Phase 1 hard ceiling on records per run
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // idempotency window: same search within 24h = cached, no re-bill

// Rough per-call cost estimates in GBP (for pricing later; logged per run).
// Overridable via env if the real vendor pricing differs. Target: <£0.30 / 5 records.
const COST = {
  apolloPerRecord: Number(process.env.DD_COST_APOLLO || 0.03),
  hunterPerVerify: Number(process.env.DD_COST_HUNTER || 0.01),
  openaiPerRun: Number(process.env.DD_COST_OPENAI || 0.002),
};

// ---- helpers -------------------------------------------------------------
function clampMax(n) {
  const v = Math.floor(Number(n) || 5);
  return Math.max(1, Math.min(HARD_CAP, v));
}

// Stable, order-independent fingerprint of a search so re-runs hit the cache.
function cacheKey(input) {
  const norm = {
    keywords: String(input.keywords || '').trim().toLowerCase(),
    country: String(input.country || 'United Kingdom').trim().toLowerCase(),
    sizeBand: String(input.sizeBand || '').trim().toLowerCase(),
    titles: (input.titles || []).map((t) => String(t).trim().toLowerCase()).sort(),
    seniority: (input.seniority || []).map((s) => String(s).trim().toLowerCase()).sort(),
    max: clampMax(input.max),
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 24);
}

async function readCache(key) {
  try {
    const path = 'deepdossier/cache/' + key + '.json';
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) return null;
    const data = await (await fetch(b.url + '?t=' + Date.now())).json();
    if (!data || !data.generatedAt) return null;
    if (Date.now() - new Date(data.generatedAt).getTime() > CACHE_TTL_MS) return null; // expired
    return data;
  } catch (e) { return null; }
}

async function writeCache(key, payload) {
  try {
    await put('deepdossier/cache/' + key + '.json', JSON.stringify(payload), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
  } catch (e) { /* best effort */ }
}

// ---- 1. title synonym expansion (OpenAI, small + fast) -------------------
// Broadens the operator's titles so Apollo matches more variants. Fails soft to
// the original titles if OpenAI is absent or slow.
async function expandTitles(titles) {
  const base = (titles || []).map((t) => String(t).trim()).filter(Boolean);
  if (!base.length || !OKEY()) return base;
  const prompt = `Expand this list of job titles into common equivalent/adjacent titles used on LinkedIn and in company org charts, for people-search matching. Keep them realistic and role-equivalent (same seniority and function), do not drift to unrelated roles. Input titles: ${base.join('; ')}.\nReturn JSON: {"titles":["..."]} with at most 18 titles total, including the originals. Never use em dashes.`;
  try {
    const r = await fetchRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OKEY() },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You output only JSON.' }, { role: 'user', content: prompt }] }),
    }, { retries: 1, timeoutMs: 8000 });
    const d = await r.json().catch(() => ({}));
    const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    const p = JSON.parse(txt || '{}');
    const out = Array.isArray(p.titles) ? p.titles.map((x) => String(x).trim()).filter(Boolean) : [];
    const merged = Array.from(new Set(base.concat(out).map((s) => s.trim()).filter(Boolean)));
    return merged.slice(0, 18);
  } catch (e) { return base; }
}

// ---- 2. Apollo people + companies ---------------------------------------
// Returns an array of raw people. Keyless -> []. Mapping isolated here so it is
// easy to correct against live Apollo docs when the key is added.
async function apolloSearch(input, expandedTitles) {
  if (!APOLLO_KEY()) return null; // signals keyless -> caller uses mock
  const perPage = clampMax(input.max);
  const body = {
    q_keywords: input.keywords || '',
    person_titles: expandedTitles,
    person_locations: input.country ? [input.country] : ['United Kingdom'],
    organization_num_employees_ranges: input.sizeBand ? [input.sizeBand] : undefined,
    page: 1,
    per_page: perPage,
  };
  try {
    const r = await fetchRetry('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_KEY() },
      body: JSON.stringify(body),
    }, { retries: 3, timeoutMs: 15000 });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    const people = d.people || d.contacts || [];
    return people.slice(0, perPage).map((p) => {
      const org = p.organization || p.account || {};
      return {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || '',
        title: p.title || '',
        company: org.name || p.organization_name || '',
        companyDomain: org.primary_domain || org.website_url || '',
        linkedin: p.linkedin_url || '',
        email: p.email || '',
        location: [p.city, p.state, p.country].filter(Boolean).join(', ') || (org.country || ''),
        tenureMonths: p.time_in_current_role_months || null,
        raw: true,
      };
    });
  } catch (e) { return []; }
}

// ---- 3. Hunter email verify ---------------------------------------------
// Verifies one email; returns { status, score } or a soft "unverified".
async function hunterVerify(email) {
  const unknown = { verified: false, status: 'unverified', score: null };
  if (!email || !HUNTER_KEY()) return unknown;
  try {
    const r = await fetchRetry('https://api.hunter.io/v2/email-verifier?email=' + encodeURIComponent(email) + '&api_key=' + encodeURIComponent(HUNTER_KEY()), {}, { retries: 3, timeoutMs: 10000 });
    if (!r.ok) return unknown;
    const d = await r.json().catch(() => ({}));
    const data = (d && d.data) || {};
    const status = data.status || data.result || 'unknown';
    return { verified: status === 'valid' || status === 'deliverable', status, score: (data.score != null ? data.score : null) };
  } catch (e) { return unknown; }
}

// ---- mock provider (keyless mode) ---------------------------------------
// Deterministic, clearly-labelled sample rows so the flow is testable pre-keys.
const FIRST = ['James', 'Sarah', 'David', 'Emma', 'Michael', 'Laura', 'Andrew', 'Rachel', 'Paul', 'Claire'];
const LAST = ['Thompson', 'Patel', 'Walker', 'Hughes', 'Mercer', 'Osborne', 'Clarke', 'Fenwick', 'Doyle', 'Ashworth'];
const COMPANIES = ['Northgate Claims', 'Meridian Loss Group', 'Cardinal Adjusters', 'Sentinel Risk Partners', 'Halcyon Claims Services', 'Argent Loss Solutions', 'Kingsway Adjusting', 'Beacon Complex Claims', 'Radcliffe & Vane', 'Thornbury Risk'];

function mockRows(input, expandedTitles, n) {
  const titles = expandedTitles.length ? expandedTitles : ['Director'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 3 + 1) % LAST.length];
    const company = COMPANIES[i % COMPANIES.length];
    const domain = company.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.co.uk';
    rows.push({
      name: first + ' ' + last,
      title: titles[i % titles.length],
      company,
      companyDomain: domain,
      linkedin: 'https://www.linkedin.com/in/' + first.toLowerCase() + '-' + last.toLowerCase() + '-' + (10 + i),
      email: first.toLowerCase() + '.' + last.toLowerCase() + '@' + domain,
      location: input.country || 'United Kingdom',
      tenureMonths: 12 + ((i * 7) % 60),
      raw: false,
    });
  }
  return rows;
}

// ---- confidence score ----------------------------------------------------
// 0-100 from the signals we actually gathered. Transparent, not magic.
function confidence(row, verify, ch) {
  let s = 40;
  if (row.linkedin) s += 15;
  if (row.email) s += 10;
  if (verify.verified) s += 20; else if (verify.status === 'unverified') s += 0; else s += 5;
  if (typeof verify.score === 'number') s += Math.round((verify.score / 100) * 5);
  if (ch && ch.found) s += 10;
  if (row.tenureMonths) s += 5;
  return Math.max(0, Math.min(100, s));
}

function tenureLabel(months) {
  if (!months || months < 1) return '';
  if (months < 12) return months + ' mo';
  const y = Math.floor(months / 12), m = months % 12;
  return m ? y + 'y ' + m + 'm' : y + 'y';
}

// ---- orchestration -------------------------------------------------------
// Returns { rows, meta }. `meta` carries mock flag, source availability, cost,
// timings and cache status for the run log + UI banner.
async function runDeepDossier(rawInput) {
  const started = Date.now();
  const input = {
    keywords: String(rawInput.keywords || '').trim(),
    country: String(rawInput.country || 'United Kingdom').trim(),
    sizeBand: String(rawInput.sizeBand || '').trim(),
    titles: Array.isArray(rawInput.titles) ? rawInput.titles : String(rawInput.titles || '').split(',').map((s) => s.trim()).filter(Boolean),
    seniority: Array.isArray(rawInput.seniority) ? rawInput.seniority : [],
    max: clampMax(rawInput.max),
  };

  const key = cacheKey(input);
  const cached = await readCache(key);
  if (cached) {
    return { rows: cached.rows, meta: Object.assign({}, cached.meta, { cached: true, cacheKey: key, msTotal: Date.now() - started, costGbp: 0 }) };
  }

  const expandedTitles = await expandTitles(input.titles);

  // Fetch people (Apollo or mock). apolloSearch returns null only when keyless.
  const apollo = await apolloSearch(input, expandedTitles);
  const mock = apollo === null;
  const people = (mock ? mockRows(input, expandedTitles, input.max) : apollo).slice(0, input.max);

  // Enrich each person in parallel but independently: a slow verify/CH lookup on
  // one contact never blocks or fails the others (graceful degradation).
  const rows = await Promise.all(people.map(async (p) => {
    const [verify, ch] = await Promise.all([
      hunterVerify(p.email),
      p.company ? companiesHouse(p.company).catch(() => ({ found: false })) : Promise.resolve({ found: false }),
    ]);
    return {
      name: p.name,
      title: p.title,
      company: p.company,
      linkedin: p.linkedin,
      email: p.email,
      emailVerified: verify.verified ? 'Yes' : (verify.status === 'unverified' ? 'Unknown' : 'No'),
      confidence: confidence(p, verify, ch),
      location: p.location,
      tenure: tenureLabel(p.tenureMonths),
      sources: [mock ? 'Sample' : 'Apollo', HUNTER_KEY() ? 'Hunter' : null, (ch && ch.found) ? 'Companies House' : null].filter(Boolean).join(', '),
    };
  }));

  rows.sort((a, b) => b.confidence - a.confidence);

  const costGbp = mock ? 0 : Number((
    rows.length * COST.apolloPerRecord +
    (HUNTER_KEY() ? rows.length * COST.hunterPerVerify : 0) +
    (OKEY() ? COST.openaiPerRun : 0)
  ).toFixed(4));

  const meta = {
    mock,
    cached: false,
    cacheKey: key,
    count: rows.length,
    requested: input.max,
    expandedTitleCount: expandedTitles.length,
    sourcesLive: { apollo: !!APOLLO_KEY(), hunter: !!HUNTER_KEY(), companiesHouse: !!process.env.COMPANIES_HOUSE_API_KEY, openai: !!OKEY() },
    costGbp,
    msTotal: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };

  await writeCache(key, { rows, meta, generatedAt: meta.generatedAt });
  return { rows, meta };
}

module.exports = { runDeepDossier, clampMax, HARD_CAP };

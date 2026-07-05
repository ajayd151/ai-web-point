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
const { companiesHouseDeep, companyNews } = require('./enrich');

const OKEY = () => process.env.OPENAI_API_KEY;
const APOLLO_KEY = () => process.env.APOLLO_API_KEY;
const HUNTER_KEY = () => process.env.HUNTER_API_KEY;

const HARD_CAP = 25;            // ceiling on records per run (listbox offers 5..25 in 5s)
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
    company: String(input.company || '').trim().toLowerCase(),
    name: String(input.name || '').trim().toLowerCase(),
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
  // Company and person-name are optional narrowers; Apollo's q_keywords covers
  // names, titles and employers, so we fold them in alongside the sector keywords.
  const q = [input.keywords, input.company, input.name].filter(Boolean).join(' ').trim();
  const body = {
    q_keywords: q,
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
      // Apollo returns a phone_numbers[] of { raw_number, type } plus a top-level
      // mobile_phone/direct_phone on richer plans. Pull the best of each kind.
      const phones = Array.isArray(p.phone_numbers) ? p.phone_numbers : [];
      const byType = (re) => (phones.find((x) => re.test(String(x.type || ''))) || {}).raw_number || '';
      return {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || '',
        title: p.title || '',
        company: org.name || p.organization_name || '',
        companyDomain: org.primary_domain || org.website_url || '',
        linkedin: p.linkedin_url || '',
        email: p.email || '',
        emailStatus: p.email_status || '', // Apollo's own status (baseline, before Hunter re-checks)
        altEmail: p.personal_emails && p.personal_emails[0] ? p.personal_emails[0] : (p.secondary_email || ''),
        mobile: p.mobile_phone || byType(/mobile|cell/i) || '',
        directDial: p.direct_phone || byType(/direct|work/i) || '',
        landline: org.phone || byType(/hq|office|main/i) || '',
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
const CITIES = ['London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Glasgow', 'Nottingham', 'Sheffield', 'Liverpool', 'Cardiff'];
const STD = ['020', '0161', '0121', '0113', '0117', '0141', '0115', '0114', '0151', '029']; // dialling codes matched to CITIES
const SIGNALS = [
  'Hiring: 3 claims handler roles posted in the last 14 days',
  'Featured in Insurance Times, mentioned expanding major-loss team',
  'Opened a new regional office in the last quarter',
  'Recently changed claims-management software (tech switch signal)',
  'Won a large panel contract announced on LinkedIn last month',
  'Director posted about capacity/backlog on LinkedIn this week',
  'Company page follower growth up sharply (hiring push)',
  'Filed expansion at Companies House (increased share capital)',
];

// Deterministic 6-digit tail so mock numbers look real but never collide with reality.
function mockDigits(seed, len) {
  let s = '';
  for (let k = 0; k < len; k++) s += String((seed * (k + 3) + 7) % 10);
  return s;
}

function mockRows(input, expandedTitles, n) {
  const titles = expandedTitles.length ? expandedTitles : ['Director'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 3 + 1) % LAST.length];
    const company = COMPANIES[i % COMPANIES.length];
    const domain = company.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.co.uk';
    const cityIdx = (i * 3) % CITIES.length;
    const tail = mockDigits(i + 1, 6);
    const incYear = 1998 + ((i * 5) % 25);
    rows.push({
      name: first + ' ' + last,
      title: titles[i % titles.length],
      company,
      companyDomain: domain,
      linkedin: 'https://www.linkedin.com/in/' + first.toLowerCase() + '-' + last.toLowerCase() + '-' + (10 + i),
      email: first.toLowerCase() + '.' + last.toLowerCase() + '@' + domain,
      emailStatus: 'verified',
      altEmail: first.toLowerCase() + last.toLowerCase() + i + '@gmail.com',
      mobile: '+44 7' + mockDigits(i + 2, 3) + ' ' + tail,
      directDial: STD[cityIdx] + ' ' + mockDigits(i + 4, 3) + ' ' + mockDigits(i + 5, 4),
      landline: STD[cityIdx] + ' ' + mockDigits(i + 1, 3) + ' ' + mockDigits(i + 6, 4),
      buyingSignal: SIGNALS[i % SIGNALS.length],
      location: CITIES[cityIdx] + ', ' + (input.country || 'United Kingdom'),
      tenureMonths: 12 + ((i * 7) % 60),
      // Every 5th sample record is an "adjacent" sector match to show an Amber score.
      industryTag: (i % 5 === 4) ? 'adjacent' : 'match',
      summary: first + ' ' + last + ' is ' + (titles[i % titles.length]) + ' at ' + company + ', a ' + CITIES[cityIdx] + '-based firm operating in the insurance claims and loss-adjusting space. As a senior decision-maker at an owner-run business, they are the direct point of contact for new supplier relationships.',
      // Synthetic Companies House + news so the sample dossier/PDF is complete.
      companiesHouse: {
        found: true,
        name: company + ' Ltd',
        number: '0' + mockDigits(i + 3, 7),
        status: 'active',
        incorporated: incYear + '-0' + ((i % 9) + 1) + '-1' + (i % 9),
        type: 'ltd',
        sic: ['66220 Activities of insurance agents and brokers'],
        address: CITIES[cityIdx] + ', ' + (input.country || 'United Kingdom'),
        accountsNextDue: (incYear + 27) + '-09-30',
        accountsLastMadeUpTo: (incYear + 26) + '-12-31',
        directors: [
          { name: last + ', ' + first, role: 'director', appointed: incYear + '-01-01' },
          { name: LAST[(i * 5 + 2) % LAST.length] + ', ' + FIRST[(i * 2 + 4) % FIRST.length], role: 'director', appointed: (incYear + 3) + '-06-01' },
        ],
        pscs: [
          { name: first + ' ' + last, kind: 'individual-person-with-significant-control', control: ['owns 75%+ of shares', '75%+ voting rights'] },
        ],
      },
      news: [
        { title: company + ' expands major-loss team amid rising claims volumes', url: 'https://example-insurancetimes.co.uk/' + domain.replace(/\..*$/, ''), source: 'insurancetimes.co.uk', date: '2026-0' + ((i % 6) + 1) + '-1' + (i % 9) },
        { title: 'Interview: ' + first + ' ' + last + ' on the future of claims handling', url: 'https://example-postonline.co.uk/' + domain.replace(/\..*$/, ''), source: 'postonline.co.uk', date: '2026-0' + ((i % 5) + 1) + '-2' + (i % 8) },
      ],
      raw: false,
    });
  }
  // If the operator searched by a specific company or person, reflect it in the
  // top sample row so the (sample) result visibly matches what they typed.
  if (rows.length && (input.company || input.name)) {
    const r0 = rows[0];
    if (input.name) r0.name = input.name;
    if (input.company) {
      r0.company = input.company;
      const dom = input.company.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.co.uk';
      const nm = String(r0.name || 'contact').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
      r0.email = nm + '@' + dom;
      if (r0.companiesHouse) r0.companiesHouse.name = input.company.toUpperCase() + ' LIMITED';
    }
  }
  return rows;
}

// ---- confidence score ----------------------------------------------------
// 0-100 from the signals we actually gathered. Transparent, not magic.
function confidence(row, verify, ch) {
  let s = 30;
  if (row.linkedin) s += 8;
  if (row.email) s += 8;
  if (verify.verified) s += 18;                 // Hunter re-checked and it passed
  else if (verify.status !== 'unverified') s += 4;
  else if (/valid|verified|deliverable/i.test(row.emailStatus || '')) s += 12; // Apollo baseline (no Hunter)
  if (typeof verify.score === 'number') s += Math.round((verify.score / 100) * 5);
  if (row.mobile) s += 12;                 // reachable by phone = much stronger lead
  if (row.directDial || row.landline) s += 6;
  if (ch && ch.found) s += 8;
  if (row.buyingSignal) s += 5;
  if (row.tenureMonths) s += 3;
  return Math.max(0, Math.min(100, s));
}

function tenureLabel(months) {
  if (!months || months < 1) return '';
  if (months < 12) return months + ' mo';
  const y = Math.floor(months / 12), m = months % 12;
  return m ? y + 'y ' + m + 'm' : y + 'y';
}

// ---- search-fit score (Green / Amber / Red) ------------------------------
// The real value of DeepDossier is reviewing each record against what was asked
// for, and re-running the search if too many are weak, so the final set strongly
// matches the brief. This scores a record on 4 criteria and bands it. We aim to
// leave NO red records in a delivered set (they get re-run out).
function fitScore(row, input) {
  const reasons = [];
  let pts = 0;
  // 1. Seniority / title matches the brief
  const titles = (input.titles || []).map((s) => String(s).toLowerCase());
  const t = String(row.title || '').toLowerCase();
  const titleOk = /(managing director|\bmd\b|head of|director|chief|\bceo\b|owner|partner|founder)/.test(t)
    || titles.some((x) => x && t.indexOf(String(x).split(' ')[0]) !== -1);
  if (titleOk) { pts += 1; reasons.push('Seniority matches the brief'); } else { reasons.push('Title is off-brief'); }
  // 2. Company is in (or adjacent to) the target sector
  const kw = String(input.keywords || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
  const hay = (String(row.company || '') + ' ' + String(row.industryTag || '')).toLowerCase();
  const pure = row.industryTag === 'match' || (kw.length > 0 && kw.some((k) => hay.indexOf(k) !== -1));
  const adjacent = row.industryTag === 'adjacent';
  if (pure) { pts += 1; reasons.push('In the target sector'); }
  else if (adjacent) { reasons.push('Adjacent to the target sector'); }
  else { pts += (kw.length ? 0 : 1); reasons.push(kw.length ? 'Sector match unconfirmed' : 'No sector keyword set'); }
  // 3. Reachable by personal email
  if (row.email) { pts += 1; reasons.push('Personal email on file'); } else { reasons.push('No personal email'); }
  // 4. Reachable by mobile
  const hasMobile = /(\+?44\s?7|\b07)\d/.test(String(row.mobile || ''));
  if (hasMobile) { pts += 1; reasons.push('Mobile on file'); } else { reasons.push('No mobile'); }

  const band = pts >= 4 ? 'green' : (pts >= 3 ? 'amber' : 'red');
  const label = band === 'green' ? 'Strong match' : (band === 'amber' ? 'Partial match' : 'Weak match');
  return { band: band, label: label, score: pts, max: 4, reasons: reasons };
}

// ---- orchestration -------------------------------------------------------
// Returns { rows, meta }. `meta` carries mock flag, source availability, cost,
// timings and cache status for the run log + UI banner.
async function runDeepDossier(rawInput) {
  const started = Date.now();
  const input = {
    keywords: String(rawInput.keywords || '').trim(),
    company: String(rawInput.company || '').trim(),
    name: String(rawInput.name || '').trim(),
    country: String(rawInput.country || 'United Kingdom').trim(),
    sizeBand: String(rawInput.sizeBand || '').trim(),
    titles: Array.isArray(rawInput.titles) ? rawInput.titles : String(rawInput.titles || '').split(',').map((s) => s.trim()).filter(Boolean),
    seniority: Array.isArray(rawInput.seniority) ? rawInput.seniority : [],
    max: clampMax(rawInput.max),
    deep: rawInput.deep !== false, // paid add-on: Companies House + news + fit score (on by default)
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
  const deep = input.deep; // paid add-on gates the Companies House + news + fit-score layer
  const rows = await Promise.all(people.map(async (p) => {
    const verify = await hunterVerify(p.email);
    // Deeper "beyond Apollo" layer only runs on the paid tier. In mock mode use the
    // synthetic CH/news baked into the row; for real data hit the APIs live. Each
    // source fails soft so one slow lookup never sinks the record.
    let ch = { found: false }, news = [];
    if (deep) {
      const pair = await Promise.all([
        (!mock && p.company) ? companiesHouseDeep(p.company).catch(() => ({ found: false })) : Promise.resolve(p.companiesHouse || { found: false }),
        (!mock && p.company) ? companyNews(p.company).catch(() => []) : Promise.resolve(p.news || []),
      ]);
      ch = pair[0]; news = pair[1];
    }
    const match = deep ? fitScore({ title: p.title, company: p.company, email: p.email, mobile: p.mobile, industryTag: p.industryTag }, input) : null;
    // Email verification: Apollo's status is the baseline; if Hunter is connected
    // it independently re-checks the mailbox (MX/SMTP) and that result wins.
    const apolloVerified = /valid|verified|deliverable/i.test(p.emailStatus || '');
    let emailVerified = 'Unknown', emailCheck = '';
    if (HUNTER_KEY() && verify.status !== 'unverified') {
      emailVerified = verify.verified ? 'Yes' : 'No';
      emailCheck = 'Hunter MX/SMTP' + (typeof verify.score === 'number' ? ' (' + verify.score + ')' : '');
    } else if (apolloVerified) {
      emailVerified = 'Yes';
      emailCheck = 'Apollo status';
    } else if (p.email) {
      emailVerified = 'Unknown';
    } else {
      emailVerified = 'No';
    }
    return {
      name: p.name,
      title: p.title,
      company: p.company,
      mobile: p.mobile || '',
      directDial: p.directDial || '',
      landline: p.landline || '',
      email: p.email,
      emailVerified: emailVerified,
      emailCheck: emailCheck, // how it was verified: 'Hunter MX/SMTP (score)' or 'Apollo status'
      altEmail: p.altEmail || '',
      linkedin: p.linkedin,
      buyingSignal: p.buyingSignal || '',
      summary: p.summary || '',
      confidence: confidence(p, verify, ch),
      location: p.location,
      tenure: tenureLabel(p.tenureMonths),
      companiesHouse: ch || { found: false },
      news: Array.isArray(news) ? news : [],
      match: match,
      sources: [mock ? 'Sample' : 'Apollo', HUNTER_KEY() ? 'Hunter' : null, (ch && ch.found) ? 'Companies House' : null, (news && news.length) ? 'News' : null].filter(Boolean).join(', '),
    };
  }));

  // Sort strongest matches first, then by confidence.
  const bandRank = { green: 0, amber: 1, red: 2 };
  rows.sort((a, b) => {
    const ra = a.match ? bandRank[a.match.band] : 1, rb = b.match ? bandRank[b.match.band] : 1;
    return ra !== rb ? ra - rb : b.confidence - a.confidence;
  });
  const matchBands = { green: 0, amber: 0, red: 0 };
  rows.forEach((r) => { if (r.match) matchBands[r.match.band] += 1; });

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
    deep: input.deep,
    matchBands: matchBands,
    expandedTitleCount: expandedTitles.length,
    sourcesLive: { apollo: !!APOLLO_KEY(), hunter: !!HUNTER_KEY(), companiesHouse: !!process.env.COMPANIES_HOUSE_API_KEY, news: true, openai: !!OKEY() },
    costGbp,
    msTotal: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };

  await writeCache(key, { rows, meta, generatedAt: meta.generatedAt });
  return { rows, meta };
}

module.exports = { runDeepDossier, clampMax, HARD_CAP };

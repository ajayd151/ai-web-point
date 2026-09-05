// Video Outreach CSV import (spec Appendix D). A dependency-free RFC 4180 style parser (quoted
// fields, doubled quotes, commas inside quotes, CRLF) and the mapping from the v12 tracker's
// column headings to prospect fields. The expected score columns are returned separately so the
// fixtures test can assert them and the importer can ignore them.

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : r[i]).trim(); }); return o; });
}

// www.Foo.com/path -> foo.com
function normaliseDomain(website) {
  let d = String(website || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].split('#')[0];
  return d;
}

// "https://x.com/products/mb-1-max" -> "Mb 1 Max"; the user can edit it in the app
function productNameFromUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  try {
    const parts = new URL(u.startsWith('http') ? u : 'https://' + u).pathname.split('/').filter(Boolean);
    let last = parts[parts.length - 1] || '';
    last = last.replace(/\.(html?|php)$/i, '').replace(/[-_]+/g, ' ').trim();
    if (!last || /^(products?|collections?|s)$/i.test(last)) return '';
    return last.replace(/\b\w/g, (m) => m.toUpperCase());
  } catch (e) { return ''; }
}

const yn = (v) => { const s = String(v || '').trim().toLowerCase(); return s === 'y' || s === 'yes' ? true : (s === 'n' || s === 'no' ? false : null); };
const int = (v) => { const s = String(v == null ? '' : v).trim(); if (s === '') return null; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : null; };
const txt = (v) => String(v == null ? '' : v).trim();

// One tracker row -> { input: prospect fields, expected: the tracker's own scores }
function mapRow(r) {
  const website = txt(r['Website']);
  const dmName = txt(r['DM name']);
  const input = {
    brand: txt(r['Brand']),
    website: website,
    domain: normaliseDomain(website),
    country: txt(r['Country']) || 'US',
    category: txt(r['Category']),
    source: 'import',
    active_meta_ads: int(r['Active Meta ads']),
    video_ads: int(r['Video ads']),
    new_ads_30d: int(r['New ads last 30d']),
    other_paid_channels: int(r['Other paid channels']),
    skus: int(r['SKUs']),
    employees: int(r['Employees']),
    monthly_visits: int(r['Monthly visits']),
    amazon_reviews_hero: int(r['Amazon reviews (hero)']),
    shopify_plus: yn(r['Shopify Plus']),
    growth_signals: int(r['Growth signals']),
    pays_for_creative: yn(r['Pays for creative']),
    creative_gap: int(r['Creative gap']),
    video_sourcing: txt(r['Video sourcing']) || 'Unknown',
    trigger_event: yn(r['Trigger event']),
    dm_name: (dmName && !/^not found$/i.test(dmName)) ? dmName : '',
    dm_title: txt(r['DM title']),
    dm_linkedin: txt(r['DM LinkedIn']),
    dm_active_90d: txt(r['DM active 90d']) || 'Not found',
    second_contact_has_email: yn(r['2nd contact + email']),
    gatekeeper: yn(r['Gatekeeper']),
    disqualified_reason: txt(r['Disqualified reason']),
    creative_style: txt(r['Creative style']) || null,
    suggested_product_url: txt(r['Suggested product (deep link)']),
    suggested_product_name: productNameFromUrl(r['Suggested product (deep link)']),
    product_photo_check: txt(r['Product photo check']) || 'Unverified', // stored verbatim (Discovery 8.10)
  };
  const expected = {
    score_a: int(r['A Need /40']), score_b: int(r['B Afford /25']), score_c: int(r['C Fit /20']), score_d: int(r['D Access /15']),
    score_total: int(r['SCORE']), tier: txt(r['Tier']), priority: txt(r['PRIORITY']), priority_number: int(r['Priority Number']),
  };
  return { input: input, expected: expected };
}

function parseFixtures(text) { return parseCsv(text).map(mapRow); }

module.exports = { parseCsv, mapRow, parseFixtures, normaliseDomain, productNameFromUrl };

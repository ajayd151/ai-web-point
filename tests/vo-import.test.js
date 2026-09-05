// The dependency-free CSV parser and the tracker column mapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCsv, parseFixtures, normaliseDomain, productNameFromUrl } = require('../lib/vo-import');

const CSV = path.join(__dirname, '..', 'docs', 'video-outreach', 'video_outreach_fixtures_v12.csv');
const text = fs.readFileSync(CSV, 'utf8');

test('parses quoted fields with commas and doubled quotes', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n2,,\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: '', c: '' }]);
});

test('fixtures: 74 rows, quoted commas preserved, blanks become null', () => {
  const rows = parseFixtures(text);
  assert.equal(rows.length, 74);
  const by = {}; rows.forEach((r) => { by[r.input.brand] = r.input; });
  assert.equal(by['Obvi'].product_photo_check, 'Pass (3, same angle)');
  assert.equal(by['Nello'].category, 'Calm drink (ashwagandha, magnesium)');
  assert.match(by['Wonderbelly'].disqualified_reason, /P&G/);
  assert.equal(by['Thesis'].monthly_visits, null);
  assert.equal(by['Thesis'].shopify_plus, null);
  assert.equal(by['Thesis'].employees, 40);
  assert.equal(by['Creatine Gummy'].dm_name, '', '"Not found" DM name is stored as blank');
  assert.equal(by['Creatine Gummy'].dm_active_90d, 'Not found');
  assert.equal(by['Cowboy Colostrum'].second_contact_has_email, true);
  assert.equal(by['Cowboy Colostrum'].gatekeeper, false);
  assert.equal(by['beam'].domain, 'shopbeam.com');
});

test('domain normalisation and product name from URL', () => {
  assert.equal(normaliseDomain('https://www.Codeage.com/products/x?y=1'), 'codeage.com');
  assert.equal(normaliseDomain('shopbeam.com'), 'shopbeam.com');
  assert.equal(productNameFromUrl('https://arrae.com/products/mb-1-max'), 'Mb 1 Max');
  assert.equal(productNameFromUrl('https://legionathletics.com/products/supplements/whey-protein-powder/'), 'Whey Protein Powder');
  assert.equal(productNameFromUrl(''), '');
});

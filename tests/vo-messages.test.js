// Appendix C5 post-checks on the generated messages for the first 20 fixture rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFixtures } = require('../lib/vo-import');
const M = require('../lib/vo-messages');

const CSV = path.join(__dirname, '..', 'docs', 'video-outreach', 'video_outreach_fixtures_v12.csv');
const rows = parseFixtures(fs.readFileSync(CSV, 'utf8')).slice(0, 20);
const EM_DASH = /\u2014/; // U+2014 as an escape, the character itself never appears in source

test('first name rules', () => {
  assert.equal(M.firstName('Dan Freed'), 'Dan');
  assert.equal(M.firstName('Michael Rutigliano Jr'), 'Michael');
  assert.equal(M.firstName(''), '[Name]');
  assert.equal(M.firstName('Not found'), '[Name]');
  assert.equal(M.firstName('Verify founder'), '[Name]');
});

for (const { input } of rows) {
  test('messages pass the C5 post-checks: ' + input.brand, () => {
    const out = M.generate(input, M.DEFAULT_PROFILE, null); // throws if any internal check fails
    for (const k of ['connection_note', 'message_a', 'message_b', 'followup_1', 'followup_2']) {
      assert.ok(!EM_DASH.test(out[k]), k + ' has an em dash');
      assert.ok(!/meta library/i.test(out[k]), k + ' says Meta library');
    }
    // paragraph rule: blank line between paragraphs, no single line breaks inside one
    for (const k of ['message_a', 'message_b']) {
      const paras = out[k].split('\n\n');
      assert.ok(paras.length >= 4, k + ' should be several paragraphs');
      assert.ok(paras.slice(0, -1).every((p) => p.trim() && !p.includes('\n')), k + ' paragraphs must be separated by a blank line');
      assert.ok(out[k].includes('Thanks,') && out[k].endsWith(M.DEFAULT_PROFILE.sender_first + '\n' + M.DEFAULT_PROFILE.sender_title), k + ' must end with the signature block');
    }
    assert.ok(out.message_a.includes(M.URL_PLACEHOLDER), 'Message A carries the URL placeholder until a video is pasted');
    assert.ok(!out.message_b.includes(M.URL_PLACEHOLDER), 'Message B has no URL');
    assert.ok(out.connection_note.length <= 300, 'connection note under 300 chars');
    assert.ok(!/https?:\/\//i.test(out.connection_note), 'connection note has no link');
    assert.ok(/\bMeta\b/.test(out.message_a), 'observation mentions Meta');
    assert.ok(out.observation.split(/\s+/).length <= 25, 'observation is 25 words or fewer');
  });
}

test('pasting a video URL replaces the placeholder in Message A', () => {
  const { input } = rows[0];
  const out = M.generate(input, M.DEFAULT_PROFILE, 'https://example.com/v/abc');
  assert.ok(out.message_a.includes('https://example.com/v/abc'));
  assert.ok(!out.message_a.includes(M.URL_PLACEHOLDER));
  assert.equal(M.postCheck(out.message_a, { kind: 'message_a', video_url: 'https://example.com/v/abc' }).ok, true);
});

test('post-check rejects the things the spec forbids', () => {
  assert.equal(M.postCheck('Hey Dan \u2014 hi\n\nThanks,\n\nAJ', { kind: 'message_b' }).ok, false);
  assert.equal(M.postCheck('Hey Dan\n\nSaw you on the Meta library.\n\nThanks,\n\nAJ', { kind: 'message_b' }).ok, false);
  assert.equal(M.postCheck('Hey Dan\nno blank line\n\nThanks,\n\nAJ', { kind: 'message_b' }).ok, false);
  assert.equal(M.postCheck('Hey Dan\n\nno sign off', { kind: 'message_b' }).ok, false);
  assert.equal(M.postCheck('Hey Dan\n\nSo I made you a sample: nothing here\n\nThanks,\n\nAJ', { kind: 'message_a', video_url: null }).ok, false);
  assert.equal(M.postCheck('Hey Dan, see https://x.com', { kind: 'note' }).ok, false);
  assert.equal(M.postCheck('x'.repeat(301), { kind: 'note' }).ok, false);
});

test('static brands get the "video would work harder" hook, video brands get the product angle', () => {
  assert.ok(/still images/i.test(M.generate({ dm_name: 'Sam', category: 'collagen', creative_style: 'Static', active_meta_ads: 12, meta_page_id: '1', suggested_product_name: 'Collagen' }, M.DEFAULT_PROFILE, null).message_a), 'static brands get the still-images clause in Message A');
  assert.match(M.genericObservation({ category: 'Collagen', creative_style: 'Video-led' }), /video ads on Meta/);
});

test('soft connection note (B) mentions their product, gives nothing away, fits LinkedIn', () => {
  const n = M.softNote({ dm_name: 'Dan Freed', brand: 'Create', suggested_product_name: 'Core - Creatine Monohydrate Gummies - 1.5g per Gummy' });
  assert.ok(n.startsWith('Hey Dan, '), n);
  assert.ok(/Creatine Monohydrate Gummies/.test(n) && !/1\.5g/.test(n), 'short product name');
  assert.ok(/Meta/.test(n));
  assert.ok(!/free|sample|video|ShekiPro|run /i.test(n), 'no offer and no pitch in the soft note');
  assert.ok(!/https?:/i.test(n) && n.length <= 300);
  assert.ok(!EM_DASH.test(n));
  assert.ok(/the Create ads/.test(M.softNote({ dm_name: 'Sam', brand: 'Create' })), 'falls back to the brand name');
  assert.equal(M.postCheck(n, { kind: 'note' }).ok, true);
});

test('attachment wording: the link sentence becomes "attached below" and back again', () => {
  const { input } = rows[0];
  const out = M.generate(input, M.DEFAULT_PROFILE, null);
  const att = M.forAttachment(out.message_a);
  assert.ok(att.includes(', attached below.') && !att.includes(M.URL_PLACEHOLDER), att);
  assert.equal(M.postCheck(att, { kind: 'message_a', attachment: true }).ok, true);
  assert.equal(M.postCheck(out.message_a, { kind: 'message_a', attachment: true }).ok, false, 'placeholder left in is a failure for attachment sends');
  const back = M.forLink(att, 'https://example.com/v/abc');
  assert.ok(back.includes(': https://example.com/v/abc') && !back.includes('attached below'));
  const withUrl = M.generate(input, M.DEFAULT_PROFILE, 'https://example.com/v/abc').message_a;
  assert.ok(M.forAttachment(withUrl).includes(', attached below.'), 'a pasted link is replaced too');
});

test('Message A asks for a chat about a daily or weekly supply, never "do one for X next"', () => {
  const { input } = rows[0];
  const out = M.generate(input, M.DEFAULT_PROFILE, null);
  assert.ok(out.message_a.includes('daily or weekly'), out.message_a);
  assert.ok(out.message_a.includes('quick chat'), out.message_a);
  assert.ok(!/do one for .* next\?/.test(out.message_a));
  assert.ok(out.message_a.includes('free sample video for'), out.message_a);
});

test('store tags are stripped from product names', () => {
  assert.equal(M.shortProduct('[Amazon #1] Biodance Collagen Gel Mask'), 'Biodance Collagen Gel Mask');
  assert.equal(M.shortProduct('EU Collagen Mask New Detail Page (ES)'), 'Collagen Mask');
  assert.equal(M.shortProduct('NEW! Official Best Seller Retinol Serum (30ml)'), 'Retinol Serum');
});

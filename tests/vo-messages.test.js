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
      assert.ok(out[k].includes('Thanks,') && out[k].endsWith(M.DEFAULT_PROFILE.signature), k + ' must end with the signature block');
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
  assert.match(M.genericObservation({ category: 'Collagen', creative_style: 'Static' }), /video would work harder/);
  assert.match(M.genericObservation({ category: 'Collagen', creative_style: 'Video-led' }), /video ads on Meta/);
});

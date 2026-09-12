// Video attachment helpers: finding the file behind a watch page and the size rule. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/vo-video');

test('finds the mp4 behind a ScrollyVid style watch page', () => {
  const html = '<html><head><meta property="og:title" content="x"><meta property="og:video" content="https://cdn.example.com/videos/a.mp4"><meta property="og:video:secure_url" content="https://cdn.example.com/videos/a.mp4"></head><body><video src="https://cdn.example.com/videos/a.mp4" controls></video></body></html>';
  assert.equal(V.findFileUrl(html, 'https://scrollyvid.ai/watch/abc'), 'https://cdn.example.com/videos/a.mp4');
  assert.equal(V.findFileUrl('<video src="/media/b.mp4"></video>', 'https://host.example/watch/x'), 'https://host.example/media/b.mp4', 'relative src resolves against the page');
  assert.equal(V.findFileUrl('<p>no video here</p>', 'https://host.example/'), null);
});

test('size rule and direct links', () => {
  assert.equal(V.maxMb(), 20);
  assert.equal(V.sizeError(34.2 * 1048576), 'Video must be less than 20 MB (this one is 34.2 MB)');
  assert.equal(V.isDirect('https://cdn.example.com/a.mp4?x=1'), true);
  assert.equal(V.isDirect('https://scrollyvid.ai/watch/abc'), false);
});

test('a bad link is refused before any network call', async () => {
  const r = await V.resolveVideo('not a link');
  assert.equal(r.ok, false); assert.match(r.error, /https/);
});

// Video attachments for Video Outreach. A pasted link (a ScrollyVid watch page, or a direct .mp4) is resolved to the
// file behind it and its size is checked BEFORE anything is sent, so a LinkedIn attachment never fails late.
// Limit: VO_VIDEO_MAX_MB (default 20). Nothing here talks to LinkedIn; the provider takes the bytes.
const { fetchRetry } = require('./backoff');

function maxMb() { return Number(process.env.VO_VIDEO_MAX_MB || 20); }
function mb(bytes) { return Math.round((Number(bytes) || 0) / 1048576 * 10) / 10; }
function sizeError(bytes) { return 'Video must be less than ' + maxMb() + ' MB (this one is ' + mb(bytes) + ' MB)'; }
function isDirect(url) { return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(String(url || '')); }

// Find the video file on a watch page: Open Graph tags first, then a <video>/<source> src, then any .mp4 link.
function findFileUrl(html, pageUrl) {
  const h = String(html || '');
  const pick = (re) => { const m = h.match(re); return m ? m[1] : null; };
  let u = pick(/property=["']og:video:secure_url["'][^>]*content=["']([^"']+)["']/i) || pick(/content=["']([^"']+)["'][^>]*property=["']og:video:secure_url["']/i)
    || pick(/property=["']og:video(?::url)?["'][^>]*content=["']([^"']+)["']/i) || pick(/content=["']([^"']+)["'][^>]*property=["']og:video(?::url)?["']/i)
    || pick(/<video[^>]*\ssrc=["']([^"']+)["']/i) || pick(/<source[^>]*\ssrc=["']([^"']+)["']/i)
    || pick(/(https?:\/\/[^"'\s<>]+\.(?:mp4|m4v|webm|mov)(?:\?[^"'\s<>]*)?)/i);
  if (!u) return null;
  try { return new URL(u, pageUrl).toString(); } catch (e) { return null; }
}

async function headSize(fileUrl) {
  let r = await fetchRetry(fileUrl, { method: 'HEAD', redirect: 'follow' }, { retries: 1, timeoutMs: 10000 }).catch(() => null);
  if (!r || !r.ok || !r.headers.get('content-length')) {
    // some hosts refuse HEAD: ask for the first byte and read the total from Content-Range
    r = await fetchRetry(fileUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' }, { retries: 1, timeoutMs: 10000 });
    const cr = r.headers.get('content-range') || ''; const m = cr.match(/\/(\d+)\s*$/);
    try { await r.body.cancel(); } catch (e) {}
    return { bytes: m ? Number(m[1]) : Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') || '' };
  }
  return { bytes: Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') || '' };
}

// -> { ok, file_url, bytes, mb, content_type, source, error }
async function resolveVideo(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\/\S+$/i.test(u)) return { ok: false, error: 'Paste an https:// video link first' };
  let fileUrl = u, source = 'direct';
  if (!isDirect(u)) {
    let r; try { r = await fetchRetry(u, { redirect: 'follow', headers: { Accept: 'text/html' } }, { retries: 1, timeoutMs: 10000 }); } catch (e) { return { ok: false, error: 'Could not open that link (' + e.message + ')' }; }
    if (!r.ok) return { ok: false, error: 'That link answered HTTP ' + r.status };
    const ct = r.headers.get('content-type') || '';
    if (/^video\//i.test(ct)) { source = 'direct'; }
    else {
      const html = (await r.text()).slice(0, 400000);
      fileUrl = findFileUrl(html, u); source = 'page';
      if (!fileUrl) return { ok: false, error: 'No video file found behind that link. Paste a ScrollyVid watch link or a direct .mp4 link, or send as a link instead.' };
    }
  }
  let size; try { size = await headSize(fileUrl); } catch (e) { return { ok: false, file_url: fileUrl, error: 'Could not read the video file (' + e.message + ')' }; }
  if (!size.bytes) return { ok: false, file_url: fileUrl, error: 'The video host did not say how big the file is, send as a link instead' };
  const out = { ok: true, file_url: fileUrl, bytes: size.bytes, mb: mb(size.bytes), content_type: size.type || 'video/mp4', source: source, max_mb: maxMb() };
  if (size.bytes > maxMb() * 1048576) { out.ok = false; out.error = sizeError(size.bytes); }
  return out;
}

async function downloadVideo(fileUrl) {
  const r = await fetchRetry(fileUrl, { redirect: 'follow' }, { retries: 1, timeoutMs: 45000 });
  if (!r.ok) throw new Error('Video download failed (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxMb() * 1048576) throw new Error(sizeError(buf.length));
  return { buffer: buf, content_type: r.headers.get('content-type') || 'video/mp4' };
}

module.exports = { resolveVideo, downloadVideo, findFileUrl, sizeError, maxMb, isDirect, mb };

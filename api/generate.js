// Vercel serverless function:
//   1. ask gpt-image-1 for a photographic hero (NO text in the image)
//   2. composite crisp branding + real business details on top (napi canvas)
//   3. flatten to a single PNG and store it publicly (Vercel Blob)
//   4. return the image URL (for email) + a view-page URL
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { put } = require('@vercel/blob');

// ---- brand ---------------------------------------------------------------
const BRAND_BLUE = '#4375ED';
const BRAND_MAUVE = '#C485B1';
const AGENCY = 'Ai Web Point';

// ---- fonts (register once, at cold start) --------------------------------
let FONTS_OK = false;
(function registerFonts() {
  const candidates = [
    path.join(process.cwd(), 'fonts'),
    path.join(__dirname, '..', 'fonts'),
    path.join(__dirname, 'fonts'),
  ];
  const dir = candidates.find((d) => {
    try { return fs.existsSync(path.join(d, 'Montserrat-Bold.ttf')); } catch (e) { return false; }
  });
  if (!dir) { console.error('FONT DIR NOT FOUND, tried:', candidates); return; }
  const reg = (file, alias) => {
    try { GlobalFonts.registerFromPath(path.join(dir, file), alias); }
    catch (e) { console.error('font register failed', file, e.message); }
  };
  reg('Montserrat-Black.ttf', 'Montserrat Black');
  reg('Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold');
  reg('Montserrat-Bold.ttf', 'Montserrat Bold');
  reg('Montserrat-SemiBold.ttf', 'Montserrat SemiBold');
  reg('Montserrat-Regular.ttf', 'Montserrat');
  FONTS_OK = true;
  console.log('fonts registered from', dir);
})();

// ---- AI scene per industry ----------------------------------------------
function sceneFor(industry) {
  const s = (industry || '').toLowerCase();
  const h = (...k) => k.some((x) => s.includes(x));
  if (h('plumb')) return 'a professional plumber in uniform fixing pipes or a boiler in a modern home, tools visible';
  if (h('electric')) return 'a professional electrician working on an electrical fuse board in a modern home';
  if (h('roof')) return 'professional roofers installing clay roof tiles on a house roof on a clear day';
  if (h('garden', 'landscap', 'lawn', 'tree surgeon')) return 'a professional landscape gardener tending a beautiful manicured garden';
  if (h('clean')) return 'a professional cleaner cleaning a bright modern living room';
  if (h('paint', 'decorat')) return 'a professional painter and decorator painting an interior wall a fresh colour';
  if (h('mechanic', 'garage', 'car ', 'auto', 'mot', 'tyre', 'vehicle')) return 'a professional car mechanic working on a car engine in a clean modern garage';
  if (h('hair', 'barber', 'salon')) return 'a stylish modern hair salon interior with a stylist working on a client';
  if (h('dent')) return 'a bright modern dental clinic with a dentist at work';
  if (h('build', 'construct', 'extension', 'renovat', 'brick', 'plaster', 'carpent', 'joiner', 'kitchen', 'bathroom')) return 'a professional builder working on a quality home extension construction site';
  return 'a friendly professional local tradesperson at work for a service business';
}

function buildPrompt(business) {
  return `Professional, photorealistic commercial photograph for a website hero banner: ${sceneFor(business.industry || business.category)}. Bright, clean, modern, high-end advertising photography with soft natural lighting and shallow depth of field. Keep the LEFT side of the frame darker and relatively uncluttered so text can be overlaid later. Absolutely NO text, NO words, NO letters, NO numbers, NO logos and NO watermarks anywhere in the image.`;
}

async function generateHero(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in Vercel → Settings → Environment Variables.');
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
      n: 1,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error('OpenAI image error: ' + ((data.error && data.error.message) || resp.status));
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('OpenAI returned no image data.');
  return Buffer.from(b64, 'base64');
}

// ---- drawing helpers -----------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapByWidth(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxWidth || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitHeadline(ctx, text, maxWidth, maxSize, minSize, maxLines, family) {
  text = String(text || '').trim();
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${size}px '${family}'`;
    const lines = wrapByWidth(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `${minSize}px '${family}'`;
  return { size: minSize, lines: wrapByWidth(ctx, text, maxWidth).slice(0, maxLines) };
}

function initials(name) {
  const w = String(name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
  return (((w[0] || '')[0] || '') + ((w[1] || '')[0] || '')).toUpperCase() || 'AW';
}

function drawLogo(ctx, x, y, size) {
  // gradient rounded square + "AW"
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, BRAND_BLUE);
  g.addColorStop(1, BRAND_MAUVE);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, size * 0.28);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${size * 0.42}px 'Montserrat ExtraBold'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AW', x + size / 2, y + size / 2 + size * 0.02);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---- compose the final PNG ----------------------------------------------
async function composeMockup(heroBuffer, business) {
  const W = 1200, H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // background photo (cover)
  const hero = await loadImage(heroBuffer);
  const scale = Math.max(W / hero.width, H / hero.height);
  const dw = hero.width * scale, dh = hero.height * scale;
  ctx.drawImage(hero, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // dark overlay: stronger on the left + bottom
  let gx = ctx.createLinearGradient(0, 0, W, 0);
  gx.addColorStop(0, 'rgba(8,14,28,0.92)');
  gx.addColorStop(0.55, 'rgba(8,14,28,0.6)');
  gx.addColorStop(1, 'rgba(8,14,28,0.25)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, W, H);
  let gy = ctx.createLinearGradient(0, H * 0.5, 0, H);
  gy.addColorStop(0, 'rgba(8,14,28,0)');
  gy.addColorStop(1, 'rgba(8,14,28,0.85)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, W, H);

  const X = 56;

  // top bar: logo + agency wordmark + "website preview"
  drawLogo(ctx, X, 30, 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = `23px 'Montserrat Bold'`;
  ctx.fillText(AGENCY, X + 60, 62);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `14px 'Montserrat SemiBold'`;
  ctx.textAlign = 'right';
  ctx.fillText('WEBSITE PREVIEW', W - X, 58);
  ctx.textAlign = 'left';

  // headline (business name)
  const fit = fitHeadline(ctx, business.name, 780, 72, 34, 2, 'Montserrat ExtraBold');
  const lh = fit.size * 1.04;
  let y = fit.lines.length > 1 ? 250 : 285;
  ctx.fillStyle = '#ffffff';
  ctx.font = `${fit.size}px 'Montserrat ExtraBold'`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  fit.lines.forEach((ln, i) => ctx.fillText(ln, X, y + i * lh));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  let cursor = y + (fit.lines.length - 1) * lh;

  // tagline
  const loc = business.location ? ' in ' + business.location : '';
  cursor += 46;
  ctx.fillStyle = '#e8edf6';
  ctx.font = `27px 'Montserrat SemiBold'`;
  ctx.fillText(`Trusted ${business.category || 'local services'}${loc}`, X, cursor);

  // phone label
  cursor += 56;
  ctx.fillStyle = BRAND_MAUVE;
  ctx.font = `16px 'Montserrat Bold'`;
  ctx.fillText('CALL NOW FOR A FREE QUOTE', X, cursor);

  // phone pill (white, brand-blue number — high contrast = emphasis)
  const phone = (business.phones && business.phones[0]) || 'Call us today';
  ctx.font = `40px 'Montserrat ExtraBold'`;
  const pw = Math.min(620, ctx.measureText(phone).width + 110);
  const pillY = cursor + 16, pillH = 80;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, X, pillY, pw, pillH, pillH / 2);
  ctx.fill();
  // little phone glyph
  ctx.fillStyle = BRAND_BLUE;
  ctx.beginPath();
  ctx.arc(X + 44, pillY + pillH / 2, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `18px 'Montserrat Bold'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☎', X + 44, pillY + pillH / 2 + 1);
  ctx.fillStyle = BRAND_BLUE;
  ctx.font = `40px 'Montserrat ExtraBold'`;
  ctx.fillText(phone, X + 44 + (pw - 70) / 2 + 8, pillY + pillH / 2 + 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // "request a demo" button (brand gradient)
  const demoY = pillY + pillH + 22, demoH = 60;
  ctx.font = `22px 'Montserrat Bold'`;
  const demoText = 'Request a demo of the full website';
  const dw2 = ctx.measureText(demoText).width + 76;
  const dg = ctx.createLinearGradient(X, demoY, X + dw2, demoY);
  dg.addColorStop(0, BRAND_BLUE);
  dg.addColorStop(1, BRAND_MAUVE);
  ctx.fillStyle = dg;
  roundRect(ctx, X, demoY, dw2, demoH, demoH / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(demoText, X + 34, demoY + demoH / 2 + 1);
  // chevron
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  const chx = X + dw2 - 30, chy = demoY + demoH / 2;
  ctx.beginPath();
  ctx.moveTo(chx - 4, chy - 7); ctx.lineTo(chx + 5, chy); ctx.lineTo(chx - 4, chy + 7);
  ctx.stroke();
  ctx.textBaseline = 'alphabetic';

  // bottom band: services chips (left) + closing line (right)
  const bandY = 706;
  ctx.fillStyle = 'rgba(6,11,22,0.62)';
  ctx.fillRect(0, bandY, W, H - bandY);
  ctx.fillStyle = BRAND_BLUE;
  ctx.fillRect(0, bandY, W, 4);

  const services = (business.services || []).slice(0, 4);
  ctx.font = `18px 'Montserrat SemiBold'`;
  ctx.textBaseline = 'middle';
  let sx = X;
  const sy = bandY + 50;
  services.forEach((s) => {
    ctx.fillStyle = BRAND_MAUVE;
    ctx.beginPath(); ctx.arc(sx + 4, sy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8edf6';
    ctx.fillText(s, sx + 16, sy + 1);
    sx += 28 + ctx.measureText(s).width;
  });

  ctx.fillStyle = '#ffffff';
  ctx.font = `19px 'Montserrat Bold'`;
  ctx.textAlign = 'right';
  ctx.fillText('Let me show you the full website over a call', W - X, sy + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  return canvas.encode('png');
}

// ---- the online "view mockup" page --------------------------------------
function buildViewHtml(business, imageUrl) {
  const demo = process.env.DEMO_URL || 'mailto:hello@aiwebpoint.com?subject=Website%20demo';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = `${esc(business.name)} — website preview by ${AGENCY}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta property="og:title" content="${title}"/>
<meta property="og:image" content="${esc(imageUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1322;color:#fff;text-align:center}
  .wrap{max-width:1000px;margin:0 auto;padding:32px 18px 64px}
  h1{font-size:22px;font-weight:700;margin:8px 0 4px}
  p.sub{color:#9fb0c7;margin:0 0 22px}
  img{width:100%;height:auto;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.5)}
  .cta{display:inline-block;margin-top:26px;padding:16px 30px;border-radius:999px;color:#fff;font-weight:700;
       text-decoration:none;background:linear-gradient(90deg,${BRAND_BLUE},${BRAND_MAUVE});font-size:18px}
  .foot{margin-top:30px;color:#7e8ca3;font-size:13px}
  .logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;margin-bottom:10px}
  .badge{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MAUVE});
         display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:800}
</style></head><body><div class="wrap">
  <div class="logo"><span class="badge">AW</span> ${AGENCY}</div>
  <h1>A website preview for ${esc(business.name)}</h1>
  <p class="sub">Here's a free home-page concept we made for you.</p>
  <img src="${esc(imageUrl)}" alt="Website mockup for ${esc(business.name)}"/>
  <div><a class="cta" href="${esc(demo)}">Request a demo of the full website →</a></div>
  <p class="foot">Made by ${AGENCY}. Prefer to talk? We'll walk you through the full site over a quick call.</p>
</div></body></html>`;
}

// ---- handler -------------------------------------------------------------
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body || typeof body !== 'object') body = {};
    const business = body.business;
    if (!business || !business.name) {
      res.status(400).json({ error: 'Missing business details.' });
      return;
    }

    const heroBuffer = await generateHero(buildPrompt(business));
    const pngBuffer = await composeMockup(heroBuffer, business);

    const id = crypto.randomUUID().slice(0, 8);
    const safe = String(business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mockup';
    const base = `mockups/${safe}-${id}`;

    const png = await put(`${base}.png`, pngBuffer, { access: 'public', contentType: 'image/png', addRandomSuffix: false });
    const view = await put(`${base}.html`, buildViewHtml(business, png.url), { access: 'public', contentType: 'text/html; charset=utf-8', addRandomSuffix: false });

    res.status(200).json({ imageUrl: png.url, viewUrl: view.url, id });
  } catch (err) {
    console.error('generate error:', err);
    res.status(500).json({ error: err.message || 'Generation failed.' });
  }
};

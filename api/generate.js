// Vercel serverless function:
//   1. ask gpt-image-1 for a photographic hero (NO text in the image)
//   2. composite crisp branding + real business details on top (napi canvas)
//   3. flatten to a single PNG and store it publicly (Vercel Blob)
//   4. return the image URL (for email) + a view-page URL
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const sharp = require('sharp');
const { put } = require('@vercel/blob');
const { verify, parseCookie } = require('../lib/auth');
const { checkAndRecord } = require('../lib/ratelimit');

// ---- brand ---------------------------------------------------------------
const BRAND_BLUE = '#4375ED';
const BRAND_MAUVE = '#C485B1';
const AGENCY = process.env.AGENCY_NAME || 'Ai Web Point';

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

// ---- AI scene + services for ANY industry (no trade assumptions) ---------
// Asks gpt-4o-mini to describe the right photo scene AND a fitting service list
// for whatever industry was entered, works for web designers, accountants,
// cafes, gyms, plumbers, anything. Falls back to a generic, non-trade default.
async function sceneAndServices(industry) {
  const label = String(industry || 'local business').trim();
  const fallback = {
    scene: `a friendly, professional person at work in a clean, modern workplace that fits a ${label.toLowerCase()} business`,
    services: ['Free Consultation', 'Friendly Local Service', 'Trusted & Reliable', 'Great Value'],
  };
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You write concise art direction and service lists for website hero designs. Output JSON only.' },
          { role: 'user', content: `For the website hero of a "${label}" business, return JSON {"scene":"...","services":["..","..","..",".."]}. "scene" = ONE vivid sentence describing the most fitting photorealistic photo: the right person/people doing their ACTUAL work in an authentic, modern, professional setting, and it must contain NO text, signage, logos or watermarks. "services" = exactly 4 short labels (2-3 words each) of things this specific kind of business genuinely offers. Do not assume it is a trade. Never use em dashes anywhere in the output.` },
        ],
      }),
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    const parsed = JSON.parse(txt || '{}');
    const scene = (parsed.scene && String(parsed.scene).trim()) || fallback.scene;
    let services = Array.isArray(parsed.services) ? parsed.services.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
    if (services.length < 4) services = fallback.services;
    return { scene, services };
  } catch (e) {
    return fallback;
  }
}

const SHOT_ANGLES = ['at natural eye level', 'from a slightly low, heroic angle', 'as a candid over-the-shoulder moment', 'in a relaxed three-quarter view', 'as a wider environmental shot'];
const SHOT_LIGHTS = ['soft natural morning light', 'warm golden afternoon light', 'bright, airy daylight', 'gentle cinematic side lighting'];

function buildPrompt(scene, business) {
  const extra = String(business.requirements || '').trim();
  const extraLine = extra
    ? ` IMPORTANT art direction from the client, apply this strongly to the look and feel of the photo (but do NOT render any of it as on-image text): ${extra}.`
    : '';
  // deliberate per-generation variety so two businesses in the SAME industry
  // never get the same-looking photo
  const a = SHOT_ANGLES[Math.floor(Math.random() * SHOT_ANGLES.length)];
  const l = SHOT_LIGHTS[Math.floor(Math.random() * SHOT_LIGHTS.length)];
  const nonce = Math.floor(Math.random() * 1000000);
  const variety = ` Shoot it ${a}, with ${l}; make the people, their appearance and the specific surroundings look unique and clearly different from any other photo (variation ${nonce}).`;
  return `Professional, photorealistic commercial photograph for a website hero banner: ${scene}.${extraLine}${variety} Bright, clean, modern, high-end advertising photography with shallow depth of field. Keep the LEFT side of the frame darker and relatively uncluttered so text can be overlaid later. Absolutely NO text, NO words, NO letters, NO numbers, NO logos and NO watermarks anywhere in the image.`;
}

// Retry transient OpenAI image failures (5xx / rate-limit / network blips) once
// before surfacing an error, most generate 500s are a momentary OpenAI hiccup.
async function generateHero(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in Vercel → Settings → Environment Variables.');
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await generateHeroOnce(prompt, key); }
    catch (e) { lastErr = e; if (attempt < 2) await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw lastErr;
}
async function generateHeroOnce(prompt, key) {
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
      output_format: 'jpeg',
      n: 1,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error('OpenAI image error: ' + ((data.error && data.error.message) || resp.status));
  const item = (data.data && data.data[0]) || {};
  if (item.b64_json) {
    const buf = Buffer.from(item.b64_json, 'base64');
    const head = buf.slice(0, 8).toString('hex');
    // valid PNG/JPEG/WEBP magic?
    if (head.startsWith('89504e47') || head.startsWith('ffd8ff') || head.startsWith('52494646')) return buf;
    throw new Error('OpenAI b64 not an image: len=' + buf.length + ' head=' + head + ' sample=' + buf.slice(0, 90).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
  }
  if (item.url) {
    const imgResp = await fetch(item.url);
    if (!imgResp.ok) throw new Error('OpenAI image url fetch failed: ' + imgResp.status);
    return Buffer.from(await imgResp.arrayBuffer());
  }
  throw new Error('OpenAI returned no image data. respKeys=' + JSON.stringify(Object.keys(data)) + ' item=' + JSON.stringify(item).slice(0, 160));
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

// the BUSINESS's own logo (initials badge + name) so the mockup reads as their site
function drawBusinessLogo(ctx, x, y, business) {
  const size = 50;
  const hue = Number.isFinite(business.brandHue) ? business.brandHue : 208;
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, `hsl(${hue} 62% 52%)`);
  g.addColorStop(1, `hsl(${(hue + 24) % 360} 58% 44%)`);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, 13);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(size * 0.4)}px 'Montserrat ExtraBold'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(business.name), x + size / 2, y + size / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // wordmark (business name), truncated to fit
  ctx.fillStyle = '#ffffff';
  ctx.font = `22px 'Montserrat Bold'`;
  let nm = String(business.name || '');
  const maxW = 470;
  if (ctx.measureText(nm).width > maxW) {
    while (nm.length > 4 && ctx.measureText(nm + '…').width > maxW) nm = nm.slice(0, -1);
    nm = nm.trim() + '…';
  }
  ctx.fillText(nm, x + size + 16, y + size / 2 + 8);
}

// ---- compose the final PNG ----------------------------------------------
function cleanCta(s, fallback, max) {
  s = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  if (!s) return fallback;
  return s.length > max ? s.slice(0, max).trim() : s;
}

async function composeMockup(heroBuffer, business, opts) {
  opts = opts || {};
  const ctaHero = cleanCta(opts.ctaHero, 'Request a demo of the full website', 48);
  const ctaBottom = cleanCta(opts.ctaBottom, 'Let me show you the full website over a call', 52);
  const W = 1200, H = 880;
  // canvas holds ONLY the overlay (transparent where the photo should show);
  // the photo is composited underneath by sharp (a robust image decoder).
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // dark overlay: stronger on the left + bottom (darkens the photo for legibility)
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

  // top-left: the BUSINESS's own logo (so the mockup reads as their website)
  drawBusinessLogo(ctx, X, 28, business);

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

  // phone pill (white, brand-blue number, high contrast = emphasis)
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
  const demoText = ctaHero;
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
  const bandY = 700;
  ctx.fillStyle = 'rgba(6,11,22,0.72)';
  ctx.fillRect(0, bandY, W, H - bandY);
  ctx.fillStyle = BRAND_BLUE;
  ctx.fillRect(0, bandY, W, 4);

  // row 1: services chips, centered
  const services = (business.services || []).slice(0, 4);
  ctx.font = `17px 'Montserrat SemiBold'`;
  ctx.textBaseline = 'middle';
  const gapDot = 10, gapItem = 30;
  const widths = services.map((s) => ctx.measureText(s).width);
  let total = 0;
  widths.forEach((w, i) => { total += 8 + gapDot + w + (i < services.length - 1 ? gapItem : 0); });
  let sx = (W - total) / 2;
  const sy = bandY + 40;
  services.forEach((s, i) => {
    ctx.fillStyle = BRAND_MAUVE;
    ctx.beginPath(); ctx.arc(sx + 4, sy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8edf6';
    ctx.fillText(s, sx + 8 + gapDot, sy);
    sx += 8 + gapDot + widths[i] + gapItem;
  });

  // row 2: the closing line as a CTA button (brand-gradient pill)
  ctx.font = `21px 'Montserrat ExtraBold'`;
  const ctaText = ctaBottom;
  const ctaW = ctx.measureText(ctaText).width + 112;
  const ctaH = 58;
  const ctaX = (W - ctaW) / 2;
  const ctaY = bandY + 66;
  const cg = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY);
  cg.addColorStop(0, BRAND_BLUE);
  cg.addColorStop(1, BRAND_MAUVE);
  ctx.fillStyle = cg;
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ctaText, W / 2 - 12, ctaY + ctaH / 2 + 1);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  const acx = ctaX + ctaW - 36, acy = ctaY + ctaH / 2;
  ctx.beginPath(); ctx.moveTo(acx - 5, acy - 7); ctx.lineTo(acx + 4, acy); ctx.lineTo(acx - 5, acy + 7); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // row 3: "Designed by Ai Web Point" sign-off (small AW badge + text), centered
  const credit = 'Designed by ' + AGENCY;
  ctx.font = `15px 'Montserrat SemiBold'`;
  const creditW = ctx.measureText(credit).width;
  const badge = 24;
  const groupX = (W - (badge + 10 + creditW)) / 2;
  const creditY = bandY + 152;
  drawLogo(ctx, groupX, creditY - badge / 2, badge);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textBaseline = 'middle';
  ctx.fillText(credit, groupX + badge + 10, creditY + 1);
  ctx.textBaseline = 'alphabetic';

  // overlay (RGBA, transparent where the photo should show through)
  const overlay = await canvas.encode('png');

  // base = the AI photo, decoded + cover-fit by sharp; fall back to a dark panel
  let base;
  try {
    base = await sharp(heroBuffer).resize(W, H, { fit: 'cover' }).toBuffer();
  } catch (e) {
    console.error('sharp decode failed:', e.message);
    base = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 17, g: 22, b: 44, alpha: 1 } } }).png().toBuffer();
  }

  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

// ---- handler -------------------------------------------------------------
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  // require a valid login session (protects your OpenAI credits)
  if (!verify(parseCookie(req, 'aiwp'), Date.now())) {
    res.status(401).json({ error: 'Please log in first.' });
    return;
  }
  // 12-hour usage cap (before any OpenAI call)
  const rl = await checkAndRecord('generate', Date.now());
  if (!rl.ok) {
    res.status(429).json({ error: `Mockup limit reached (${rl.limit} per 12 hours). Try again in ~${rl.retryHours}h.` });
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

    // industry-appropriate scene + services (no trade assumptions)
    const ss = await sceneAndServices(business.industry || business.category);
    if (ss.services && ss.services.length) business.services = ss.services;
    const heroBuffer = await generateHero(buildPrompt(ss.scene, business));
    const pngBuffer = await composeMockup(heroBuffer, business, { ctaHero: body.ctaHero, ctaBottom: body.ctaBottom });

    const id = crypto.randomUUID().slice(0, 8);
    const safe = String(business.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mockup';
    const base = `mockups/${safe}-${id}`;

    const png = await put(`${base}.png`, pngBuffer, { access: 'public', contentType: 'image/png', addRandomSuffix: false });

    // store small metadata so the short /v/<slug> view page can look it up
    const cta = cleanCta(body.ctaHero, 'Request a demo of the full website', 48);
    const who = String(body.personName || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
    const phone = (business.phones && business.phones[0]) || '';
    await put(`${base}.json`, JSON.stringify({ name: business.name || '', loc: business.location || '', searchLoc: business.searchLoc || '', who, cta, img: png.url, phone, category: business.category || '', mapsUrl: business.mapsUrl || '', placeId: business.id || '' }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });

    // short, clean, WhatsApp-friendly link (no query string / special chars)
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const linkBase = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
    const slug = `${safe}-${id}`;
    const viewUrl = `${linkBase}/v/${slug}`;
    const imageUrl = `${linkBase}/i/${slug}.png`; // branded, hides the blob host

    res.status(200).json({ imageUrl, viewUrl, id, slug });
  } catch (err) {
    console.error('generate error:', err);
    res.status(500).json({ error: err.message || 'Generation failed.' });
  }
};

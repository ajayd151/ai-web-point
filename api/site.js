// Renders a generated 1-page website from sites/<slug>.json (built by /api/pounce).
// Wired via the /s/:slug rewrite. Preview sites are noindex. Per-business favicon.
const { list } = require('@vercel/blob');
const { SAMPLES } = require('../lib/samples');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');

function favicon(initials) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%23ffb703'/><stop offset='1' stop-color='%23f59e0b'/></linearGradient></defs><rect width='64' height='64' rx='14' fill='url(%23g)'/><text x='32' y='44' font-family='Arial,sans-serif' font-size='30' font-weight='800' fill='%231a1206' text-anchor='middle'>${encodeURIComponent(initials)}</text></svg>`;
  return 'data:image/svg+xml,' + svg;
}

function lum(hex) {
  const m = String(hex || '').replace('#', '');
  if (m.length < 6) return 200;
  return 0.299 * parseInt(m.slice(0, 2), 16) + 0.587 * parseInt(m.slice(2, 4), 16) + 0.114 * parseInt(m.slice(4, 6), 16);
}

function render(s) {
  const b = s.business || {};
  const hero = s.hero || {};
  const acc = (s.accent && /^#[0-9a-f]{6}$/i.test(s.accent.a || '')) ? s.accent : { a: '#ffb703', d: '#f59e0b' };
  const accInk = lum(acc.a) > 150 ? '#1a1206' : '#ffffff';
  const heroBg = hero.image
    ? `linear-gradient(90deg, rgba(8,18,38,.92), rgba(8,18,38,.55)), url('${esc(hero.image)}')`
    : `linear-gradient(120deg, #0a1c3a, #15315c)`;
  const phone = b.phone || '';
  const trust = (s.trust || []).map((t) => `<span><span class="tick">✓</span> ${esc(t)}</span>`).join('');
  const services = (s.services || []).map((sv) => `<div class="svc"><div class="ic">${esc(sv.icon || '⭐')}</div><h3>${esc(sv.title || '')}</h3><p>${esc(sv.desc || '')}</p></div>`).join('');
  const stats = ((s.about && s.about.stats) || []).map((st) => `<div class="stat"><b>${esc(st.num || '')}</b><span>${esc(st.label || '')}</span></div>`).join('');
  const paras = ((s.about && s.about.paras) || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const gallery = (s.gallery || []).length
    ? `<section><div class="wrap"><div class="sec-head"><div class="kicker">Our work</div><h2>Recent projects</h2></div><div class="gal">${(s.gallery || []).map((g) => `<div style="background-image:url('${esc(g)}')" role="img" aria-label="Project photo"></div>`).join('')}</div></div></section>`
    : '';
  const mapsUrl = b.mapsUrl || '';
  // 1) accreditation strip (only the ones the agency confirmed, never fabricated)
  const accred = (s.accreditations || []).length
    ? `<div class="accred"><div class="wrap"><span class="accred-lead">Accredited &amp; trusted</span>${(s.accreditations || []).map((a) => `<span class="ac-badge">🛡️ ${esc(a)}</span>`).join('')}</div></div>`
    : '';
  // 3) live Google rating widget
  const googleBadge = s.rating
    ? `<a class="gbadge"${mapsUrl ? ` href="${esc(mapsUrl)}" target="_blank" rel="noopener"` : ''}><span class="g-logo">G</span><span class="g-mid"><span class="g-stars">★★★★★</span><span class="g-sub">${esc(s.rating)} · ${esc(s.reviewCount || 0)} Google reviews${mapsUrl ? ' · Read on Google ↗' : ''}</span></span></a>`
    : '';
  const googleBand = (!(s.reviews || []).length && s.rating)
    ? `<section class="gband"><div class="wrap" style="text-align:center">${googleBadge}</div></section>` : '';
  // 4) service area + keyless embedded map
  const areas = s.areasCovered || [];
  const mapEmbed = (b.address || b.location) ? `https://www.google.com/maps?q=${encodeURIComponent(b.address || b.location)}&output=embed` : '';
  const areaSec = (areas.length || mapEmbed)
    ? `<section id="area" class="areasec"><div class="wrap"><div class="sec-head"><div class="kicker">Where we work</div><h2>Areas we cover</h2>${areas.length ? `<p>Proudly serving ${esc(b.location)} and the surrounding area.</p>` : ''}</div>
      <div class="area-grid">
        ${mapEmbed ? `<iframe class="area-map" src="${esc(mapEmbed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Service area map"></iframe>` : ''}
        <div class="area-list">${areas.length ? `<div class="area-chips">${areas.map((a) => `<span>📍 ${esc(a)}</span>`).join('')}</div>` : ''}${phone ? `<a class="btn btn-amber" href="${telHref(phone)}" style="margin-top:6px">📞 Call ${esc(phone)}</a>` : ''}</div>
      </div></div></section>`
    : '';
  // 2) sticky mobile call bar
  const mobileBar = phone
    ? `<div class="mobilebar"><a href="${telHref(phone)}">📞 Call now</a><a href="#contact" class="mb-quote">Free quote</a></div>`
    : `<div class="mobilebar"><a href="#contact" class="mb-quote" style="flex:1">Get a free quote →</a></div>`;
  // PREVIEW-ONLY sales bar: "Yes, sign me up" → subscribe page (env-configurable).
  // Tracks the click as a 'signup' hot signal. Never renders on a published site.
  const isPreview = s.mode !== 'published';
  const subBase = process.env.SUBSCRIBE_URL || 'https://aiwebpoint.com/subscribe';
  const subUrl = subBase + (subBase.indexOf('?') >= 0 ? '&' : '?') + 'source=' + encodeURIComponent(s.slug || '');
  const previewBar = isPreview
    ? `<div class="pvbar"><div class="pvbar-in"><span class="pv-txt"><b>👋 Like your new website${b.name ? ', ' + esc(b.name) : ''}?</b> 🚀 Founding-member offer, get it live this month.</span><a class="pv-cta" href="${esc(subUrl)}" target="_blank" rel="noopener" onclick="if(navigator.sendBeacon){navigator.sendBeacon('/api/track?slug=${encodeURIComponent(s.slug || '')}&e=signup');}">Yes, sign me up →</a></div></div>`
    : '';
  const reviews = (s.reviews || []).length
    ? `<section id="reviews" class="reviews"><div class="wrap"><div class="sec-head"><div class="kicker" style="color:var(--amber)">Reviews</div><h2>What our customers say</h2>${googleBadge ? `<div class="gbadge-wrap">${googleBadge}</div>` : ''}</div><div class="rev-grid">${(s.reviews || []).map((r) => {
        const init = (r.name || 'C').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return `<div class="rev"><div class="stars">${'★'.repeat(Math.round(r.rating || 5))}</div><p>"${esc(r.text)}"</p><div class="who"><div class="av">${esc(init)}</div><div><b>${esc(r.name)}</b><span>Google review</span></div></div></div>`;
      }).join('')}</div></div></section>`
    : '';
  const faq = (s.faq || []).filter((f) => f && f.q && f.a);
  const faqSec = faq.length
    ? `<section id="faq" class="faqsec"><div class="wrap narrow"><div class="sec-head"><div class="kicker">FAQs</div><h2>Frequently asked questions</h2></div><div class="faq">${faq.map((f) => `<details><summary>${esc(f.q)}<span class="fic">+</span></summary><p>${esc(f.a)}</p></details>`).join('')}</div></div></section>`
    : '';
  const offerBar = s.offer ? `<div class="offer-bar"><div class="wrap">🎉 ${esc(s.offer)}</div></div>` : '';
  const hours = ((s.contact && s.contact.hours) || []).length
    ? `<div class="ci"><div class="cic">🕒</div><div><b>Opening hours</b><span>${(s.contact.hours || []).map(esc).join('<br>')}</span></div></div>` : '';
  const cta = phone ? `<a class="btn btn-amber" href="${telHref(phone)}">📞 Call ${esc(phone)}</a>` : `<a class="btn btn-amber" href="#contact">Get a Free Quote</a>`;
  const quoteForm = (id) => `<form id="${id}" onsubmit="event.preventDefault();this.querySelector('.form-ok').style.display='block';this.reset();">
      <div class="form-ok">✓ Thanks! We've got your details and will be in touch shortly.</div>
      <div class="row"><div class="fld"><label>Your name</label><input type="text" required placeholder="Jane Smith" /></div><div class="fld"><label>Phone</label><input type="tel" required placeholder="07…" /></div></div>
      <div class="fld"><label>Email</label><input type="email" placeholder="you@email.com" /></div>
      <div class="fld"><label>How can we help?</label><textarea rows="3" placeholder="Tell us what you need…"></textarea></div>
      <button class="btn btn-amber" type="submit" style="width:100%;justify-content:center">Send my enquiry →</button>
    </form>`;
  // About visual: real photo if we have one, otherwise a branded highlight card (never blank)
  const aboutVisual = (s.gallery || [])[0]
    ? `<div class="about-img" style="background-image:url('${esc((s.gallery || [])[0])}')" role="img" aria-label="${esc(b.name)}"></div>`
    : `<div class="about-card">
        ${s.rating ? `<div class="ac-score"><b>${esc(s.rating)}</b><div><div class="ac-stars">★★★★★</div><small>${esc(s.reviewCount || '')} Google reviews</small></div></div>` : ''}
        <div class="ac-list">
          <div>📍 Proudly serving ${esc(b.location)}</div>
          ${(s.trust || []).slice(0, 3).map((t) => `<div>✓ ${esc(t)}</div>`).join('')}
        </div>
        <a class="btn btn-amber" href="#contact" style="width:100%;justify-content:center">Get your free quote →</a>
      </div>`;
  const noindex = s.mode !== 'published';

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc((s.seo && s.seo.title) || b.name)}</title>
<meta name="description" content="${esc((s.seo && s.seo.description) || '')}" />
${noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''}
<meta property="og:title" content="${esc((s.seo && s.seo.title) || b.name)}" />
<meta property="og:description" content="${esc((s.seo && s.seo.description) || '')}" />
<link rel="icon" href="${favicon(s.initials || 'SP')}" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root{--navy:#0a1c3a;--navy2:#102a52;--amber:${acc.a};--amber-d:${acc.d};--acc-ink:${accInk};--ink:#14233b;--muted:#5d6b82;--line:#e6eaf1;--bg:#f6f8fc}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,sans-serif;color:var(--ink);background:#fff;line-height:1.6}
h1,h2,h3,.logo-txt,.btn{font-family:'Poppins',sans-serif}a{color:inherit;text-decoration:none}
.wrap{max-width:1140px;margin:0 auto;padding:0 22px}.wrap.narrow{max-width:780px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:15px;padding:13px 24px;border-radius:10px;cursor:pointer;border:none;transition:transform .12s,filter .12s}
.btn:hover{transform:translateY(-2px)}
.btn-amber{background:linear-gradient(135deg,var(--amber),var(--amber-d));color:var(--acc-ink);box-shadow:0 8px 22px rgba(0,0,0,.18)}
.btn-ghost{background:rgba(255,255,255,.12);color:#fff;border:1.5px solid rgba(255,255,255,.5)}
.offer-bar{background:linear-gradient(90deg,var(--amber),var(--amber-d));color:var(--acc-ink);font-weight:700;font-size:14.5px;text-align:center;padding:9px 0}
header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.hbar{display:flex;align-items:center;justify-content:space-between;height:72px}
.brand{display:flex;align-items:center;gap:12px}
.badge{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--amber),var(--amber-d));display:grid;place-items:center;font-weight:800;color:var(--acc-ink);font-size:17px}
.logo-txt b{display:block;font-size:17px;font-weight:800;color:var(--navy);line-height:1.1}.logo-txt span{font-size:11px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
.nav{display:flex;align-items:center;gap:24px}.nav a.lnk{font-weight:600;font-size:14.5px}.nav a.lnk:hover{color:var(--amber-d)}
.htel{font-weight:700;color:var(--navy);font-size:15px}
@media(max-width:880px){.nav .lnk,.htel-txt{display:none}}
.hero{position:relative;overflow:hidden;background:linear-gradient(120deg,var(--navy),var(--navy2))}
.hero-img{position:absolute;inset:0;background-size:cover;background-position:center}
.hero-grid{position:relative;display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center;padding:72px 0 80px}
.hero-content{max-width:600px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);color:#fff;font-weight:600;font-size:13px;padding:6px 14px;border-radius:999px;margin-bottom:20px}
.hero h1{font-size:44px;line-height:1.08;font-weight:800;margin-bottom:16px;color:#fff}
.hero p.lead{font-size:18px;color:#d4ddee;margin-bottom:26px}.hero-cta{display:flex;gap:14px;flex-wrap:wrap}
.trust-row{display:flex;gap:20px;flex-wrap:wrap;margin-top:28px}.trust-row span{font-size:13.5px;color:#eef2f9;font-weight:600;display:flex;align-items:center;gap:7px}.trust-row .tick{color:var(--amber);font-weight:800}
.hero-card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 30px 60px rgba(0,0,0,.35)}
.hero-card h3{font-size:20px;color:var(--navy)}.hero-card .hc-sub{font-size:13.5px;color:var(--muted);margin-bottom:16px}
.hero-card form{background:none;border:none;box-shadow:none;padding:0}
@media(max-width:900px){.hero-grid{grid-template-columns:1fr;gap:32px;padding:52px 0 60px}.hero h1{font-size:34px}.hero-card{max-width:520px}}
section{padding:76px 0}.sec-head{text-align:center;max-width:640px;margin:0 auto 46px}
.kicker{color:var(--amber-d);font-weight:700;font-size:13px;letter-spacing:1.5px;text-transform:uppercase}
.sec-head h2{font-size:33px;font-weight:800;color:var(--navy);margin:8px 0 12px}.sec-head p{color:var(--muted);font-size:16px}
.svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.svc{background:#fff;border:1px solid var(--line);border-radius:16px;padding:26px;transition:transform .15s,box-shadow .15s}
.svc:hover{transform:translateY(-4px);box-shadow:0 18px 40px rgba(16,42,82,.1)}
.svc .ic{width:52px;height:52px;border-radius:13px;background:#eef3fb;display:grid;place-items:center;font-size:24px;margin-bottom:16px}
.svc h3{font-size:18px;color:var(--navy);margin-bottom:7px}.svc p{color:var(--muted);font-size:14.5px}
@media(max-width:860px){.svc-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.svc-grid{grid-template-columns:1fr}}
.about{background:var(--bg)}.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.about h2{font-size:31px;color:var(--navy);margin-bottom:16px}.about p{color:var(--muted);margin-bottom:14px;font-size:16px}
.stats{display:flex;gap:30px;margin-top:24px;flex-wrap:wrap}.stat b{display:block;font-family:'Poppins';font-size:30px;font-weight:800;color:var(--amber-d)}.stat span{font-size:13.5px;color:var(--muted);font-weight:600}
.about-img{height:420px;border-radius:18px;background:var(--navy2);background-size:cover;background-position:center;box-shadow:0 24px 50px rgba(16,42,82,.18)}
.about-card{background:linear-gradient(150deg,var(--navy),var(--navy2));border-radius:18px;padding:32px;color:#fff;box-shadow:0 24px 50px rgba(16,42,82,.22)}
.ac-score{display:flex;align-items:center;gap:16px;padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,.15)}
.ac-score b{font-family:'Poppins';font-size:46px;font-weight:800;color:#fff;line-height:1}.ac-stars{color:var(--amber);font-size:18px;letter-spacing:2px}.ac-score small{color:#aebdd6;font-size:13px}
.ac-list{display:flex;flex-direction:column;gap:11px;margin-bottom:22px}.ac-list div{font-size:15px;color:#e3eaf6;font-weight:500}
@media(max-width:820px){.about-grid{grid-template-columns:1fr}.about-img{height:280px}}
.gal{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.gal div{height:190px;border-radius:14px;background:var(--navy2);background-size:cover;background-position:center}
@media(max-width:820px){.gal{grid-template-columns:1fr 1fr}}
.reviews{background:var(--navy)}.reviews .sec-head h2{color:#fff}
.rev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start}
.rev{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:24px}
.stars{color:var(--amber);letter-spacing:2px;font-size:16px;margin-bottom:12px}.rev p{color:#eef2f9;font-size:15px;margin-bottom:16px}
.rev .who{display:flex;align-items:center;gap:11px}.rev .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--amber),var(--amber-d));display:grid;place-items:center;font-weight:800;color:var(--acc-ink)}.rev .who b{font-size:14.5px;color:#fff}.rev .who span{display:block;font-size:12px;color:#a9b8d2}
@media(max-width:860px){.rev-grid{grid-template-columns:1fr}}
.faqsec{background:var(--bg)}.faq details{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:12px;overflow:hidden}
.faq summary{list-style:none;cursor:pointer;padding:18px 22px;font-weight:700;color:var(--navy);font-size:16px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.faq summary::-webkit-details-marker{display:none}.faq .fic{color:var(--amber-d);font-size:22px;font-weight:700;transition:transform .2s}.faq details[open] .fic{transform:rotate(45deg)}
.faq details p{padding:0 22px 20px;color:var(--muted);font-size:15px}
.contact-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:44px;align-items:start}
.ci{display:flex;gap:14px;margin-bottom:18px}.ci .cic{width:44px;height:44px;border-radius:11px;background:#eef3fb;display:grid;place-items:center;font-size:19px;flex:0 0 44px}.ci b{display:block;color:var(--navy);font-size:15px}.ci span{color:var(--muted);font-size:14.5px}
form{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 18px 44px rgba(16,42,82,.08)}
form label{display:block;font-weight:600;font-size:13.5px;margin:0 0 6px}.fld{margin-bottom:15px}
form input,form textarea{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#fbfcfe}
form input:focus,form textarea:focus{outline:none;border-color:var(--amber-d);background:#fff}
form .row{display:flex;gap:14px}form .row .fld{flex:1}
.form-ok{display:none;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:10px;padding:12px;font-weight:600;font-size:14px;margin-bottom:14px}
@media(max-width:820px){.contact-grid{grid-template-columns:1fr}form .row{flex-direction:column;gap:0}}
footer{background:#07142b;color:#aebbd2;padding:44px 0 26px}
.foot-top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;padding-bottom:24px;border-bottom:1px solid rgba(255,255,255,.1)}.foot-top .logo-txt b{color:#fff}
.foot-links{display:flex;gap:22px;flex-wrap:wrap}.foot-links a{font-size:14px}.foot-links a:hover{color:#fff}
.foot-bot{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-top:22px;font-size:13px}.foot-bot a{color:var(--amber);font-weight:600}
.accred{background:#fff;border-bottom:1px solid var(--line)}.accred .wrap{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-top:16px;padding-bottom:16px}
.accred-lead{font-weight:700;color:var(--navy);font-size:13px;text-transform:uppercase;letter-spacing:.5px}
.ac-badge{display:inline-flex;align-items:center;gap:6px;background:#eef3fb;border:1px solid var(--line);color:var(--navy);font-weight:600;font-size:13px;padding:7px 12px;border-radius:8px}
.gbadge-wrap{display:flex;justify-content:center;margin-top:18px}
.gbadge{display:inline-flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 18px;box-shadow:0 6px 18px rgba(16,42,82,.12)}
.g-logo{width:30px;height:30px;border-radius:50%;background:conic-gradient(#ea4335,#fbbc05,#34a853,#4285f4,#ea4335);display:grid;place-items:center;color:#fff;font-weight:800;font-family:Arial;font-size:17px}
.g-mid{display:flex;flex-direction:column;line-height:1.2}.g-stars{color:#fbbc05;letter-spacing:1px;font-size:14px}.g-sub{font-size:13px;color:var(--ink);font-weight:600}
.gband{padding:40px 0;background:var(--bg)}
.areasec{background:#fff}.area-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:30px;align-items:stretch}
.area-map{width:100%;min-height:320px;border:0;border-radius:16px;box-shadow:0 18px 40px rgba(16,42,82,.12)}
.area-list{display:flex;flex-direction:column;justify-content:center;gap:16px}
.area-chips{display:flex;flex-wrap:wrap;gap:9px}.area-chips span{background:var(--bg);border:1px solid var(--line);color:var(--navy);font-weight:600;font-size:13.5px;padding:7px 12px;border-radius:8px}
@media(max-width:820px){.area-grid{grid-template-columns:1fr}.area-map{min-height:240px}}
.mobilebar{display:none}
@media(max-width:760px){.mobilebar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;gap:1px;background:var(--line);box-shadow:0 -6px 20px rgba(0,0,0,.18)}
.mobilebar a{flex:1;text-align:center;padding:14px 8px;font-weight:800;font-size:15px;font-family:'Poppins';background:var(--navy);color:#fff}
.mobilebar a.mb-quote{background:linear-gradient(135deg,var(--amber),var(--amber-d));color:var(--acc-ink)}
body{padding-bottom:56px}}
.pvbar{position:fixed;top:0;left:0;right:0;z-index:200;background:linear-gradient(90deg,#0a1c3a,#15315c);border-bottom:2px solid var(--amber)}
.pvbar-in{max-width:1140px;margin:0 auto;min-height:46px;padding:7px 22px;display:flex;align-items:center;justify-content:center;gap:16px}
.pv-txt{color:#fff;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv-txt b{color:#fff}
.pv-cta{flex:0 0 auto;background:linear-gradient(135deg,var(--amber),var(--amber-d));color:var(--acc-ink);font-weight:800;font-size:13.5px;padding:8px 16px;border-radius:8px;white-space:nowrap;animation:pvpulse 2s infinite}
@keyframes pvpulse{0%,100%{box-shadow:0 0 0 0 rgba(255,183,3,.55)}50%{box-shadow:0 0 0 9px rgba(255,183,3,0)}}
body.preview{padding-top:46px}body.preview header{top:46px}
@media(max-width:640px){.pv-txt{font-size:12px}.pvbar-in{gap:10px;padding:6px 12px}}
</style></head><body${noindex ? ' class="preview"' : ''}>
${previewBar}
<header><div class="wrap hbar">
  <div class="brand"><span class="badge">${esc(s.initials || 'SP')}</span><span class="logo-txt"><b>${esc(b.name)}</b><span>Local · Trusted</span></span></div>
  <nav class="nav"><a class="lnk" href="#services">Services</a><a class="lnk" href="#about">About</a>${(s.reviews || []).length ? '<a class="lnk" href="#reviews">Reviews</a>' : ''}<a class="lnk" href="#contact">Contact</a>${phone ? `<a class="htel" href="${telHref(phone)}"><span class="htel-txt">📞 ${esc(phone)}</span></a>` : ''}<a class="btn btn-amber" href="#contact">Get a Free Quote</a></nav>
</div></header>
${offerBar}
<section class="hero">
  <div class="hero-img" style="background-image:${heroBg}"></div>
  <div class="wrap hero-grid">
    <div class="hero-content">
      ${s.rating ? `<span class="eyebrow">★★★★★ Rated ${esc(s.rating)} by ${esc(s.reviewCount)} customers on Google</span>` : ''}
      <h1>${esc(hero.headline)}</h1><p class="lead">${esc(hero.sub)}</p>
      <div class="hero-cta">${cta}<a class="btn btn-ghost" href="#contact">Get a Free Quote</a></div>
      ${trust ? `<div class="trust-row">${trust}</div>` : ''}
    </div>
    <div class="hero-card">
      <h3>Get a free quote</h3><div class="hc-sub">No obligation, we'll reply fast.</div>
      ${quoteForm('hero-form')}
    </div>
  </div>
</section>
${accred}
<section id="services"><div class="wrap"><div class="sec-head"><div class="kicker">What we do</div><h2>Our services</h2></div><div class="svc-grid">${services}</div></div></section>
<section id="about" class="about"><div class="wrap about-grid">
  <div><div class="kicker">About us</div><h2>${esc((s.about && s.about.heading) || 'About us')}</h2>${paras}${stats ? `<div class="stats">${stats}</div>` : ''}</div>
  ${aboutVisual}
</div></section>
${gallery}${reviews}${googleBand}${areaSec}${faqSec}
<section id="contact"><div class="wrap"><div class="sec-head"><div class="kicker">Get in touch</div><h2>Get your free quote</h2></div>
  <div class="contact-grid">
    <div>
      ${phone ? `<div class="ci"><div class="cic">📞</div><div><b>Call us</b><span><a href="${telHref(phone)}">${esc(phone)}</a></span></div></div>` : ''}
      <div class="ci"><div class="cic">📍</div><div><b>Find us</b><span>${esc(b.address || b.location)}</span></div></div>
      ${hours}
      ${phone ? `<a class="btn btn-amber" style="margin-top:8px" href="${telHref(phone)}">📞 Call now</a>` : ''}
    </div>
    ${quoteForm('contact-form')}
  </div></div></section>
<footer><div class="wrap">
  <div class="foot-top"><div class="brand"><span class="badge">${esc(s.initials || 'SP')}</span><span class="logo-txt"><b>${esc(b.name)}</b><span>${esc(b.location)}</span></span></div>
    <div class="foot-links"><a href="#services">Services</a><a href="#about">About</a><a href="#contact">Contact</a>${phone ? `<a href="${telHref(phone)}">${esc(phone)}</a>` : ''}</div></div>
  <div class="foot-bot"><span>© 2026 ${esc(b.name)}. All rights reserved.</span><span>Powered by <a href="https://aiwebpoint.com/?source=${encodeURIComponent(s.slug || '')}" target="_blank" rel="noopener">aiwebpoint.com</a></span></div>
</div></footer>
${mobileBar}
</body></html>`;
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').replace(/[^a-z0-9-]/gi, '');
  if (!slug) { res.status(400).send('Missing site.'); return; }
  // built-in demo sites (no login / no paid build needed), same renderer
  if (SAMPLES[slug]) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.status(200).send(render(SAMPLES[slug]));
    return;
  }
  try {
    const path = 'sites/' + slug + '.json';
    const { blobs } = await list({ prefix: path });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) { res.setHeader('Content-Type', 'text/html'); res.status(404).send('<h1>Site not found</h1>'); return; }
    const site = await (await fetch(b.url + '?t=' + Date.now())).json();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (site.mode !== 'published') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.status(200).send(render(site));
  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    res.status(500).send('<h1>Could not load this site</h1>');
  }
};

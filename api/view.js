// Serves the shareable "view mockup" page on our own domain.
// Short form: /v/<slug>  (rewritten to ?slug=<slug>) — looks up stored metadata.
// Legacy form: ?img=&name=&loc=&cta=  still supported.
const { list } = require('@vercel/blob');

const BRAND_BLUE = '#4375ED';
const BRAND_MAUVE = '#C485B1';
const AGENCY = process.env.AGENCY_NAME || 'Ai Web Point';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1322;color:#fff;text-align:center}
.wrap{max-width:1040px;margin:0 auto;padding:40px 18px 70px}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  let img = q.img || '';
  let name = q.name || 'your business';
  let loc = q.loc || '';
  let who = q.who || '';
  let cta = q.cta || 'Request a demo of the full website';
  const slug = String(q.slug || '').replace(/[^a-z0-9-]/gi, '');

  // short URL: /v/<slug> -> ?slug=<slug>
  if (q.slug) {
    try {
      const path = 'mockups/' + slug + '.json';
      const { blobs } = await list({ prefix: path });
      const b = blobs.find((x) => x.pathname === path);
      if (!b) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(404).send(page('<h1>Preview not found</h1><p style="color:#9fb0c7">This link may have expired.</p>'));
        return;
      }
      const r = await fetch(b.url + '?t=' + Date.now());
      const meta = await r.json();
      img = meta.img || '';
      name = meta.name || name;
      loc = meta.loc || '';
      who = meta.who || '';
      cta = meta.cta || cta;
    } catch (e) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(500).send(page('<h1>Could not load this preview</h1>'));
      return;
    }
  }

  cta = String(cta).slice(0, 60);
  if (!img) { res.status(400).send('Missing image.'); return; }

  // serve the image via our own /i/<slug>.png so the blob host is never exposed
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = process.env.LINK_DOMAIN ? `https://${process.env.LINK_DOMAIN}` : `https://${host}`;
  const imgSrc = slug ? `${base}/i/${slug}.png` : img;

  const demo = process.env.DEMO_URL || 'mailto:hello@aiwebpoint.com?subject=Website%20demo%20-%20' + encodeURIComponent(name);
  // tracked link back to the agency site — utm identifies which prospect viewed
  const utm = 'preview' + (slug ? '-' + slug : '');
  const agencyUrl = `https://aiwebpoint.com/?utm_source=${encodeURIComponent(utm)}`;
  const title = `${esc(name)} — website preview by ${AGENCY}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta property="og:title" content="${title}"/>
<meta property="og:image" content="${esc(imgSrc)}"/>
<meta property="og:description" content="A free website home-page concept for ${esc(name)}."/>
<meta name="twitter:card" content="summary_large_image"/>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1322;color:#fff;text-align:center}
  .wrap{max-width:1040px;margin:0 auto;padding:30px 18px 70px}
  h1{font-size:23px;font-weight:700;margin:10px 0 4px}
  p.sub{color:#9fb0c7;margin:0 0 22px}
  img{width:100%;height:auto;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.5);display:block}
  .cta{display:inline-block;margin-top:28px;padding:17px 34px;border-radius:999px;color:#fff;font-weight:700;
       text-decoration:none;background:linear-gradient(90deg,${BRAND_BLUE},${BRAND_MAUVE});font-size:18px}
  .cta:hover{filter:brightness(1.06)}
  .foot{margin-top:30px;color:#7e8ca3;font-size:13px;line-height:1.6}
  .logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;margin-bottom:12px;font-size:18px}
  .badge{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MAUVE});
         display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff}
  .who{color:#ffd166;font-weight:800}
  .foot a{color:#9fb0c7}
</style></head><body><div class="wrap">
  <div class="logo"><span class="badge">AW</span> ${AGENCY}</div>
  <h1>A website preview for ${who ? '<span class="who">' + esc(who) + '</span> · ' : ''}${esc(name)}${loc ? ' · ' + esc(loc) : ''}</h1>
  <p class="sub">Here's a free home-page concept we designed for you.</p>
  <a href="${esc(demo)}" class="demo" target="_blank" rel="noopener"><img src="${esc(imgSrc)}" alt="Website mockup for ${esc(name)}"/></a>
  <div><a class="cta demo" href="${esc(demo)}" target="_blank" rel="noopener">${esc(cta)} &rarr;</a></div>
  <p class="foot">Designed by <a href="${agencyUrl}" target="_blank" rel="noopener">${AGENCY}</a>. Prefer to talk? We'll walk you through the full website over a quick call.</p>
</div>${slug ? `<script>
(function(){var s=${JSON.stringify(slug)};
function t(e){try{var q=new URLSearchParams(location.search);var c=(q.get('c')||q.get('p')||'');var u='/api/track?slug='+encodeURIComponent(s)+'&e='+e+(c?'&c='+encodeURIComponent(c):'');if(navigator.sendBeacon){navigator.sendBeacon(u);}else{fetch(u,{keepalive:true});}}catch(x){}}
t('view');
document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a.demo'):null;if(a){t('cta');}},true);
})();
</script>` : ''}</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};

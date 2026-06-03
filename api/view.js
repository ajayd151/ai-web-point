// Serves the shareable "view mockup" page on our own domain (Vercel Blob won't
// render user-uploaded HTML). Takes ?img=<png url>&name=<business>&loc=<location>.
const BRAND_BLUE = '#4375ED';
const BRAND_MAUVE = '#C485B1';
const AGENCY = 'Ai Web Point';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = (req, res) => {
  const q = req.query || {};
  const img = q.img || '';
  const name = q.name || 'your business';
  const loc = q.loc || '';
  const demo = process.env.DEMO_URL || 'mailto:hello@aiwebpoint.com?subject=Website%20demo%20-%20' + encodeURIComponent(name);

  if (!img) {
    res.status(400).send('Missing image.');
    return;
  }

  const title = `${esc(name)} — website preview by ${AGENCY}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta property="og:title" content="${title}"/>
<meta property="og:image" content="${esc(img)}"/>
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
</style></head><body><div class="wrap">
  <div class="logo"><span class="badge">AW</span> ${AGENCY}</div>
  <h1>A website preview for ${esc(name)}${loc ? ' · ' + esc(loc) : ''}</h1>
  <p class="sub">Here's a free home-page concept we designed for you.</p>
  <img src="${esc(img)}" alt="Website mockup for ${esc(name)}"/>
  <div><a class="cta" href="${esc(demo)}">Request a demo of the full website &rarr;</a></div>
  <p class="foot">Designed by ${AGENCY}. Prefer to talk? We'll walk you through the full website over a quick call.</p>
</div></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};

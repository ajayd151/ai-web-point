// Serves the shareable "view mockup" page on our own domain.
// Short form: /v/<slug>  (rewritten to ?slug=<slug>), looks up stored metadata.
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
  // tracked link back to the agency site, utm identifies which prospect viewed
  const utm = 'preview' + (slug ? '-' + slug : '');
  const agencyUrl = `https://aiwebpoint.com/?utm_source=${encodeURIComponent(utm)}`;
  const title = `${esc(name)}, website preview by ${AGENCY}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
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
  .cta-nudge{margin:32px 0 0;color:#cdd8ec;font-size:17px;font-weight:600}
  .cta-row{display:flex;gap:14px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:12px}
  .cta{display:inline-flex;align-items:center;gap:10px;padding:20px 40px;border-radius:14px;color:#fff;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.3);
       text-decoration:none;background:linear-gradient(135deg,#22c55e,#15994a);font-size:20px;box-shadow:0 14px 34px rgba(34,197,94,.45);animation:ctapulse 2s infinite}
  .cta:hover{transform:translateY(-2px);filter:brightness(1.06)}
  @keyframes ctapulse{0%,100%{box-shadow:0 14px 34px rgba(34,197,94,.4)}50%{box-shadow:0 14px 46px rgba(34,197,94,.75)}}
  .nothanks{padding:18px 26px;border-radius:14px;border:1.5px solid #5b3a44;background:#2a1620;color:#ff9b9b;font-weight:700;font-size:16px;cursor:pointer}
  .nothanks:hover{background:#3a1d28}
  .decline-panel{display:none;max-width:520px;margin:18px auto 0;background:#111b2e;border:1px solid #25324a;border-radius:14px;padding:18px 20px;text-align:left}
  .decline-panel p{margin:0 0 12px;color:#cdd8ec;font-size:15px}
  .reasons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .reasons button{padding:9px 13px;border-radius:999px;border:1px solid #2f3e58;background:#16233b;color:#cdd8ec;font-size:13.5px;font-weight:600;cursor:pointer}
  .reasons button.sel{background:#2563eb;color:#fff;border-color:transparent}
  .decline-panel textarea{width:100%;padding:11px 13px;border-radius:10px;border:1px solid #2f3e58;background:#0e1626;color:#fff;font:inherit;font-size:14px}
  .decline-send{margin-top:12px;padding:13px 26px;border-radius:10px;border:none;background:#e23b3b;color:#fff;font-weight:800;font-size:15px;cursor:pointer}
  .decline-done{display:none;max-width:520px;margin:18px auto 0;background:#0e2417;border:1px solid #1e5b3a;border-radius:12px;padding:16px;color:#86efac;font-weight:600;font-size:16px}
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
  <p class="cta-nudge">👇 Like your new website${who ? ', ' + esc(who) : ''}? Let's make it real:</p>
  <div class="cta-row">
    <a class="cta demo" href="${esc(demo)}" target="_blank" rel="noopener">📞 Yes, I'd like a demo for ${esc(name)} &rarr;</a>
    <button class="nothanks" id="nothanks" type="button">No thanks</button>
  </div>
  <div class="decline-panel" id="declinePanel">
    <p>No problem, we won't contact you again. Mind telling us why? (optional)</p>
    <div class="reasons" id="reasons">
      <button type="button" data-r="Already have a website">Already have a website</button>
      <button type="button" data-r="Not interested">Not interested</button>
      <button type="button" data-r="Bad timing">Bad timing</button>
      <button type="button" data-r="Too expensive">Too expensive</button>
    </div>
    <textarea id="declineComment" rows="2" placeholder="Anything else? (optional)"></textarea>
    <div><button class="decline-send" id="declineSend" type="button">Send</button></div>
  </div>
  <div class="decline-done" id="declineDone">✓ Thanks for letting us know. All the best!</div>
  <p class="foot">Designed by <a href="${agencyUrl}" target="_blank" rel="noopener">${AGENCY}</a>. Prefer to talk? We'll walk you through the full website over a quick call.</p>
</div>${slug ? `<script>
(function(){var s=${JSON.stringify(slug)};
function t(e){try{var q=new URLSearchParams(location.search);var c=(q.get('c')||q.get('p')||'');var u='/api/track?slug='+encodeURIComponent(s)+'&e='+e+(c?'&c='+encodeURIComponent(c):'');if(navigator.sendBeacon){navigator.sendBeacon(u);}else{fetch(u,{keepalive:true});}}catch(x){}}
t('view');
document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a.demo'):null;if(a){t('cta');}},true);
var sel='';var nt=document.getElementById('nothanks');var panel=document.getElementById('declinePanel');var reasonsEl=document.getElementById('reasons');
if(nt){nt.addEventListener('click',function(){if(panel)panel.style.display='block';nt.style.display='none';});}
if(reasonsEl){reasonsEl.addEventListener('click',function(ev){var b=ev.target&&ev.target.closest?ev.target.closest('button[data-r]'):null;if(!b)return;var was=b.classList.contains('sel');Array.prototype.forEach.call(reasonsEl.querySelectorAll('button'),function(x){x.classList.remove('sel');});if(!was){b.classList.add('sel');sel=b.getAttribute('data-r');}else{sel='';}});}
var ds=document.getElementById('declineSend');
if(ds){ds.addEventListener('click',function(){var fb='';var c=document.getElementById('declineComment');if(c)fb=c.value||'';try{fetch('/api/decline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s,reason:sel,feedback:fb}),keepalive:true});}catch(x){}if(panel)panel.style.display='none';var done=document.getElementById('declineDone');if(done)done.style.display='block';var row=document.querySelector('.cta-row');if(row)row.style.display='none';var nudge=document.querySelector('.cta-nudge');if(nudge)nudge.style.display='none';});}
})();
</script>` : ''}</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); // keep prospect previews out of search
  res.status(200).send(html);
};

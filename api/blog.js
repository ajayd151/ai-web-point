// Site Pounce blog. Served at /blog (index) and /blog/<slug> (article) via rewrites. Renders
// brand-consistent pages with proper SEO (title, description, canonical, Open Graph, JSON-LD) so
// the content can rank and pull in prospects. Pure content, no auth.
const { ARTICLES, getArticle } = require('../lib/articles');

const SITE = 'https://www.sitepounce.com';
const BRAND_SVG = '<svg class="bm" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 C14.6 3 7 10.6 7 20 C7 31.9 24 46 24 46 C24 46 41 31.9 41 20 C41 10.6 33.4 3 24 3 Z" fill="#0FB6A8"/><circle cx="24" cy="19.5" r="9.6" fill="#fff"/><path d="M25.6 10.8 L17.4 22 L22.6 22 L20.8 28.4 L30.6 16.6 L24.8 16.6 Z" fill="#FF6B6B"/></svg>';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtDate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } }

function shell(opts) {
  const canonical = SITE + opts.path;
  const jsonld = opts.jsonld ? '<script type="application/ld+json">' + JSON.stringify(opts.jsonld) + '</script>' : '';
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${opts.ogType || 'website'}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Site Pounce">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0FB6A8">
<style>
:root{--teal:#0FB6A8;--ink:#0f2233;--muted:#5b6b7a;--line:#e6ecf1;--bg:#f6f9fb}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.65}
a{color:#0e8a80}
.bnav{display:flex;align-items:center;justify-content:space-between;max-width:920px;margin:0 auto;padding:18px 20px}
.bbrand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:19px;text-decoration:none;color:var(--ink)}
.bm{width:26px;height:26px}.tt{color:var(--teal)}
.bnav-cta{background:var(--teal);color:#fff;text-decoration:none;font-weight:700;padding:8px 16px;border-radius:9px;font-size:14px}
.wrap{max-width:720px;margin:0 auto;padding:14px 20px 60px}
.crumbs{font-size:13px;color:var(--muted);margin:8px 0 4px}.crumbs a{color:var(--muted)}
h1{font-size:34px;line-height:1.2;margin:10px 0 6px;letter-spacing:-.5px}
h2{font-size:22px;margin:30px 0 8px}
.meta{color:var(--muted);font-size:14px;margin-bottom:8px}
.post p,.post li{font-size:17px;color:#22323f}
.post ul{padding-left:20px}
.tags{margin:6px 0 26px}.tag{display:inline-block;background:#eef6f5;color:#0e8a80;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;margin-right:6px}
.cardlist{display:grid;gap:14px;margin-top:8px}
.card{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:14px;padding:18px 20px;transition:box-shadow .12s,transform .12s}
.card:hover{box-shadow:0 6px 22px rgba(15,34,51,.08);transform:translateY(-1px)}
.card h3{margin:0 0 4px;font-size:20px}.card p{margin:0;color:var(--muted);font-size:15px}
.lead{font-size:18px;color:var(--muted);margin:0 0 20px}
.cta-box{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:26px;text-align:center;margin:40px 0 10px}
.cta-box h3{margin:0 0 6px;font-size:22px}.cta-box p{margin:0 0 16px;color:var(--muted)}
.cta-btn{display:inline-block;background:var(--teal);color:#fff;text-decoration:none;font-weight:800;padding:13px 26px;border-radius:11px}
.bfoot{border-top:1px solid var(--line);margin-top:40px}
.bfoot-in{max-width:920px;margin:0 auto;padding:22px 20px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;color:var(--muted);font-size:14px}
.bfoot a{color:var(--muted);margin-left:16px}
@media(max-width:600px){h1{font-size:27px}.post p,.post li{font-size:16px}}
</style>
${jsonld}
</head><body>
<header><div class="bnav"><a class="bbrand" href="/">${BRAND_SVG}Site<span class="tt">Pounce</span></a><a class="bnav-cta" href="/#pricing">Get started</a></div></header>
<main class="wrap">${opts.main}</main>
<div class="cta-box"><h3>Find local leads worth calling</h3><p>Site Pounce finds local businesses with no website, then helps you turn them into clients.</p><a class="cta-btn" href="/#pricing">See plans</a></div>
<footer class="bfoot"><div class="bfoot-in"><div>&copy; Site Pounce</div><div><a href="/">Home</a><a href="/blog">Blog</a><a href="/#pricing">Pricing</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a></div></div></footer>
</body></html>`;
}

function indexPage() {
  const cards = ARTICLES.map((a) => `<a class="card" href="/blog/${esc(a.slug)}"><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p></a>`).join('');
  return shell({
    path: '/blog',
    title: 'Blog, practical guides on local lead generation and outreach | Site Pounce',
    description: 'Practical, no nonsense guides on finding local business leads, cold outreach that does not get you banned, and selling websites to local businesses.',
    main: `<h1>The Site Pounce blog</h1><p class="lead">Practical guides on finding local leads, reaching out without getting banned, and winning the work.</p><div class="cardlist">${cards}</div>`,
  });
}

function articlePage(a) {
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.description,
    datePublished: a.date, dateModified: a.date, author: { '@type': 'Organization', name: 'Site Pounce' },
    publisher: { '@type': 'Organization', name: 'Site Pounce' }, mainEntityOfPage: SITE + '/blog/' + a.slug,
  };
  return shell({
    path: '/blog/' + a.slug, ogType: 'article', jsonld: jsonld,
    title: a.title + ' | Site Pounce',
    description: a.description,
    main: `<div class="crumbs"><a href="/blog">Blog</a> / ${esc(a.title)}</div>`
      + `<h1>${esc(a.title)}</h1><div class="meta">${fmtDate(a.date)}</div>`
      + `<div class="tags">${(a.tags || []).map((t) => '<span class="tag">' + esc(t) + '</span>').join('')}</div>`
      + `<div class="post">${a.body}</div>`,
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  const slug = (req.query && req.query.slug) || '';
  if (!slug) { res.status(200).send(indexPage()); return; }
  const a = getArticle(slug);
  if (!a) { res.setHeader('X-Robots-Tag', 'noindex'); res.status(404).send(shell({ path: '/blog', title: 'Not found | Site Pounce', description: '', main: '<h1>Post not found</h1><p><a href="/blog">Back to the blog</a></p>' })); return; }
  res.status(200).send(articlePage(a));
};

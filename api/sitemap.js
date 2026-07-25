// XML sitemap at /sitemap.xml so search engines discover the marketing pages + every blog post.
const { ARTICLES } = require('../lib/articles');
const SITE = 'https://www.sitepounce.com';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  const urls = [
    { loc: SITE + '/', pri: '1.0' },
    { loc: SITE + '/blog', pri: '0.8' },
  ].concat(ARTICLES.map((a) => ({ loc: SITE + '/blog/' + a.slug, pri: '0.7', lastmod: a.date })));
  const body = urls.map((u) => '<url><loc>' + u.loc + '</loc>' + (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '<priority>' + u.pri + '</priority></url>').join('');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + body + '</urlset>');
};

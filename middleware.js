// Edge middleware: when a request hits a client subdomain of aiwebpoint.com
// (e.g. ashgardens.aiwebpoint.com), rewrite the homepage to the Pounce site
// renderer (/api/site?sub=…), which looks the subdomain up -> slug -> renders.
// Everything else (the app on sitepounce.com / *.vercel.app, and the reserved
// subdomains preview/www/etc.) passes straight through untouched.
//
// Only runs on "/" (config.matcher) and fails safe: any error -> next().
import { next, rewrite } from '@vercel/edge';

export const config = { matcher: '/' };

const RESERVED = ['www', 'preview', 'app', 'api', 'mail', 'ftp', 'admin', 'cdn', 'static', 'assets'];

export default function middleware(request) {
  try {
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    const m = host.match(/^([a-z0-9-]+)\.aiwebpoint\.com$/);
    if (m && RESERVED.indexOf(m[1]) === -1) {
      return rewrite(new URL('/api/site?sub=' + encodeURIComponent(m[1]), request.url));
    }
  } catch (e) { /* fall through to next() */ }
  return next();
}

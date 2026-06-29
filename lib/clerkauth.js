// Verifies a Clerk session JWT with NO external dependency: we fetch Clerk's
// public JWKS and check the RS256 signature with Node's built-in crypto. This
// keeps the live Vercel build safe (no new npm package to break it). The Clerk
// SECRET key is never needed here, session tokens are verified with public keys.
const crypto = require('crypto');
const https = require('https');

let _jwks = null;
let _jwksAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // cache keys for an hour

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

async function getJwks(issuer) {
  const now = Date.now();
  if (_jwks && now - _jwksAt < JWKS_TTL_MS) return _jwks;
  const base = String(issuer || '').replace(/\/$/, '');
  const j = await fetchJSON(base + '/.well-known/jwks.json');
  _jwks = (j && j.keys) || [];
  _jwksAt = now;
  return _jwks;
}

function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Returns the decoded payload (sub, email, exp, iss, ...) when the token is a
// valid, unexpired Clerk session token for `issuer`; otherwise null.
async function verifyClerkToken(token, issuer) {
  try {
    if (!token || !issuer) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
    const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const keys = await getJwks(issuer);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(parts[0] + '.' + parts[1]);
    const sig = b64urlToBuf(parts[2]);
    if (!crypto.verify('RSA-SHA256', signingInput, pub, sig)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now - 5) return null;     // expired
    if (payload.nbf && payload.nbf > now + 5) return null;      // not yet valid
    const iss = String(payload.iss || '').replace(/\/$/, '');
    if (iss && iss !== String(issuer).replace(/\/$/, '')) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = { verifyClerkToken };

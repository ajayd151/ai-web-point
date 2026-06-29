// Minimal Stripe REST client with NO npm dependency (keeps the Vercel build safe;
// also we can't npm-install locally). Calls api.stripe.com with the secret key,
// form-encoding params in Stripe's bracket notation. Returns parsed JSON.
const https = require('https');

function secret() { return process.env.STRIPE_SECRET_KEY || ''; }
function configured() { return !!secret(); }

// Encode nested objects/arrays the way Stripe expects:
// { line_items: [{ price: 'x', quantity: 1 }] } -> line_items[0][price]=x&line_items[0][quantity]=1
function encode(obj, prefix, pairs) {
  pairs = pairs || [];
  Object.keys(obj).forEach((key) => {
    const val = obj[key];
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item && typeof item === 'object') encode(item, name + '[' + i + ']', pairs);
        else pairs.push([name + '[' + i + ']', String(item)]);
      });
    } else if (typeof val === 'object') {
      encode(val, name, pairs);
    } else {
      pairs.push([name, String(val)]);
    }
  });
  return pairs;
}
function formBody(params) {
  return encode(params || {}, '', []).map((p) => encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1])).join('&');
}

function stripeReq(method, path, params) {
  const body = (method === 'POST') ? formBody(params) : '';
  const qs = (method === 'GET' && params) ? ('?' + formBody(params)) : '';
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/' + path + qs,
      method: method,
      headers: {
        Authorization: 'Bearer ' + secret(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(d || '{}'); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error((json.error && json.error.message) || ('Stripe ' + res.statusCode)));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { stripeReq, configured };

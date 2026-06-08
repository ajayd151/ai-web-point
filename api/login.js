// Validates username/password against env vars and, on success, sets a signed
// HttpOnly session cookie. The password is never returned to the client.
const { sign, constantEquals } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // status check (does a valid session cookie exist?), used by the UI on load
    const { verify, parseCookie } = require('../lib/auth');
    res.status(200).json({ authed: verify(parseCookie(req, 'aiwp'), Date.now()), configured: !!process.env.APP_PASSWORD });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body || {};
    const wantU = process.env.APP_USERNAME || '';
    const wantP = process.env.APP_PASSWORD || '';
    if (!wantP) {
      res.status(503).json({ error: 'Login is not configured yet.' });
      return;
    }
    const okUser = wantU ? body.username === wantU : true;
    const okPass = constantEquals(body.password || '', wantP);
    if (!okUser || !okPass) {
      res.status(401).json({ error: 'Incorrect username or password.' });
      return;
    }
    const token = sign(body.username || 'user', Date.now());
    res.setHeader('Set-Cookie', `aiwp=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
};

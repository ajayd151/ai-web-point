// Lists sign-ups from the Clerk Admin API (needs CLERK_SECRET_KEY). Zero-dep https.
// Returns null if no secret key, [] on any error, else normalised user rows. Used only
// by the owner-only Admin > Customers screen.
const https = require('https');

function listClerkUsers(limit) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return Promise.resolve(null);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.clerk.com',
      path: '/v1/users?limit=' + lim + '&order_by=-created_at',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d || '[]');
          if (!Array.isArray(j)) { resolve([]); return; }
          resolve(j.map((u) => {
            const emails = u.email_addresses || [];
            const pe = emails.find((e) => e.id === u.primary_email_address_id) || emails[0] || {};
            return {
              clerkId: u.id,
              email: String(pe.email_address || '').toLowerCase(),
              name: ((u.first_name || '') + ' ' + (u.last_name || '')).trim(),
              createdAt: u.created_at || null,       // epoch ms
              lastSignInAt: u.last_sign_in_at || null, // epoch ms
            };
          }));
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// Create a Clerk account (so a team member can just sign in). Returns
// { ok:true, id } on success, { exists:true } if the email already has an account,
// or { error } otherwise. Needs CLERK_SECRET_KEY.
function createClerkUser({ email, firstName, lastName, password }) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return Promise.resolve({ error: 'clerk_not_configured' });
  const payload = JSON.stringify({
    email_address: [String(email || '').toLowerCase()],
    password: password,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    skip_password_checks: true, // allow our generated password without strength/breach checks
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.clerk.com', path: '/v1/users', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(d || '{}'); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve({ ok: true, id: j.id }); return; }
        const errs = (j && j.errors) || [];
        const exists = errs.some((e) => /that email address exists|already exists|taken|duplicate/i.test((e && (e.message + ' ' + e.long_message)) || ''));
        resolve(exists ? { exists: true } : { error: (errs[0] && errs[0].message) || ('Clerk ' + res.statusCode) });
      });
    });
    req.on('error', () => resolve({ error: 'network' }));
    req.write(payload); req.end();
  });
}

module.exports = { listClerkUsers, createClerkUser };

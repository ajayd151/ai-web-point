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

module.exports = { listClerkUsers };

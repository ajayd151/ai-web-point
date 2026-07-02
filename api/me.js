// Tells the front-end who is signed in and whether they have paid access, so the
// UI can show the app (subscribed) or the paywall (signed in, no plan yet). Read-only.
const { account, canDeepDossier } = require('../lib/access');

module.exports = async (req, res) => {
  const a = await account(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    loggedIn: !!a.email,
    email: a.email,
    access: !!a.access,
    plan: a.plan,
    status: a.status,
    member: !!a.member,   // true = a team member (restricted by permissions)
    perms: a.perms || {}, // permission map, used by the UI to hide what they can't do
    deepdossier: canDeepDossier(a.email), // private MVP: gates the hidden DeepDossier nav button
  });
};
